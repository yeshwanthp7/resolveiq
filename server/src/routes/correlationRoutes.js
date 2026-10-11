import { Router } from 'express';
import {
  getCorrelationGraph,
  getIncidentCorrelations,
  submitCorrelationDecision,
} from '../controllers/correlationController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Graph topology retrieval (all authenticated roles)
router.get('/graph', authenticate, getCorrelationGraph);

// Specific incident correlation candidates and blast radius
router.get('/incident/:id', authenticate, getIncidentCorrelations);

// Engineer decision recording (authorized engineers, managers, admins)
router.post(
  '/decision',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  submitCorrelationDecision
);

export default router;
