import Incident from '../models/Incident.js';
import AuditLog from '../models/AuditLog.js';
import { calculatePriority } from '../utils/priorityMatrix.js';
import { computeSlaTargets } from '../utils/slaEngine.js';
import { getDeterministicRecommendations } from '../services/recommendationEngine.js';
import { emitIncidentEvent } from '../services/socketService.js';

const VALID_SOURCES = ['manual', 'prometheus', 'datadog', 'cloudwatch', 'synthetic', 'webhook'];
const VALID_CATEGORIES = ['availability', 'latency', 'data_integrity', 'security', 'infrastructure', 'deployment'];
const VALID_IMPACTS = ['enterprise', 'department', 'single_user'];
const VALID_URGENCIES = ['critical', 'moderate', 'low'];

/**
 * Maps raw external severity labels (e.g. Datadog, Prometheus Alertmanager) to ITIL impact/urgency
 */
function deriveImpactAndUrgency(payload) {
  let impact = payload.impact;
  let urgency = payload.urgency;

  // If explicit valid values are provided, use them
  if (VALID_IMPACTS.includes(impact) && VALID_URGENCIES.includes(urgency)) {
    return { impact, urgency };
  }

  // Derive from severity or level if impact or urgency is absent
  const rawSeverity = String(payload.severity || payload.level || payload.priority || '').toLowerCase().trim();

  if (['critical', 'p1', 'disaster', 'emergency', 'page'].includes(rawSeverity)) {
    impact = impact || 'enterprise';
    urgency = urgency || 'critical';
  } else if (['high', 'p2', 'error', 'alert'].includes(rawSeverity)) {
    impact = impact || 'department';
    urgency = urgency || 'critical';
  } else if (['warn', 'warning', 'medium', 'p3', 'moderate'].includes(rawSeverity)) {
    impact = impact || 'department';
    urgency = urgency || 'moderate';
  } else if (['low', 'info', 'informational', 'p4', 'p5', 'debug'].includes(rawSeverity)) {
    impact = impact || 'single_user';
    urgency = urgency || 'low';
  } else {
    impact = impact || 'department';
    urgency = urgency || 'moderate';
  }

  // Ensure valid enums
  if (!VALID_IMPACTS.includes(impact)) impact = 'department';
  if (!VALID_URGENCIES.includes(urgency)) urgency = 'moderate';

  return { impact, urgency };
}

/**
 * Map integration credentials and payload to permitted incident source
 */
function deriveSource(payload, apiKey) {
  const payloadSource = String(payload.source || '').toLowerCase().trim();
  if (VALID_SOURCES.includes(payloadSource)) {
    return payloadSource;
  }
  const keyProvider = String(apiKey?.provider || '').toLowerCase().trim();
  if (VALID_SOURCES.includes(keyProvider)) {
    return keyProvider;
  }
  return 'webhook';
}

/**
 * Controller: Secure Ingestion Endpoint for Monitoring Alerts & Tools
 * POST /api/v1/ingest/incidents
 */
