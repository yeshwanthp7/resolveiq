import { Router } from 'express';
import {
  createIncident,
  getIncidents,
  getIncidentById,
  updateIncident,
  updateStatus,
  reopenIncident,
  reassignIncident,
  recordResolution,
  addInvestigationNote,
  linkRelatedIncident,
  unlinkRelatedIncident,
} from '../controllers/incidentController.js';
import {
  getRecommendations,
  getIncidentRecommendations,
  submitRecommendationFeedback,
  getDuplicates,
} from '../controllers/recommendationController.js';
import {
  getResolutionRecommendation,
  submitResolutionFeedback,
  searchKnowledgeBaseEndpoint,
  flagResolutionOutdated,
  unflagResolution,
  getFeedbackAnalytics,
} from '../controllers/resolutionRecommendationController.js';
import {
  getCandidateResponders,
  simulateIncidentScenario,
} from '../controllers/assignmentSimulatorController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// 1. Declare incident (any authenticated role)
router.post('/', authenticate, createIncident);

// 2. Recommendations & Duplicate scan on draft or parameters
router.post('/recommendations', authenticate, getRecommendations);

// 3. Search verified resolution knowledge base (Static path before :id)
router.get(
  '/knowledge-base/search',
  authenticate,
  searchKnowledgeBaseEndpoint
);

// Phase 10: Resolution Learning Loop & Feedback Analytics
router.get(
  '/knowledge-base/feedback-analytics',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  getFeedbackAnalytics
);

router.post(
  '/knowledge-base/:id/flag',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  flagResolutionOutdated
);

router.post(
  '/knowledge-base/:id/unflag',
  authenticate,
  authorize('manager', 'admin'),
  unflagResolution
);

// 4. Query incidents with search, filters, and pagination
router.get('/', authenticate, getIncidents);

// 5. View incident detail with audit timeline and resolution
router.get('/:id', authenticate, getIncidentById);

// 6. Get triage recommendations and duplicates for existing incident
router.get('/:id/recommendations', authenticate, getIncidentRecommendations);
router.get('/:id/duplicates', authenticate, getDuplicates);

// 7. Get evidence-backed resolution recommendations (Phase 6)
router.get(
  '/:id/resolution-recommendations',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  getResolutionRecommendation
);

// 8. Submit feedback on resolution recommendations (Phase 6)
router.post(
  '/:id/resolution-recommendations/feedback',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  submitResolutionFeedback
);

// 9. Submit feedback on triage recommendations (Accept, Edit, Reject)
router.post(
  '/:id/recommendations/feedback',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  submitRecommendationFeedback
);

// 10. Phase 9: Workload-aware candidate responders and what-if simulation
router.get(
  '/:id/candidate-responders',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  getCandidateResponders
);

router.post(
  '/:id/what-if',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  simulateIncidentScenario
);

// 7. Edit non-restricted incident fields
router.put('/:id', authenticate, updateIncident);
router.patch('/:id', authenticate, updateIncident);

// 8. Lifecycle status transition
router.patch(
  '/:id/status',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  updateStatus
);

// 9. Permitted reopening path from resolved or closed
router.post(
  '/:id/reopen',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  reopenIncident
);

// 10. Team and responder assignment (restricted to Managers and Admins)
router.patch(
  '/:id/reassign',
  authenticate,
  authorize('manager', 'admin'),
  reassignIncident
);
router.patch(
  '/:id/assign',
  authenticate,
  authorize('manager', 'admin'),
  reassignIncident
);

// 11. Record verified resolution
router.post(
  '/:id/resolution',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  recordResolution
);

// 12. Append investigation note
router.post(
  '/:id/notes',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  addInvestigationNote
);

// 13. Link and unlink related tickets
router.post(
  '/:id/related',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  linkRelatedIncident
);
router.delete(
  '/:id/related/:relatedId',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  unlinkRelatedIncident
);

export default router;
