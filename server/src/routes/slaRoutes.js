import { Router } from 'express';
import SLAPolicy from '../models/SLAPolicy.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Read SLA policies (all authenticated roles can read policies)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const policies = await SLAPolicy.find().sort({ priority: 1 });
    res.status(200).json({ success: true, count: policies.length, policies });
  } catch (err) {
    next(err);
  }
});

// Admin-only policy creation and modification
router.post('/', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { name, priority, responseTargetMinutes, resolutionTargetMinutes, businessHoursOnly } = req.body;
    const policy = await SLAPolicy.create({
      name,
      priority,
      responseTargetMinutes,
      resolutionTargetMinutes,
      businessHoursOnly: Boolean(businessHoursOnly),
    });
    res.status(201).json({ success: true, policy });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const policy = await SLAPolicy.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!policy) {
      return res.status(404).json({ success: false, error: 'SLA Policy not found.' });
    }
    res.status(200).json({ success: true, policy });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const policy = await SLAPolicy.findByIdAndDelete(req.params.id);
    if (!policy) {
      return res.status(404).json({ success: false, error: 'SLA Policy not found.' });
    }
    res.status(200).json({ success: true, message: 'SLA Policy deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

export default router;
