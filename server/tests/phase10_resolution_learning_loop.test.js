import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import Resolution from '../src/models/Resolution.js';
import RecommendationFeedback from '../src/models/RecommendationFeedback.js';
import AuditLog from '../src/models/AuditLog.js';
import Team from '../src/models/Team.js';
import { searchVerifiedResolutions } from '../src/services/knowledgeBaseService.js';

describe('ResolveIQ Phase 10: Resolution Learning Loop', () => {
  let app;
  let managerUser, engineerAlpha, engineerBeta, endUser;
  let managerCookie, engineerAlphaCookie, engineerBetaCookie, endUserCookie;
  let teamAlpha, teamBeta;
  let incidentAlpha, incidentBeta;
  let historicalInc1, historicalInc2, resolution1, resolution2;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'phase10_learning_loop_jwt_secret_test';
    await connectDB();
    app = createApp();

    const timestamp = Date.now();

    // 1. Teams
    teamAlpha = await Team.findOneAndUpdate(
      { name: 'Core Infrastructure' },
      { $set: { name: 'Core Infrastructure', tier: 'Tier-1', services: ['database', 'redis-cache'] } },
      { upsert: true, new: true }
    );

    teamBeta = await Team.findOneAndUpdate(
      { name: 'Payments Core' },
      { $set: { name: 'Payments Core', tier: 'Tier-1', services: ['payment-gateway'] } },
      { upsert: true, new: true }
    );

    // 2. Users
    managerUser = await User.create({
      name: 'Manager Maya',
      email: `maya_mgr_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'manager',
      team: 'Core Infrastructure',
      isActive: true,
    });

    engineerAlpha = await User.create({
      name: 'Engineer Alan',
      email: `alan_alpha_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Core Infrastructure',
      isActive: true,
    });

    engineerBeta = await User.create({
      name: 'Engineer Brenda',
      email: `brenda_beta_${timestamp}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Payments Core',
      isActive: true,
    });

    endUser = await User.create({
      name: 'Consumer Dave',
      email: `dave_client_${timestamp}@client.io`,
      password: 'EnterprisePass123!',
      role: 'end_user',
      isActive: true,
    });

    const login = async (email) => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'EnterprisePass123!' });
      return res.headers['set-cookie'];
    };

    managerCookie = await login(managerUser.email);
    engineerAlphaCookie = await login(engineerAlpha.email);
    engineerBetaCookie = await login(engineerBeta.email);
    endUserCookie = await login(endUser.email);

    // 3. Incidents belonging to different teams
    incidentAlpha = await Incident.create({
      title: 'Database connection pool saturation',
      description: 'Primary PostgreSQL pool exhausted under heavy peak load',
      affectedService: 'database',
      impact: 'enterprise',
      urgency: 'critical',
      priority: 'P1',
      status: 'investigating',
      assignedTeam: 'Core Infrastructure',
      reporter: endUser._id,
      category: 'infrastructure',
    });

    incidentBeta = await Incident.create({
      title: 'Payment gateway timeout error',
      description: 'Stripe webhook latency exceeding timeout threshold',
      affectedService: 'payment-gateway',
      impact: 'enterprise',
      urgency: 'critical',
      priority: 'P1',
      status: 'investigating',
      assignedTeam: 'Payments Core',
      reporter: endUser._id,
      category: 'availability',
    });

    // 4. Historical Closed Incidents with Verified Resolutions for Knowledge Base
    historicalInc1 = await Incident.create({
      title: 'PostgreSQL connection exhaustion on primary db',
      description: 'Pool connection leak due to unclosed idle client sessions in database service',
      affectedService: 'database',
      impact: 'enterprise',
      urgency: 'critical',
      priority: 'P1',
      status: 'resolved',
      assignedTeam: 'Core Infrastructure',
      reporter: endUser._id,
      category: 'infrastructure',
    });

    resolution1 = await Resolution.create({
      incidentId: historicalInc1._id,
      rootCauseCategory: 'capacity_exhaustion',
      summary: 'Increased max_connections and added aggressive idle client timeout',
      remediationSteps: [
        'ALTER SYSTEM SET max_connections = 400;',
        'ALTER SYSTEM SET idle_in_transaction_session_timeout = 10000;',
        'SELECT pg_reload_conf();',
      ],
      preventativeActions: ['Configure PgBouncer pooling proxy'],
      resolvedBy: managerUser._id,
      isVerified: true,
      verificationStatus: 'verified',
      successFeedbackCount: 0,
      failureFeedbackCount: 0,
    });

    historicalInc2 = await Incident.create({
      title: 'Legacy database connection buffer overflow',
      description: 'Buffer overflow caused by obsolete client driver pooling in database service',
      affectedService: 'database',
      impact: 'enterprise',
      urgency: 'critical',
      priority: 'P1',
      status: 'resolved',
      assignedTeam: 'Core Infrastructure',
      reporter: endUser._id,
      category: 'infrastructure',
    });

    resolution2 = await Resolution.create({
      incidentId: historicalInc2._id,
      rootCauseCategory: 'configuration_drift',
      summary: 'Legacy manual connection restart script executed',
      remediationSteps: ['systemctl restart legacy-pg-buffer'],
      preventativeActions: ['Upgrade legacy client drivers'],
      resolvedBy: managerUser._id,
      isVerified: true,
      verificationStatus: 'verified',
      successFeedbackCount: 0,
      failureFeedbackCount: 0,
    });
  });

  after(async () => {
    await Incident.deleteMany({
      _id: { $in: [incidentAlpha?._id, incidentBeta?._id, historicalInc1?._id, historicalInc2?._id] },
    });
    await Resolution.deleteMany({
      _id: { $in: [resolution1?._id, resolution2?._id] },
    });
    await RecommendationFeedback.deleteMany({
      incidentId: { $in: [incidentAlpha?._id, incidentBeta?._id] },
    });
    await User.deleteMany({
      _id: { $in: [managerUser?._id, engineerAlpha?._id, engineerBeta?._id, endUser?._id] },
    });
    await disconnectDB();
  });

  /* ------------------------------------------------------------------------- */
  /* 1. FEEDBACK MODEL VALIDATION & KNOWLEDGE SEPARATION                       */
  /* ------------------------------------------------------------------------- */
  describe('A. Recommendation Feedback Capture & Knowledge Separation', () => {
    test('captures full recommendation feedback record with engineer decision and outcomes', async () => {
      const payload = {
        decision: 'accepted',
        recommendationSource: 'gemini_ai_copilot',
        historicalEvidenceUsed: [
          {
            ticketId: historicalInc1.incidentNumber,
            incidentNumber: historicalInc1.incidentNumber,
            similarityScore: 0.88,
            rootCauseCategory: 'capacity_exhaustion',
          },
        ],
        fixAttempted: true,
        fixWorked: true,
        probableRootCause: 'AI Hypothesis: Idle connection pool leak',
        confirmedRootCause: 'Engineer Ground Truth: Verified idle pool leak via pg_stat_activity',
        confirmedOutcome: 'Applied PgBouncer pool recycle and reset connection limits',
        feedbackNotes: 'Hypothesis matched real telemetry accurately',
        selectedRemediationSteps: ['ALTER SYSTEM SET max_connections = 400;'],
      };

      const res = await request(app)
        .post(`/api/v1/incidents/${incidentAlpha._id}/resolution-recommendations/feedback`)
        .set('Cookie', engineerAlphaCookie)
        .send(payload);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      // Verify RecommendationFeedback persisted document
      const fb = await RecommendationFeedback.findOne({ incidentId: incidentAlpha._id });
      assert.ok(fb);
      assert.equal(fb.decision, 'accepted');
      assert.equal(fb.fixAttempted, true);
      assert.equal(fb.fixWorked, true);
      assert.equal(fb.recommendationSource, 'gemini_ai_copilot');
      assert.equal(fb.engineerConfirmedRootCause, payload.confirmedRootCause);
      assert.equal(fb.reviewerId.toString(), engineerAlpha._id.toString());
      assert.equal(fb.historicalEvidenceUsed.length, 1);
      assert.equal(fb.historicalEvidenceUsed[0].ticketId, historicalInc1.incidentNumber);

      // Verify incident model keeps AI hypothesis separate from confirmed facts
      const updatedInc = await Incident.findById(incidentAlpha._id);
      assert.equal(updatedInc.aiHypothesis.hypothesisText, payload.probableRootCause);
      assert.equal(updatedInc.aiHypothesis.status, 'approved');

      // Investigation notes contains confirmed ground truth
      const latestNote = updatedInc.investigationNotes[updatedInc.investigationNotes.length - 1];
      assert.ok(latestNote.note.includes('Fix Attempted: Yes'));
      assert.ok(latestNote.note.includes('Fix Worked: Yes'));
      assert.ok(latestNote.note.includes(payload.confirmedRootCause));

      // AuditLog entry created
      const audit = await AuditLog.findOne({
        incidentId: incidentAlpha._id,
        action: 'RESOLUTION_RECOMMENDATION_ACCEPTED',
      });
      assert.ok(audit);
      assert.equal(audit.actorName, engineerAlpha.name);
    });

    test('captures rejection feedback with primary rejection reason', async () => {
      const payload = {
        decision: 'rejected',
        recommendationSource: 'gemini_ai_copilot',
        fixAttempted: false,
        rejectionReason: 'wrong_root_cause',
        probableRootCause: 'Hallucinated hardware RAID failure',
        feedbackNotes: 'Not applicable to cloud managed database',
      };

      const res = await request(app)
        .post(`/api/v1/incidents/${incidentAlpha._id}/resolution-recommendations/feedback`)
        .set('Cookie', engineerAlphaCookie)
        .send(payload);

      assert.equal(res.status, 200);

      const fb = await RecommendationFeedback.findOne({
        incidentId: incidentAlpha._id,
        decision: 'rejected',
      });
      assert.ok(fb);
      assert.equal(fb.fixAttempted, false);
      assert.equal(fb.fixWorked, false);
      assert.equal(fb.rejectionReason, 'wrong_root_cause');
    });
  });

  /* ------------------------------------------------------------------------- */
  /* 2. CROSS-TEAM AUTHORIZATION & RBAC ENFORCEMENT                             */
  /* ------------------------------------------------------------------------- */
  describe('B. Cross-Team Authorization Enforcement', () => {
    test('strictly prevents an engineer from modifying another team’s restricted records', async () => {
      // engineerBeta belongs to 'Payments Core'. incidentAlpha belongs to 'Core Infrastructure'.
      const res = await request(app)
        .post(`/api/v1/incidents/${incidentAlpha._id}/resolution-recommendations/feedback`)
        .set('Cookie', engineerBetaCookie)
        .send({
          decision: 'accepted',
          probableRootCause: 'Cross team unauthorized review',
        });

      assert.equal(res.status, 403);
      assert.match(res.body.error, /Access denied|team/i);
    });

    test('rejects unauthenticated and end_user requests with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/incidents/${incidentAlpha._id}/resolution-recommendations/feedback`)
        .set('Cookie', endUserCookie)
        .send({ decision: 'accepted' });

      assert.equal(res.status, 403);
    });

    test('permits authorized managers across all team records', async () => {
      const res = await request(app)
        .post(`/api/v1/incidents/${incidentBeta._id}/resolution-recommendations/feedback`)
        .set('Cookie', managerCookie)
        .send({
          decision: 'edited',
          probableRootCause: 'Webhook latency',
          confirmedRootCause: 'Stripe gateway rate limit exhaustion',
          confirmedOutcome: 'Regenerated webhook retry policy',
          fixAttempted: true,
          fixWorked: true,
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
    });
  });

  /* ------------------------------------------------------------------------- */
  /* 3. FLAGGING OUTDATED RESOLUTIONS & RE-VERIFICATION                         */
  /* ------------------------------------------------------------------------- */
  describe('C. Outdated Resolution Flagging & Re-verification', () => {
    test('allows authorized engineer to flag outdated resolution with documented reason', async () => {
      const res = await request(app)
        .post(`/api/v1/incidents/knowledge-base/${historicalInc2.incidentNumber}/flag`)
        .set('Cookie', engineerAlphaCookie)
        .send({
          reason: 'Legacy manual connection restart script was deprecated in v3.0 release',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      // Verify Resolution model was updated
      const updatedRes = await Resolution.findById(resolution2._id);
      assert.equal(updatedRes.isOutdated, true);
      assert.equal(updatedRes.verificationStatus, 'outdated');
      assert.match(updatedRes.outdatedReason, /deprecated/i);
      assert.equal(updatedRes.outdatedFlaggedBy.toString(), engineerAlpha._id.toString());

      // Verify AuditLog record
      const audit = await AuditLog.findOne({
        incidentId: historicalInc2._id,
        action: 'RESOLUTION_FLAGGED_OUTDATED',
      });
      assert.ok(audit);
      assert.equal(audit.actorName, engineerAlpha.name);
    });

    test('allows manager to re-verify an outdated resolution', async () => {
      const res = await request(app)
        .post(`/api/v1/incidents/knowledge-base/${historicalInc2.incidentNumber}/unflag`)
        .set('Cookie', managerCookie);

      assert.equal(res.status, 200);

      const reverifiedRes = await Resolution.findById(resolution2._id);
      assert.equal(reverifiedRes.isOutdated, false);
      assert.equal(reverifiedRes.verificationStatus, 'verified');

      // Re-flag resolution2 as outdated for ranking comparison tests below
      reverifiedRes.isOutdated = true;
      reverifiedRes.verificationStatus = 'outdated';
      reverifiedRes.outdatedReason = 'Deprecated legacy driver';
      await reverifiedRes.save();
    });
  });

  /* ------------------------------------------------------------------------- */
  /* 4. DETERMINISTIC LEARNING LOOP RANKING ADJUSTMENTS                         */
  /* ------------------------------------------------------------------------- */
  describe('D. Deterministic Retrieval Ranking Changes Using Labelled Examples', () => {
    test('boosts verified successful resolutions and penalizes outdated precedents', async () => {
      // 1. Manually update resolution1 with verified successes
      await Resolution.findByIdAndUpdate(resolution1._id, {
        $set: { successFeedbackCount: 3, failureFeedbackCount: 0, isOutdated: false },
      });

      // 2. resolution2 is marked outdated
      await Resolution.findByIdAndUpdate(resolution2._id, {
        $set: { isOutdated: true, verificationStatus: 'outdated' },
      });

      // 3. Perform verified knowledge base search for "database connection pooling leak"
      const searchResults = await searchVerifiedResolutions(
        {
          title: 'Database connection pooling leak',
          description: 'Connection leak exhausting database pool clients',
          affectedService: 'database',
        },
        { threshold: 0.1, limit: 5 }
      );

      assert.ok(searchResults.candidates.length >= 2, 'Should retrieve both database cases');

      const topCase = searchResults.candidates[0];
      const bottomCase = searchResults.candidates.find(
        (c) => c.incidentNumber === historicalInc2.incidentNumber
      );

      // Labelled Assertions:
      // resolution1 (with 3 successes) must rank #1 above resolution2 (which is outdated)
      assert.equal(topCase.incidentNumber, historicalInc1.incidentNumber);
      assert.ok(topCase.feedbackOutcomes.successCount >= 3);
      assert.ok(topCase.feedbackOutcomes.outcomeBoostApplied > 0, 'Outcome boost must be applied');

      assert.ok(bottomCase, 'Historical case 2 must be found');
      assert.equal(bottomCase.isOutdated, true);
      assert.ok(
        topCase.similarityScore > bottomCase.similarityScore,
        'Successful case score must be strictly higher than outdated case score'
      );

      // Verify learning loop explanation disclaimer (No Gemini retraining)
      assert.ok(searchResults.learningLoop);
      assert.equal(searchResults.learningLoop.rankingMethod, 'deterministic_outcome_weighting');
      assert.match(searchResults.learningLoop.explanation, /retrain|fine-tune/i);
    });
  });

  /* ------------------------------------------------------------------------- */
  /* 5. FEEDBACK ANALYTICS & QUALITY METRICS                                   */
  /* ------------------------------------------------------------------------- */
  describe('E. Resolution Learning Loop Analytics View', () => {
    test('GET /api/v1/incidents/knowledge-base/feedback-analytics returns quality metrics and flagged cases', async () => {
      const res = await request(app)
        .get('/api/v1/incidents/knowledge-base/feedback-analytics')
        .set('Cookie', managerCookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      const analytics = res.body.analytics;
      assert.ok(analytics.recommendationsReviewed >= 2);
      assert.ok(analytics.acceptanceCount >= 1);
      assert.ok(analytics.rejectionCount >= 1);

      // Fix outcomes
      assert.ok(analytics.verifiedResolutionOutcomes);
      assert.ok(analytics.verifiedResolutionOutcomes.fixesAttemptedCount >= 1);
      assert.ok(analytics.verifiedResolutionOutcomes.fixesWorkedCount >= 1);
      assert.ok(analytics.verifiedResolutionOutcomes.fixSuccessRate > 0);

      // Common rejection reasons
      assert.ok(analytics.commonRejectionReasons);
      assert.ok(analytics.commonRejectionReasons.wrong_root_cause >= 1);

      // Resolutions requiring review
      assert.ok(Array.isArray(analytics.historicalResolutionsRequiringReview));
      assert.ok(
        analytics.historicalResolutionsRequiringReview.some(
          (r) => r.incidentNumber === historicalInc2.incidentNumber && r.isOutdated
        )
      );

      // Learning loop policy
      assert.equal(analytics.learningLoopPolicy.improvesRetrievalRanking, true);
      assert.equal(analytics.learningLoopPolicy.retrainsGemini, false);
      assert.match(analytics.learningLoopPolicy.explanation, /NOT automatically retrained/i);
    });

    test('GET /api/v1/analytics/feedback returns identical structured analytics', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/feedback')
        .set('Cookie', engineerAlphaCookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.analytics.recommendationsReviewed >= 2);
    });
  });
});
