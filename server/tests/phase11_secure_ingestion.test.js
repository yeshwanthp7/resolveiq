import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import IntegrationKey from '../src/models/IntegrationKey.js';
import AuditLog from '../src/models/AuditLog.js';
import Team from '../src/models/Team.js';
import { resetApiKeyRateLimits } from '../src/middleware/apiKeyAuth.js';

describe('ResolveIQ Phase 11: Secure Incident Ingestion for External Monitoring Tools', () => {
  let app;
  let adminUser, endUser;
  let adminCookie, endUserCookie;
  let validApiKey, validKeyRecord;
  let revokedApiKey, revokedKeyRecord;
  let scopedApiKey, scopedKeyRecord;
  let rateLimitedApiKey, rateLimitedKeyRecord;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'phase11_ingest_jwt_secret_test_2026';
    await connectDB();
    app = createApp();

    const timestamp = Date.now();

    // 1. Seed Team
    await Team.findOneAndUpdate(
      { name: 'Platform SRE' },
      { $set: { name: 'Platform SRE', tier: 'Tier-1', services: ['kubernetes', 'ingress-gateway', 'payment-gateway'] } },
      { upsert: true, new: true }
    );

    // 2. Seed Admin & End User
    adminUser = await User.create({
      name: 'Admin Alice',
      email: `alice_admin_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'admin',
      team: 'Platform SRE',
      isActive: true,
    });

    endUser = await User.create({
      name: 'User Bob',
      email: `bob_user_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'end_user',
      team: 'Platform SRE',
      isActive: true,
    });

    // Login Admin
    const adminLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: adminUser.email, password: 'EnterprisePass123!' });
    adminCookie = adminLoginRes.headers['set-cookie'];

    // Login End User
    const endUserLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: endUser.email, password: 'EnterprisePass123!' });
    endUserCookie = endUserLoginRes.headers['set-cookie'];

    // 3. Provision Test API Keys
    // Standard valid key
    validApiKey = `riq_live_${crypto.randomBytes(24).toString('hex')}`;
    const validHash = crypto.createHash('sha256').update(validApiKey).digest('hex');
    validKeyRecord = await IntegrationKey.create({
      serviceName: 'Production Datadog APM',
      provider: 'datadog',
      apiKeyHash: validHash,
      apiKeyPrefix: validApiKey.slice(0, 12),
      scopes: ['ingest:incidents'],
      rateLimitPerMinute: 60,
      createdBy: adminUser._id,
      isActive: true,
    });

    // Revoked key
    revokedApiKey = `riq_live_${crypto.randomBytes(24).toString('hex')}`;
    const revokedHash = crypto.createHash('sha256').update(revokedApiKey).digest('hex');
    revokedKeyRecord = await IntegrationKey.create({
      serviceName: 'Decommissioned Prometheus',
      provider: 'prometheus',
      apiKeyHash: revokedHash,
      apiKeyPrefix: revokedApiKey.slice(0, 12),
      scopes: ['ingest:incidents'],
      rateLimitPerMinute: 60,
      createdBy: adminUser._id,
      isActive: false,
      revokedAt: new Date(),
    });

    // Insufficient scopes key
    scopedApiKey = `riq_live_${crypto.randomBytes(24).toString('hex')}`;
    const scopedHash = crypto.createHash('sha256').update(scopedApiKey).digest('hex');
    scopedKeyRecord = await IntegrationKey.create({
      serviceName: 'Read Only Analytics Key',
      provider: 'webhook',
      apiKeyHash: scopedHash,
      apiKeyPrefix: scopedApiKey.slice(0, 12),
      scopes: ['read:metrics'], // Missing 'ingest:incidents'
      rateLimitPerMinute: 60,
      createdBy: adminUser._id,
      isActive: true,
    });

    // Rate limited key (limit 2)
    rateLimitedApiKey = `riq_live_${crypto.randomBytes(24).toString('hex')}`;
    const rateLimitedHash = crypto.createHash('sha256').update(rateLimitedApiKey).digest('hex');
    rateLimitedKeyRecord = await IntegrationKey.create({
      serviceName: 'Throttled Probe Key',
      provider: 'synthetic',
      apiKeyHash: rateLimitedHash,
      apiKeyPrefix: rateLimitedApiKey.slice(0, 12),
      scopes: ['ingest:incidents'],
      rateLimitPerMinute: 2,
      createdBy: adminUser._id,
      isActive: true,
    });
  });

  after(async () => {
    await disconnectDB();
  });

  describe('1. Machine-to-Machine Credential Lifecycle & Security', () => {
    test('Admin can provision a new API key and receives plaintext token exactly once', async () => {
      const res = await request(app)
        .post('/api/v1/integrations')
        .set('Cookie', adminCookie)
        .send({
          serviceName: 'AWS CloudWatch Alarms',
          provider: 'cloudwatch',
          rateLimitPerMinute: 120,
          scopes: ['ingest:incidents'],
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.ok(res.body.apiKey, 'Must return plaintext apiKey in response');
      assert.ok(res.body.apiKey.startsWith('riq_live_'));

      // Check DB persistence: plaintext token must NEVER be stored, only SHA-256 hash
      const dbKey = await IntegrationKey.findById(res.body.integration._id).select('+apiKeyHash');
      assert.ok(dbKey, 'Key document must exist in MongoDB');
      assert.notEqual(dbKey.apiKeyHash, res.body.apiKey, 'Plaintext key must never equal stored hash');
      const expectedHash = crypto.createHash('sha256').update(res.body.apiKey).digest('hex');
      assert.equal(dbKey.apiKeyHash, expectedHash, 'Stored hash must match SHA-256 digest of plaintext key');

      // Check audit log was created
      const auditLog = await AuditLog.findOne({
        action: 'API_KEY_CREATED',
        'newState.integrationId': dbKey._id,
      });
      assert.ok(auditLog, 'Audit log for API_KEY_CREATED must be recorded');
    });

    test('Non-admin users cannot provision integration credentials (RBAC 403)', async () => {
      const res = await request(app)
        .post('/api/v1/integrations')
        .set('Cookie', endUserCookie)
        .send({
          serviceName: 'Unauthorized Ingestion Attempt',
          provider: 'prometheus',
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
    });

    test('Listing integrations returns masked key prefix and metadata but never exposes plaintext or hashes', async () => {
      const res = await request(app)
        .get('/api/v1/integrations')
        .set('Cookie', adminCookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(Array.isArray(res.body.integrations));
      assert.ok(res.body.integrations.length >= 4);

      for (const item of res.body.integrations) {
        assert.ok(item.apiKeyPrefix, 'apiKeyPrefix must be present');
        assert.equal(item.apiKey, undefined, 'Plaintext apiKey must not be present in list response');
        assert.equal(item.apiKeyHash, undefined, 'apiKeyHash must not be leaked');
      }
    });

    test('Admin can revoke an API key via POST /api/v1/integrations/:id/revoke', async () => {
      // Create a temporary key to revoke
      const tempKey = `riq_live_${crypto.randomBytes(24).toString('hex')}`;
      const tempHash = crypto.createHash('sha256').update(tempKey).digest('hex');
      const tempDoc = await IntegrationKey.create({
        serviceName: 'Temporary Key To Revoke',
        provider: 'webhook',
        apiKeyHash: tempHash,
        apiKeyPrefix: tempKey.slice(0, 12),
        scopes: ['ingest:incidents'],
        createdBy: adminUser._id,
        isActive: true,
      });

      const res = await request(app)
        .post(`/api/v1/integrations/${tempDoc._id}/revoke`)
        .set('Cookie', adminCookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.integration.isActive, false);
      assert.ok(res.body.integration.revokedAt);

      // Verify Audit Log
      const audit = await AuditLog.findOne({
        action: 'API_KEY_REVOKED',
        'newState.integrationId': tempDoc._id,
      });
      assert.ok(audit, 'AuditLog for API_KEY_REVOKED must be present');
    });
  });

  describe('2. Authentication & Authorization Gatekeepers for Ingestion Endpoint', () => {
    test('Reject request when no API credentials are provided (401 Unauthorized)', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .send({
          title: 'Database Spike',
          description: 'Spike detected',
          affectedService: 'database-cluster',
        });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.match(res.body.error, /Machine-to-machine authentication required/i);
    });

    test('Reject request with invalid or corrupted API key (401 Unauthorized)', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', 'Bearer riq_live_invalid_garbage_key_9999')
        .send({
          title: 'Database Spike',
          description: 'Spike detected',
          affectedService: 'database-cluster',
        });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.match(res.body.error, /Invalid API key/i);
    });

    test('Reject request using a revoked API key (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${revokedApiKey}`)
        .send({
          title: 'Network Partition',
          description: 'Ingress node dropped',
          affectedService: 'ingress-gateway',
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.error, /revoked or deactivated/i);
    });

    test('Reject request using an API key lacking required scope (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${scopedApiKey}`)
        .send({
          title: 'Cache Timeout',
          description: 'Redis read timeout',
          affectedService: 'redis-cache',
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.error, /lacks required permission: ingest:incidents/i);
    });

    test('Accept authentication via X-API-Key header as alternative to Bearer token', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('X-API-Key', validApiKey)
        .send({
          title: 'X-API-Key Header Test Alert',
          description: 'Testing authentication via custom header',
          affectedService: 'ingress-gateway',
          severity: 'high',
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.ok(res.body.incident._id);
    });
  });

  describe('3. Payload Validation & Request Size Controls', () => {
    test('Reject empty JSON body with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({});

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.error, /Malformed or empty JSON payload/i);
    });

    test('Reject payload missing title with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({
          description: 'Description without title',
          affectedService: 'payment-gateway',
        });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /Incident title is required/i);
    });

    test('Reject payload missing description with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({
          title: 'Title without description',
          affectedService: 'payment-gateway',
        });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /Incident description is required/i);
    });

    test('Reject payload missing affectedService with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({
          title: 'Valid title',
          description: 'Valid description',
        });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /Affected service is required/i);
    });

    test('Reject title exceeding 200 character boundary with 400 Bad Request', async () => {
      const longTitle = 'A'.repeat(220);
      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({
          title: longTitle,
          description: 'Description',
          affectedService: 'payment-gateway',
        });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /cannot exceed 200 characters/i);
    });
  });

  describe('4. Idempotency Keys & Duplicate Retry Prevention', () => {
    const testEventId = `prom_evt_${Date.now()}_dedup_test`;

    test('Initial ingestion of external event returns 201 Created and persists incident', async () => {
      const initialCount = await Incident.countDocuments();

      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({
          title: 'Container Memory Leak Triggering OOMKilled in Payments',
          description: 'Prometheus container memory usage exceeded 95% cgroup limit.',
          affectedService: 'payment-gateway',
          severity: 'critical',
          source: 'datadog',
          externalEventId: testEventId,
          environment: 'production',
          tags: ['memory', 'oom', 'kubernetes'],
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.isDuplicateRetry, false);
      assert.ok(res.body.incident._id);
      assert.equal(res.body.incident.externalEventId, testEventId);

      const afterCount = await Incident.countDocuments();
      assert.equal(afterCount, initialCount + 1, 'Incident count must increment by 1');
    });

    test('Duplicate retry with same externalEventId returns 200 OK with isDuplicateRetry: true without creating duplicates', async () => {
      const initialCount = await Incident.countDocuments();

      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({
          title: 'Container Memory Leak Triggering OOMKilled in Payments',
          description: 'Prometheus container memory usage exceeded 95% cgroup limit. (RETRY SEND)',
          affectedService: 'payment-gateway',
          severity: 'critical',
          source: 'datadog',
          externalEventId: testEventId,
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.isDuplicateRetry, true);
      assert.match(res.body.message, /Duplicate event detected/i);
      assert.equal(res.body.incident.externalEventId, testEventId);

      // Verify zero new incidents created
      const afterCount = await Incident.countDocuments();
      assert.equal(afterCount, initialCount, 'Database incident count must NOT increment on duplicate retry');
    });

    test('Duplicate retry with X-Idempotency-Key header returns existing incident without creating duplicates', async () => {
      const headerIdempotencyKey = `idemp_hdr_${Date.now()}_retry_test`;

      // 1. First call with X-Idempotency-Key
      const res1 = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${validApiKey}`)
        .set('X-Idempotency-Key', headerIdempotencyKey)
        .send({
          title: 'HTTP 504 Gateway Timeouts on Edge Proxy',
          description: 'Ingress reports 504 error rate spike',
          affectedService: 'ingress-gateway',
          severity: 'high',
        });

      assert.equal(res1.status, 201);
      assert.equal(res1.body.isDuplicateRetry, false);
      const originalIncidentId = res1.body.incident._id;

      // 2. Retry with same X-Idempotency-Key
      const res2 = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${validApiKey}`)
        .set('X-Idempotency-Key', headerIdempotencyKey)
        .send({
          title: 'HTTP 504 Gateway Timeouts on Edge Proxy (RETRY)',
          description: 'Ingress reports 504 error rate spike (RETRY)',
          affectedService: 'ingress-gateway',
          severity: 'high',
        });

      assert.equal(res2.status, 200);
      assert.equal(res2.body.isDuplicateRetry, true);
      assert.equal(res2.body.incident._id, originalIncidentId);
    });
  });

  describe('5. Reuse of Priority Matrix, SLA Engine, and Deterministic Triage', () => {
    test('Accepted monitoring event derives deterministic priority, calculates SLA targets, and executes triage', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({
          title: 'Critical Outage: Core Database Cluster Down',
          description: 'Postgres primary unreachable across all replicas. Immediate failover required.',
          affectedService: 'database-cluster',
          severity: 'critical',
          source: 'datadog',
        });

      assert.equal(res.status, 201);
      const inc = res.body.incident;

      // 1. Priority calculation: severity critical maps to enterprise impact + critical urgency => P1
      assert.equal(inc.priority, 'P1');
      assert.equal(inc.impact, 'enterprise');
      assert.equal(inc.urgency, 'critical');

      // 2. SLA deadlines computed
      assert.ok(inc.sla, 'SLA object must be generated');
      assert.ok(inc.sla.responseDeadline, 'responseDeadline must be calculated');
      assert.ok(inc.sla.resolutionDeadline, 'resolutionDeadline must be calculated');
      assert.equal(inc.sla.responseTargetMinutes, 15, 'P1 response target should be 15 minutes');
      assert.equal(inc.sla.resolutionTargetMinutes, 120, 'P1 resolution target should be 120 minutes');

      // 3. Triage routing
      assert.equal(inc.category, 'availability', 'Outage / down keywords should classify as availability');

      // 4. Persistence check in MongoDB
      const foundInDb = await Incident.findById(inc._id);
      assert.ok(foundInDb, 'Incident must be persistent in MongoDB');
      assert.equal(foundInDb.incidentNumber, inc.incidentNumber);

      // 5. Audit Log check
      const audit = await AuditLog.findOne({
        incidentId: inc._id,
        action: 'INCIDENT_INGESTED',
      });
      assert.ok(audit, 'AuditLog record must exist for INCIDENT_INGESTED');
      assert.match(audit.actorName, /M2M Integration/i);
      assert.equal(audit.actorRole, 'system');
    });

    test('Ingested incident appears in normal UI incident list query (GET /api/v1/incidents)', async () => {
      const res = await request(app)
        .get('/api/v1/incidents')
        .set('Cookie', adminCookie)
        .query({ search: 'Core Database Cluster Down' });

      assert.equal(res.status, 200);
      assert.ok(res.body.incidents.length >= 1);
      const matched = res.body.incidents.find((i) => i.title.includes('Core Database Cluster Down'));
      assert.ok(matched, 'Ingested incident must appear in regular incident query endpoints');
      assert.equal(matched.priority, 'P1');
    });
  });

  describe('6. Rate Limiting Enforcement', () => {
    test('Exceeding API key rate limit returns 429 Too Many Requests with Retry-After header', async () => {
      resetApiKeyRateLimits();

      // rateLimitedApiKey has rateLimitPerMinute = 2
      // 1st request -> ok
      const res1 = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${rateLimitedApiKey}`)
        .send({
          title: 'Throttled Probe 1',
          description: 'Probe ping 1',
          affectedService: 'ingress-gateway',
        });
      assert.equal(res1.status, 201);

      // 2nd request -> ok
      const res2 = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${rateLimitedApiKey}`)
        .send({
          title: 'Throttled Probe 2',
          description: 'Probe ping 2',
          affectedService: 'ingress-gateway',
        });
      assert.equal(res2.status, 201);

      // 3rd request -> exceeds limit of 2 req/min -> 429
      const res3 = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${rateLimitedApiKey}`)
        .send({
          title: 'Throttled Probe 3',
          description: 'Probe ping 3',
          affectedService: 'ingress-gateway',
        });

      assert.equal(res3.status, 429);
      assert.equal(res3.body.success, false);
      assert.match(res3.body.error, /Rate limit exceeded/i);
      assert.ok(res3.headers['retry-after'], 'Retry-After header must be set');
    });
  });
});
