import Incident from '../models/Incident.js';
import DeploymentEvent from '../models/DeploymentEvent.js';
import CorrelationDecision from '../models/CorrelationDecision.js';
import Resolution from '../models/Resolution.js';

/**
 * ResolveIQ Deterministic Incident Correlation & Blast Radius Engine
 *
 * Factors evaluated:
 * 1. Shared affected services (+0.35)
 * 2. Explicit service dependency topology (+0.25)
 * 3. Similar error signatures and symptom keywords (+0.25)
 * 4. Temporal proximity and overlapping active windows (+0.15)
 * 5. Preceding deployment events within change window (+0.40 - +0.85)
 * 6. Historical links or identical verified resolution root cause (+0.15)
 *
 * CAUSATION INTEGRITY PRINCIPLE:
 * Timestamp proximity alone NEVER establishes proof of causation.
 * The engine marks all algorithm-derived edges as 'suspected_correlation' (unverified).
 * Only an authorized engineer recording a verified decision can establish confirmed causation.
 */

export const SERVICE_DEPENDENCY_GRAPH = {
  'ingress-gateway': ['payments-service', 'order-processing', 'auth-service'],
  'order-processing': ['database-cluster', 'payments-service', 'inventory-service'],
  'payments-service': ['database-cluster', 'banking-gateway'],
  'auth-service': ['database-cluster', 'redis-cache'],
  'database-cluster': [],
  'redis-cache': [],
  'inventory-service': ['database-cluster'],
  'banking-gateway': [],
  'notification-service': ['redis-cache'],
  'monitoring': [],
};

export const COMMON_ERROR_PATTERNS = [
  '502',
  '503',
  '504',
  '500',
  '429',
  'timeout',
  'connection refused',
  'connection reset',
  'connection pool',
  'oomkilled',
  'out of memory',
  'deadlock',
  'crashloopbackoff',
  'dns resolution',
  'tls handshake',
  'pool exhausted',
  'high latency',
  'packet loss',
  'disk full',
  'replication lag',
  'cpu throttle',
  'secret rotation',
  'signature mismatch',
];

/**
 * Check if service A depends on service B or vice versa
 */
export function checkServiceDependency(serviceA, serviceB) {
  if (!serviceA || !serviceB || serviceA === serviceB) {
    return { isDependent: false, direction: null };
  }

  const sA = serviceA.toLowerCase().trim();
  const sB = serviceB.toLowerCase().trim();

  // Direct dependency: A -> B
  const depsA = SERVICE_DEPENDENCY_GRAPH[sA] || [];
  if (depsA.includes(sB)) {
    return {
      isDependent: true,
      direction: 'downstream',
      evidence: `${sA} directly depends on ${sB}`,
    };
  }

  // Reverse direct dependency: B -> A
  const depsB = SERVICE_DEPENDENCY_GRAPH[sB] || [];
  if (depsB.includes(sA)) {
    return {
      isDependent: true,
      direction: 'upstream',
      evidence: `${sB} directly depends on ${sA}`,
    };
  }

  // Transitive 2-hop check: A -> X -> B
  for (const intermediate of depsA) {
    const subDeps = SERVICE_DEPENDENCY_GRAPH[intermediate] || [];
    if (subDeps.includes(sB)) {
      return {
        isDependent: true,
        direction: 'transitive_downstream',
        evidence: `${sA} transitively depends on ${sB} via ${intermediate}`,
      };
    }
  }

  for (const intermediate of depsB) {
    const subDeps = SERVICE_DEPENDENCY_GRAPH[intermediate] || [];
    if (subDeps.includes(sA)) {
      return {
        isDependent: true,
        direction: 'transitive_upstream',
        evidence: `${sB} transitively depends on ${sA} via ${intermediate}`,
      };
    }
  }

  return { isDependent: false, direction: null };
}

/**
 * Extract matched error patterns from text
 */
export function extractErrorPatterns(text = '') {
  if (!text) return [];
  const lower = text.toLowerCase();
  const matched = [];

  for (const pattern of COMMON_ERROR_PATTERNS) {
    if (lower.includes(pattern)) {
      matched.push(pattern);
    }
  }
  return matched;
}

