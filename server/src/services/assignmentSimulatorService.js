import User from '../models/User.js';
import Team from '../models/Team.js';
import Incident from '../models/Incident.js';
import SLAPolicy from '../models/SLAPolicy.js';
import { SLA_TARGETS, evaluateSlaStatus, computeSlaTargets } from '../utils/slaEngine.js';
import { normalizeRole } from '../middleware/auth.js';

export const DEFAULT_ASSIGNMENT_WEIGHTS = {
  teamServiceCompatibility: 30,
  skillsMatch: 25,
  workloadBandwidth: 20,
  criticalIncidentsHeadroom: 15,
  availabilityReadiness: 10,
};

export const AUTHORIZED_RESPONDER_ROLES = [
  'support_engineer',
  'manager',
  'admin',
  'resolver',
  'commander',
];

/**
 * Deterministically score and rank eligible candidates for an incident
 */
export async function scoreCandidateEngineers(incident, options = {}) {
  if (!incident) {
    throw new Error('Incident is required to score candidate engineers.');
  }

  const weights = { ...DEFAULT_ASSIGNMENT_WEIGHTS, ...(options.weights || {}) };
  const targetService = (incident.affectedService || '').toLowerCase().trim();
  const assignedTeamName = incident.assignedTeam || '';

  // 1. Fetch all active users with authorized roles
  const users = await User.find({
    isActive: true,
    role: { $in: AUTHORIZED_RESPONDER_ROLES },
  }).lean();

  // 2. Fetch all teams for service mapping
  const teams = await Team.find().lean();
  const teamServiceMap = new Map();
  for (const t of teams) {
    teamServiceMap.set(t.name, t.services || t.serviceResponsibilities || []);
  }

  // 3. Fetch active workload counts per user
  const activeIncidents = await Incident.find({
    status: { $nin: ['resolved', 'closed'] },
    assignee: { $ne: null },
  })
    .select('assignee priority status')
    .lean();

  const userWorkloadMap = new Map();
  for (const inc of activeIncidents) {
    const uid = inc.assignee.toString();
    if (!userWorkloadMap.has(uid)) {
      userWorkloadMap.set(uid, { total: 0, critical: 0 });
    }
    const stat = userWorkloadMap.get(uid);
    stat.total++;
    if (inc.priority === 'P1' || inc.priority === 'P2') {
      stat.critical++;
    }
  }

  const candidates = [];

  for (const candidate of users) {
    // GATEKEEPER 1: Must be active (already filtered by query)
    if (!candidate.isActive) continue;

    // GATEKEEPER 2: Must be an authorized responder
    const normalizedRole = normalizeRole(candidate.role);
    if (!AUTHORIZED_RESPONDER_ROLES.includes(normalizedRole)) continue;

    // GATEKEEPER 3: Must not be marked 'unavailable'
    if (candidate.availabilityStatus === 'unavailable') continue;

    const breakdown = {};
    let compositeScore = 0;

    // Factor 1: Team & Service Compatibility (Max 30 pts)
    const isSameTeam = candidate.team === assignedTeamName;
    const teamOwnsService = (teamServiceMap.get(candidate.team) || []).includes(targetService);
    const candidateOwnsService = (candidate.serviceResponsibilities || []).includes(targetService);

    let compScore = 0;
    const compEvidence = [];
    if (isSameTeam) {
      compScore += 18;
      compEvidence.push(`Member of assigned team '${candidate.team}' (+18)`);
    } else if (teamOwnsService) {
      compScore += 12;
      compEvidence.push(`Team '${candidate.team}' owns service '${targetService}' (+12)`);
    }

    if (candidateOwnsService) {
      compScore += 12;
      compEvidence.push(`Designated owner for service '${targetService}' (+12)`);
    }

    const finalCompScore = Math.min(weights.teamServiceCompatibility, compScore);
    compositeScore += finalCompScore;
    breakdown.teamServiceCompatibility = {
      score: finalCompScore,
      maxScore: weights.teamServiceCompatibility,
      evidence: compEvidence.join(' • ') || 'Cross-team general responder (+0)',
    };

    // Factor 2: Relevant Skills Match (Max 25 pts)
    const candidateSkills = (candidate.skills || []).map((s) => s.toLowerCase().trim());
    const incidentTags = [
      targetService,
      incident.category || '',
      ...(incident.classificationMetadata?.tags || []),
    ]
      .filter(Boolean)
      .map((t) => t.toLowerCase().trim());

    const matchedSkills = candidateSkills.filter((s) =>
      incidentTags.some((t) => t.includes(s) || s.includes(t))
    );

    let skillScore = 0;
    if (matchedSkills.length > 0) {
      skillScore = Math.min(
        weights.skillsMatch,
        Math.round((matchedSkills.length / Math.max(1, Math.min(3, incidentTags.length))) * weights.skillsMatch)
      );
    } else {
      skillScore = candidateSkills.includes('general-triage') ? 5 : 2;
    }

    compositeScore += skillScore;
    breakdown.skillsMatch = {
      score: skillScore,
      maxScore: weights.skillsMatch,
      matchedSkills,
      evidence:
        matchedSkills.length > 0
          ? `Matched skill tags: [${matchedSkills.join(', ')}]`
          : 'General triage coverage baseline',
    };

    // Factor 3: Workload Bandwidth (Max 20 pts)
    const userStats = userWorkloadMap.get(candidate._id.toString()) || { total: 0, critical: 0 };
    const maxCapacity = candidate.maxConcurrentIncidents || 5;
    const openTickets = userStats.total;

    // Remaining bandwidth ratio
    const bandwidthRatio = Math.max(0, 1 - openTickets / maxCapacity);
    const workloadScore = Math.round(bandwidthRatio * weights.workloadBandwidth);

    compositeScore += workloadScore;
    breakdown.workloadBandwidth = {
      score: workloadScore,
      maxScore: weights.workloadBandwidth,
      openTickets,
      maxCapacity,
      evidence: `${openTickets}/${maxCapacity} active tickets assigned (${Math.round(bandwidthRatio * 100)}% bandwidth)`,
    };

    // Factor 4: Critical Incidents Headroom (Max 15 pts)
    const criticalCount = userStats.critical;
    let criticalScore = weights.criticalIncidentsHeadroom;
    if (criticalCount === 1) criticalScore = Math.round(weights.criticalIncidentsHeadroom * 0.5);
    else if (criticalCount >= 2) criticalScore = 0;

    compositeScore += criticalScore;
    breakdown.criticalIncidentsHeadroom = {
      score: criticalScore,
      maxScore: weights.criticalIncidentsHeadroom,
      activeCriticalCount: criticalCount,
      evidence:
        criticalCount === 0
          ? 'Zero active P1/P2 assignments (full headroom)'
          : `${criticalCount} active high-severity ticket(s) in flight`,
    };

    // Factor 5: Configured Availability Readiness (Max 10 pts)
    const availStatus = candidate.availabilityStatus || 'available';
    let availScore = 7;
    if (availStatus === 'on_call') availScore = weights.availabilityReadiness;
    else if (availStatus === 'available') availScore = 7;
    else if (availStatus === 'busy') availScore = 3;

    compositeScore += availScore;
    breakdown.availabilityReadiness = {
      score: availScore,
      maxScore: weights.availabilityReadiness,
      status: availStatus,
      evidence:
        availStatus === 'on_call'
          ? 'Designated on-call primary responder'
          : `Availability status: '${availStatus}'`,
    };

    candidates.push({
      user: {
        id: candidate._id,
        name: candidate.name,
        email: candidate.email,
        role: candidate.role,
        team: candidate.team,
        availabilityStatus: availStatus,
        skills: candidate.skills,
        serviceResponsibilities: candidate.serviceResponsibilities,
      },
      compositeScore,
      scoringBreakdown: breakdown,
      currentWorkload: {
        openTickets,
        criticalTickets: criticalCount,
        maxCapacity,
      },
    });
  }

  // Sort descending by compositeScore
  candidates.sort((a, b) => b.compositeScore - a.compositeScore);

  // Assign ranks
  const ranked = candidates.map((c, idx) => ({
    ...c,
    rank: idx + 1,
    isRecommended: idx === 0,
  }));

  return {
    meta: {
      incidentId: incident._id,
      incidentNumber: incident.incidentNumber,
      service: targetService,
      priority: incident.priority,
      evaluatedCandidatesCount: ranked.length,
      weightsApplied: weights,
      disclaimer:
        'Deterministic assignment formula evaluates operational queue bandwidth and skill alignment only. It does not measure individual performance, competency, or productivity.',
    },
    candidates: ranked,
  };
}

