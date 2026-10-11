import crypto from 'crypto';
import IntegrationKey from '../models/IntegrationKey.js';

// In-memory rate limiting map for machine-to-machine API keys
const keyRateLimitMap = new Map();

/**
 * Reset rate limit tracker (useful for unit/integration testing)
 */
export function resetApiKeyRateLimits() {
  keyRateLimitMap.clear();
}

/**
 * Middleware to authenticate machine-to-machine API keys
 * 
 * Supports:
 * - Authorization: Bearer <key>
 * - X-API-Key: <key>
 * 
 * Verifies:
 * 1. Key existence via SHA-256 hash lookup (never stores or compares plaintext)
 * 2. Active status (rejects revoked credentials)
 * 3. Expiration date (if configured)
 * 4. Granular permissions/scopes (e.g. 'ingest:incidents')
 * 5. Rate limiting per API credential
 */
export function authenticateApiKey(requiredScope = 'ingest:incidents') {
  return async (req, res, next) => {
    try {
      let rawKey = null;

      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        rawKey = authHeader.substring(7).trim();
      } else if (req.headers['x-api-key']) {
        rawKey = String(req.headers['x-api-key']).trim();
      }

      if (!rawKey) {
        return res.status(401).json({
          success: false,
          error: 'Machine-to-machine authentication required. Please provide a valid API key via Authorization: Bearer <key> or X-API-Key header.',
        });
      }

      // Compute SHA-256 hash of provided plaintext token
      const apiKeyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      // Query database for matching hashed key
      const integrationKey = await IntegrationKey.findOne({ apiKeyHash }).select('+apiKeyHash');
      if (!integrationKey) {
        return res.status(401).json({
          success: false,
          error: 'Invalid API key credentials.',
        });
      }

      // Check Revocation & Active status
      if (!integrationKey.isActive) {
        return res.status(403).json({
          success: false,
          error: 'API key has been revoked or deactivated.',
        });
      }

      // Check Expiration
      if (integrationKey.expiresAt && new Date(integrationKey.expiresAt) < new Date()) {
        return res.status(403).json({
          success: false,
          error: 'API key has expired.',
        });
      }

      // Check Scopes / Permissions
      if (requiredScope && (!integrationKey.scopes || !integrationKey.scopes.includes(requiredScope))) {
        return res.status(403).json({
          success: false,
          error: `API key lacks required permission: ${requiredScope}`,
        });
      }

      // Enforce Rate Limiting
      const limit = integrationKey.rateLimitPerMinute || 60;
      const keyId = integrationKey._id.toString();
      const now = Date.now();
      const windowMs = 60 * 1000;

      let record = keyRateLimitMap.get(keyId);
      if (!record || now - record.startTime > windowMs) {
        record = { startTime: now, count: 1 };
        keyRateLimitMap.set(keyId, record);
      } else {
        record.count += 1;
        if (record.count > limit) {
          const remainingSeconds = Math.max(1, Math.ceil((windowMs - (now - record.startTime)) / 1000));
          res.setHeader('Retry-After', remainingSeconds);
          return res.status(429).json({
            success: false,
            error: `Rate limit exceeded. Maximum ${limit} requests per minute allowed for this API credential.`,
            retryAfterSeconds: remainingSeconds,
          });
        }
      }

      // Asynchronously update lastUsedAt timestamp without blocking request
      IntegrationKey.findByIdAndUpdate(integrationKey._id, { $set: { lastUsedAt: new Date() } }).exec();

      req.apiKey = integrationKey;
      next();
    } catch (err) {
      next(err);
    }
  };
}