/**
 * Calculate Jaccard similarity between two arrays of error patterns
 */
export function calculatePatternOverlap(patternsA = [], patternsB = []) {
  if (patternsA.length === 0 || patternsB.length === 0) return 0;
  const setA = new Set(patternsA);
  const setB = new Set(patternsB);

  const intersection = [...setA].filter((x) => setB.has(x));
  const union = new Set([...setA, ...setB]);

  return intersection.length / union.size;
}

/**
 * Score correlation between two incidents deterministically
 */
export function scoreIncidentToIncident(incA, incB, options = {}) {
  if (!incA || !incB || incA._id?.toString() === incB._id?.toString()) {
    return null;
  }

  const timeWindowMinutes = options.timeWindowMinutes || 120;
  const factors = [];
  let score = 0;

  const svcA = (incA.affectedService || '').toLowerCase().trim();
  const svcB = (incB.affectedService || '').toLowerCase().trim();

  // 1. Shared Affected Service (+0.35)
  if (svcA && svcB && svcA === svcB) {
    score += 0.35;
    factors.push({
      factor: 'SHARED_SERVICE',
      weight: 0.35,
      evidence: `Both incidents directly impact service '${svcA}'.`,
    });
  } else {
    // 2. Explicit Service Dependency (+0.25)
    const depCheck = checkServiceDependency(svcA, svcB);
    if (depCheck.isDependent) {
      const weight = depCheck.direction.startsWith('transitive') ? 0.15 : 0.25;
      score += weight;
      factors.push({
        factor: 'SERVICE_DEPENDENCY',
        weight,
        evidence: depCheck.evidence,
      });
    }
  }

  // 3. Similar Error Patterns (+0.25)
  const textA = `${incA.title || ''} ${incA.description || ''} ${(incA.classificationMetadata?.tags || []).join(' ')}`;
  const textB = `${incB.title || ''} ${incB.description || ''} ${(incB.classificationMetadata?.tags || []).join(' ')}`;
  const patternsA = extractErrorPatterns(textA);
  const patternsB = extractErrorPatterns(textB);
  const patternOverlap = calculatePatternOverlap(patternsA, patternsB);

  if (patternOverlap > 0) {
    const weight = Number((0.25 * patternOverlap).toFixed(2));
    score += weight;
    const commonPatterns = patternsA.filter((p) => patternsB.includes(p));
    factors.push({
      factor: 'SIMILAR_ERROR_PATTERNS',
      weight,
      evidence: `Shared error symptoms: [${commonPatterns.join(', ')}].`,
    });
  }

  // 4. Temporal Proximity & Overlapping Time Window (+0.15 max)
  const timeA = incA.createdAt ? new Date(incA.createdAt).getTime() : 0;
  const timeB = incB.createdAt ? new Date(incB.createdAt).getTime() : 0;
  const diffMinutes = Math.abs(timeA - timeB) / 60000;

  if (diffMinutes <= 15) {
    score += 0.15;
    factors.push({
      factor: 'TEMPORAL_PROXIMITY',
      weight: 0.15,
      evidence: `Incidents declared within 15 minutes of each other (${Math.round(diffMinutes)}m apart).`,
    });
  } else if (diffMinutes <= 60) {
    score += 0.10;
    factors.push({
      factor: 'TEMPORAL_PROXIMITY',
      weight: 0.10,
      evidence: `Incidents declared within 1 hour (${Math.round(diffMinutes)}m apart).`,
    });
  } else if (diffMinutes <= timeWindowMinutes) {
    score += 0.05;
    factors.push({
      factor: 'TEMPORAL_PROXIMITY',
      weight: 0.05,
      evidence: `Incidents declared within correlation window (${Math.round(diffMinutes)}m apart).`,
    });
  }

  // 5. Historical link or related incidents (+0.15)
  const isExplicitlyRelated =
    incA.relatedIncidents?.some((r) => r.toString() === incB._id.toString()) ||
    incB.relatedIncidents?.some((r) => r.toString() === incA._id.toString());

  if (isExplicitlyRelated) {
    score += 0.15;
    factors.push({
      factor: 'HISTORICAL_TICKET_LINK',
      weight: 0.15,
      evidence: 'Tickets are explicitly linked as related incident investigations.',
    });
  }

  const normalizedScore = Number(Math.min(0.95, score).toFixed(2));

  let confidenceTier = 'LOW';
  if (normalizedScore >= 0.70) confidenceTier = 'HIGH';
  else if (normalizedScore >= 0.45) confidenceTier = 'MEDIUM';

  return {
    sourceIncidentId: incA._id,
    targetIncidentId: incB._id,
    sourceTicket: incA.incidentNumber,
    targetTicket: incB.incidentNumber,
    confidenceScore: normalizedScore,
    confidenceTier,
    contributingFactors: factors,
    isCausalProof: false, // Proximity or heuristic is NEVER causal proof
    relationshipType: 'suspected_correlation',
    status: 'unverified',
  };
}

