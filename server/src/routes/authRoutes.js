import { Router } from 'express';
import {
  register,
  login,
  logout,
  getMe,
  setupInitialAdmin,
  updateUserRole,
  getUsers,
} from '../controllers/authController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Public Authentication Endpoints (Rate Limited)
router.post('/register', authRateLimiter, register);
router.post('/login', authRateLimiter, login);
router.post('/logout', logout);
router.post('/setup-admin', authRateLimiter, setupInitialAdmin);

// Protected Session Retrieval
router.get('/me', authenticate, getMe);
router.get('/users', authenticate, authorize('support_engineer', 'manager', 'admin'), getUsers);

// Admin-Only User Roster Management
router.patch('/users/:id', authenticate, authorize('admin'), updateUserRole);

export default router;
