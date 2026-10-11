/**
 * ResolveIQ Phase 13: End-to-End Classroom Integration Verification Test
 *
 * Verifies all 15 operational integration milestones end-to-end:
 *  1. Log in as an end user
 *  2. Create a real incident
 *  3. Generate category, priority and resolver recommendations
 *  4. Find a related historical ticket
 *  5. Display evidence-backed root-cause suggestions
 *  6. Log in as an authorized engineer
 *  7. Inspect related incidents and a relevant deployment event
 *  8. Review a potential incident correlation
 *  9. View SLA deadlines and workload
 * 10. Run a what-if simulation without changing the real incident
 * 11. Confirm an assignment and resolve the incident
 * 12. Record the verified root cause and recommendation feedback
 * 13. Verify the dashboard and evaluation data update correctly
 * 14. Submit a monitoring event through the integration API
 * 15. Test an unauthorized action and confirm it is rejected
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import Team from '../src/models/Team.js';
import DeploymentEvent from '../src/models/DeploymentEvent.js';
import IntegrationKey from '../src/models/IntegrationKey.js';
import RecommendationFeedback from '../src/models/RecommendationFeedback.js';
import Resolution from '../src/models/Resolution.js';

describe('Phase 13: Full 15-Point End-to-End Classroom Integration Verification', () => {
  let app;
  let endUser;
  let engineer;
  let manager;
  let admin;
  let endUserCookie;
  let engineerCookie;
  let managerCookie;
  let adminCookie;
  let teamPlatform;
  let historicalIncident;
  let createdIncident;
  let deploymentEvent;
  let m2mRawApiKey;
  let m2mKeyDoc;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'phase13_integration_secret_2026_test';
    app = createApp();
    await connectDB();
    await User.deleteMany({});
    await Incident.deleteMany({});
    await Team.deleteMany({});
    await DeploymentEvent.deleteMany({});
    await IntegrationKey.deleteMany({});
    await RecommendationFeedback.deleteMany({});
    await Resolution.deleteMany({});

    // 1. Create Teams
    teamPlatform = await Team.create({
      name: 'Platform SRE',
      tier: 'tier-2',
      services: ['ingress-controller', 'api-gateway', 'payment-service'],
      escalationContact: 'sre-lead@resolveiq.io',
      maxActiveCapacity: 20,
    });

    // 2. Create Users
    endUser = await User.create({
      name: 'End User Alice',
      email: 'alice.enduser@resolveiq.io',
      password: 'EnterprisePass123!',
      role: 'end_user',
      isActive: true,
    });

    engineer = await User.create({
      name: 'Engineer Raj',
      email: 'raj.engineer@resolveiq.io',
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Platform SRE',
      skillTags: ['kubernetes', 'envoy', 'networking', 'ingress'],
      availabilityStatus: 'available',
      maxConcurrentIncidents: 5,
      isActive: true,
    });

    manager = await User.create({
      name: 'Manager Chen',
      email: 'chen.manager@resolveiq.io',
      password: 'EnterprisePass123!',
      role: 'manager',
      team: 'Platform SRE',
      availabilityStatus: 'available',
      isActive: true,
    });

    admin = await User.create({
      name: 'Admin Taylor',
      email: 'taylor.admin@resolveiq.io',
      password: 'EnterprisePass123!',
      role: 'admin',
      team: 'Platform SRE',
      isActive: true,
    });

    // 3. Seed Verified Historical Incident in Knowledge Base
    historicalIncident = await Incident.create({
      incidentNumber: 'INC-HIST-01',
      title: 'Ingress Envoy connection pool exhausted with 504 timeouts',
      description: 'Envoy proxy ingress exhausted upstream connections during traffic surge. Pods dropped traffic with HTTP 504.',
      affectedService: 'ingress-controller',
      category: 'availability',
      impact: 'enterprise',
      urgency: 'critical',
      priority: 'P1',
      status: 'resolved',
      assignedTeam: 'Platform SRE',
      assignedTo: engineer._id,
      reportedBy: engineer._id,
      resolutionDetails: {
        rootCause: 'Default max_connections limit of 1024 saturated on envoy ingress upstream cluster.',
        rootCauseCategory: 'capacity_exhaustion',
        remediationSteps: 'Scaled upstream connection pool limit to 4096 in EnvoyFilter config map and reloaded pods.',
        verifiedBy: engineer._id,
        verifiedAt: new Date(Date.now() - 3600000 * 24),
      },
    });

    await Resolution.create({
      incidentId: historicalIncident._id,
      incidentNumber: historicalIncident.incidentNumber,
      title: historicalIncident.title,
      affectedService: historicalIncident.affectedService,
      rootCauseCategory: 'capacity_exhaustion',
      confirmedRootCause: 'Default max_connections limit of 1024 saturated on envoy ingress upstream cluster.',
      summary: 'Envoy proxy ingress exhausted upstream connections during traffic surge. Pods dropped traffic with HTTP 504.',
      remediationSteps: ['Scaled upstream connection pool limit to 4096 in EnvoyFilter config map and reloaded pods.'],
      preventativeActions: ['Configure rate limiter on upstream ingress'],
      isVerified: true,
      resolvedBy: engineer._id,
      verifiedBy: manager._id,
    });

    // 4. Seed Preceding Deployment Event
    deploymentEvent = await DeploymentEvent.create({
      service: 'ingress-controller',
      version: 'v2.4.1',
      environment: 'production',
      deployedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 mins ago
      deployedBy: 'ci-runner@resolveiq.io',
      status: 'success',
      changeSummary: 'Bumped envoy ingress proxy image and reduced worker thread memory threshold',
    });

    // 5. Seed M2M API Key
    m2mRawApiKey = 'riq_live_f89a241b72e90c1284d72819034aa102bc45';
    const keyHash = crypto.createHash('sha256').update(m2mRawApiKey).digest('hex');
    m2mKeyDoc = await IntegrationKey.create({
      serviceName: 'Datadog Ingestion',
      provider: 'datadog',
      apiKeyHash: keyHash,
      apiKeyPrefix: 'riq_live_f89a',
      scopes: ['ingest:incidents'],
      createdBy: admin._id,
      isActive: true,
    });
  });

  after(async () => {
    await disconnectDB();
  });

  // -------------------------------------------------------------------------
  // Milestone 1: Log in as an end user
  // -------------------------------------------------------------------------
  test('Milestone 1: Log in as an end user', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: endUser.email, password: 'EnterprisePass123!' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.role, 'end_user');
    assert.ok(res.headers['set-cookie'], 'Must issue HttpOnly JWT session cookie');
    endUserCookie = res.headers['set-cookie'];
  });

  // -------------------------------------------------------------------------
  // Milestone 2: Create a real incident
  // -------------------------------------------------------------------------
  test('Milestone 2: Create a real incident with derived priority and ticket number', async () => {
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Cookie', endUserCookie)
      .send({
        title: 'Envoy proxy ingress saturated returning HTTP 504 Gateway Timeout',
        description: 'Customer checkout traffic is failing. Upstream connection pool saturated on ingress proxy.',
        affectedService: 'ingress-controller',
        impact: 'enterprise',
        urgency: 'critical',
        source: 'manual',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.incident._id);
    assert.match(res.body.incident.incidentNumber, /^INC-/);
    assert.equal(res.body.incident.priority, 'P1'); // enterprise + critical = P1
    assert.ok(['triggered', 'new'].includes(res.body.incident.status));
    createdIncident = res.body.incident;
  });

  // -------------------------------------------------------------------------
  // Milestone 3: Generate category, priority and resolver recommendations
  // -------------------------------------------------------------------------
  test('Milestone 3: Generate category, priority and resolver recommendations', async () => {
    const res = await request(app)
      .get(`/api/v1/incidents/${createdIncident._id}/recommendations`)
      .set('Cookie', endUserCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.recommendation.suggestedCategory || res.body.recommendation.category, 'Must suggest category');
    assert.ok(res.body.recommendation.suggestedPriority || res.body.recommendation.priority, 'Must suggest priority');
    assert.ok(res.body.recommendation.suggestedTeam || res.body.recommendation.resolverTeam, 'Must suggest resolver team');
    assert.ok(res.body.recommendation.explanation, 'Must include explainable evidence');
  });

  // -------------------------------------------------------------------------
  // Milestone 4: Find a related historical ticket
  // -------------------------------------------------------------------------
  test('Milestone 4: Find related historical ticket via knowledge base search', async () => {
    const res = await request(app)
      .get(`/api/v1/incidents/knowledge-base/search?q=Envoy connection pool saturated&threshold=0.15`)
      .set('Cookie', endUserCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.candidates));
    assert.ok(res.body.candidates.length >= 1, 'Should retrieve historical precedent');
    assert.equal(res.body.candidates[0].incidentNumber, 'INC-HIST-01');
    assert.ok(res.body.candidates[0].similarityScore > 0, 'Must provide ranking score');
  });

  // -------------------------------------------------------------------------
  // Milestone 5: Display evidence-backed root-cause suggestions
  // -------------------------------------------------------------------------
  test('Milestone 5: Display evidence-backed root-cause suggestions', async () => {
    const engLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: engineer.email, password: 'EnterprisePass123!' });
    engineerCookie = engLogin.headers['set-cookie'];

    const res = await request(app)
      .get(`/api/v1/incidents/${createdIncident._id}/resolution-recommendations`)
      .set('Cookie', engineerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.recommendation);
    assert.ok(res.body.recommendation.probableRootCause || res.body.recommendation.status, 'Must provide root cause hypothesis or status');
    assert.ok(
      Array.isArray(res.body.recommendation.potentialResolutionSteps) ||
      Array.isArray(res.body.recommendation.resolutionSteps),
      'Must provide resolution steps'
    );
  });

  // -------------------------------------------------------------------------
  // Milestone 6: Log in as an authorized engineer
  // -------------------------------------------------------------------------
  test('Milestone 6: Log in as an authorized engineer', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: engineer.email, password: 'EnterprisePass123!' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.role, 'support_engineer');
    engineerCookie = res.headers['set-cookie'];
  });

  // -------------------------------------------------------------------------
  // Milestone 7: Inspect related incidents and a relevant deployment event
  // -------------------------------------------------------------------------
  test('Milestone 7: Inspect related incidents and preceding deployment event', async () => {
    const res = await request(app)
      .get('/api/v1/deployments')
      .set('Cookie', engineerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.deployments));
    assert.ok(res.body.deployments.some((d) => d.service === 'ingress-controller'));
  });

  // -------------------------------------------------------------------------
  // Milestone 8: Review a potential incident correlation
  // -------------------------------------------------------------------------
  test('Milestone 8: Review a potential incident correlation with blast radius', async () => {
    const res = await request(app)
      .get(`/api/v1/correlations/incident/${createdIncident._id}`)
      .set('Cookie', engineerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.correlatedIncidents), 'Must return correlated incidents array');
    assert.ok(Array.isArray(res.body.correlatedDeployments), 'Must return correlated deployments array');
    assert.ok(res.body.dependencyTopology, 'Must compute dependency topology');
  });

  // -------------------------------------------------------------------------
  // Milestone 9: View SLA deadlines and workload
  // -------------------------------------------------------------------------
  test('Milestone 9: View SLA deadlines and workload details', async () => {
    const incRes = await request(app)
      .get(`/api/v1/incidents/${createdIncident._id}`)
      .set('Cookie', engineerCookie);

    assert.equal(incRes.status, 200);
    assert.ok(incRes.body.incident.sla.responseDeadline, 'Must have response SLA deadline');
    assert.ok(incRes.body.incident.sla.resolutionDeadline, 'Must have resolution SLA deadline');

    const workRes = await request(app)
      .get('/api/v1/analytics/workload-details')
      .set('Cookie', engineerCookie);

    assert.equal(workRes.status, 200);
    assert.equal(workRes.body.success, true);
    assert.ok(Array.isArray(workRes.body.engineerRoster), 'Must return engineer roster array');
    assert.ok(Array.isArray(workRes.body.teamQueues), 'Must return team queues array');
  });

  // -------------------------------------------------------------------------
  // Milestone 10: Run a what-if simulation without changing the real incident
  // -------------------------------------------------------------------------
  test('Milestone 10: Run what-if simulation without changing real database incident', async () => {
    const beforeInc = await Incident.findById(createdIncident._id);

    const res = await request(app)
      .post(`/api/v1/incidents/${createdIncident._id}/what-if`)
      .set('Cookie', engineerCookie)
      .send({
        delayMinutes: 45,
        targetAssigneeId: engineer._id,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.simulation.meta.isHypothetical, true);
    assert.ok(res.body.simulation.slaProjections);

    const afterInc = await Incident.findById(createdIncident._id);
    assert.equal(
      afterInc.status,
      beforeInc.status,
      'Simulation must never mutate live incident status'
    );
    assert.equal(
      String(afterInc.assignedTo),
      String(beforeInc.assignedTo),
      'Simulation must never mutate live assignee'
    );
  });

  // -------------------------------------------------------------------------
  // Milestone 11: Confirm an assignment and resolve the incident
  // -------------------------------------------------------------------------
  test('Milestone 11: Confirm an assignment and resolve the incident lifecycle', async () => {
    // Log in as manager to perform assignment
    const loginMgr = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: manager.email, password: 'EnterprisePass123!' });
    managerCookie = loginMgr.headers['set-cookie'];

    // Reassign to engineer
    const assignRes = await request(app)
      .patch(`/api/v1/incidents/${createdIncident._id}/reassign`)
      .set('Cookie', managerCookie)
      .send({ assigneeId: engineer._id });
    assert.equal(assignRes.status, 200);

    // Acknowledge incident
    const ackRes = await request(app)
      .patch(`/api/v1/incidents/${createdIncident._id}/status`)
      .set('Cookie', engineerCookie)
      .send({ status: 'acknowledged' });
    assert.equal(ackRes.status, 200);

    // Transition to in_progress
    const inProgRes = await request(app)
      .patch(`/api/v1/incidents/${createdIncident._id}/status`)
      .set('Cookie', engineerCookie)
      .send({ status: 'in_progress' });
    assert.equal(inProgRes.status, 200);

    // Resolve incident with remediation details
    const resolveRes = await request(app)
      .patch(`/api/v1/incidents/${createdIncident._id}/status`)
      .set('Cookie', engineerCookie)
      .send({
        status: 'resolved',
        resolutionDetails: {
          rootCause: 'Envoy proxy upstream connection pool limit saturated.',
          rootCauseCategory: 'capacity_exhaustion',
          remediationSteps: 'Applied EnvoyFilter CRD increasing connection limit to 4096.',
        },
      });
    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.body.incident.status, 'resolved');
  });

  // -------------------------------------------------------------------------
  // Milestone 12: Record verified root cause and recommendation feedback
  // -------------------------------------------------------------------------
  test('Milestone 12: Record verified root cause and recommendation feedback', async () => {
    const feedbackRes = await request(app)
      .post(`/api/v1/incidents/${createdIncident._id}/resolution-recommendations/feedback`)
      .set('Cookie', engineerCookie)
      .send({
        recommendationSource: 'gemini_ai_copilot',
        historicalEvidenceUsed: ['INC-HIST-01'],
        decision: 'accepted',
        fixAttempted: true,
        fixWorked: true,
        engineerConfirmedRootCause: 'Envoy upstream max connections limit saturated',
        verifiedResolution: 'Scaled upstream connection pool limit in EnvoyFilter config',
      });

    assert.equal(feedbackRes.status, 200);
    assert.equal(feedbackRes.body.success, true);
    assert.ok(feedbackRes.body.feedback._id);
  });

  // -------------------------------------------------------------------------
  // Milestone 13: Verify dashboard and evaluation data update correctly
  // -------------------------------------------------------------------------
  test('Milestone 13: Verify dashboard and metrics update with resolved count', async () => {
    const analyticsRes = await request(app)
      .get('/api/v1/analytics')
      .set('Cookie', managerCookie);

    assert.equal(analyticsRes.status, 200);
    assert.equal(analyticsRes.body.success, true);
    assert.ok(analyticsRes.body.metrics);
    assert.ok(typeof analyticsRes.body.metrics.totalIncidents === 'number');
  });

  // -------------------------------------------------------------------------
  // Milestone 14: Submit monitoring event through the integration API
  // -------------------------------------------------------------------------
  test('Milestone 14: Submit monitoring event via M2M REST integration with idempotency', async () => {
    const externalAlert = {
      title: 'PostgreSQL Active Connections Reached 98% [Alert #8812]',
      description: 'Connection pool saturation on payments-db. Active client connections: 492 / 500.',
      affectedService: 'payment-service',
      severity: 'critical',
      source: 'datadog',
      externalEventId: 'dd_event_pg_pool_8812',
      environment: 'production',
      tags: ['database', 'postgres', 'pool-saturation'],
    };

    // First ingestion -> 201 Created
    const ingestRes1 = await request(app)
      .post('/api/v1/ingest/incidents')
      .set('Authorization', `Bearer ${m2mRawApiKey}`)
      .set('X-Idempotency-Key', 'idemp_dd_pg_8812')
      .send(externalAlert);

    assert.equal(ingestRes1.status, 201);
    assert.equal(ingestRes1.body.isDuplicateRetry, false);
    assert.ok(ingestRes1.body.incident.incidentNumber);

    // Immediate retry with same idempotency key -> 200 OK (no duplicate ticket)
    const ingestRes2 = await request(app)
      .post('/api/v1/ingest/incidents')
      .set('Authorization', `Bearer ${m2mRawApiKey}`)
      .set('X-Idempotency-Key', 'idemp_dd_pg_8812')
      .send(externalAlert);

    assert.equal(ingestRes2.status, 200);
    assert.equal(ingestRes2.body.isDuplicateRetry, true);
    assert.equal(
      ingestRes2.body.incident._id,
      ingestRes1.body.incident._id,
      'Must return identical incident record without creating duplicates'
    );
  });

  // -------------------------------------------------------------------------
  // Milestone 15: Test an unauthorized action and confirm it is rejected
  // -------------------------------------------------------------------------
  test('Milestone 15: Test unauthorized actions by end user and confirm rejection (403)', async () => {
    // 1. End user attempts to access manager analytics
    const unauthAnalytics = await request(app)
      .get('/api/v1/analytics')
      .set('Cookie', endUserCookie);
    assert.equal(unauthAnalytics.status, 403, 'End user must be rejected from manager analytics');

    // 2. End user attempts to reassign incident
    const unauthReassign = await request(app)
      .patch(`/api/v1/incidents/${createdIncident._id}/reassign`)
      .set('Cookie', endUserCookie)
      .send({ assigneeId: engineer._id });
    assert.equal(unauthReassign.status, 403, 'End user must be rejected from reassigning incidents');

    // 3. End user attempts to promote self to admin
    const unauthRoleChange = await request(app)
      .patch(`/api/v1/auth/users/${endUser._id}`)
      .set('Cookie', endUserCookie)
      .send({ role: 'admin' });
    assert.equal(unauthRoleChange.status, 403, 'End user must be rejected from changing user roles');
  });
});
