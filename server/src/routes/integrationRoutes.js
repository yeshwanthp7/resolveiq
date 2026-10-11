import { Router } from 'express';
import crypto from 'crypto';
import IntegrationKey from '../models/IntegrationKey.js';
import AuditLog from '../models/AuditLog.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Admin-Only: List all registered integrations (Safe metadata only, hashes never exposed)
router.get('/', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const integrations = await IntegrationKey.find()
      .populate('createdBy', 'name email role')
      .populate('revokedBy', 'name email role')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: integrations.length,
      integrations,
    });
  } catch (err) {
    next(err);
  }
});

// Admin-Only: Register / provision dedicated machine-to-machine integration key
router.post('/', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { serviceName, provider, scopes, rateLimitPerMinute, expiresInDays } = req.body;
    if (!serviceName || !provider) {
      return res.status(400).json({
        success: false,
        error: 'serviceName and provider are required fields.',
      });
    }

    // Generate cryptographically secure API key
    const rawApiKey = `riq_live_${crypto.randomBytes(24).toString('hex')}`;
    const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
    const apiKeyPrefix = rawApiKey.slice(0, 12);

    let expiresAt = null;
    if (expiresInDays && Number(expiresInDays) > 0) {
      expiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);
    }

    const permittedScopes = Array.isArray(scopes) && scopes.length > 0
      ? scopes
      : ['ingest:incidents'];

    const integration = await IntegrationKey.create({
      serviceName: serviceName.trim(),
      provider: provider.trim().toLowerCase(),
      apiKeyHash,
      apiKeyPrefix,
      scopes: permittedScopes,
      rateLimitPerMinute: Number(rateLimitPerMinute) || 60,
      expiresAt,
      createdBy: req.user._id,
      isActive: true,
    });

    // Record audit entry
    await AuditLog.create({
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'API_KEY_CREATED',
      newState: {
        integrationId: integration._id,
        serviceName: integration.serviceName,
        provider: integration.provider,
        apiKeyPrefix,
        scopes: permittedScopes,
        rateLimitPerMinute: integration.rateLimitPerMinute,
      },
      reason: `Provisioned M2M API key credentials for ${integration.serviceName} (${integration.provider})`,
    });

    res.status(201).json({
      success: true,
      message: 'Integration API key provisioned successfully. Copy this key now; it will never be displayed again.',
      apiKey: rawApiKey, // Revealed only once upon creation
      integration: {
        _id: integration._id,
        serviceName: integration.serviceName,
        provider: integration.provider,
        apiKeyPrefix: integration.apiKeyPrefix,
        scopes: integration.scopes,
        rateLimitPerMinute: integration.rateLimitPerMinute,
        isActive: integration.isActive,
        expiresAt: integration.expiresAt,
        createdAt: integration.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Admin-Only: Revoke integration key
router.post('/:id/revoke', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const integration = await IntegrationKey.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          isActive: false,
          revokedAt: new Date(),
          revokedBy: req.user._id,
        },
      },
      { new: true }
    );

    if (!integration) {
      return res.status(404).json({ success: false, error: 'Integration key not found.' });
    }

    await AuditLog.create({
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'API_KEY_REVOKED',
      newState: {
        integrationId: integration._id,
        serviceName: integration.serviceName,
        isActive: false,
        revokedAt: integration.revokedAt,
      },
      reason: `Revoked M2M API key credentials for ${integration.serviceName}`,
    });

    res.status(200).json({
      success: true,
      message: 'API key credentials revoked successfully.',
      integration,
    });
  } catch (err) {
    next(err);
  }
});

// Admin-Only: Update status / settings of integration key
router.patch('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { isActive, rateLimitPerMinute, scopes } = req.body;
    const updateDoc = {};

    if (typeof isActive === 'boolean') {
      updateDoc.isActive = isActive;
      if (!isActive) {
        updateDoc.revokedAt = new Date();
        updateDoc.revokedBy = req.user._id;
      } else {
        updateDoc.revokedAt = null;
        updateDoc.revokedBy = null;
      }
    }

    if (rateLimitPerMinute) {
      updateDoc.rateLimitPerMinute = Number(rateLimitPerMinute);
    }

    if (Array.isArray(scopes)) {
      updateDoc.scopes = scopes;
    }

    const integration = await IntegrationKey.findByIdAndUpdate(
      req.params.id,
      { $set: updateDoc },
      { new: true }
    );

    if (!integration) {
      return res.status(404).json({ success: false, error: 'Integration key not found.' });
    }

    if (typeof isActive === 'boolean' && !isActive) {
      await AuditLog.create({
        actorId: req.user._id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'API_KEY_REVOKED',
        newState: {
          integrationId: integration._id,
          serviceName: integration.serviceName,
          isActive: false,
        },
        reason: `Deactivated M2M credentials for ${integration.serviceName}`,
      });
    }

    res.status(200).json({ success: true, integration });
  } catch (err) {
    next(err);
  }
});

// Admin-Only: Delete integration key
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const integration = await IntegrationKey.findByIdAndDelete(req.params.id);
    if (!integration) {
      return res.status(404).json({ success: false, error: 'Integration not found.' });
    }

    await AuditLog.create({
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'API_KEY_REVOKED',
      newState: {
        integrationId: integration._id,
        serviceName: integration.serviceName,
      },
      reason: `Permanently removed API credentials for ${integration.serviceName}`,
    });

    res.status(200).json({ success: true, message: 'Integration revoked and removed.' });
  } catch (err) {
    next(err);
  }
});

export default router;