/**
 * Score correlation between a deployment event and an incident
 */
export function scoreDeploymentToIncident(deployment, incident, options = {}) {
  if (!deployment || !incident) return null;

  const maxPrecedingHours = options.maxPrecedingHours || 4; // 4h change window
  const depTime = deployment.deployedAt ? new Date(deployment.deployedAt).getTime() : 0;
  const incTime = incident.createdAt ? new Date(incident.createdAt).getTime() : 0;

  // Deployment must PRECEDE or be synchronous with incident declaration
  const minutesBefore = (incTime - depTime) / 60000;
  if (minutesBefore < -5 || minutesBefore > maxPrecedingHours * 60) {
    return null; // Out of causal deployment window
  }

  const depSvc = (deployment.service || deployment.serviceName || '').toLowerCase().trim();
  const incSvc = (incident.affectedService || '').toLowerCase().trim();

  const factors = [];
  let score = 0;

  // 1. Service Alignment
  const isDirectServiceMatch = depSvc && incSvc && depSvc === incSvc;
  const depCheck = isDirectServiceMatch ? null : checkServiceDependency(incSvc, depSvc);

  if (isDirectServiceMatch) {
    score += 0.40;
    factors.push({
      factor: 'DIRECT_SERVICE_DEPLOYMENT',
      weight: 0.40,
      evidence: `Deployment ${deployment.version} was deployed directly to the incident's affected service '${incSvc}'.`,
    });
  } else if (depCheck?.isDependent) {
    const weight = depCheck.direction.startsWith('transitive') ? 0.20 : 0.30;
    score += weight;
    factors.push({
      factor: 'DEPENDENT_SERVICE_DEPLOYMENT',
      weight,
      evidence: `Deployment ${deployment.version} affected upstream dependency '${depSvc}' (${depCheck.evidence}).`,
    });
  } else {
    // Unrelated service: zero causal connection
    return null;
  }

  // 2. Temporal Proximity (Preceding window)
  if (minutesBefore >= 0 && minutesBefore <= 20) {
    score += 0.25;
    factors.push({
      factor: 'IMMEDIATE_PRECEDING_WINDOW',
      weight: 0.25,
      evidence: `Incident began only ${Math.round(minutesBefore)} minutes after deployment rollout.`,
    });
  } else if (minutesBefore > 20 && minutesBefore <= 60) {
    score += 0.15;
    factors.push({
      factor: 'RECENT_PRECEDING_WINDOW',
      weight: 0.15,
      evidence: `Incident began ${Math.round(minutesBefore)} minutes following deployment.`,
    });
  } else if (minutesBefore > 60 && minutesBefore <= 180) {
    score += 0.10;
    factors.push({
      factor: 'EXTENDED_CHANGE_WINDOW',
      weight: 0.10,
      evidence: `Incident occurred ${Math.round(minutesBefore)} minutes post-deployment.`,
    });
  }

  // 3. Deployment Status Signal
  if (deployment.status === 'failed' || deployment.status === 'rolled_back') {
    score += 0.15;
    factors.push({
      factor: 'DEPLOYMENT_ANOMALY',
      weight: 0.15,
      evidence: `Deployment recorded non-standard completion status: '${deployment.status}'.`,
    });
  }

  // 4. Change Summary & Symptom Keyword Correlation
  const changeSummaryLower = (deployment.changeSummary || '').toLowerCase();
  const incTextLower = `${incident.title || ''} ${incident.description || ''}`.toLowerCase();
  const summaryPatterns = extractErrorPatterns(changeSummaryLower);
  const incPatterns = extractErrorPatterns(incTextLower);
  const matchingPatterns = summaryPatterns.filter((p) => incPatterns.includes(p));

  if (matchingPatterns.length > 0) {
    score += 0.15;
    factors.push({
      factor: 'CHANGE_CONTENT_SYMPTOM_MATCH',
      weight: 0.15,
      evidence: `Deployment change summary notes match incident symptoms: [${matchingPatterns.join(', ')}].`,
    });
  }

  const normalizedScore = Number(Math.min(0.95, score).toFixed(2));

  let confidenceTier = 'LOW';
  if (normalizedScore >= 0.70) confidenceTier = 'HIGH';
  else if (normalizedScore >= 0.45) confidenceTier = 'MEDIUM';

  return {
    deploymentId: deployment._id,
    incidentId: incident._id,
    version: deployment.version,
    service: depSvc,
    environment: deployment.environment,
    deployedAt: deployment.deployedAt,
    incidentNumber: incident.incidentNumber,
    minutesBefore: Math.round(minutesBefore),
    confidenceScore: normalizedScore,
    confidenceTier,
    contributingFactors: factors,
    isCausalProof: false, // Deployment correlation is a suspected hypothesis until confirmed
    relationshipType: 'deployment_to_incident',
    status: 'unverified',
  };
}

