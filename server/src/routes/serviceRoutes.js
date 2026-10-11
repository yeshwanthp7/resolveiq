import { Router } from 'express';
import Team from '../models/Team.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Read teams roster (all authenticated roles)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const teams = await Team.find().sort({ name: 1 });
    res.status(200).json({
      success: true,
      count: teams.length,
      teams,
    });
  } catch (err) {
    next(err);
  }
});

// Admin-Only Team Lifecycle Management
router.post('/', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { name, tier, services, description } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'Team name is required.' });
    }

    const team = await Team.create({
      name: name.trim(),
      tier: tier || 'tier-2',
      services: Array.isArray(services) ? services : [],
      description: description || '',
    });

    res.status(201).json({ success: true, team });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const team = await Team.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found.' });
    }
    res.status(200).json({ success: true, team });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const team = await Team.findByIdAndDelete(req.params.id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found.' });
    }
    res.status(200).json({ success: true, message: 'Team successfully removed.' });
  } catch (err) {
    next(err);
  }
});

export default router;
