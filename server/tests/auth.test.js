import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';

describe('ResolveIQ Phase 1: Authentication & Health API Tests', () => {
  let app;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test_secret_for_unit_tests_resolveiq';
    await connectDB();
    app = createApp();
    await User.deleteMany({});
  });

  after(async () => {
    await User.deleteMany({ email: /sarah\.chen/ });
    await disconnectDB();
  });

  test('GET /api/v1/health returns 200 and database status', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');
    assert.equal(res.body.database.connected, true);
    assert.equal(typeof res.body.uptimeSeconds, 'number');
  });

  test('POST /api/v1/auth/register fails when required fields are missing', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'alex@resolveiq.io',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /Please provide name, email, and password/);
  });

  test('POST /api/v1/auth/register fails when password is too short', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Alex Rivera',
      email: 'alex@resolveiq.io',
      password: '123',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /at least 6 characters/);
  });

  test('POST /api/v1/auth/register successfully creates user and returns JWT', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Commander Sarah Chen',
      email: 'sarah.chen@resolveiq.io',
      password: 'enterpriseSecurePass2026',
      role: 'commander',
      team: 'Core Incident Response',
      skills: ['k8s', 'incident-command', 'aws'],
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, 'sarah.chen@resolveiq.io');
    assert.equal(res.body.user.role, 'commander');
    assert.equal(res.body.user.password, undefined); // Ensure password is sanitized
  });

  test('POST /api/v1/auth/register rejects duplicate email with 409', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Sarah Chen Duplicate',
      email: 'sarah.chen@resolveiq.io',
      password: 'anotherPassword',
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
  });

  test('POST /api/v1/auth/login fails with wrong password', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'sarah.chen@resolveiq.io',
      password: 'wrongPassword123',
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /Invalid email or password/);
  });

  test('POST /api/v1/auth/login succeeds with correct password and returns JWT', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'sarah.chen@resolveiq.io',
      password: 'enterpriseSecurePass2026',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, 'sarah.chen@resolveiq.io');
  });

  test('GET /api/v1/auth/me requires Bearer token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test('GET /api/v1/auth/me returns current user profile when authenticated', async () => {
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: 'sarah.chen@resolveiq.io',
      password: 'enterpriseSecurePass2026',
    });
    const token = loginRes.body.token;

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.success, true);
    assert.equal(meRes.body.user.email, 'sarah.chen@resolveiq.io');
    assert.equal(meRes.body.user.role, 'commander');
    assert.equal(meRes.body.user.password, undefined);
  });
});
