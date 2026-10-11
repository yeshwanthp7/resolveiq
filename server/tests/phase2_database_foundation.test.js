import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Incident from '../src/models/Incident.js';
import Resolution from '../src/models/Resolution.js';
import SLAPolicy from '../src/models/SLAPolicy.js';

describe('ResolveIQ Phase 2: Database Foundation & Schema Tests', () => {
  let app;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test_secret_for_unit_tests_resolveiq_phase2';
    await connectDB();
    const { seedInitialData } = await import('../src/config/seed.js');
    await seedInitialData();
    app = createApp();
  });

  after(async () => {
    await disconnectDB();
  });

  test('GET /api/health returns 200 with database status and latency metric', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');
    assert.equal(res.body.database.connected, true);
    assert.ok(typeof res.body.uptimeSeconds === 'number');
    assert.ok(res.body.database.target.includes('****')); // Confirms secret masking
  });

  test('GET /api/v1/health returns versioned health status', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.service, 'resolveiq-api');
  });

  test('User schema validates email uniqueness and hashes password with bcrypt', async () => {
    const testEmail = `sre_${Date.now()}@resolveiq.io`;
    const user = await User.create({
      name: 'Test SRE Engineer',
      email: testEmail,
      password: 'SecurePassword123!',
      role: 'resolver',
    });

    assert.ok(user._id);
    assert.notEqual(user.password, 'SecurePassword123!'); // Hashes password
    const isMatch = await user.comparePassword('SecurePassword123!');
    assert.equal(isMatch, true);

    // Duplicate email fails with E11000
    await assert.rejects(
      async () => {
        await User.create({
          name: 'Duplicate SRE',
          email: testEmail,
          password: 'AnotherPassword123!',
        });
      },
      (err) => err.code === 11000
    );
  });

  test('Team schema validates tier enum and services array', async () => {
    const teamName = `Team_${Date.now()}`;
    const team = await Team.create({
      name: teamName,
      tier: 'tier-1',
      services: ['payments-service', 'settlement-db'],
    });

    assert.equal(team.name, teamName);
    assert.equal(team.tier, 'tier-1');
    assert.equal(team.services.length, 2);
  });

  test('Incident schema generates unique sequential ticket number and validates enum fields', async () => {
    const inc = await Incident.create({
      title: 'Database Failover Latency Spike',
      description: 'Secondary replica election delayed during primary node stepdown.',
      affectedService: 'database-cluster',
      impact: 'enterprise',
      urgency: 'critical',
      priority: 'P1',
      source: 'datadog',
      category: 'infrastructure',
    });

    assert.ok(inc.incidentNumber);
    assert.match(inc.incidentNumber, /^INC-\d+/);
    assert.equal(inc.priority, 'P1');
    assert.equal(inc.status, 'triggered');
  });

  test('Resolution schema validates rootCauseCategory enum and requires remediationSteps', async () => {
    const inc = await Incident.create({
      title: 'Cache Eviction Storm',
      description: 'Sudden TTL expiration caused cache stampede on auth token redis cluster.',
      affectedService: 'auth-service',
      impact: 'department',
      urgency: 'moderate',
      priority: 'P3',
    });

    const user = await User.findOne();

    const resolution = await Resolution.create({
      incidentId: inc._id,
      rootCauseCategory: 'capacity_exhaustion',
      summary: 'Thundering herd on expired tokens saturated cache memory.',
      remediationSteps: [
        'Added jitter to token TTL values across auth workers',
        'Scaled cache memory ceiling by 50%',
      ],
      resolvedBy: user._id,
    });

    assert.equal(resolution.rootCauseCategory, 'capacity_exhaustion');
    assert.equal(resolution.remediationSteps.length, 2);
  });

  test('SLAPolicy schema validates priority targets', async () => {
    const p1Policy = await SLAPolicy.findOne({ priority: 'P1' });
    assert.ok(p1Policy);
    assert.equal(p1Policy.responseTargetMinutes, 15);
    assert.equal(p1Policy.resolutionTargetMinutes, 120);
  });
});
