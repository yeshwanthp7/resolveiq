import { Router } from 'express';
import {
  getDeployments,
  getDeploymentById,
  createDeployment,
  updateDeployment,
  deleteDeployment,
} from '../controllers/deploymentController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Read deployment events (all authenticated users)
router.get('/', authenticate, getDeployments);
router.get('/:id', authenticate, getDeploymentById);

// Create deployment event (restricted to support engineers, managers, admins)
router.post(
  '/',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  createDeployment
);

// Update deployment event
router.patch(
  '/:id',
  authenticate,
  authorize('support_engineer', 'manager', 'admin'),
  updateDeployment
);

// Delete deployment event (admin only)
router.delete('/:id', authenticate, authorize('admin'), deleteDeployment);

export default router;