/**
 * Deterministic What-If Incident Simulator
 * Explores hypothetical reassignment, assignment delay, SLA boundaries, and workload changes.
 * STRICT: Does NOT mutate live database records.
 */
export async function simulateWhatIfScenario(incidentId, scenario = {}) {
  const incident = await Incident.findById(incidentId).lean();
  if (!incident) {
    throw new Error(`Incident '${incidentId}' not found.`);
  }

  const {
    assignmentDelayMinutes = 0,
    targetTeam = null,
    targetEngineerId = null,
    simulatedPriority = null,
    simulatedResolutionPaceMultiplier = 1.0,
  } = scenario;

  const now = new Date();
  const createdTime = new Date(incident.createdAt).getTime();

  // 1. Baseline Target & Deadline Calculations
  const baselinePriority = incident.priority;
  const activePriority = simulatedPriority || baselinePriority;

  const priorityTargets = SLA_TARGETS[activePriority] || SLA_TARGETS.P4;
  const responseTargetMinutes = priorityTargets.responseMinutes;
  const resolutionTargetMinutes = priorityTargets.resolutionMinutes;

  const responseDeadline = new Date(createdTime + responseTargetMinutes * 60000);
  const resolutionDeadline = new Date(createdTime + resolutionTargetMinutes * 60000);

  // 2. Simulated Response / Acknowledgement Time
  const delayMs = Math.max(0, assignmentDelayMinutes) * 60000;
  let simulatedAckTimeMs;

  if (incident.acknowledgedAt) {
    // If already acknowledged, what if delayed reassignment
    simulatedAckTimeMs = new Date(incident.acknowledgedAt).getTime() + delayMs;
  } else {
    // If unacknowledged, acknowledgment occurs at now + delay
    simulatedAckTimeMs = now.getTime() + delayMs;
  }

  const simulatedAckDate = new Date(simulatedAckTimeMs);
  const wouldBreachResponse = simulatedAckTimeMs > responseDeadline.getTime();
  const responseBreachMarginMinutes = Math.round(
    (simulatedAckTimeMs - responseDeadline.getTime()) / 60000
  );

  // 3. Simulated Resolution Time
  // Baseline resolution duration estimate based on priority target
  const baseExpectedDurationMs = resolutionTargetMinutes * 0.5 * 60000;
  const paceFactor = Math.max(0.5, Math.min(3.0, simulatedResolutionPaceMultiplier || 1.0));
  const expectedResolutionDurationMs = baseExpectedDurationMs * paceFactor;

  const simulatedResolutionTimeMs = simulatedAckTimeMs + expectedResolutionDurationMs;
  const simulatedResolvedDate = new Date(simulatedResolutionTimeMs);

  const wouldBreachResolution = simulatedResolutionTimeMs > resolutionDeadline.getTime();
  const resolutionBreachMarginMinutes = Math.round(
    (simulatedResolutionTimeMs - resolutionDeadline.getTime()) / 60000
  );

  // SLA State projection
  let projectedSlaState = 'On Track';
  if (wouldBreachResolution || wouldBreachResponse) {
    projectedSlaState = 'Breached';
  } else {
    const elapsedAtSimulatedEnd = simulatedResolutionTimeMs - createdTime;
    const totalBudgetMs = resolutionTargetMinutes * 60000;
    if (elapsedAtSimulatedEnd / totalBudgetMs >= 0.8) {
      projectedSlaState = 'At Risk';
    }
  }

  // 4. Workload Delta & Queue Shift Calculation
  let targetEngineer = null;
  if (targetEngineerId) {
    targetEngineer = await User.findById(targetEngineerId).select('name email role team maxConcurrentIncidents').lean();
  }

  const [currentAssigneeCount, targetAssigneeCount, currentTeamCount, targetTeamCount] =
    await Promise.all([
      incident.assignee
        ? Incident.countDocuments({ assignee: incident.assignee, status: { $nin: ['resolved', 'closed'] } })
        : 0,
      targetEngineerId
        ? Incident.countDocuments({ assignee: targetEngineerId, status: { $nin: ['resolved', 'closed'] } })
        : 0,
      incident.assignedTeam
        ? Incident.countDocuments({ assignedTeam: incident.assignedTeam, status: { $nin: ['resolved', 'closed'] } })
        : 0,
      targetTeam && targetTeam !== incident.assignedTeam
        ? Incident.countDocuments({ assignedTeam: targetTeam, status: { $nin: ['resolved', 'closed'] } })
        : 0,
    ]);

  const queueWarnings = [];

  // Evaluate target engineer queue saturation
  if (targetEngineer) {
    const maxCapacity = targetEngineer.maxConcurrentIncidents || 5;
    const postAssignmentCount = targetAssigneeCount + 1;
    if (postAssignmentCount >= maxCapacity) {
      queueWarnings.push(
        `Target engineer ${targetEngineer.name} reaches maximum capacity (${postAssignmentCount}/${maxCapacity} open tickets).`
      );
    }
  }

  // Evaluate SLA delay warnings
  if (assignmentDelayMinutes > responseTargetMinutes) {
    queueWarnings.push(
      `Assignment delay (${assignmentDelayMinutes}m) exceeds full response target budget (${responseTargetMinutes}m).`
    );
  }

  return {
    meta: {
      incidentId: incident._id,
      incidentNumber: incident.incidentNumber,
      title: incident.title,
      isHypothetical: true,
      simulatedAt: now.toISOString(),
      disclaimer:
        'Hypothetical what-if simulation model. Calculations represent policy estimates based on deterministic calendar-hour budgets and instantaneous queue snapshots. This simulation does NOT modify production records.',
    },
    scenarioInputs: {
      assignmentDelayMinutes,
      targetTeam: targetTeam || incident.assignedTeam,
      targetEngineer: targetEngineer ? { id: targetEngineer._id, name: targetEngineer.name } : null,
      simulatedPriority: activePriority,
      simulatedResolutionPaceMultiplier: paceFactor,
    },
    slaProjections: {
      responseTargetMinutes,
      resolutionTargetMinutes,
      responseDeadline: responseDeadline.toISOString(),
      resolutionDeadline: resolutionDeadline.toISOString(),
      simulatedAcknowledgementAt: simulatedAckDate.toISOString(),
      simulatedResolvedAt: simulatedResolvedDate.toISOString(),
      wouldBreachResponse,
      responseBreachMarginMinutes,
      wouldBreachResolution,
      resolutionBreachMarginMinutes,
      projectedSlaState,
    },
    workloadImpact: {
      currentAssignee: {
        id: incident.assignee,
        openTicketsBefore: currentAssigneeCount,
        openTicketsAfter: Math.max(0, currentAssigneeCount - (targetEngineerId ? 1 : 0)),
      },
      targetAssignee: targetEngineer
        ? {
            id: targetEngineer._id,
            name: targetEngineer.name,
            openTicketsBefore: targetAssigneeCount,
            openTicketsAfter: targetAssigneeCount + 1,
            maxCapacity: targetEngineer.maxConcurrentIncidents || 5,
          }
        : null,
      teamQueues: {
        currentTeam: {
          name: incident.assignedTeam,
          openTicketsBefore: currentTeamCount,
          openTicketsAfter: Math.max(0, currentTeamCount - (targetTeam && targetTeam !== incident.assignedTeam ? 1 : 0)),
        },
        targetTeam: targetTeam && targetTeam !== incident.assignedTeam
          ? {
              name: targetTeam,
              openTicketsBefore: targetTeamCount,
              openTicketsAfter: targetTeamCount + 1,
            }
          : null,
      },
      queueWarnings,
    },
  };
}
