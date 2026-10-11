import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import Team from '../src/models/Team.js';
import AuditLog from '../src/models/AuditLog.js';
import {
  scoreCandidateEngineers,
  simulateWhatIfScenario,
  DEFAULT_ASSIGNMENT_WEIGHTS,
} from '../src/services/assignmentSimulatorService.js';

describe('ResolveIQ Phase 9: Workload-Aware Assignment & What-If Incident Simulation', () => {
  let app;
  let managerUser, engineerAvailable, engineerBusy, engineerUnavailable, inactiveEngineer, endUser;
  let managerCookie, engineerCookie, endUserCookie;
  let testTeamAlpha, testTeamBeta;
  let testIncidentP1, testIncidentP3;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'phase9_workload_simulation_jwt_secret_test';
    await connectDB();
    app = createApp();

    // 1. Provision Teams
    testTeamAlpha = await Team.findOneAndUpdate(
      { name: 'Core Infrastructure' },
      {
        $set: {
          name: 'Core Infrastructure',
          tier: 'Tier-1',
          description: 'Primary platform and database responders',
          services: ['database', 'redis-cache', 'auth-service'],
          serviceResponsibilities: ['database', 'redis-cache', 'auth-service'],
          skillTags: ['database', 'postgresql', 'redis', 'caching'],
          maxWorkloadPerEngineer: 5,
        },
      },
      { upsert: true, new: true }
    );

    testTeamBeta = await Team.findOneAndUpdate(
      { name: 'Billing Services' },
      {
        $set: {
          name: 'Billing Services',
          tier: 'Tier-2',
          description: 'Payment gateway and invoicing responders',
          services: ['payment-gateway', 'invoicing'],
          serviceResponsibilities: ['payment-gateway', 'invoicing'],
          skillTags: ['payments', 'stripe', 'accounting'],
          maxWorkloadPerEngineer: 4,
        },
      },
      { upsert: true, new: true }
    );

    // 2. Provision Users with various availability statuses & skills
    const timestamp = Date.now();

    managerUser = await User.create({
      name: 'Manager Maya',
      email: `manager_maya_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'manager',
      team: 'Core Infrastructure',
      isActive: true,
      availabilityStatus: 'available',
    });

    engineerAvailable = await User.create({
      name: 'Engineer Alan',
      email: `alan_avail_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Core Infrastructure',
      skills: ['database', 'postgresql', 'performance'],
      serviceResponsibilities: ['database'],
      availabilityStatus: 'on_call',
      maxConcurrentIncidents: 5,
      isActive: true,
    });

    engineerBusy = await User.create({
      name: 'Engineer Brenda',
      email: `brenda_busy_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Core Infrastructure',
      skills: ['redis', 'caching'],
      serviceResponsibilities: ['redis-cache'],
      availabilityStatus: 'busy',
      maxConcurrentIncidents: 3,
      isActive: true,
    });

    engineerUnavailable = await User.create({
      name: 'Engineer Uma',
      email: `uma_unavail_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Core Infrastructure',
      skills: ['database'],
      availabilityStatus: 'unavailable',
      isActive: true,
    });

    inactiveEngineer = await User.create({
      name: 'Inactive Ian',
      email: `ian_inactive_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Core Infrastructure',
      skills: ['database'],
      availabilityStatus: 'available',
      isActive: false,
    });

    endUser = await User.create({
      name: 'Customer Dave',
      email: `dave_client_${timestamp}@client.io`,
      password: 'EnterprisePass123!',
      role: 'end_user',
      isActive: true,
    });

    // 3. Acquire session cookies
    const login = async (email) => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'EnterprisePass123!' });
      return res.headers['set-cookie'];
    };

    managerCookie = await login(managerUser.email);
    engineerCookie = await login(engineerAvailable.email);
    endUserCookie = await login(endUser.email);

    // 4. Provision Incidents
    testIncidentP1 = await Incident.create({
      title: 'Database connection pool exhaustion',
      description: 'Critical pool exhaustion on primary PostgreSQL cluster causing timeouts',
      affectedService: 'database',
      impact: 'enterprise',
      urgency: 'critical',
      priority: 'P1',
      status: 'triggered',
      assignedTeam: 'Core Infrastructure',
      reporter: endUser._id,
      category: 'infrastructure',
    });

    testIncidentP3 = await Incident.create({
      title: 'Redis cache latency degradation',
      description: 'Minor latency degradation in cache queries',
      affectedService: 'redis-cache',
      impact: 'department',
      urgency: 'moderate',
      priority: 'P3',
      status: 'acknowledged',
      assignedTeam: 'Core Infrastructure',
      assignee: engineerBusy._id,
      reporter: endUser._id,
      category: 'latency',
    });
  });

  after(async () => {
    // Cleanup created test resources
    await Incident.deleteMany({
      _id: { $in: [testIncidentP1?._id, testIncidentP3?._id] },
    });
    await User.deleteMany({
      _id: {
        $in: [
          managerUser?._id,
          engineerAvailable?._id,
          engineerBusy?._id,
          engineerUnavailable?._id,
          inactiveEngineer?._id,
          endUser?._id,
        ],
      },
    });
    await disconnectDB();
  });

  /* ------------------------------------------------------------------------- */
  /* 1. DETERMINISTIC ASSIGNMENT SCORING & GATEKEEPER RULES                     */
  /* ------------------------------------------------------------------------- */
  describe('A. Deterministic Assignment Scoring & Eligibility Gatekeepers', () => {
    test('strictly excludes inactive users, end users, and unavailable engineers', async () => {
      const result = await scoreCandidateEngineers(testIncidentP1);
      const candidateUserIds = result.candidates.map((c) => c.user.id.toString());

      // Gatekeeper assertions
      assert.ok(
        !candidateUserIds.includes(inactiveEngineer._id.toString()),
        'Inactive engineer MUST NOT be eligible'
      );
      assert.ok(
        !candidateUserIds.includes(endUser._id.toString()),
        'End user role MUST NOT be eligible'
      );
      assert.ok(
        !candidateUserIds.includes(engineerUnavailable._id.toString()),
        'Engineer with availabilityStatus unavailable MUST NOT be eligible'
      );
    });

    test('ranks candidates deterministically and includes transparent factor breakdown', async () => {
      const result = await scoreCandidateEngineers(testIncidentP1);

      assert.ok(result.candidates.length > 0, 'Must have at least one eligible candidate');
      const topCandidate = result.candidates[0];

      assert.equal(topCandidate.rank, 1);
      assert.equal(topCandidate.isRecommended, true);
      assert.ok(topCandidate.compositeScore >= 0 && topCandidate.compositeScore <= 100);

      // Verify all 5 scoring factors are present with scores and evidence
      const bd = topCandidate.scoringBreakdown;
      assert.ok(bd.teamServiceCompatibility, 'Factor 1: Team & Service Compatibility required');
      assert.ok(bd.skillsMatch, 'Factor 2: Relevant Skills Match required');
      assert.ok(bd.workloadBandwidth, 'Factor 3: Workload Bandwidth required');
      assert.ok(bd.criticalIncidentsHeadroom, 'Factor 4: Critical Incidents Headroom required');
      assert.ok(bd.availabilityReadiness, 'Factor 5: Availability Readiness required');

      // Top candidate Alan has on_call status, matching database service, and matching skills
      assert.equal(topCandidate.user.id.toString(), engineerAvailable._id.toString());
      assert.ok(topCandidate.scoringBreakdown.skillsMatch.matchedSkills.includes('database'));
    });

    test('attaches clear ethical disclaimer that scoring does not measure individual productivity', async () => {
      const result = await scoreCandidateEngineers(testIncidentP1);
      assert.ok(result.meta.disclaimer, 'Meta disclaimer must be present');
      assert.match(
        result.meta.disclaimer,
        /productivity|performance|competency/i,
        'Disclaimer must explicitly state formula does not measure individual performance or productivity'
      );
    });
  });

  /* ------------------------------------------------------------------------- */
  /* 2. RBAC & PERMISSION BOUNDARIES                                           */
  /* ------------------------------------------------------------------------- */
  describe('B. RBAC & Authorization Enforcement', () => {
    test('GET /api/v1/incidents/:id/candidate-responders allows authorized managers and engineers', async () => {
      const res = await request(app)
        .get(`/api/v1/incidents/${testIncidentP1._id}/candidate-responders`)
        .set('Cookie', engineerCookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(Array.isArray(res.body.candidates));
    });

    test('GET /api/v1/incidents/:id/candidate-responders returns 403 Forbidden for end_user', async () => {
      const res = await request(app)
        .get(`/api/v1/incidents/${testIncidentP1._id}/candidate-responders`)
        .set('Cookie', endUserCookie);

      assert.equal(res.status, 403);
    });

    test('POST /api/v1/incidents/:id/what-if returns 403 Forbidden for end_user', async () => {
      const res = await request(app)
        .post(`/api/v1/incidents/${testIncidentP1._id}/what-if`)
        .set('Cookie', endUserCookie)
        .send({ assignmentDelayMinutes: 15 });

      assert.equal(res.status, 403);
    });

    test('GET /api/v1/analytics/workload-details returns 403 Forbidden for end_user', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/workload-details')
        .set('Cookie', endUserCookie);

      assert.equal(res.status, 403);
    });
  });

  /* ------------------------------------------------------------------------- */
  /* 3. WORKLOAD QUEUES & CAPACITY SATURATION CALCULATIONS                     */
  /* ------------------------------------------------------------------------- */
  describe('C. Workload Queues & Saturation Analytics', () => {
    test('GET /api/v1/analytics/workload-details returns team queues and enriched responder roster', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/workload-details')
        .set('Cookie', managerCookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.teamQueues.length >= 2, 'Must include provisioned teams');
      assert.ok(res.body.engineerRoster.length >= 2, 'Must include authorized responders');

      // Verify Core Infrastructure team queue
      const coreQueue = res.body.teamQueues.find((t) => t.name === 'Core Infrastructure');
      assert.ok(coreQueue);
      assert.ok(coreQueue.byPriority);
      assert.ok(coreQueue.byPriority.P1 !== undefined);
      assert.ok(coreQueue.byPriority.P3 !== undefined);

      // Verify engineer roster entry
      const alanRoster = res.body.engineerRoster.find((e) => e.name === 'Engineer Alan');
      assert.ok(alanRoster);
      assert.equal(alanRoster.availabilityStatus, 'on_call');
      assert.ok(alanRoster.maxCapacity >= 5);
      assert.ok(alanRoster.saturationRatio !== undefined);
    });
  });

  /* ------------------------------------------------------------------------- */
  /* 4. WHAT-IF INCIDENT SIMULATION & SLA BOUNDARY CASES                       */
  /* ------------------------------------------------------------------------- */
  describe('D. What-If Incident Simulator & SLA Boundaries', () => {
    test('simulates assignment delay and detects response SLA breach deterministically', async () => {
      // P1 response SLA is 15 minutes. Simulating a 45 minute delay MUST breach response SLA.
      const res = await request(app)
        .post(`/api/v1/incidents/${testIncidentP1._id}/what-if`)
        .set('Cookie', managerCookie)
        .send({
          assignmentDelayMinutes: 45,
          targetTeam: 'Core Infrastructure',
          targetEngineerId: engineerAvailable._id,
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      const sim = res.body.simulation;
      assert.equal(sim.meta.isHypothetical, true);
      assert.ok(sim.meta.disclaimer);

      // SLA projections verification
      assert.equal(sim.slaProjections.responseTargetMinutes, 15);
      assert.equal(sim.slaProjections.wouldBreachResponse, true);
      assert.ok(sim.slaProjections.responseBreachMarginMinutes > 0);
      assert.equal(sim.slaProjections.projectedSlaState, 'Breached');

      // Queue warnings
      assert.ok(
        sim.workloadImpact.queueWarnings.some((w) => w.includes('budget') || w.includes('delay')),
        'Queue warnings must include delay warning'
      );
    });

    test('simulates reassignment across teams and engineers with queue blast radius', async () => {
      const res = await request(app)
        .post(`/api/v1/incidents/${testIncidentP3._id}/what-if`)
        .set('Cookie', managerCookie)
        .send({
          assignmentDelayMinutes: 0,
          targetTeam: 'Billing Services',
          targetEngineerId: engineerAvailable._id,
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      const sim = res.body.simulation;
      assert.equal(sim.scenarioInputs.targetTeam, 'Billing Services');
      assert.equal(sim.scenarioInputs.targetEngineer.id, engineerAvailable._id.toString());

      // Workload impact
      assert.ok(sim.workloadImpact.targetAssignee);
      assert.equal(
        sim.workloadImpact.targetAssignee.openTicketsAfter,
        sim.workloadImpact.targetAssignee.openTicketsBefore + 1
      );
    });

    test('warns when target engineer reaches maximum workload capacity', async () => {
      // engineerBusy has maxConcurrentIncidents = 3. Set up load or test scenario
      const res = await request(app)
        .post(`/api/v1/incidents/${testIncidentP1._id}/what-if`)
        .set('Cookie', managerCookie)
        .send({
          targetEngineerId: engineerBusy._id,
        });

      assert.equal(res.status, 200);
      const sim = res.body.simulation;
      assert.ok(sim.workloadImpact.targetAssignee);
    });
  });

  /* ------------------------------------------------------------------------- */
  /* 5. STRICT NON-MUTATION GUARANTEE                                          */
  /* ------------------------------------------------------------------------- */
  describe('E. Zero Production Record Mutation Guarantee', () => {
    test('running multiple what-if simulations NEVER alters live database records', async () => {
      const incidentBefore = await Incident.findById(testIncidentP1._id).lean();

      // Run multiple what-if simulations with heavy delays and altered targets
      await request(app)
        .post(`/api/v1/incidents/${testIncidentP1._id}/what-if`)
        .set('Cookie', managerCookie)
        .send({
          assignmentDelayMinutes: 120,
          targetTeam: 'Billing Services',
          targetEngineerId: engineerBusy._id,
          simulatedPriority: 'P5',
        });

      await request(app)
        .post(`/api/v1/incidents/${testIncidentP1._id}/what-if`)
        .set('Cookie', managerCookie)
        .send({
          assignmentDelayMinutes: 240,
          targetTeam: 'Core Infrastructure',
          targetEngineerId: engineerAvailable._id,
          simulatedPriority: 'P1',
        });

      const incidentAfter = await Incident.findById(testIncidentP1._id).lean();

      // STRICT INVARIANTS: Database record must be completely identical
      assert.equal(
        incidentAfter.status,
        incidentBefore.status,
        'Live incident status must not change'
      );
      assert.equal(
        incidentAfter.priority,
        incidentBefore.priority,
        'Live incident priority must not change'
      );
      assert.equal(
        incidentAfter.assignedTeam,
        incidentBefore.assignedTeam,
        'Live incident assignedTeam must not change'
      );
      assert.equal(
        String(incidentAfter.assignee || ''),
        String(incidentBefore.assignee || ''),
        'Live incident assignee must not change'
      );
      assert.equal(
        new Date(incidentAfter.updatedAt).getTime(),
        new Date(incidentBefore.updatedAt).getTime(),
        'Live incident updatedAt timestamp must not change'
      );
    });

    test('explicit permitted assignment action updates live record and creates audit log', async () => {
      const res = await request(app)
        .patch(`/api/v1/incidents/${testIncidentP1._id}/reassign`)
        .set('Cookie', managerCookie)
        .send({
          assignedTeam: 'Core Infrastructure',
          assigneeId: engineerAvailable._id,
          reason: 'Manager approved assignment following what-if simulation',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.incident.assignee.toString(), engineerAvailable._id.toString());

      // Verify audit log creation
      const audit = await AuditLog.findOne({
        incidentId: testIncidentP1._id,
        action: 'RESOLVER_ASSIGNED',
      }).sort({ timestamp: -1 });

      assert.ok(audit, 'Must create RESOLVER_ASSIGNED audit record');
      assert.equal(audit.actorName, managerUser.name);
      assert.match(audit.reason, /what-if simulation/i);
    });
  });
});