export async function ingestIncident(req, res, next) {
  try {
    const payload = req.body;

    // 1. Validate payload existence and shape
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Malformed or empty JSON payload received.',
      });
    }

    const {
      title,
      description,
      affectedService,
      category,
      assignedTeam,
      reproductionSteps,
      environment,
      tags,
    } = payload;

    // 2. Validate required core fields
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed: Incident title is required.',
      });
    }

    if (title.trim().length > 200) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed: Incident title cannot exceed 200 characters.',
      });
    }

    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed: Incident description is required.',
      });
    }

    if (description.trim().length > 30000) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed: Incident description exceeds maximum allowed length.',
      });
    }

    if (!affectedService || typeof affectedService !== 'string' || !affectedService.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed: Affected service is required.',
      });
    }

    // 3. Extract Idempotency Key / External Event ID from Body and Headers
    const externalEventId =
      payload.externalEventId ||
      payload.eventId ||
      payload.alertId ||
      req.headers['x-event-id'] ||
      null;

    const idempotencyKey =
      payload.idempotencyKey ||
      req.headers['idempotency-key'] ||
      req.headers['x-idempotency-key'] ||
      externalEventId ||
      null;

    const source = deriveSource(payload, req.apiKey);

    // 4. Idempotency Deduplication Check
    // If externalEventId or idempotencyKey was provided, check if matching incident exists
    if (idempotencyKey || externalEventId) {
      const matchCriteria = [];
      if (idempotencyKey) {
        matchCriteria.push({ idempotencyKey: String(idempotencyKey).trim() });
      }
      if (externalEventId) {
        matchCriteria.push({
          source,
          externalEventId: String(externalEventId).trim(),
        });
      }

      const existingIncident = await Incident.findOne({ $or: matchCriteria });

      if (existingIncident) {
        // Return 200 with idempotent retry flag and existing record
        return res.status(200).json({
          success: true,
          isDuplicateRetry: true,
          message: 'Duplicate event detected. Returning existing incident record.',
          incident: existingIncident,
        });
      }
    }

    // 5. Derive Impact & Urgency
    const { impact, urgency } = deriveImpactAndUrgency(payload);

    // 6. Reuse Priority Calculation (ITIL 3x3 Deterministic Matrix)
    const priorityCalc = calculatePriority(impact, urgency);

    // 7. Reuse SLA Countdown Engine
    const sla = computeSlaTargets(priorityCalc.code, new Date());

    // 8. Reuse Deterministic Triage & Recommendations Engine
    const triage = await getDeterministicRecommendations({
      title: title.trim(),
      description: description.trim(),
      affectedService: affectedService.trim(),
      impact,
      urgency,
      reproductionSteps: reproductionSteps ? String(reproductionSteps).trim() : '',
      category: category && VALID_CATEGORIES.includes(category) ? category : null,
    });

    const finalCategory =
      category && VALID_CATEGORIES.includes(category)
        ? category
        : triage.suggestedCategory || 'availability';

    const finalTeam =
      assignedTeam && typeof assignedTeam === 'string' && assignedTeam.trim()
        ? assignedTeam.trim()
        : triage.suggestedTeam || 'Platform SRE';

    // Parse tags safely
    const tagList = Array.isArray(tags)
      ? tags.map((t) => String(t).trim()).filter(Boolean)
      : typeof tags === 'string'
      ? tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    // 9. Persist Incident in MongoDB
    const incident = await Incident.create({
      title: title.trim(),
      description: description.trim(),
      reproductionSteps: reproductionSteps ? String(reproductionSteps).trim() : '',
      affectedService: affectedService.toLowerCase().trim(),
      source,
      category: finalCategory,
      impact,
      urgency,
      priority: priorityCalc.code,
      assignedTeam: finalTeam,
      reporter: req.apiKey.createdBy || null,
      sla,
      externalEventId: externalEventId ? String(externalEventId).trim() : null,
      idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : null,
      integrationMetadata: {
        keyId: req.apiKey._id,
        keyPrefix: req.apiKey.apiKeyPrefix,
        serviceName: req.apiKey.serviceName,
        provider: req.apiKey.provider,
        ingestedAt: new Date(),
        clientIp: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      },
      classificationMetadata: {
        environment: environment || 'production',
        tags: tagList,
        confidenceScore: 0.95,
      },
    });

    // 10. Record Safe Audit Log
    await AuditLog.create({
      incidentId: incident._id,
      actorName: `M2M Integration (${req.apiKey.serviceName})`,
      actorRole: 'system',
      action: 'INCIDENT_INGESTED',
      newState: {
        incidentNumber: incident.incidentNumber,
        priority: incident.priority,
        status: incident.status,
        source: incident.source,
        externalEventId: incident.externalEventId,
        idempotencyKey: incident.idempotencyKey,
      },
      reason: `Ingested from ${req.apiKey.provider} via API key ${req.apiKey.apiKeyPrefix}... with priority ${priorityCalc.code}`,
    });

    // 11. Broadcast Real-Time Socket Event
    emitIncidentEvent('incident:created', incident);

    // 12. Return Consistent 201 Created Response
    res.status(201).json({
      success: true,
      isDuplicateRetry: false,
      message: 'Incident ingested successfully.',
      incident,
    });
  } catch (err) {
    next(err);
  }
}