/**
 * Retrieve comprehensive Incident Correlation Graph dataset
 */
export async function getCorrelationGraphData({
  windowHours = 48,
  minScore = 0.25,
  service = 'all',
}) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

  const incidentQuery = { createdAt: { $gte: windowStart } };
  const deploymentQuery = { deployedAt: { $gte: windowStart } };

  if (service && service !== 'all') {
    incidentQuery.affectedService = service.toLowerCase().trim();
    deploymentQuery.$or = [
      { service: service.toLowerCase().trim() },
      { serviceName: service.toLowerCase().trim() },
    ];
  }

  const [incidents, deployments, decisions, resolutions] = await Promise.all([
    Incident.find(incidentQuery)
      .select('incidentNumber title affectedService priority status createdAt resolvedAt classificationMetadata')
      .lean(),
    DeploymentEvent.find(deploymentQuery)
      .select('service serviceName version environment status changeSummary changeReference deployedAt')
      .lean(),
    CorrelationDecision.find().lean(),
    Resolution.find().select('incidentId rootCauseCategory summary resolvedAt').lean(),
  ]);

  const nodes = [];
  const edges = [];
  const uniqueServices = new Set();

  // 1. Add Incident Nodes
  for (const inc of incidents) {
    nodes.push({
      id: inc._id.toString(),
      type: 'incident',
      label: inc.incidentNumber,
      title: inc.title,
      service: inc.affectedService,
      priority: inc.priority,
      status: inc.status,
      createdAt: inc.createdAt,
      resolvedAt: inc.resolvedAt,
    });
    if (inc.affectedService) uniqueServices.add(inc.affectedService);
  }

  // 2. Add Service Nodes & Incident-to-Service Edges
  for (const svcName of uniqueServices) {
    nodes.push({
      id: `service-${svcName}`,
      type: 'service',
      label: svcName,
      service: svcName,
      dependencies: SERVICE_DEPENDENCY_GRAPH[svcName] || [],
    });
  }

  for (const inc of incidents) {
    if (inc.affectedService) {
      edges.push({
        id: `edge-${inc._id}-svc-${inc.affectedService}`,
        source: inc._id.toString(),
        target: `service-${inc.affectedService}`,
        relationshipType: 'affects_service',
        label: 'affects',
        confidenceScore: 1.0,
      });
    }
  }

  // 3. Add Service-to-Service Dependency Edges
  for (const [parentSvc, depList] of Object.entries(SERVICE_DEPENDENCY_GRAPH)) {
    if (uniqueServices.has(parentSvc)) {
      for (const childSvc of depList) {
        if (uniqueServices.has(childSvc)) {
          edges.push({
            id: `edge-dep-${parentSvc}-${childSvc}`,
            source: `service-${parentSvc}`,
            target: `service-${childSvc}`,
            relationshipType: 'service_dependency',
            label: 'depends on',
            confidenceScore: 1.0,
          });
        }
      }
    }
  }

  // 4. Add Deployment Nodes & Deployment-to-Incident Edges
  for (const dep of deployments) {
    const depSvc = dep.service || dep.serviceName;
    nodes.push({
      id: dep._id.toString(),
      type: 'deployment',
      label: dep.version,
      service: depSvc,
      status: dep.status,
      environment: dep.environment,
      changeSummary: dep.changeSummary,
      changeReference: dep.changeReference,
      deployedAt: dep.deployedAt,
    });

    // Check correlation with incidents in window
    for (const inc of incidents) {
      const depCorr = scoreDeploymentToIncident(dep, inc, { maxPrecedingHours: 6 });
      if (depCorr && depCorr.confidenceScore >= minScore) {
        // Check if an engineer decision exists
        const existingDecision = decisions.find(
          (d) =>
            d.deploymentId?.toString() === dep._id.toString() &&
            d.sourceIncidentId?.toString() === inc._id.toString()
        );

        edges.push({
          id: `edge-dep-${dep._id}-inc-${inc._id}`,
          source: dep._id.toString(),
          target: inc._id.toString(),
          relationshipType: existingDecision?.isRootCause
            ? 'verified_root_cause'
            : existingDecision?.decision === 'confirmed'
            ? 'confirmed_relationship'
            : 'preceding_deployment',
          confidenceScore: depCorr.confidenceScore,
          confidenceTier: depCorr.confidenceTier,
          contributingFactors: depCorr.contributingFactors,
          status: existingDecision?.decision || 'unverified',
          isRootCause: existingDecision?.isRootCause || false,
          verifiedRootCause: existingDecision?.verifiedRootCause || '',
          decisionId: existingDecision?._id || null,
        });
      }
    }
  }

  // 5. Evaluate Incident-to-Incident Correlations
  for (let i = 0; i < incidents.length; i++) {
    for (let j = i + 1; j < incidents.length; j++) {
      const incA = incidents[i];
      const incB = incidents[j];

      const corr = scoreIncidentToIncident(incA, incB, { timeWindowMinutes: 180 });
      if (corr && corr.confidenceScore >= minScore) {
        const existingDecision = decisions.find(
          (d) =>
            (d.sourceIncidentId?.toString() === incA._id.toString() &&
              d.targetIncidentId?.toString() === incB._id.toString()) ||
            (d.sourceIncidentId?.toString() === incB._id.toString() &&
              d.targetIncidentId?.toString() === incA._id.toString())
        );

        edges.push({
          id: `edge-inc-${incA._id}-${incB._id}`,
          source: incA._id.toString(),
          target: incB._id.toString(),
          relationshipType: existingDecision?.decision === 'confirmed'
            ? 'confirmed_relationship'
            : 'suspected_correlation',
          confidenceScore: corr.confidenceScore,
          confidenceTier: corr.confidenceTier,
          contributingFactors: corr.contributingFactors,
          status: existingDecision?.decision || 'unverified',
          isRootCause: existingDecision?.isRootCause || false,
          decisionId: existingDecision?._id || null,
        });
      }
    }
  }

  // 6. Add Historical Resolution Nodes
  for (const res of resolutions) {
    if (res.incidentId) {
      const matchedIncident = incidents.find((i) => i._id.toString() === res.incidentId.toString());
      if (matchedIncident) {
        const resNodeId = `res-${res._id}`;
        nodes.push({
          id: resNodeId,
          type: 'resolution',
          label: res.rootCauseCategory,
          summary: res.summary,
          rootCauseCategory: res.rootCauseCategory,
          resolvedAt: res.resolvedAt,
        });

        edges.push({
          id: `edge-inc-${matchedIncident._id}-res-${res._id}`,
          source: matchedIncident._id.toString(),
          target: resNodeId,
          relationshipType: 'verified_resolution',
          label: 'resolved with',
          confidenceScore: 1.0,
        });
      }
    }
  }

  // 7. Extract Suspected Incident Clusters
  const clusters = identifyClusters(incidents, edges);

  return {
    meta: {
      generatedAt: now.toISOString(),
      windowHours,
      minScore,
      serviceFilter: service,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      clusterCount: clusters.length,
      principles: [
        'Deterministic correlation heuristics are not causal proof.',
        'Human engineer verification is strictly required before confirming root causes.',
      ],
    },
    nodes,
    edges,
    clusters,
  };
}

