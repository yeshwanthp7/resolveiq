import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import SLAPolicy from '../src/models/SLAPolicy.js';

describe('ResolveIQ Phase 3: Secure Auth, HttpOnly Cookies & RBAC Boundary Tests', () => {
  let app;
  let adminUser, managerUser, engineerUser, endUserA, endUserB, inactiveUser;
  let adminCookie, managerCookie, engineerCookie, endUserACookie, endUserBCookie;
  let incidentA;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test_secret_for_phase3_enterprise_auth_suite';
    await connectDB();
    app = createApp();

    // 1. Create test users with explicit roles
    adminUser = await User.create({
      name: 'System Admin',
      email: `admin_${Date.now()}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'admin',
      team: 'Platform Ops',
      isActive: true,
    });

    managerUser = await User.create({
      name: 'Incident Manager',
      email: `manager_${Date.now()}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'manager',
      team: 'Platform SRE',
      isActive: true,
    });

    engineerUser = await User.create({
      name: 'Support Engineer Raj',
      email: `engineer_${Date.now()}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Platform SRE',
      isActive: true,
    });

    endUserA = await User.create({
      name: 'Client User Alice',
      email: `alice_${Date.now()}@customer.io`,
      password: 'EnterprisePass123!',
      role: 'end_user',
      team: 'Customer Care',
      isActive: true,
    });

    endUserB = await User.create({
      name: 'Client User Bob',
      email: `bob_${Date.now()}@customer.io`,
      password: 'EnterprisePass123!',
      role: 'end_user',
      team: 'Customer Care',
      isActive: true,
    });

    inactiveUser = await User.create({
      name: 'Deactivated User',
      email: `inactive_${Date.now()}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'end_user',
      isActive: false, // Inactive
    });

    // 2. Obtain HttpOnly session cookies for each role via login endpoint
    const getCookie = async (user) => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: user.email,
        password: 'EnterprisePass123!',
      });
      assert.equal(res.status, 200, `Login failed for ${user.email}: ${JSON.stringify(res.body)}`);
      const cookies = res.headers['set-cookie'];
      return Array.isArray(cookies) ? cookies[0] : cookies || '';
    };

    adminCookie = await getCookie(adminUser);
    managerCookie = await getCookie(managerUser);
    engineerCookie = await getCookie(engineerUser);
    endUserACookie = await getCookie(endUserA);
    endUserBCookie = await getCookie(endUserB);
  });

  after(async () => {
    await disconnectDB();
  });

  test('POST /api/v1/auth/register attaches HttpOnly cookie and forces non-admin role', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Public Registrant',
        email: `public_${Date.now()}@external.io`,
        password: 'SecurePassword123!',
        role: 'admin', // Attempt privilege escalation on public registration
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'end_user'); // Enforces non-admin!
    const cookieHeader = res.headers['set-cookie']?.[0] || '';
    assert.match(cookieHeader, /token=/);
    assert.match(cookieHeader, /HttpOnly/i);
  });

  test('POST /api/v1/auth/login rejects inactive users with 403 Forbidden', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: inactiveUser.email,
      password: 'EnterprisePass123!',
    });

    assert.equal(res.status, 403);
    assert.match(res.body.error, /deactivated/i);
  });

  test('POST /api/v1/auth/logout clears HttpOnly session cookie', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    assert.equal(res.status, 200);
    const cookieHeader = res.headers['set-cookie']?.[0] || '';
    assert.match(cookieHeader, /token=;/); // Clears cookie value
  });

  test('GET /api/v1/auth/me authenticates via HttpOnly cookie', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', endUserACookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, endUserA.email);
    assert.equal(res.body.user.role, 'end_user');
  });

  test('End User can create an incident and reporter is locked to authenticated identity', async () => {
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Cookie', endUserACookie)
      .send({
        title: 'Checkout Form Hanging on Card Submission',
        description: 'Payment submit button spins indefinitely on mobile safari.',
        affectedService: 'payments-service',
        impact: 'department',
        urgency: 'moderate',
        assignedTeam: 'Platform SRE',
      });

    assert.equal(res.status, 201);
    incidentA = res.body.incident;
    assert.equal(incidentA.reporter.toString(), endUserA._id.toString());
  });

  test('End User ownership: Alice can view her incident, but Bob is denied with 403', async () => {
    // Alice requests her own incident -> Allowed
    const resAlice = await request(app)
      .get(`/api/v1/incidents/${incidentA._id}`)
      .set('Cookie', endUserACookie);
    assert.equal(resAlice.status, 200);

    // Bob requests Alice's incident -> Denied with 403
    const resBob = await request(app)
      .get(`/api/v1/incidents/${incidentA._id}`)
      .set('Cookie', endUserBCookie);
    assert.equal(resBob.status, 403);
    assert.match(resBob.body.error, /only authorized to view incidents they reported/);
  });

  test('End User queue list is scoped strictly to own reported incidents', async () => {
    const res = await request(app)
      .get('/api/v1/incidents')
      .set('Cookie', endUserBCookie);

    assert.equal(res.status, 200);
    // Bob should not see Alice's incident in his list
    const foundAliceIncident = res.body.incidents.some((i) => i._id.toString() === incidentA._id.toString());
    assert.equal(foundAliceIncident, false);
  });

  test('Support Engineer cannot reassign incident, but Manager can', async () => {
    // Support Engineer attempts reassign -> 403 Forbidden
    const resEng = await request(app)
      .patch(`/api/v1/incidents/${incidentA._id}/reassign`)
      .set('Cookie', engineerCookie)
      .send({ assignedTeam: 'Payments Core' });
    assert.equal(resEng.status, 403);

    // Manager attempts reassign -> 200 OK
    const resMgr = await request(app)
      .patch(`/api/v1/incidents/${incidentA._id}/reassign`)
      .set('Cookie', managerCookie)
      .send({ assigneeId: engineerUser._id.toString(), assignedTeam: 'Platform SRE' });
    assert.equal(resMgr.status, 200);
    assert.equal(resMgr.body.incident.assignee.toString(), engineerUser._id.toString());
  });

  test('Support Engineer can update lifecycle status and record verified resolution', async () => {
    // Status transition to investigating
    const resStatus = await request(app)
      .patch(`/api/v1/incidents/${incidentA._id}/status`)
      .set('Cookie', engineerCookie)
      .send({ status: 'investigating', reason: 'Analyzing safari network trace' });
    assert.equal(resStatus.status, 200);
    assert.equal(resStatus.body.incident.status, 'investigating');

    // Record verified resolution
    const resResolution = await request(app)
      .post(`/api/v1/incidents/${incidentA._id}/resolution`)
      .set('Cookie', engineerCookie)
      .send({
        rootCauseCategory: 'code_defect',
        summary: 'Safari regex catastrophic backtracking on expiry date formatter',
        remediationSteps: [
          'Patched input formatting regex',
          'Deployed hotfix v2.1.4 to edge cdn',
        ],
      });

    assert.equal(resResolution.status, 200);
    assert.equal(resResolution.body.resolution.rootCauseCategory, 'code_defect');
    assert.equal(resResolution.body.incident.status, 'resolved');
  });

  test('Admin-only boundaries: Non-admin denied from SLA policy modification', async () => {
    // Support Engineer denied
    const resDenied = await request(app)
      .post('/api/v1/sla-policies')
      .set('Cookie', engineerCookie)
      .send({ name: 'Custom SLA', priority: 'P2', responseTargetMinutes: 20, resolutionTargetMinutes: 180 });
    assert.equal(resDenied.status, 403);

    // Admin allowed
    const testPriority = `P_${Date.now()}`;
    const resAdmin = await request(app)
      .post('/api/v1/sla-policies')
      .set('Cookie', adminCookie)
      .send({ name: `Policy_${Date.now()}`, priority: 'P5', responseTargetMinutes: 300, resolutionTargetMinutes: 2400 });
    // If P5 exists from seeder, try update
    assert.ok(resAdmin.status === 201 || resAdmin.status === 409 || resAdmin.status === 400);
  });

  test('Support Engineer team boundaries: Denied access and updates on other team incidents', async () => {
    // Create an incident assigned to 'Database Ops' (not engineerUser's team 'Platform SRE' and not assigned to them)
    const dbIncident = await Incident.create({
      title: 'PostgreSQL Connection Pool Exhausted',
      description: 'Max connections reached on write replica.',
      affectedService: 'postgresql-primary',
      impact: 'department',
      urgency: 'critical',
      priority: 'P2',
      assignedTeam: 'Database Ops',
      reporter: adminUser._id,
      sla: {
        responseTargetMinutes: 30,
        resolutionTargetMinutes: 240,
        responseDeadline: new Date(Date.now() + 1800000),
        resolutionDeadline: new Date(Date.now() + 14400000),
      },
    });

    // 1. Support engineer cannot view incident of another team
    const resView = await request(app)
      .get(`/api/v1/incidents/${dbIncident._id}`)
      .set('Cookie', engineerCookie);
    assert.equal(resView.status, 403);
    assert.match(resView.body.error, /Support Engineers can only access incidents assigned to their team/);

    // 2. Support engineer cannot update status of another team incident
    const resStatus = await request(app)
      .patch(`/api/v1/incidents/${dbIncident._id}/status`)
      .set('Cookie', engineerCookie)
      .send({ status: 'investigating' });
    assert.equal(resStatus.status, 403);
    assert.match(resStatus.body.error, /Support Engineers can only update incidents assigned to their team/);

    // 3. Support engineer cannot record resolution of another team incident
    const resRes = await request(app)
      .post(`/api/v1/incidents/${dbIncident._id}/resolution`)
      .set('Cookie', engineerCookie)
      .send({
        rootCauseCategory: 'configuration_drift',
        summary: 'Restarted connection pooler',
        remediationSteps: ['Flushed pool'],
      });
    assert.equal(resRes.status, 403);
    assert.match(resRes.body.error, /Support Engineers can only record resolutions for incidents assigned to their team/);
  });

  test('Manager and Admin can access permitted analytics and workload, non-managers denied', async () => {
    // Manager permitted
    const resMgrAnalytics = await request(app)
      .get('/api/v1/analytics')
      .set('Cookie', managerCookie);
    assert.equal(resMgrAnalytics.status, 200);
    assert.ok(resMgrAnalytics.body.metrics);

    const resMgrWorkload = await request(app)
      .get('/api/v1/analytics/workload')
      .set('Cookie', managerCookie);
    assert.equal(resMgrWorkload.status, 200);
    assert.ok(resMgrWorkload.body.workloadByTeam);

    // End User denied
    const resUserDenied = await request(app)
      .get('/api/v1/analytics')
      .set('Cookie', endUserACookie);
    assert.equal(resUserDenied.status, 403);

    // Support Engineer denied
    const resEngDenied = await request(app)
      .get('/api/v1/analytics/workload')
      .set('Cookie', engineerCookie);
    assert.equal(resEngDenied.status, 403);
  });

  test('Admin operations: Manage teams and integrations, non-admins denied with 403', async () => {
    // 1. Team management - Engineer denied
    const resTeamDenied = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', engineerCookie)
      .send({ name: `Infra Team ${Date.now()}`, tier: 'tier-1' });
    assert.equal(resTeamDenied.status, 403);

    // Team management - Admin allowed
    const teamName = `Infra Team ${Date.now()}`;
    const resTeamAdmin = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', adminCookie)
      .send({ name: teamName, tier: 'tier-1', services: ['ingress', 'mesh'] });
    assert.equal(resTeamAdmin.status, 201);
    assert.equal(resTeamAdmin.body.team.name, teamName);

    // 2. Integration management - Manager denied
    const resIntDenied = await request(app)
      .post('/api/v1/integrations')
      .set('Cookie', managerCookie)
      .send({ serviceName: 'k8s-cluster', provider: 'prometheus' });
    assert.equal(resIntDenied.status, 403);

    // Integration management - Admin allowed
    const resIntAdmin = await request(app)
      .post('/api/v1/integrations')
      .set('Cookie', adminCookie)
      .send({ serviceName: 'k8s-cluster', provider: 'prometheus' });
    assert.equal(resIntAdmin.status, 201);
    assert.ok(resIntAdmin.body.apiKey);

    // 3. User management - Support Engineer denied
    const resUserPatchDenied = await request(app)
      .patch(`/api/v1/auth/users/${endUserA._id}`)
      .set('Cookie', engineerCookie)
      .send({ role: 'support_engineer' });
    assert.equal(resUserPatchDenied.status, 403);

    // User management - Admin allowed
    const resUserPatchAdmin = await request(app)
      .patch(`/api/v1/auth/users/${endUserA._id}`)
      .set('Cookie', adminCookie)
      .send({ role: 'support_engineer' });
    assert.equal(resUserPatchAdmin.status, 200);
    assert.equal(resUserPatchAdmin.body.user.role, 'support_engineer');
  });

  test('Initial-admin setup is locked once an admin exists', async () => {
    const res = await request(app)
      .post('/api/v1/auth/setup-admin')
      .send({
        name: 'Another Admin Attempt',
        email: 'attacker@evil.io',
        password: 'AttackPassword123!',
      });

    assert.equal(res.status, 403);
    assert.match(res.body.error, /Initial administrator already exists/);
  });
});
