import Incident from '../models/Incident.js';
import User from '../models/User.js';
import Team from '../models/Team.js';
import {
  scoreCandidateEngineers,
  simulateWhatIfScenario,
} from '../services/assignmentSimulatorService.js';

/**
 * 1. GET /api/v1/incidents/:id/candidate-responders
 * Deterministically ranks eligible engineers with transparent scoring factors
 */
export async function getCandidateResponders(req, res, next) {
  try {
    const { id } = req.params;
    const incident = await Incident.findById(id).lean();

    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const result = await scoreCandidateEngineers(incident);

    res.status(200).json({
      success: true,
      meta: result.meta,
      candidates: result.candidates,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. POST /api/v1/incidents/:id/what-if
 * Deterministic what-if incident simulator exploring delays, reassignments, SLA breaches, and workload shifts.
 * STRICT: Live database record is NEVER mutated.
 */
export async function simulateIncidentScenario(req, res, next) {
  try {
    const { id } = req.params;
    const scenario = req.body || {};

    const simulation = await simulateWhatIfScenario(id, scenario);

    res.status(200).json({
      success: true,
      simulation,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. GET /api/v1/analytics/workload-details
 * Returns comprehensive team queues, responder rosters, availability, and priority distributions
 */
export async function getWorkloadQueues(req, res, next) {
  try {
    const [teams, users, activeIncidents] = await Promise.all([
      Team.find().lean(),
      User.find({
        role: { $in: ['support_engineer', 'manager', 'admin', 'resolver', 'commander'] },
        isActive: true,
      })
        .select('-password')
        .lean(),
      Incident.find({ status: { $nin: ['resolved', 'closed'] } })
        .select('assignedTeam assignee priority status incidentNumber affectedService')
        .lean(),
    ]);

    // Map open incidents by engineer
    const engineerIncidentMap = new Map();
    for (const inc of activeIncidents) {
      if (inc.assignee) {
        const uid = inc.assignee.toString();
        if (!engineerIncidentMap.has(uid)) {
          engineerIncidentMap.set(uid, []);
        }
        engineerIncidentMap.get(uid).push(inc);
      }
    }

    // Map open incidents by team
    const teamIncidentMap = new Map();
    for (const inc of activeIncidents) {
      const tName = inc.assignedTeam || 'Unassigned';
      if (!teamIncidentMap.has(tName)) {
        teamIncidentMap.set(tName, []);
      }
      teamIncidentMap.get(tName).push(inc);
    }

    // Construct enriched engineer roster
    const roster = users.map((u) => {
      const assigned = engineerIncidentMap.get(u._id.toString()) || [];
      const criticalCount = assigned.filter((i) => i.priority === 'P1' || i.priority === 'P2').length;
      const maxCapacity = u.maxConcurrentIncidents || 5;
      const saturationRatio = Math.min(1.0, assigned.length / maxCapacity);

      return {
        id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        team: u.team,
        availabilityStatus: u.availabilityStatus || 'available',
        skills: u.skills || [],
        serviceResponsibilities: u.serviceResponsibilities || [],
        openTicketsCount: assigned.length,
        criticalTicketsCount: criticalCount,
        maxCapacity,
        saturationRatio: Number(saturationRatio.toFixed(2)),
        isOverloaded: assigned.length >= maxCapacity,
      };
    });

    // Construct enriched team queues
    const teamQueues = teams.map((t) => {
      const teamIncs = teamIncidentMap.get(t.name) || [];
      const byPriority = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0 };
      let unassignedCount = 0;

      for (const inc of teamIncs) {
        if (byPriority[inc.priority] !== undefined) {
          byPriority[inc.priority]++;
        }
        if (!inc.assignee) {
          unassignedCount++;
        }
      }

      const teamMembers = roster.filter((r) => r.team === t.name);

      return {
        id: t._id,
        name: t.name,
        tier: t.tier,
        description: t.description,
        services: t.services || [],
        activeCount: teamIncs.length,
        unassignedCount,
        byPriority,
        memberCount: teamMembers.length,
        members: teamMembers,
      };
    });

    res.status(200).json({
      success: true,
      totalActiveIncidents: activeIncidents.length,
      teamQueues,
      engineerRoster: roster,
    });
  } catch (err) {
    next(err);
  }
}
