import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import DeploymentEvent from '../src/models/DeploymentEvent.js';
import CorrelationDecision from '../src/models/CorrelationDecision.js';
import AuditLog from '../src/models/AuditLog.js';
import Team from '../src/models/Team.js';
import {
  scoreIncidentToIncident,
  scoreDeploymentToIncident,
  checkServiceDependency,
  extractErrorPatterns,
  getCorrelationGraphData,
} from '../src/services/correlationService.js';

describe('ResolveIQ Phase 8: Incident Correlation Graph & Deployment-to-Incident Correlation', () => {
  let app;
  let managerUser, engineerUser, clientUser;
  let managerCookie, engineerCookie, clientCookie;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'phase8_correlation_jwt_secret_test';
    await connectDB();
    app = createApp();

    // Ensure test teams
    await Team.findOneAndUpdate(
      { name: 'Platform SRE' },
      { $set: { name: 'Platform SRE', tier: 'Tier-1', services: ['order-processing', 'payments-service'] } },
      { upsert: true, new: true }
    );

    // Provision test users
    managerUser = await User.create({
      name: 'Incident Commander Nora',
      email: `commander_nora_${Date.now()}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'manager',
      team: 'Platform SRE',
      isActive: true,
    });

    engineerUser = await User.create({
      name: 'Senior SRE Evan',
      email: `sre_evan_${Date.now()}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Platform SRE',
      isActive: true,
    });

    clientUser = await User.create({
      name: 'End User Charlie',
      email: `charlie_${Date.now()}@consumer.io`,
      password: 'EnterprisePass123!',
      role: 'end_user',
      team: 'Platform SRE',
      isActive: true,
    });

    // Obtain HttpOnly session cookies
    const loginAndGetCookie = async (user) => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: user.email,
        password: 'EnterprisePass123!',
      });
      assert.equal(res.status, 200);
      const cookies = res.headers['set-cookie'];
      return Array.isArray(cookies) ? cookies[0] : cookies || '';
    };

    managerCookie = await loginAndGetCookie(managerUser);
    engineerCookie = await loginAndGetCookie(engineerUser);
    clientCookie = await loginAndGetCookie(clientUser);
  });

  after(async () => {
    await disconnectDB();
  });

  describe('1. Deployment Event Management & Role Access Control', () => {
    let createdDeploymentId;

    test('Authorized engineer can record deployment event via POST /api/v1/deployments', async () => {
      const res = await request(app)
        .post('/api/v1/deployments')
        .set('Cookie', engineerCookie)
        .send({
          service: 'payments-service',
          version: 'v2.4.0-stripe-upgrade',
          environment: 'production',
          status: 'success',
          changeSummary: 'Upgraded Stripe SDK and connection pool timeout settings',
          changeReference: 'PR-1042',
          commitHash: '8b7f3a1',
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.deployment.service, 'payments-service');
      assert.equal(res.body.deployment.version, 'v2.4.0-stripe-upgrade');
      assert.equal(res.body.deployment.status, 'success');
      createdDeploymentId = res.body.deployment._id;

      // Verify AuditLog recorded DEPLOYMENT_RECORDED
      const audit = await AuditLog.findOne({
        incidentId: createdDeploymentId,
        action: 'DEPLOYMENT_RECORDED',
      });
      assert.ok(audit, 'AuditLog must record deployment event');
    });

    test('Unauthorized end_user is rejected with 403 on POST /api/v1/deployments', async () => {
      const res = await request(app)
        .post('/api/v1/deployments')
        .set('Cookie', clientCookie)
        .send({
          service: 'ingress-gateway',
          version: 'v1.0.0',
          changeSummary: 'Unauthorized deployment declaration attempt',
        });

      assert.equal(res.status, 403);
    });

    test('Validates mandatory fields on deployment creation', async () => {
      const res = await request(app)
        .post('/api/v1/deployments')
        .set('Cookie', engineerCookie)
        .send({
          service: '', // Missing
          version: 'v1.0.0',
        });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /service, version, and changeSummary are required/);
    });

    test('Queries deployment history with filtering by service and status', async () => {
      const res = await request(app)
        .get('/api/v1/deployments?service=payments-service&status=success')
        .set('Cookie', engineerCookie);

      assert.equal(res.status, 200);
      assert.ok(res.body.total >= 1);
      assert.equal(res.body.deployments[0].service, 'payments-service');
    });

    test('Updates deployment event status via PATCH /api/v1/deployments/:id', async () => {
      const res = await request(app)
        .patch(`/api/v1/deployments/${createdDeploymentId}`)
        .set('Cookie', managerCookie)
        .send({
          status: 'failed',
          changeSummary: 'Hotfix failed connection pool healthcheck in production',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.deployment.status, 'failed');
    });
  });

  describe('2. Deterministic Incident & Deployment Correlation Algorithm', () => {
    test('Verifies explicit service dependency topology mapping', () => {
      // order-processing directly depends on payments-service
      const directDep = checkServiceDependency('order-processing', 'payments-service');
      assert.equal(directDep.isDependent, true);
      assert.equal(directDep.direction, 'downstream');

      // ingress-gateway transitively depends on database-cluster via order-processing / payments-service
      const transDep = checkServiceDependency('ingress-gateway', 'database-cluster');
      assert.equal(transDep.isDependent, true);

      // monitoring has zero dependencies on payments-service
      const noDep = checkServiceDependency('monitoring', 'payments-service');
      assert.equal(noDep.isDependent, false);
    });

    test('Extracts known error patterns and symptom signatures from incident text', () => {
      const text = 'Upstream 504 Gateway Timeout: connection pool exhausted during high latency spike';
      const patterns = extractErrorPatterns(text);

      assert.ok(patterns.includes('504'));
      assert.ok(patterns.includes('timeout'));
      assert.ok(patterns.includes('connection pool'));
      assert.ok(patterns.includes('high latency'));
    });

    test('Correlates preceding deployment with incident affecting the same service within change window', () => {
      const baseTime = new Date('2026-10-10T12:00:00.000Z');
      const deployment = {
        _id: 'dep-101',
        service: 'payments-service',
        version: 'v2.4.0',
        environment: 'production',
        deployedAt: baseTime,
        status: 'failed',
        changeSummary: 'Upgraded Stripe SDK and connection pool timeout settings',
      };

      const incident = {
        _id: 'inc-101',
        incidentNumber: 'INC-801',
        affectedService: 'payments-service',
        title: 'Payments Service Connection Pool 504 Timeout',
        description: 'Client requests failing with connection pool timeout',
        createdAt: new Date(baseTime.getTime() + 15 * 60000), // 15 mins later
      };

      const correlation = scoreDeploymentToIncident(deployment, incident);

      assert.ok(correlation);
      assert.ok(correlation.confidenceScore >= 0.70, 'Must have high confidence score');
      assert.equal(correlation.confidenceTier, 'HIGH');
      assert.equal(correlation.isCausalProof, false, 'Must flag as unverified hypothesis, not proof');
      assert.ok(correlation.contributingFactors.some((f) => f.factor === 'DIRECT_SERVICE_DEPLOYMENT'));
      assert.ok(correlation.contributingFactors.some((f) => f.factor === 'IMMEDIATE_PRECEDING_WINDOW'));
      assert.ok(correlation.contributingFactors.some((f) => f.factor === 'DEPLOYMENT_ANOMALY'));
    });

    test('Correlates dependent service incidents sharing cascading error symptoms and time overlap', () => {
      const baseTime = new Date('2026-10-10T12:15:00.000Z');

      const incA = {
        _id: 'inc-101',
        incidentNumber: 'INC-801',
        affectedService: 'payments-service',
        title: 'Payments Service 504 Gateway Timeout',
        description: 'Connection pool timeout to payment gateway',
        createdAt: baseTime,
      };

      const incB = {
        _id: 'inc-102',
        incidentNumber: 'INC-802',
        affectedService: 'order-processing', // Depends on payments-service!
        title: 'Checkout Failure: 504 Gateway Timeout from Payment Upstream',
        description: 'Checkout workflow failing with 504 timeout from payment worker',
        createdAt: new Date(baseTime.getTime() + 7 * 60000), // 7 mins later
      };

      const correlation = scoreIncidentToIncident(incA, incB);

      assert.ok(correlation);
      assert.ok(correlation.confidenceScore >= 0.50);
      assert.equal(correlation.isCausalProof, false);
      assert.ok(correlation.contributingFactors.some((f) => f.factor === 'SERVICE_DEPENDENCY'));
      assert.ok(correlation.contributingFactors.some((f) => f.factor === 'SIMILAR_ERROR_PATTERNS'));
      assert.ok(correlation.contributingFactors.some((f) => f.factor === 'TEMPORAL_PROXIMITY'));
    });

    test('Causation Integrity: Timestamp proximity alone does NOT yield high confidence or false causality', () => {
      const baseTime = new Date('2026-10-10T12:15:00.000Z');

      const incA = {
        _id: 'inc-101',
        incidentNumber: 'INC-801',
        affectedService: 'payments-service',
        title: 'Payments Service 504 Gateway Timeout',
        description: 'Connection pool timeout to payment gateway',
        createdAt: baseTime,
      };

      // Unrelated incident declared only 3 minutes later on unrelated service with different symptoms
      const incUnrelated = {
        _id: 'inc-103',
        incidentNumber: 'INC-803',
        affectedService: 'monitoring',
        title: 'Grafana Agent Disk Space Alert',
        description: 'Persistent volume disk usage exceeded 90% threshold',
        createdAt: new Date(baseTime.getTime() + 3 * 60000), // Close in time!
      };

      const correlation = scoreIncidentToIncident(incA, incUnrelated);

      // Only temporal proximity matches (+0.15), total score is low and cannot prove causation
      assert.ok(correlation);
      assert.ok(correlation.confidenceScore <= 0.20, 'Score must remain low (≤0.20)');
      assert.equal(correlation.confidenceTier, 'LOW');
      assert.equal(correlation.isCausalProof, false, 'Must never claim causal proof from proximity');
      assert.equal(correlation.status, 'unverified');

      // Deployment on payments-service must NOT correlate with unrelated monitoring incident
      const deployment = {
        _id: 'dep-101',
        service: 'payments-service',
        deployedAt: new Date(baseTime.getTime() - 15 * 60000),
        status: 'failed',
        changeSummary: 'Stripe upgrade',
      };

      const depCorr = scoreDeploymentToIncident(deployment, incUnrelated);
      assert.equal(depCorr, null, 'Unrelated service deployment must yield null correlation');
    });
  });

  describe('3. Investigation Workflow, Human Confirmation & Verified Root Cause', () => {
    let incidentA, incidentB, deploymentEvent;

    before(async () => {
      await Incident.deleteMany({});
      await DeploymentEvent.deleteMany({});
      await CorrelationDecision.deleteMany({});
      await AuditLog.deleteMany({});

      const baseTime = new Date();

      deploymentEvent = await DeploymentEvent.create({
        service: 'payments-service',
        serviceName: 'payments-service',
        version: 'v2.4.0',
        environment: 'production',
        status: 'failed',
        changeSummary: 'Reduced DB pool max connections to 5',
        changeReference: 'PR-901',
        deployedAt: new Date(baseTime.getTime() - 30 * 60000),
      });

      incidentA = await Incident.create({
        incidentNumber: 'INC-801',
        title: 'Payments Service Connection Pool 504 Timeout',
        description: 'Worker threads blocked waiting for database connection pool slot',
        affectedService: 'payments-service',
        impact: 'enterprise',
        urgency: 'critical',
        category: 'latency',
        priority: 'P1',
        status: 'investigating',
        assignedTeam: 'Platform SRE',
        reporter: managerUser._id,
        createdAt: new Date(baseTime.getTime() - 15 * 60000),
      });

      incidentB = await Incident.create({
        incidentNumber: 'INC-802',
        title: 'Checkout Failure: 504 Upstream Gateway Timeout',
        description: 'Checkout workflow failing due to payments-service latency',
        affectedService: 'order-processing',
        impact: 'enterprise',
        urgency: 'critical',
        category: 'availability',
        priority: 'P1',
        status: 'triggered',
        assignedTeam: 'Platform SRE',
        reporter: managerUser._id,
        createdAt: new Date(baseTime.getTime() - 10 * 60000),
      });
    });

    test('GET /api/v1/correlations/incident/:id returns candidate correlations and blast radius', async () => {
      const res = await request(app)
        .get(`/api/v1/correlations/incident/${incidentA._id}`)
        .set('Cookie', engineerCookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      // Must find candidate incident INC-802
      const matchedInc = res.body.correlatedIncidents.find((c) => c.targetTicket === 'INC-802');
      assert.ok(matchedInc);
      assert.ok(matchedInc.confidenceScore >= 0.45);

      // Must find candidate deployment v2.4.0
      const matchedDep = res.body.correlatedDeployments.find((d) => d.version === 'v2.4.0');
      assert.ok(matchedDep);
      assert.ok(matchedDep.confidenceScore >= 0.60);
    });

    test('Authorized engineer records confirmed correlation decision via POST /api/v1/correlations/decision', async () => {
      const res = await request(app)
        .post('/api/v1/correlations/decision')
        .set('Cookie', engineerCookie)
        .send({
          sourceIncidentId: incidentA._id,
          targetIncidentId: incidentB._id,
          decision: 'confirmed',
          rationale: 'Confirmed downstream cascade from payments-service to checkout order-processing',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.decision.decision, 'confirmed');

      // Verify tickets are linked in MongoDB
      const updatedA = await Incident.findById(incidentA._id);
      const updatedB = await Incident.findById(incidentB._id);
      assert.ok(updatedA.relatedIncidents.some((id) => id.toString() === incidentB._id.toString()));
      assert.ok(updatedB.relatedIncidents.some((id) => id.toString() === incidentA._id.toString()));

      // Verify AuditLog
      const audit = await AuditLog.findOne({
        incidentId: incidentA._id,
        action: 'CORRELATION_CONFIRMED',
      });
      assert.ok(audit, 'AuditLog must record CORRELATION_CONFIRMED');
    });

    test('Authorized engineer records deployment as verified root cause', async () => {
      const res = await request(app)
        .post('/api/v1/correlations/decision')
        .set('Cookie', managerCookie)
        .send({
          sourceIncidentId: incidentA._id,
          deploymentId: deploymentEvent._id,
          decision: 'confirmed',
          isRootCause: true,
          verifiedRootCause: 'v2.4.0 configuration drift restricted connection pool max limit to 5 instead of 50',
          rationale: 'Rollback of v2.4.0 immediately restored payment processing throughput',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.decision.isRootCause, true);
      assert.equal(res.body.decision.verifiedRootCause, 'v2.4.0 configuration drift restricted connection pool max limit to 5 instead of 50');

      // Verify AuditLog captures ROOT_CAUSE_ESTABLISHED
      const audit = await AuditLog.findOne({
        incidentId: incidentA._id,
        action: 'ROOT_CAUSE_ESTABLISHED',
      });
      assert.ok(audit, 'AuditLog must record ROOT_CAUSE_ESTABLISHED');
    });

    test('Unauthorized end_user is rejected on POST /api/v1/correlations/decision', async () => {
      const res = await request(app)
        .post('/api/v1/correlations/decision')
        .set('Cookie', clientCookie)
        .send({
          sourceIncidentId: incidentA._id,
          decision: 'confirmed',
        });

      assert.equal(res.status, 403);
    });
  });

  describe('4. Correlation Graph Topology & Cluster Aggregation', () => {
    test('GET /api/v1/correlations/graph returns nodes, edges, suspected clusters, and verified status', async () => {
      const res = await request(app)
        .get('/api/v1/correlations/graph?windowHours=24')
        .set('Cookie', engineerCookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      const graph = res.body.graph;
      assert.ok(graph.nodes.length >= 4, 'Must include incidents, services, deployments');
      assert.ok(graph.edges.length >= 2, 'Must include relationship edges');

      // Verify incident-to-incident edge reflects confirmed status
      const confirmedEdge = graph.edges.find((e) => e.relationshipType === 'confirmed_relationship');
      assert.ok(confirmedEdge, 'Must reflect confirmed relationship in graph edges');

      // Verify deployment edge reflects verified root cause
      const rootCauseEdge = graph.edges.find((e) => e.relationshipType === 'verified_root_cause' || e.isRootCause === true);
      assert.ok(rootCauseEdge, 'Must reflect verified root cause edge');

      // Verify detected cluster includes both incidents
      assert.ok(graph.clusters.length >= 1, 'Must detect at least 1 incident cluster');
      const cluster = graph.clusters[0];
      assert.equal(cluster.memberCount, 2);
    });
  });
});
