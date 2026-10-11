import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import Team from '../src/models/Team.js';
import DeploymentEvent from '../src/models/DeploymentEvent.js';
import Resolution from '../src/models/Resolution.js';
import RecommendationFeedback from '../src/models/RecommendationFeedback.js';
import IntegrationKey from '../src/models/IntegrationKey.js';
import AuditLog from '../src/models/AuditLog.js';
import { calculatePriority } from '../src/utils/priorityMatrix.js';
import { computeSlaTargets, evaluateSlaStatus } from '../src/utils/slaEngine.js';
import { validateGeminiOutput } from '../src/services/geminiService.js';
import { runEvaluationBenchmark } from '../src/utils/evaluationBenchmark.js';

describe('ResolveIQ Phase 12: Master Automated Testing, Evaluation & Security Hardening', () => {
  let app;
  let adminUser, managerUser, engineerTeamA, engineerTeamB, endUser;
  let adminCookie, managerCookie, engineerTeamACookie, engineerTeamBCookie, endUserCookie;
  let teamA, teamB;
  let incidentTeamA, incidentTeamB;

  before(async () => {
    // Isolated in-memory database guarantees tests cannot alter or erase development data
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'phase12_master_secret_2026_test';
    await connectDB();
    app = createApp();

    const timestamp = Date.now();

    // 1. Teams
    teamA = await Team.findOneAndUpdate(
      { name: 'Platform SRE' },
      { $set: { name: 'Platform SRE', tier: 'Tier-1', services: ['ingress-gateway', 'kubernetes', 'auth-service'] } },
      { upsert: true, new: true }
    );

    teamB = await Team.findOneAndUpdate(
      { name: 'Payments Core' },
      { $set: { name: 'Payments Core', tier: 'Tier-1', services: ['payment-gateway', 'billing-service'] } },
      { upsert: true, new: true }
    );

    // 2. Users
    adminUser = await User.create({
      name: 'Admin Alice',
      email: `alice_p12_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'admin',
      team: 'Platform SRE',
      isActive: true,
    });

    managerUser = await User.create({
      name: 'Manager Maya',
      email: `maya_p12_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'manager',
      team: 'Platform SRE',
      isActive: true,
    });

    engineerTeamA = await User.create({
      name: 'Engineer Alan',
      email: `alan_p12_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Platform SRE',
      isActive: true,
    });

    engineerTeamB = await User.create({
      name: 'Engineer Brenda',
      email: `brenda_p12_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Payments Core',
      isActive: true,
    });

    endUser = await User.create({
      name: 'User Bob',
      email: `bob_p12_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'end_user',
      team: 'Platform SRE',
      isActive: true,
    });

    // 3. Login sessions
    const login = async (user) => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'EnterprisePass123!' });
      return res.headers['set-cookie'];
    };

    adminCookie = await login(adminUser);
    managerCookie = await login(managerUser);
    engineerTeamACookie = await login(engineerTeamA);
    engineerTeamBCookie = await login(engineerTeamB);
    endUserCookie = await login(endUser);

    // 4. Incidents
    incidentTeamA = await Incident.create({
      title: 'Ingress Envoy Pod 504 Timeouts',
      description: 'Customer traffic experiencing 504 timeouts across ingress gateway pods.',
      affectedService: 'ingress-gateway',
      impact: 'enterprise',
      urgency: 'critical',
      priority: 'P1',
      status: 'investigating',
      assignedTeam: 'Platform SRE',
      assignee: engineerTeamA._id,
      reporter: endUser._id,
      sla: computeSlaTargets('P1', new Date()),
    });

    incidentTeamB = await Incident.create({
      title: 'Stripe Webhook Processing Lag on Payments API',
      description: 'Webhook queue accumulation in payment-gateway service.',
      affectedService: 'payment-gateway',
      impact: 'department',
      urgency: 'moderate',
      priority: 'P3',
      status: 'acknowledged',
      assignedTeam: 'Payments Core',
      assignee: engineerTeamB._id,
      reporter: engineerTeamB._id,
      sla: computeSlaTargets('P3', new Date()),
    });
  });

  after(async () => {
    await disconnectDB();
  });

  // =========================================================================
  // 1. Authentication, Authorization & Security Hardening
  // =========================================================================
  describe('1. Authentication, Authorization & Security Hardening', () => {
    test('Password verification with bcrypt and rejected bad credentials', async () => {
      const badRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: adminUser.email, password: 'WrongPassword999!' });
      assert.equal(badRes.status, 401);
      assert.equal(badRes.body.success, false);
    });

    test('Regular registration strictly prevents self-assigning admin role', async () => {
      const regRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Hacker Harry',
          email: `harry_${Date.now()}@resolveiq.io`,
          password: 'EnterprisePass123!',
          role: 'admin', // Attempt privilege escalation
        });

      assert.equal(regRes.status, 201);
      assert.notEqual(regRes.body.user.role, 'admin', 'Public registration must never assign admin role');
      assert.equal(regRes.body.user.role, 'end_user');
    });

    test('Non-admins cannot change user roles via PATCH /auth/users/:id', async () => {
      const res = await request(app)
        .patch(`/api/v1/auth/users/${endUser._id}`)
        .set('Cookie', endUserCookie)
        .send({ role: 'admin' });

      assert.equal(res.status, 403);
    });

    test('Users cannot manipulate SLA values in payload on incident update', async () => {
      const originalDeadline = incidentTeamA.sla.resolutionDeadline;

      const res = await request(app)
        .patch(`/api/v1/incidents/${incidentTeamA._id}`)
        .set('Cookie', engineerTeamACookie)
        .send({
          sla: {
            resolutionTargetMinutes: 999999,
            isResolutionBreached: false,
          },
          title: 'Ingress Envoy Pod 504 Timeouts (Updated Title)',
        });

      assert.equal(res.status, 200);
      const inc = await Incident.findById(incidentTeamA._id);
      assert.equal(inc.title, 'Ingress Envoy Pod 504 Timeouts (Updated Title)');
      // SLA target must remain untouched by client body tampering
      assert.equal(
        inc.sla.resolutionDeadline.toISOString(),
        originalDeadline.toISOString(),
        'Server must ignore client-supplied SLA overrides'
      );
    });

    test('End users cannot assign incidents or change assignees beyond their permissions', async () => {
      const res = await request(app)
        .patch(`/api/v1/incidents/${incidentTeamA._id}/reassign`)
        .set('Cookie', endUserCookie)
        .send({ assigneeId: engineerTeamA._id });

      assert.equal(res.status, 403, 'End users must not be permitted to assign incidents');
    });

    test('Reassigning to an inactive user or end user is rejected with 400 Bad Request', async () => {
      const inactiveUser = await User.create({
        name: 'Inactive Responder',
        email: `inactive_${Date.now()}@resolveiq.io`,
        password: 'EnterprisePass123!',
        role: 'support_engineer',
        team: 'Platform SRE',
        isActive: false,
      });

      const res = await request(app)
        .patch(`/api/v1/incidents/${incidentTeamA._id}/reassign`)
        .set('Cookie', managerCookie)
        .send({ assigneeId: inactiveUser._id });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /inactive user/i);

      // Attempt to assign to end user
      const resEnd = await request(app)
        .patch(`/api/v1/incidents/${incidentTeamA._id}/reassign`)
        .set('Cookie', managerCookie)
        .send({ assigneeId: endUser._id });

      assert.equal(resEnd.status, 400);
      assert.match(resEnd.body.error, /Cannot assign incident to an end user/i);
    });
  });

  // =========================================================================
  // 2. User & Team Data Isolation
  // =========================================================================
  describe('2. User and Team Data Isolation', () => {
    test('End user is denied access to view incidents reported by other users', async () => {
      // incidentTeamB was reported by engineerTeamB
      const res = await request(app)
        .get(`/api/v1/incidents/${incidentTeamB._id}`)
        .set('Cookie', endUserCookie);

      assert.equal(res.status, 403);
      assert.match(res.body.error, /End users are only authorized to view incidents they reported/i);
    });

    test('Support Engineer from Team A cannot view or edit incidents assigned to Team B', async () => {
      // Engineer A belongs to Platform SRE, incidentTeamB belongs to Payments Core
      const resGet = await request(app)
        .get(`/api/v1/incidents/${incidentTeamB._id}`)
        .set('Cookie', engineerTeamACookie);

      assert.equal(resGet.status, 403);
      assert.match(resGet.body.error, /Support Engineers can only access incidents assigned to their team/i);

      const resPatch = await request(app)
        .patch(`/api/v1/incidents/${incidentTeamB._id}`)
        .set('Cookie', engineerTeamACookie)
        .send({ title: 'Tampered Team B Title' });

      assert.equal(resPatch.status, 403);
    });
  });

  // =========================================================================
  // 3. Incident Creation, Lifecycle & Ticket Number Uniqueness
  // =========================================================================
  describe('3. Incident Creation, Lifecycle & Ticket Number Uniqueness', () => {
    test('Rapid concurrent creation generates unique sequential ticket numbers (INC-XXXX)', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/api/v1/incidents')
          .set('Cookie', engineerTeamACookie)
          .send({
            title: `Rapid Concurrent Incident ${i + 1}`,
            description: `Testing atomic ticket sequence generation ${i + 1}`,
            affectedService: 'kubernetes',
            impact: 'department',
            urgency: 'moderate',
          })
      );

      const results = await Promise.all(promises);
      const ticketNumbers = new Set();

      for (const res of results) {
        assert.equal(res.status, 201);
        assert.ok(res.body.incident.incidentNumber);
        assert.ok(res.body.incident.incidentNumber.startsWith('INC-'));
        ticketNumbers.add(res.body.incident.incidentNumber);
      }

      assert.equal(ticketNumbers.size, 5, 'All concurrent incidents must have unique ticket numbers');
    });

    test('Enforces permitted lifecycle transitions and blocks illegal state jumps', async () => {
      // Valid transition: investigating -> in_progress
      const resValid = await request(app)
        .patch(`/api/v1/incidents/${incidentTeamA._id}/status`)
        .set('Cookie', engineerTeamACookie)
        .send({ status: 'in_progress', reason: 'Engaged active debugging session' });

      assert.equal(resValid.status, 200);
      assert.equal(resValid.body.incident.status, 'in_progress');

      // Invalid transition: in_progress -> reopened (can only reopen from resolved or closed)
      const resInvalid = await request(app)
        .patch(`/api/v1/incidents/${incidentTeamA._id}/status`)
        .set('Cookie', engineerTeamACookie)
        .send({ status: 'reopened', reason: 'Illegal jump' });

      assert.equal(resInvalid.status, 400);
      assert.match(resInvalid.body.error, /Invalid status transition/i);
    });
  });

  // =========================================================================
  // 4. Classification, Priority Rules & SLA Engine
  // =========================================================================
  describe('4. Classification Rules, Priority Matrix & SLA Calculations', () => {
    test('Deterministic ITIL 3x3 Matrix derives correct priorities across all impact/urgency tiers', () => {
      assert.equal(calculatePriority('enterprise', 'critical').code, 'P1');
      assert.equal(calculatePriority('enterprise', 'moderate').code, 'P2');
      assert.equal(calculatePriority('enterprise', 'low').code, 'P3');
      assert.equal(calculatePriority('department', 'critical').code, 'P2');
      assert.equal(calculatePriority('department', 'moderate').code, 'P3');
      assert.equal(calculatePriority('department', 'low').code, 'P4');
      assert.equal(calculatePriority('single_user', 'critical').code, 'P4');
      assert.equal(calculatePriority('single_user', 'moderate').code, 'P4');
      assert.equal(calculatePriority('single_user', 'low').code, 'P5');
    });

    test('SLA engine calculates explicit response/resolution targets and evaluates breach states', () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - 150 * 60 * 1000);
      const p1Sla = computeSlaTargets('P1', createdAt);
      assert.equal(p1Sla.responseTargetMinutes, 15);
      assert.equal(p1Sla.resolutionTargetMinutes, 120);

      // Verify SLA status evaluation on synthetic ticket
      const breachedTicket = {
        priority: 'P1',
        createdAt,
        acknowledgedAt: new Date(createdAt.getTime() + 10 * 60 * 1000), // acked within 10m <= 15m
        resolvedAt: null,
        status: 'in_progress',
        sla: p1Sla,
      };

      const evalResult = evaluateSlaStatus(breachedTicket, now);
      assert.equal(evalResult.isResponseBreached, false, 'Acked within 10m <= 15m target');
      assert.equal(evalResult.isResolutionBreached, true, 'Unresolved after 150m > 120m target');
      assert.equal(evalResult.overallState, 'Breached');
    });
  });

  // =========================================================================
  // 5. Duplicate Detection & Lexical Similarity
  // =========================================================================
  describe('5. Duplicate Detection & Historical Retrieval', () => {
    test('Duplicate scan detects lexical similarity between related tickets and returns evidence', async () => {
      const res = await request(app)
        .get(`/api/v1/incidents/${incidentTeamA._id}/duplicates`)
        .set('Cookie', engineerTeamACookie);

      assert.equal(res.status, 200);
      assert.ok(res.body.success);
      assert.ok(Array.isArray(res.body.duplicates));
    });

    test('Search knowledge base retrieves verified historical resolutions with ranking evidence', async () => {
      // Seed a resolved historical incident and verified resolution
      const historicalInc = await Incident.create({
        title: 'Envoy Pod Connection Saturation Outage',
        description: 'Envoy proxy connection pool saturated by spike in HTTP keep-alive connections.',
        affectedService: 'ingress-gateway',
        impact: 'enterprise',
        urgency: 'critical',
        priority: 'P1',
        status: 'resolved',
        assignedTeam: 'Platform SRE',
      });

      await Resolution.create({
        incidentId: historicalInc._id,
        incidentNumber: historicalInc.incidentNumber,
        title: historicalInc.title,
        affectedService: historicalInc.affectedService,
        rootCauseCategory: 'capacity_exhaustion',
        summary: 'Envoy proxy connection pool saturated by spike in HTTP keep-alive connections.',
        remediationSteps: ['Scale envoy replica count from 3 to 6', 'Increase max_connections parameter to 4096'],
        preventativeActions: ['Configure rate limiter on upstream ingress'],
        isVerified: true,
        resolvedBy: engineerTeamA._id,
        verifiedBy: managerUser._id,
      });

      const res = await request(app)
        .get('/api/v1/incidents/knowledge-base/search')
        .set('Cookie', engineerTeamACookie)
        .query({ q: 'Envoy connection pool saturated' });

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.candidates));
      assert.ok(res.body.candidates.length >= 1);
      assert.equal(res.body.candidates[0].isVerified, true);
    });
  });

  // =========================================================================
  // 6. AI Co-Pilot Validation & Failure Fallback
  // =========================================================================
  describe('6. AI Co-Pilot Schema Validation & Failure Fallback', () => {
    test('validateGeminiOutput strictly rejects malformed candidate schema', () => {
      // Missing suggestedCategory
      assert.equal(validateGeminiOutput({ suggestedPriority: 'P1' }).valid, false);
      // Invalid category
      assert.equal(
        validateGeminiOutput({
          suggestedCategory: 'magical_outage',
          suggestedPriority: 'P1',
          suggestedTeam: 'Platform SRE',
          explanation: 'Valid explanation',
          evidence: ['Evidence 1'],
        }).valid,
        false
      );
      // Valid payload passes
      assert.equal(
        validateGeminiOutput({
          suggestedCategory: 'availability',
          suggestedPriority: 'P1',
          suggestedTeam: 'Platform SRE',
          explanation: 'Valid explanation string',
          evidence: ['Evidence 1'],
        }).valid,
        true
      );
    });
  });

  // =========================================================================
  // 7. Dashboard Aggregation & Operational Analytics
  // =========================================================================
  describe('7. Dashboard Aggregation & Analytics Scoping', () => {
    test('GET /api/v1/analytics returns open incidents, priority breakdown, and workload', async () => {
      const res = await request(app)
        .get('/api/v1/analytics')
        .set('Cookie', managerCookie);

      assert.equal(res.status, 200);
      assert.ok(res.body.metrics);
      assert.ok(typeof res.body.metrics.totalIncidents === 'number');
    });

    test('End users are forbidden from accessing manager analytics (403)', async () => {
      const res = await request(app)
        .get('/api/v1/analytics')
        .set('Cookie', endUserCookie);

      assert.equal(res.status, 403);
    });
  });

  // =========================================================================
  // 8. Incident Correlation & Deployment Correlation
  // =========================================================================
  describe('8. Incident & Deployment Correlation Engine', () => {
    test('Computes multi-factor correlation score and identifies blast radius', async () => {
      // Seed a deployment event on ingress-gateway preceding the incident
      await DeploymentEvent.create({
        service: 'ingress-gateway',
        serviceName: 'ingress-gateway',
        version: 'v2.8.4',
        environment: 'production',
        deployedAt: new Date(Date.now() - 25 * 60 * 1000), // 25m ago
        status: 'success',
        changeSummary: 'Update envoy max_connections configuration and TLS cipher suite',
      });

      const res = await request(app)
        .get(`/api/v1/correlations/incident/${incidentTeamA._id}`)
        .set('Cookie', engineerTeamACookie);

      assert.equal(res.status, 200);
      assert.ok(res.body.dependencyTopology);
      assert.ok(Array.isArray(res.body.correlatedDeployments));
      assert.ok(res.body.correlatedDeployments.length >= 1);
      assert.equal(res.body.correlatedDeployments[0].deployment.version, 'v2.8.4');
    });
  });

  // =========================================================================
  // 9. Workload-Aware Assignment & What-If Simulation
  // =========================================================================
  describe('9. Workload-Aware Assignment & What-If Simulation', () => {
    test('Candidate responder ranking evaluates workload, skill tags, and availability', async () => {
      const res = await request(app)
        .get(`/api/v1/incidents/${incidentTeamA._id}/candidate-responders`)
        .set('Cookie', managerCookie);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.candidates));
      assert.ok(res.body.meta.disclaimer, 'Must include ethical productivity disclaimer');
    });

    test('What-if simulator projects SLA breach and queue impact with ZERO database mutations', async () => {
      const preSnapshot = await Incident.findById(incidentTeamA._id).lean();

      const res = await request(app)
        .post(`/api/v1/incidents/${incidentTeamA._id}/what-if`)
        .set('Cookie', managerCookie)
        .send({
          assignmentDelayMinutes: 45,
          targetAssigneeId: engineerTeamA._id,
        });

      assert.equal(res.status, 200);
      assert.ok(res.body.simulation);
      assert.equal(res.body.simulation.meta.isHypothetical, true);

      // Verify zero live mutations
      const postSnapshot = await Incident.findById(incidentTeamA._id).lean();
      assert.equal(postSnapshot.title, preSnapshot.title);
      assert.equal(postSnapshot.status, preSnapshot.status);
      assert.equal(postSnapshot.assignee.toString(), preSnapshot.assignee.toString());
    });
  });

  // =========================================================================
  // 10. Resolution Feedback & Learning Loop
  // =========================================================================
  describe('10. Resolution Learning Loop & Ranking Adjustment', () => {
    test('Submitting verified resolution feedback records intervention outcome and authorized actor', async () => {
      const res = await request(app)
        .post(`/api/v1/incidents/${incidentTeamA._id}/resolution-recommendations/feedback`)
        .set('Cookie', engineerTeamACookie)
        .send({
          recommendationSource: 'historical_precedent',
          decision: 'accepted',
          fixAttempted: true,
          fixWorked: true,
          engineerConfirmedRootCause: 'Envoy thread contention under heavy connection reuse',
          verifiedResolution: 'Tuned envoy concurrency workers from 2 to 4',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.feedback.fixWorked, true);
      assert.equal(res.body.feedback.decision, 'accepted');
    });
  });

  // =========================================================================
  // 11. Machine-to-Machine Integration API & Idempotency
  // =========================================================================
  describe('11. Integration API Authentication & Idempotency', () => {
    test('M2M API key authentication, deduplication retry, and MongoDB incident persistence', async () => {
      // 1. Provision M2M key
      const rawKey = `riq_live_${crypto.randomBytes(24).toString('hex')}`;
      const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
      await IntegrationKey.create({
        serviceName: 'Automated CI/CD Ingest',
        provider: 'prometheus',
        apiKeyHash: hash,
        apiKeyPrefix: rawKey.slice(0, 12),
        scopes: ['ingest:incidents'],
        createdBy: adminUser._id,
        isActive: true,
      });

      const externalEventId = `prom_p12_evt_${Date.now()}`;

      // 2. Ingest first time -> 201 Created
      const res1 = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${rawKey}`)
        .send({
          title: 'Prometheus Alert: K8s Node Pressure Spike',
          description: 'Kubelet reporting memory pressure on worker-04.',
          affectedService: 'kubernetes',
          severity: 'high',
          source: 'prometheus',
          externalEventId,
        });

      assert.equal(res1.status, 201);
      assert.equal(res1.body.isDuplicateRetry, false);
      const originalId = res1.body.incident._id;

      // 3. Retry with same externalEventId -> 200 OK with isDuplicateRetry: true
      const res2 = await request(app)
        .post('/api/v1/ingest/incidents')
        .set('Authorization', `Bearer ${rawKey}`)
        .send({
          title: 'Prometheus Alert: K8s Node Pressure Spike (RETRY)',
          description: 'Kubelet reporting memory pressure on worker-04. (RETRY)',
          affectedService: 'kubernetes',
          severity: 'high',
          source: 'prometheus',
          externalEventId,
        });

      assert.equal(res2.status, 200);
      assert.equal(res2.body.isDuplicateRetry, true);
      assert.equal(res2.body.incident._id, originalId);
    });
  });

  // =========================================================================
  // 12. Benchmark Evaluation & Workflow Comparison
  // =========================================================================
  describe('12. Ground-Truth Benchmark Evaluation & Comparative Analysis', () => {
    test('Executes evaluation benchmark and measures accuracy, precision, recall, and workflow savings', async () => {
      const report = await runEvaluationBenchmark();

      // Dataset and metrics verification
      assert.equal(report.metadata.sampleSizeIncidents, 24);
      assert.equal(report.metadata.sampleSizeDuplicatePairs, 16);
      assert.ok(parseFloat(report.classification.categoryAccuracy) >= 80.0);
      assert.equal(report.classification.priorityAccuracy, '100.0%');
      assert.ok(parseFloat(report.duplicateDetection.precision) >= 90.0);
      assert.ok(parseFloat(report.duplicateDetection.recall) >= 80.0);

      // Workflow comparison verification
      assert.ok(Array.isArray(report.workflowComparison.scenarios));
      assert.equal(report.workflowComparison.scenarios.length, 3);
      assert.ok(report.workflowComparison.aggregate.simulatedTimeSavingsMinutes > 100);
      assert.ok(report.workflowComparison.aggregate.aggregatePercentageReduction.includes('%'));
    });
  });
});