/**
 * Group correlated incidents into connected clusters
 */
function identifyClusters(incidents, edges) {
  const incidentEdges = edges.filter(
    (e) =>
      (e.relationshipType === 'suspected_correlation' ||
        e.relationshipType === 'confirmed_relationship') &&
      e.confidenceScore >= 0.40
  );

  const adjacency = new Map();
  for (const inc of incidents) {
    adjacency.set(inc._id.toString(), new Set());
  }

  for (const edge of incidentEdges) {
    if (adjacency.has(edge.source) && adjacency.has(edge.target)) {
      adjacency.get(edge.source).add(edge.target);
      adjacency.get(edge.target).add(edge.source);
    }
  }

  const visited = new Set();
  const clusters = [];

  for (const inc of incidents) {
    const id = inc._id.toString();
    if (visited.has(id)) continue;

    const component = [];
    const queue = [id];
    visited.add(id);

    while (queue.length > 0) {
      const curr = queue.shift();
      component.push(curr);
      const neighbors = adjacency.get(curr) || new Set();
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }

    if (component.length > 1) {
      const memberIncidents = incidents.filter((i) => component.includes(i._id.toString()));
      const commonServices = [...new Set(memberIncidents.map((i) => i.affectedService))];

      clusters.push({
        clusterId: `cluster-${clusters.length + 1}`,
        leadTicket: memberIncidents[0].incidentNumber,
        memberCount: memberIncidents.length,
        services: commonServices,
        incidents: memberIncidents.map((i) => ({
          id: i._id,
          incidentNumber: i.incidentNumber,
          title: i.title,
          service: i.affectedService,
          priority: i.priority,
          status: i.status,
        })),
      });
    }
  }

  return clusters;
}

