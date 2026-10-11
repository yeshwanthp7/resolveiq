import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import AuditLog from '../src/models/AuditLog.js';
import Team from '../src/models/Team.js';
import {
  SLA_TARGETS,
  SLA_STATES,
  computeSlaTargets,
  calculateAcknowledgementTimeMinutes,
  calculateResolutionTimeMinutes,
  calculateTimeRemainingMinutes,
  evaluateSlaStatus,
} from '../src/utils/slaEngine.js';

describe('ResolveIQ Phase 7: SLA Monitoring, Engine Boundaries & Operational Analytics', () => {
  let app;
  let managerUser, engineerUser, endUserA, endUserB;
  let managerCookie, engineerCookie, endUserACookie, endUserBCookie;
  let sreTeam, dbOpsTeam;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'phase7_sla_analytics_jwt_secret_test';
    await connectDB();
    app = createApp();

    // Ensure teams exist
    sreTeam = await Team.findOneAndUpdate(
      { name: 'Platform SRE' },
      { $set: { name: 'Platform SRE', tier: 'Tier-2', description: 'Site reliability engineering' } },
      { upsert: true, new: true }
    );
    dbOpsTeam = await Team.findOneAndUpdate(
      { name: 'Database Ops' },
      { $set: { name: 'Database Ops', tier: 'Tier-3', description: 'Database cluster operations' } },
      { upsert: true, new: true }
    );

    // Provision test users
    managerUser = await User.create({
      name: 'Ops Director Helen',
      email: `ops_director_${Date.now()}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'manager',
      team: 'Platform SRE',
      isActive: true,
    });

    engineerUser = await User.create({
      name: 'Resolver Kyle',
      email: `resolver_kyle_${Date.now()}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Platform SRE',
      isActive: true,
    });

    endUserA = await User.create({
      name: 'Customer Alice',
      email: `alice_${Date.now()}@retail.io`,
      password: 'EnterprisePass123!',
      role: 'end_user',
      team: 'Customer Support',
      isActive: true,
    });

    endUserB = await User.create({
      name: 'Customer Bob',
      email: `bob_${Date.now()}@fintech.io`,
      password: 'EnterprisePass123!',
      role: 'end_user',
      team: 'Customer Support',
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
    endUserACookie = await loginAndGetCookie(endUserA);
    endUserBCookie = await loginAndGetCookie(endUserB);
  });

  after(async () => {
    await disconnectDB();
  });

  describe('1. SLA Engine Targets, Deadlines & Calendar Hours Computations', () => {
    test('Configures deterministic targets by priority (P1–P5) under calendar hours standard', () => {
      assert.equal(SLA_TARGETS.P1.responseMinutes, 15);
      assert.equal(SLA_TARGETS.P1.resolutionMinutes, 120);

      assert.equal(SLA_TARGETS.P2.responseMinutes, 30);
      assert.equal(SLA_TARGETS.P2.resolutionMinutes, 240);

      assert.equal(SLA_TARGETS.P3.responseMinutes, 120);
      assert.equal(SLA_TARGETS.P3.resolutionMinutes, 720);

      assert.equal(SLA_TARGETS.P4.responseMinutes, 240);
      assert.equal(SLA_TARGETS.P4.resolutionMinutes, 1440);

      assert.equal(SLA_TARGETS.P5.responseMinutes, 480);
      assert.equal(SLA_TARGETS.P5.resolutionMinutes, 4320);
    });

    test('Calculates response and resolution deadlines from creation timestamp', () => {
      const baseTime = new Date('2026-10-10T12:00:00.000Z');
      const sla = computeSlaTargets('P1', baseTime);

      assert.equal(sla.responseTargetMinutes, 15);
      assert.equal(sla.resolutionTargetMinutes, 120);

      // Calendar hours: 15 minutes = +15*60000ms
      const expectedResponseDeadline = new Date('2026-10-10T12:15:00.000Z');
      const expectedResolutionDeadline = new Date('2026-10-10T14:00:00.000Z');

      assert.equal(sla.responseDeadline.getTime(), expectedResponseDeadline.getTime());
      assert.equal(sla.resolutionDeadline.getTime(), expectedResolutionDeadline.getTime());
    });

    test('Calculates time remaining accurately (positive before deadline, negative after deadline)', () => {
      const deadline = new Date('2026-10-10T14:00:00.000Z');
      const beforeDeadline = new Date('2026-10-10T13:30:00.000Z');
      const afterDeadline = new Date('2026-10-10T14:45:00.000Z');

      const remainingBefore = calculateTimeRemainingMinutes(deadline, beforeDeadline);
      const remainingAfter = calculateTimeRemainingMinutes(deadline, afterDeadline);

      assert.equal(remainingBefore, 30);
      assert.equal(remainingAfter, -45);
    });

    test('Computes acknowledgement time and handles missing or unacknowledged timestamps', () => {
      const incidentAcked = {
        createdAt: new Date('2026-10-10T12:00:00.000Z'),
        acknowledgedAt: new Date('2026-10-10T12:12:00.000Z'),
      };
      const incidentUnacked = {
        createdAt: new Date('2026-10-10T12:00:00.000Z'),
        acknowledgedAt: null,
      };
      const incidentMissingCreated = {
        createdAt: null,
        acknowledgedAt: new Date('2026-10-10T12:12:00.000Z'),
      };

      assert.equal(calculateAcknowledgementTimeMinutes(incidentAcked), 12);
      assert.equal(calculateAcknowledgementTimeMinutes(incidentUnacked), null);
      assert.equal(calculateAcknowledgementTimeMinutes(incidentMissingCreated), null);
    });

    test('Computes resolution time and strictly returns null for unresolved or reopened tickets', () => {
      const incidentResolved = {
        createdAt: new Date('2026-10-10T12:00:00.000Z'),
        resolvedAt: new Date('2026-10-10T13:30:00.000Z'),
        status: 'resolved',
      };
      const incidentOpen = {
        createdAt: new Date('2026-10-10T12:00:00.000Z'),
        resolvedAt: null,
        status: 'investigating',
      };
      const incidentReopened = {
        createdAt: new Date('2026-10-10T12:00:00.000Z'),
        resolvedAt: new Date('2026-10-10T13:00:00.000Z'),
        status: 'reopened',
      };

      assert.equal(calculateResolutionTimeMinutes(incidentResolved), 90);
      assert.equal(calculateResolutionTimeMinutes(incidentOpen), null);
      assert.equal(calculateResolutionTimeMinutes(incidentReopened), null);
    });
  });

  describe('2. Explicit SLA States, Threshold Boundaries & Reopened Incidents', () => {
    test('Evaluates On Track state when elapsed time is under 80% of target budget', () => {
      const createdAt = new Date('2026-10-10T12:00:00.000Z');
      const now = new Date('2026-10-10T12:05:00.000Z'); // 5m into 15m target (33% elapsed)
      const incident = {
        priority: 'P1',
        createdAt,
        status: 'triggered',
        sla: computeSlaTargets('P1', createdAt),
      };

      const result = evaluateSlaStatus(incident, now);
      assert.equal(result.responseState, SLA_STATES.ON_TRACK);
      assert.equal(result.resolutionState, SLA_STATES.ON_TRACK);
      assert.equal(result.overallState, SLA_STATES.ON_TRACK);
      assert.equal(result.isBreached, false);
    });

    test('Transitions to At Risk state when elapsed time crosses 80% warning threshold', () => {
      const createdAt = new Date('2026-10-10T12:00:00.000Z');
      const now = new Date('2026-10-10T12:13:00.000Z'); // 13m into 15m target (86.7% elapsed)
      const incident = {
        priority: 'P1',
        createdAt,
        status: 'triggered',
        sla: computeSlaTargets('P1', createdAt),
      };

      const result = evaluateSlaStatus(incident, now);
      assert.equal(result.responseState, SLA_STATES.AT_RISK);
      assert.equal(result.overallState, SLA_STATES.AT_RISK);
      assert.equal(result.isBreached, false);
    });

    test('Transitions to Breached state when response deadline is exceeded unacknowledged', () => {
      const createdAt = new Date('2026-10-10T12:00:00.000Z');
      const now = new Date('2026-10-10T12:16:00.000Z'); // 16m into 15m target (past response deadline)
      const incident = {
        priority: 'P1',
        createdAt,
        status: 'triggered',
        sla: computeSlaTargets('P1', createdAt),
      };

      const result = evaluateSlaStatus(incident, now);
      assert.equal(result.responseState, SLA_STATES.BREACHED);
      assert.equal(result.isResponseBreached, true);
      assert.equal(result.overallState, SLA_STATES.BREACHED);
      assert.equal(result.isBreached, true);
    });

    test('Records Met state when response and resolution occur before deadlines', () => {
      const createdAt = new Date('2026-10-10T12:00:00.000Z');
      const incident = {
        priority: 'P1',
        createdAt,
        acknowledgedAt: new Date('2026-10-10T12:10:00.000Z'), // Met (10m <= 15m)
        resolvedAt: new Date('2026-10-10T13:30:00.000Z'), // Met (90m <= 120m)
        status: 'resolved',
        sla: computeSlaTargets('P1', createdAt),
      };

      const result = evaluateSlaStatus(incident, new Date('2026-10-10T14:00:00.000Z'));
      assert.equal(result.responseState, SLA_STATES.MET);
      assert.equal(result.resolutionState, SLA_STATES.MET);
      assert.equal(result.overallState, SLA_STATES.MET);
      assert.equal(result.isBreached, false);
    });

    test('Correctly handles reopened incident: active resolution clock breaches if past deadline', () => {
      const createdAt = new Date('2026-10-10T12:00:00.000Z');
      const incident = {
        priority: 'P1', // Resolution target = 120m (deadline: 14:00:00)
        createdAt,
        status: 'reopened',
        reopenedCount: 1,
        reopenedAt: new Date('2026-10-10T14:10:00.000Z'),
        sla: computeSlaTargets('P1', createdAt),
      };

      const nowPastDeadline = new Date('2026-10-10T14:15:00.000Z');
      const result = evaluateSlaStatus(incident, nowPastDeadline);

      assert.equal(result.resolutionState, SLA_STATES.BREACHED);
      assert.equal(result.isResolutionBreached, true);
      assert.equal(result.overallState, SLA_STATES.BREACHED);
    });
  });

  describe('3. Operational Dashboard Aggregations, Windows & MTTR Denominator', () => {
    let resolvedP1, resolvedP2, openP1Overdue, openP3OnTrack;

    before(async () => {
      await Incident.deleteMany({});
      await AuditLog.deleteMany({});

      const baseDate = new Date();

      // 1. Resolved P1 (within SLA): created 100m ago, resolved 40m ago (duration = 60m)
      resolvedP1 = await Incident.create({
        incidentNumber: 'INC-701',
        title: 'API Gateway 502 High Latency',
        description: 'Excessive 502 Bad Gateway responses on ingress',
        affectedService: 'api-gateway',
        impact: 'enterprise',
        urgency: 'critical',
        category: 'availability',
        priority: 'P1',
        status: 'resolved',
        assignedTeam: 'Platform SRE',
        reporter: managerUser._id,
        createdAt: new Date(baseDate.getTime() - 100 * 60000),
        acknowledgedAt: new Date(baseDate.getTime() - 95 * 60000), // 5m ack
        resolvedAt: new Date(baseDate.getTime() - 40 * 60000), // 60m resolution (P1 target 120m)
        sla: computeSlaTargets('P1', new Date(baseDate.getTime() - 100 * 60000)),
      });

      // 2. Resolved P2 (within SLA): created 80m ago, resolved 20m ago (duration = 60m)
      resolvedP2 = await Incident.create({
        incidentNumber: 'INC-702',
        title: 'Redis Cache Memory Pressure',
        description: 'Cache eviction rate exceeded normal threshold',
        affectedService: 'cache-service',
        impact: 'department',
        urgency: 'critical',
        category: 'latency',
        priority: 'P2',
        status: 'resolved',
        assignedTeam: 'Platform SRE',
        reporter: managerUser._id,
        createdAt: new Date(baseDate.getTime() - 80 * 60000),
        acknowledgedAt: new Date(baseDate.getTime() - 70 * 60000), // 10m ack
        resolvedAt: new Date(baseDate.getTime() - 20 * 60000), // 60m resolution (P2 target 240m)
        sla: computeSlaTargets('P2', new Date(baseDate.getTime() - 80 * 60000)),
      });

      // 3. Open Overdue P1: created 200m ago, still investigating (P1 resolution target 120m exceeded!)
      openP1Overdue = await Incident.create({
        incidentNumber: 'INC-703',
        title: 'Primary DB Replica Out of Sync',
        description: 'Replication lag exceeds 15 minutes',
        affectedService: 'database',
        impact: 'enterprise',
        urgency: 'critical',
        category: 'availability',
        priority: 'P1',
        status: 'investigating',
        assignedTeam: 'Database Ops',
        reporter: managerUser._id,
        createdAt: new Date(baseDate.getTime() - 200 * 60000),
        acknowledgedAt: new Date(baseDate.getTime() - 195 * 60000),
        sla: computeSlaTargets('P1', new Date(baseDate.getTime() - 200 * 60000)),
      });

      // 4. Open On-Track P3: created 10m ago (P3 target 720m)
      openP3OnTrack = await Incident.create({
        incidentNumber: 'INC-704',
        title: 'Grafana Dashboard Rendering Delay',
        description: 'Occasional query timeout on analytics dashboard',
        affectedService: 'monitoring',
        impact: 'department',
        urgency: 'moderate',
        category: 'latency',
        priority: 'P3',
        status: 'triggered',
        assignedTeam: 'Platform SRE',
        reporter: endUserA._id,
        createdAt: new Date(baseDate.getTime() - 10 * 60000),
        sla: computeSlaTargets('P3', new Date(baseDate.getTime() - 10 * 60000)),
      });

      // Audit logs
      await AuditLog.create({
        incidentId: resolvedP1._id,
        actorId: managerUser._id,
        actorName: managerUser.name,
        actorRole: managerUser.role,
        action: 'RESOLUTION_RECORDED',
        reason: 'Connection pool timeout tuned',
      });
    });

    test('GET /api/v1/analytics/dashboard computes open incidents, today created count, and SLA compliance', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Cookie', managerCookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      const metrics = res.body.metrics;
      // 2 open incidents (INC-703, INC-704)
      assert.equal(metrics.openIncidents, 2);

      // 4 incidents created today
      assert.equal(metrics.incidentsCreatedToday, 4);

      // Status breakdown
      assert.equal(metrics.incidentsByStatus.resolved, 2);
      assert.equal(metrics.incidentsByStatus.investigating, 1);
      assert.equal(metrics.incidentsByStatus.triggered, 1);

      // Priority breakdown
      assert.equal(metrics.incidentsByPriority.P1, 2);
      assert.equal(metrics.incidentsByPriority.P2, 1);
      assert.equal(metrics.incidentsByPriority.P3, 1);

      // Active Breaches: 1 open incident overdue (INC-703)
      assert.equal(metrics.activeBreaches.count, 1);
      assert.equal(metrics.activeBreaches.items[0].incidentNumber, 'INC-703');

      // SLA Compliance Rate
      // Evaluated: 2 met (INC-701, INC-702) + 1 breached (INC-703) = 3 total evaluated
      // Rate = (2 / 3) * 100 = 66.7%
      assert.equal(metrics.slaCompliance.metCount, 2);
      assert.equal(metrics.slaCompliance.breachedCount, 1);
      assert.equal(metrics.slaCompliance.denominator, 3);
      assert.equal(metrics.slaCompliance.rate, 66.7);
    });

    test('MTTR strictly excludes unresolved incidents from completed-resolution denominator', async () => {
      const resInitial = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Cookie', managerCookie);

      assert.equal(resInitial.status, 200);
      const mttrInitial = resInitial.body.metrics.mttr;

      // 2 resolved incidents with 60m resolution duration each: (60 + 60) / 2 = 60 minutes
      assert.equal(mttrInitial.denominator, 2);
      assert.equal(mttrInitial.minutes, 60);
      assert.equal(mttrInitial.excludedUnresolvedCount, 2);

      // Now, insert 3 additional open unresolved incidents
      await Incident.create([
        {
          incidentNumber: 'INC-705',
          title: 'Unresolved Ticket Alpha',
          description: 'Investigating network latency',
          affectedService: 'networking',
          impact: 'single_user',
          urgency: 'moderate',
          category: 'infrastructure',
          priority: 'P4',
          status: 'investigating',
          assignedTeam: 'Platform SRE',
          reporter: managerUser._id,
        },
        {
          incidentNumber: 'INC-706',
          title: 'Unresolved Ticket Beta',
          description: 'Investigating high CPU',
          affectedService: 'compute',
          impact: 'single_user',
          urgency: 'low',
          category: 'infrastructure',
          priority: 'P4',
          status: 'triggered',
          assignedTeam: 'Platform SRE',
          reporter: managerUser._id,
        },
      ]);

      const resAfter = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Cookie', managerCookie);

      assert.equal(resAfter.status, 200);
      const mttrAfter = resAfter.body.metrics.mttr;

      // Unresolved tickets must NOT dilute or alter MTTR denominator
      assert.equal(mttrAfter.denominator, 2, 'Denominator must remain 2 resolved incidents');
      assert.equal(mttrAfter.minutes, 60, 'MTTR must remain 60 minutes');
      assert.equal(mttrAfter.excludedUnresolvedCount, 4, 'Excluded count must reflect 4 open tickets');
    });

    test('Buckets ageing incidents accurately into calendar duration tiers', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Cookie', managerCookie);

      assert.equal(res.status, 200);
      const ageing = res.body.metrics.ageingIncidents;

      // We have INC-703 created 200m ago (1–4h bucket)
      // INC-704 created 10m ago (< 1h bucket)
      // INC-705, INC-706 created just now (< 1h bucket)
      assert.equal(ageing.oneToFourHours, 1);
      assert.equal(ageing.under1Hour, 3);
      assert.equal(ageing.totalOpen, 4);
    });

    test('Calculates team workload, active counts and breach count per responder team', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Cookie', managerCookie);

      assert.equal(res.status, 200);
      const workload = res.body.metrics.teamWorkload;

      const sreWorkload = workload.find((w) => w.teamName === 'Platform SRE');
      const dbWorkload = workload.find((w) => w.teamName === 'Database Ops');

      assert.ok(sreWorkload);
      assert.ok(dbWorkload);

      // Database Ops has 1 overdue P1 incident (INC-703)
      assert.equal(dbWorkload.activeCount, 1);
      assert.equal(dbWorkload.breachedCount, 1);

      // Platform SRE has 3 active tickets (INC-704, INC-705, INC-706), 0 breached
      assert.equal(sreWorkload.activeCount, 3);
      assert.equal(sreWorkload.breachedCount, 0);
    });
  });

  describe('4. Filters & Role-Based Access Scoping in Operational Telemetry', () => {
    test('Filters metrics by team and priority query parameters', async () => {
      // Filter by team = Database Ops
      const teamRes = await request(app)
        .get('/api/v1/analytics/dashboard?team=Database%20Ops')
        .set('Cookie', managerCookie);

      assert.equal(teamRes.status, 200);
      assert.equal(teamRes.body.metrics.openIncidents, 1);
      assert.equal(teamRes.body.metrics.activeBreaches.count, 1);

      // Filter by priority = P3
      const priorityRes = await request(app)
        .get('/api/v1/analytics/dashboard?priority=P3')
        .set('Cookie', managerCookie);

      assert.equal(priorityRes.status, 200);
      assert.equal(priorityRes.body.metrics.openIncidents, 1);
      assert.equal(priorityRes.body.metrics.incidentsByPriority.P3, 1);
      assert.equal(priorityRes.body.metrics.incidentsByPriority.P1, 0);
    });

    test('Respects user permissions: end_user only receives metrics for their reported incidents', async () => {
      // End User A reported only INC-704
      const resA = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Cookie', endUserACookie);

      assert.equal(resA.status, 200);
      assert.equal(resA.body.meta.userRole, 'end_user');
      assert.equal(resA.body.metrics.openIncidents, 1); // Only INC-704
      assert.equal(resA.body.metrics.incidentsByPriority.P3, 1);
      assert.equal(resA.body.metrics.incidentsByPriority.P1, 0); // Cannot see manager's P1s

      // End User B reported zero incidents
      const resB = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Cookie', endUserBCookie);

      assert.equal(resB.status, 200);
      assert.equal(resB.body.metrics.openIncidents, 0);
      assert.equal(resB.body.metrics.totalInWindow, 0);
    });
  });

  describe('5. Real Database Mutations & Live Dynamic Refresh', () => {
    test('Verifies dashboard values update immediately after real database creation and resolution', async () => {
      // 1. Get baseline count
      const baselineRes = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Cookie', managerCookie);
      const baselineOpen = baselineRes.body.metrics.openIncidents;

      // 2. Declare new incident via POST /api/v1/incidents
      const createRes = await request(app)
        .post('/api/v1/incidents')
        .set('Cookie', managerCookie)
        .send({
          title: 'Live Telemetry Test: Kafka Consumer Lag',
          description: 'Consumer lag on notifications topic is increasing',
          affectedService: 'notification-service',
          impact: 'department',
          urgency: 'moderate',
          category: 'latency',
          assignedTeam: 'Platform SRE',
        });

      assert.equal(createRes.status, 201);
      const createdId = createRes.body.incident._id;

      // 3. Verify open incident count incremented by 1
      const afterCreateRes = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Cookie', managerCookie);
      assert.equal(afterCreateRes.body.metrics.openIncidents, baselineOpen + 1);

      // 4. Record verified resolution via POST /api/v1/incidents/:id/resolution
      const resolveRes = await request(app)
        .post(`/api/v1/incidents/${createdId}/resolution`)
        .set('Cookie', managerCookie)
        .send({
          rootCauseCategory: 'configuration_drift',
          summary: 'Increased consumer group concurrency to 8 partitions',
          remediationSteps: ['Scaled consumer worker pods', 'Rebalanced Kafka partition assignments'],
        });

      assert.equal(resolveRes.status, 200);

      // 5. Verify open incidents decremented and resolved status updated
      const afterResolveRes = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Cookie', managerCookie);

      assert.equal(afterResolveRes.body.metrics.openIncidents, baselineOpen);
      assert.ok(afterResolveRes.body.metrics.incidentsByStatus.resolved >= 3);

      // Verify audit activity stream captures latest mutation
      const latestActivity = afterResolveRes.body.metrics.recentActivity[0];
      assert.ok(latestActivity);
      assert.equal(latestActivity.action, 'RESOLUTION_RECORDED');
    });
  });
});
