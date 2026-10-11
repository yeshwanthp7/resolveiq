import Incident from '../models/Incident.js';
import DeploymentEvent from '../models/DeploymentEvent.js';
import CorrelationDecision from '../models/CorrelationDecision.js';
import AuditLog from '../models/AuditLog.js';
import {
  getCorrelationGraphData,
  scoreIncidentToIncident,
  scoreDeploymentToIncident,
  recordCorrelationDecision,
  checkServiceDependency,
  SERVICE_DEPENDENCY_GRAPH,
} from '../services/correlationService.js';
import { emitIncidentEvent } from '../services/socketService.js';

/**
 * 1. GET /api/v1/correlations/graph
 * Retrieve entire correlation topology graph with nodes, edges, clusters
 */
export async function getCorrelationGraph(req, res, next) {
  try {
    const { windowHours = 48, minScore = 0.25, service = 'all' } = req.query;

    const graphData = await getCorrelationGraphData({
      windowHours: parseInt(windowHours, 10),
      minScore: parseFloat(minScore),
      service,
    });

    res.status(200).json({
      success: true,
      graph: graphData,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. GET /api/v1/correlations/incident/:id
 * Retrieve candidate correlations and blast radius for a specific incident
 */
export async function getIncidentCorrelations(req, res, next) {
  try {
    const { id } = req.params;

    const incident = await Incident.findById(id).lean();
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const incTime = incident.createdAt ? new Date(incident.createdAt).getTime() : Date.now();
    const windowStart = new Date(incTime - 6 * 60 * 60 * 1000); // 6h before
    const windowEnd = new Date(incTime + 6 * 60 * 60 * 1000); // 6h after

    // Find other incidents in temporal window
    const [candidateIncidents, candidateDeployments, decisions] = await Promise.all([
      Incident.find({
        _id: { $ne: incident._id },
        createdAt: { $gte: windowStart, $lte: windowEnd },
      })
        .select('incidentNumber title affectedService priority status createdAt')
        .lean(),
      DeploymentEvent.find({
        deployedAt: { $gte: windowStart, $lte: new Date(incTime + 15 * 60000) },
      })
        .select('service serviceName version environment status changeSummary changeReference deployedAt')
        .lean(),
      CorrelationDecision.find({
        $or: [{ sourceIncidentId: incident._id }, { targetIncidentId: incident._id }],
      }).lean(),
    ]);

    // Score candidate incidents
    const correlatedIncidents = [];
    for (const other of candidateIncidents) {
      const score = scoreIncidentToIncident(incident, other, { timeWindowMinutes: 360 });
      if (score && score.confidenceScore >= 0.25) {
        const existingDecision = decisions.find(
          (d) =>
            (d.sourceIncidentId?.toString() === incident._id.toString() &&
              d.targetIncidentId?.toString() === other._id.toString()) ||
            (d.sourceIncidentId?.toString() === other._id.toString() &&
              d.targetIncidentId?.toString() === incident._id.toString())
        );

        correlatedIncidents.push({
          incident: other,
          ...score,
          decision: existingDecision?.decision || 'unverified',
          isRootCause: existingDecision?.isRootCause || false,
          decisionId: existingDecision?._id || null,
        });
      }
    }

    // Score candidate deployments
    const correlatedDeployments = [];
    for (const dep of candidateDeployments) {
      const score = scoreDeploymentToIncident(dep, incident, { maxPrecedingHours: 6 });
      if (score && score.confidenceScore >= 0.25) {
        const existingDecision = decisions.find(
          (d) =>
            d.deploymentId?.toString() === dep._id.toString() &&
            d.sourceIncidentId?.toString() === incident._id.toString()
        );

        correlatedDeployments.push({
          deployment: dep,
          ...score,
          decision: existingDecision?.decision || 'unverified',
          isRootCause: existingDecision?.isRootCause || false,
          verifiedRootCause: existingDecision?.verifiedRootCause || '',
          decisionId: existingDecision?._id || null,
        });
      }
    }

    // Service dependencies for this service
    const serviceName = incident.affectedService;
    const dependencies = SERVICE_DEPENDENCY_GRAPH[serviceName] || [];
    const upstreamDependents = Object.entries(SERVICE_DEPENDENCY_GRAPH)
      .filter(([_, deps]) => deps.includes(serviceName))
      .map(([s]) => s);

    res.status(200).json({
      success: true,
      incident: {
        id: incident._id,
        incidentNumber: incident.incidentNumber,
        title: incident.title,
        service: incident.affectedService,
        priority: incident.priority,
        status: incident.status,
      },
      correlatedIncidents: correlatedIncidents.sort((a, b) => b.confidenceScore - a.confidenceScore),
      correlatedDeployments: correlatedDeployments.sort((a, b) => b.confidenceScore - a.confidenceScore),
      dependencyTopology: {
        service: serviceName,
        directDependencies: dependencies,
        upstreamDependents,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. POST /api/v1/correlations/decision
 * Record engineer confirmation, rejection, or verified root cause
 */
export async function submitCorrelationDecision(req, res, next) {
  try {
    const {
      sourceIncidentId,
      targetIncidentId,
      deploymentId,
      decision = 'unverified',
      isRootCause = false,
      verifiedRootCause = '',
      rationale = '',
    } = req.body;

    if (!sourceIncidentId) {
      return res.status(400).json({
        success: false,
        error: 'sourceIncidentId is required.',
      });
    }

    const decisionDoc = await recordCorrelationDecision({
      sourceIncidentId,
      targetIncidentId,
      deploymentId,
      decision,
      isRootCause,
      verifiedRootCause,
      rationale,
      user: req.user,
    });

    // Create AuditLog entry
    let auditAction = 'CORRELATION_DECIDED';
    if (isRootCause) auditAction = 'ROOT_CAUSE_ESTABLISHED';
    else if (decision === 'confirmed') auditAction = 'CORRELATION_CONFIRMED';
    else if (decision === 'rejected') auditAction = 'CORRELATION_REJECTED';

    await AuditLog.create({
      incidentId: sourceIncidentId,
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: auditAction,
      newState: {
        decision: decisionDoc.decision,
        isRootCause: decisionDoc.isRootCause,
        targetIncidentId: decisionDoc.targetIncidentId,
        deploymentId: decisionDoc.deploymentId,
      },
      reason: rationale || (isRootCause ? `Verified root cause: ${verifiedRootCause}` : `Correlation decision: ${decision}`),
    });

    emitIncidentEvent('correlation:decision_recorded', decisionDoc);

    res.status(200).json({
      success: true,
      decision: decisionDoc,
    });
  } catch (err) {
    next(err);
  }
}