/**
 * Record or update an engineer's correlation decision
 */
export async function recordCorrelationDecision({
  sourceIncidentId,
  targetIncidentId = null,
  deploymentId = null,
  decision = 'unverified',
  isRootCause = false,
  verifiedRootCause = '',
  rationale = '',
  user,
}) {
  if (!sourceIncidentId) {
    throw new Error('sourceIncidentId is required to record a correlation decision.');
  }

  // Determine relationship type
  let relationshipType = 'incident_to_incident';
  if (deploymentId) relationshipType = 'deployment_to_incident';

  const filter = {
    sourceIncidentId,
    ...(targetIncidentId ? { targetIncidentId } : {}),
    ...(deploymentId ? { deploymentId } : {}),
  };

  const decisionDoc = await CorrelationDecision.findOneAndUpdate(
    filter,
    {
      $set: {
        sourceIncidentId,
        targetIncidentId: targetIncidentId || null,
        deploymentId: deploymentId || null,
        relationshipType,
        decision,
        isRootCause: Boolean(isRootCause),
        verifiedRootCause: verifiedRootCause ? verifiedRootCause.trim() : '',
        rationale: rationale ? rationale.trim() : '',
        decidedBy: user?._id || null,
        decidedByName: user?.name || 'Engineer',
        decidedByRole: user?.role || 'support_engineer',
        decidedAt: new Date(),
      },
    },
    { upsert: true, new: true, runValidators: true }
  );

  // If confirmed and target is incident, update relatedIncidents on both tickets
  if (decision === 'confirmed' && targetIncidentId) {
    await Promise.all([
      Incident.findByIdAndUpdate(sourceIncidentId, {
        $addToSet: { relatedIncidents: targetIncidentId },
      }),
      Incident.findByIdAndUpdate(targetIncidentId, {
        $addToSet: { relatedIncidents: sourceIncidentId },
      }),
    ]);
  }

  // If deployment is marked as verified root cause, update deployment's correlatedIncidents
  if (isRootCause && deploymentId) {
    await DeploymentEvent.findByIdAndUpdate(deploymentId, {
      $addToSet: { correlatedIncidents: sourceIncidentId },
    });
  }

  return decisionDoc;
}
