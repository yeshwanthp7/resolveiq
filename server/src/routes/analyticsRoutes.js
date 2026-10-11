import { Router } from 'express';
import Incident from '../models/Incident.js';
import User from '../models/User.js';
import Team from '../models/Team.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { getDashboard } from '../controllers/analyticsController.js';
import { getWorkloadQueues } from '../controllers/assignmentSimulatorController.js';
import { getFeedbackAnalytics } from '../controllers/resolutionRecommendationController.js';

const router = Router();

// Phase 10: Resolution Learning Loop Feedback Analytics
router.get(
  '/feedback',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  getFeedbackAnalytics
);

// Phase 9: Detailed workload queues and engineer availability
router.get(
  '/workload-details',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  getWorkloadQueues
);

// Phase 7: Comprehensive Operational Dashboard (RBAC Scoped across all roles)
router.get('/dashboard', authenticate, getDashboard);

// Manager & Admin only: Analytics overview legacy endpoint
router.get('/', authenticate, authorize('manager', 'admin'), async (req, res, next) => {
  try {
    const [total, triggered, investigating, resolved, p1Count] = await Promise.all([
      Incident.countDocuments(),
      Incident.countDocuments({ status: 'triggered' }),
      Incident.countDocuments({ status: { $in: ['acknowledged', 'investigating'] } }),
      Incident.countDocuments({ status: { $in: ['mitigated', 'resolved', 'closed'] } }),
      Incident.countDocuments({ priority: 'P1' }),
    ]);

    res.status(200).json({
      success: true,
      metrics: {
        totalIncidents: total,
        activeUnacknowledged: triggered,
        inInvestigation: investigating,
        resolvedIncidents: resolved,
        criticalP1Incidents: p1Count,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Manager & Admin only: Team workload & responder capacity legacy endpoint
router.get('/workload', authenticate, authorize('manager', 'admin'), async (req, res, next) => {
  try {
    const [engineers, teams, activeIncidents] = await Promise.all([
      User.find({ role: { $in: ['support_engineer', 'manager'] }, isActive: true }).select('-password'),
      Team.find(),
      Incident.find({ status: { $nin: ['resolved', 'closed'] } }).select('assignedTeam assignee priority status'),
    ]);

    const workloadByTeam = {};
    for (const t of teams) {
      workloadByTeam[t.name] = {
        tier: t.tier,
        activeCount: activeIncidents.filter((i) => i.assignedTeam === t.name).length,
      };
    }

    const engineerCapacity = engineers.map((eng) => ({
      id: eng._id,
      name: eng.name,
      email: eng.email,
      team: eng.team,
      role: eng.role,
      activeIncidents: activeIncidents.filter((i) => i.assignee?.toString() === eng._id.toString()).length,
    }));

    res.status(200).json({
      success: true,
      workloadByTeam,
      engineerCapacity,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
