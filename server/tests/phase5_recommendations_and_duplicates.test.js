import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import AuditLog from '../src/models/AuditLog.js';
import Team from '../src/models/Team.js';
import RecommendationFeedback from '../src/models/RecommendationFeedback.js';
import { getDeterministicRecommendations } from '../src/services/recommendationEngine.js';
import {
  tokenize,
  buildCorpusStats,
  computeTfIdfVector,
  calculateCosineSimilarity,
} from '../src/services/textProcessing.js';
import { detectDuplicateIncidents } from '../src/services/duplicateDetector.js';
import {
  validateGeminiOutput,
  getGeminiAssistedRecommendations,
} from '../src/services/geminiService.js';
import {
  loadEvaluationDataset,
  evaluateClassification,
  evaluateDuplicateDetection,
  runEvaluationBenchmark,
} from '../src/utils/evaluationBenchmark.js';

describe('ResolveIQ Phase 5: Incident Classification, Priority, Resolver Routing & Duplicate Detection', () => {
  let app;
  let engineerUser, managerUser;
  let engineerCookie, managerCookie;
  let testIncident;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'phase5_recommendations_jwt_secret_test';
    await connectDB();
    app = createApp();

    // Ensure teams exist for routing tests
    await Team.deleteMany({});
    await Team.create([
      { name: 'Platform SRE', services: ['ingress-gateway', 'k8s-cluster'] },
      { name: 'Payments Core', services: ['checkout-service', 'billing-service', 'stripe-webhook'] },
      { name: 'Database Ops', services: ['postgresql-primary', 'redis-cache'] },
      { name: 'Edge & CDN', services: ['edge-cdn', 'envoy-ingress'] },
      { name: 'Identity Service', services: ['iam-service', 'keycloak'] },
    ]);

    // Provision test users
    managerUser = await User.create({
      name: 'Manager Sofia',
      email: `sofia_mgr_${Date.now()}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'manager',
      team: 'Platform SRE',
      isActive: true,
    });

    engineerUser = await User.create({
      name: 'Responder Leo',
      email: `leo_eng_${Date.now()}@resolveiq.io`,
      password: 'EnterprisePass123!',
      role: 'support_engineer',
      team: 'Payments Core',
      isActive: true,
    });

    // Login users to acquire session cookies
    const getCookie = async (user) => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: user.email,
        password: 'EnterprisePass123!',
      });
      assert.equal(res.status, 200);
      const cookies = res.headers['set-cookie'];
      return Array.isArray(cookies) ? cookies[0] : cookies || '';
    };

    managerCookie = await getCookie(managerUser);
    engineerCookie = await getCookie(engineerUser);

    // Seed historical incidents for duplicate search
    await Incident.deleteMany({});
    testIncident = await Incident.create({
      incidentNumber: 'INC-7001',
      title: '504 Gateway Timeout on Ingress Envoy Edge Pods',
      description: 'Customer traffic experiencing intermittent 504 gateway timeouts across edge envoy proxy pods with connection pool exhaustion.',
      affectedService: 'ingress-gateway',
      impact: 'enterprise',
      urgency: 'critical',
      priority: 'P1',
      category: 'availability',
      status: 'investigating',
      assignedTeam: 'Platform SRE',
      reporter: engineerUser._id,
      timeline: [{ action: 'INCIDENT_CREATED', actorName: 'System', details: 'Initialized' }],
    });

    await Incident.create({
      incidentNumber: 'INC-7002',
      title: 'PostgreSQL Write Replica Replication Lag Exceeding 180s',
      description: 'Database replica replication stream lag exceeded 180 seconds. Read traffic serving stale order snapshots.',
      affectedService: 'postgresql-primary',
      impact: 'department',
      urgency: 'critical',
      priority: 'P2',
      category: 'availability',
      status: 'acknowledged',
      assignedTeam: 'Database Ops',
      reporter: engineerUser._id,
      timeline: [{ action: 'INCIDENT_CREATED', actorName: 'System', details: 'Initialized' }],
    });
  });

  after(async () => {
    await disconnectDB();
  });

  // =========================================================================
  // 1. Text Normalization, TF-IDF and Cosine Similarity Tests
  // =========================================================================
  describe('1. Explainable Lexical Processing (TF-IDF & Cosine Similarity)', () => {
    test('Tokenizes text, strips stopwords, stems suffixes and excludes purely numeric tokens', () => {
      const tokens = tokenize('The 504 Gateway Timeouts were repeating rapidly on 1234 pods');
      assert.ok(tokens.includes('gateway'));
      assert.ok(tokens.includes('timeout')); // stemmed from timeouts
      assert.ok(tokens.includes('repeat')); // stemmed from repeating
      assert.ok(!tokens.includes('the'), 'Stopword "the" should be stripped');
      assert.ok(!tokens.includes('were'), 'Stopword "were" should be stripped');
      assert.ok(!tokens.includes('1234'), 'Purely numeric token should be excluded');
    });

    test('Computes TF-IDF vector with smoothed IDF and measures high cosine similarity on overlapping texts', () => {
      const corpus = [
        '504 gateway timeout on ingress envoy edge pods connection pool',
        'postgresql database replica replication lag exceeded seconds',
        'redis cache memory eviction spike unexpected restart',
      ];
      const stats = buildCorpusStats(corpus);
      assert.equal(stats.N, 3);
      assert.ok(stats.docFrequencies.has('gateway'));

      const vecA = computeTfIdfVector('504 gateway timeout on ingress envoy proxy pods', stats);
      const vecB = computeTfIdfVector('Envoy edge ingress proxy experiencing 504 gateway timeout', stats);
      const { similarity, matchedEvidence } = calculateCosineSimilarity(vecA, vecB);

      assert.ok(similarity >= 0.70, `Expected similarity >= 0.70, got ${similarity}`);
      assert.ok(matchedEvidence.includes('gateway') || matchedEvidence.includes('timeout'));
    });

    test('Measures zero cosine similarity on completely unrelated topics with zero token overlap', () => {
      const corpus = ['billing stripe webhook ledger transaction', 'kubernetes node memory cluster eviction'];
      const stats = buildCorpusStats(corpus);
      const vecA = computeTfIdfVector('billing invoice stripe checkout charge', stats);
      const vecB = computeTfIdfVector('kubernetes worker pod hardware crash', stats);
      const { similarity } = calculateCosineSimilarity(vecA, vecB);

      assert.equal(similarity, 0.0);
    });
  });

  // =========================================================================
  // 2. Deterministic Baseline Recommendation Engine
  // =========================================================================
  describe('2. Deterministic Baseline Recommendations', () => {
    test('Correctly classifies Category, calculates ITIL Priority, and routes Team with explainable evidence', async () => {
      const rec = await getDeterministicRecommendations({
        title: 'Elevated 504 Gateway Timeouts on Edge Proxy',
        description: 'Outage observed with upstream service timeout and unavailable connection pool.',
        affectedService: 'ingress-gateway',
        impact: 'enterprise',
        urgency: 'critical',
      });

      assert.equal(rec.suggestedCategory, 'availability');
      assert.equal(rec.suggestedPriority, 'P1');
      assert.equal(rec.suggestedTeam, 'Platform SRE');
      assert.equal(rec.classificationMethod, 'deterministic_rule_heuristic');
      assert.ok(Array.isArray(rec.evidence) && rec.evidence.length >= 2);

      // Verify uncalibrated confidence structure
      assert.ok(rec.confidenceInfo, 'confidenceInfo must be defined');
      assert.equal(rec.confidenceInfo.confidenceType, 'heuristic_match_strength_uncalibrated');
      assert.ok(typeof rec.confidenceInfo.heuristicMatchScore === 'number');
      assert.match(rec.confidenceInfo.disclaimer, /heuristic/i);
    });

    test('Correctly routes Database Ops and latency classification', async () => {
      const rec = await getDeterministicRecommendations({
        title: 'Severe response latency and query lag spike on Postgres',
        description: 'Read queries hanging with p99 latency exceeding 5000ms.',
        affectedService: 'postgresql-primary',
        impact: 'department',
        urgency: 'moderate',
      });

      assert.equal(rec.suggestedCategory, 'latency');
      assert.equal(rec.suggestedPriority, 'P3');
      assert.equal(rec.suggestedTeam, 'Database Ops');
    });

    test('Correctly routes Payments Core and security classification for unauthorized token errors', async () => {
      const rec = await getDeterministicRecommendations({
        title: '401 Unauthorized token verification failures in Checkout',
        description: 'Breach alert or invalid expired credentials on payment gateway.',
        affectedService: 'checkout-service',
        impact: 'enterprise',
        urgency: 'moderate',
      });

      assert.equal(rec.suggestedCategory, 'security');
      assert.equal(rec.suggestedPriority, 'P2');
      assert.equal(rec.suggestedTeam, 'Payments Core');
    });
  });

  // =========================================================================
  // 3. Duplicate Detection Workflow
  // =========================================================================
  describe('3. Duplicate Detection Against MongoDB Incidents', () => {
    test('Flags candidate duplicate ticket with similarity score, candidate ID and matched evidence without altering records', async () => {
      const queryIncident = {
        title: '504 Gateway Timeout in Ingress Envoy Pods',
        description: 'Customer traffic dropping due to 504 gateway timeout and connection pool exhaustion on edge proxy.',
        affectedService: 'ingress-gateway',
      };

      const duplicates = await detectDuplicateIncidents(queryIncident, { threshold: 0.60 });
      assert.ok(duplicates.length > 0, 'Should find at least 1 candidate duplicate');

      const match = duplicates.find((d) => d.incidentNumber === 'INC-7001');
      assert.ok(match, 'INC-7001 should be returned as a candidate match');
      assert.ok(match.similarityScore >= 0.60, `Expected score >= 0.60, got ${match.similarityScore}`);
      assert.equal(match.isSuspectedDuplicate, true);
      assert.ok(Array.isArray(match.matchingEvidence));

      // Verify no tickets were deleted or merged
      const count = await Incident.countDocuments();
      assert.equal(count, 2, 'Total ticket count must remain intact (no auto-deletion/merge)');
    });
  });

  // =========================================================================
  // 4. AI-Disabled Mode & Deterministic Fallback
  // =========================================================================
  describe('4. AI-Disabled Mode & Graceful Fallback', () => {
    test('Executes deterministic engine seamlessly when GEMINI_API_KEY is not configured', async () => {
      const originalKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = '';

      const rec = await getGeminiAssistedRecommendations({
        title: 'Bad commit deployment rollout failure',
        description: 'Docker image tag mismatch failed helm release pipeline.',
        affectedService: 'billing-service',
        impact: 'department',
        urgency: 'low',
      });

      assert.equal(rec.suggestedCategory, 'deployment');
      assert.equal(rec.suggestedPriority, 'P4');
      assert.equal(rec.suggestedTeam, 'Payments Core');
      assert.equal(rec.classificationMethod, 'deterministic_rule_heuristic');

      if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
      else delete process.env.GEMINI_API_KEY;
    });

    test('Validates model output against strict schema and rejects invalid JSON', () => {
      assert.equal(validateGeminiOutput(null).valid, false);
      assert.equal(validateGeminiOutput({ suggestedCategory: 'unknown_cat' }).valid, false);
      assert.equal(validateGeminiOutput({
        suggestedCategory: 'availability',
        suggestedPriority: 'P99', // Invalid
      }).valid, false);

      const validOutput = {
        suggestedCategory: 'security',
        suggestedPriority: 'P1',
        suggestedTeam: 'Platform SRE',
        explanation: 'Valid explanation string',
        evidence: ['Valid token evidence'],
      };
      assert.equal(validateGeminiOutput(validOutput).valid, true);
    });

    test('Falls back to deterministic engine on Gemini HTTP error or schema violation', async () => {
      const originalKey = process.env.GEMINI_API_KEY;
      const originalFetch = global.fetch;

      process.env.GEMINI_API_KEY = 'mock_test_api_key';

      // Mock fetch returning a 429 Rate Limit error
      global.fetch = async () => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ error: 'Quota exceeded' }),
      });

      const rec = await getGeminiAssistedRecommendations({
        title: 'Redis Outage and Cluster Crash',
        description: 'Redis node died unexpectedly with OOM error.',
        affectedService: 'redis-cache',
        impact: 'enterprise',
        urgency: 'critical',
      });

      assert.equal(rec.suggestedCategory, 'availability');
      assert.equal(rec.suggestedTeam, 'Database Ops');
      assert.equal(rec.classificationMethod, 'deterministic_fallback');
      assert.match(rec.fallbackReason, /429/);

      // Restore
      global.fetch = originalFetch;
      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
      else delete process.env.GEMINI_API_KEY;
    });
  });

  // =========================================================================
  // 5. AI-Enabled Mode (Simulated Model Response)
  // =========================================================================
  describe('5. AI-Enabled Mode (Simulated Gemini AI Execution)', () => {
    test('Parses validated Gemini response, returns llm_estimated_confidence and gemini_ai_copilot method', async () => {
      const originalKey = process.env.GEMINI_API_KEY;
      const originalFetch = global.fetch;

      process.env.GEMINI_API_KEY = 'valid_test_ai_key';

      // Mock fetch returning valid JSON adhering to schema
      global.fetch = async () => ({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      suggestedCategory: 'security',
                      suggestedPriority: 'P1',
                      suggestedTeam: 'Identity Service',
                      explanation: 'Gemini detected expired TLS certificate rotation failure on edge.',
                      evidence: ['Expired certificate token', 'Auth rejection status 401'],
                      modelConfidence: 0.94,
                      confidenceLevel: 'high',
                    }),
                  },
                ],
              },
            },
          ],
        }),
      });

      const rec = await getGeminiAssistedRecommendations({
        title: 'Expired TLS certificate on IAM OAuth2 endpoint',
        description: 'Authentication requests failing with TLS handshake termination.',
        affectedService: 'iam-service',
        impact: 'enterprise',
        urgency: 'critical',
      });

      assert.equal(rec.classificationMethod, 'gemini_ai_copilot');
      assert.equal(rec.suggestedCategory, 'security');
      assert.equal(rec.suggestedPriority, 'P1');
      assert.equal(rec.suggestedTeam, 'Identity Service');
      assert.equal(rec.confidenceInfo.confidenceType, 'llm_estimated_confidence');
      assert.equal(rec.confidenceInfo.modelConfidenceScore, 0.94);

      // Restore
      global.fetch = originalFetch;
      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
      else delete process.env.GEMINI_API_KEY;
    });
  });

  // =========================================================================
  // 6. Recommendation Controller & Feedback Decision API
  // =========================================================================
  describe('6. Controller Endpoints, Decision Feedback & Audit Trail', () => {
    test('POST /api/v1/incidents/recommendations returns structured triage & duplicate scan', async () => {
      const res = await request(app)
        .post('/api/v1/incidents/recommendations')
        .set('Cookie', engineerCookie)
        .send({
          title: '504 Gateway Timeout in Ingress Envoy Pods',
          description: 'Customer traffic dropping due to 504 gateway timeout and connection pool exhaustion.',
          affectedService: 'ingress-gateway',
          impact: 'enterprise',
          urgency: 'critical',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.recommendation);
      assert.equal(res.body.recommendation.suggestedCategory, 'availability');
      assert.ok(Array.isArray(res.body.duplicateCandidates));
      assert.ok(res.body.duplicateCandidates.length > 0);
    });

    test('POST /api/v1/incidents/:id/recommendations/feedback records ACCEPTED decision and updates ticket', async () => {
      const res = await request(app)
        .post(`/api/v1/incidents/${testIncident._id}/recommendations/feedback`)
        .set('Cookie', engineerCookie)
        .send({
          decision: 'accepted',
          method: 'rule_based',
          suggestedCategory: 'availability',
          suggestedPriority: 'P1',
          suggestedTeam: 'Platform SRE',
          finalCategory: 'availability',
          finalPriority: 'P1',
          finalTeam: 'Platform SRE',
          explanation: 'Deterministic ITIL and keyword rules confirmed',
          evidence: ['504', 'timeout'],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      // Verify RecommendationFeedback persisted
      const fb = await RecommendationFeedback.findOne({ incidentId: testIncident._id, decision: 'accepted' });
      assert.ok(fb);
      assert.equal(fb.method, 'rule_based');
      assert.equal(fb.decision, 'accepted');

      // Verify AuditLog recorded
      const log = await AuditLog.findOne({
        incidentId: testIncident._id,
        action: 'RECOMMENDATION_ACCEPTED',
      });
      assert.ok(log, 'Audit log must record RECOMMENDATION_ACCEPTED');
    });

    test('POST /api/v1/incidents/:id/recommendations/feedback records EDITED (manually overridden) decision', async () => {
      const res = await request(app)
        .post(`/api/v1/incidents/${testIncident._id}/recommendations/feedback`)
        .set('Cookie', managerCookie)
        .send({
          decision: 'edited',
          method: 'manually_overridden',
          suggestedCategory: 'availability',
          suggestedPriority: 'P1',
          suggestedTeam: 'Platform SRE',
          finalCategory: 'infrastructure',
          finalPriority: 'P2',
          finalTeam: 'Platform SRE',
          feedbackNotes: 'Traffic isolated to test cluster; lowered to P2 infrastructure',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      // Verify incident updated to overridden values
      const updatedInc = await Incident.findById(testIncident._id);
      assert.equal(updatedInc.category, 'infrastructure');
      assert.equal(updatedInc.priority, 'P2');

      // Verify AuditLog recorded
      const log = await AuditLog.findOne({
        incidentId: testIncident._id,
        action: 'RECOMMENDATION_OVERRIDDEN',
      });
      assert.ok(log, 'Audit log must record RECOMMENDATION_OVERRIDDEN');
    });

    test('POST /api/v1/incidents/:id/recommendations/feedback records REJECTED decision without modifying ticket', async () => {
      const prevCategory = (await Incident.findById(testIncident._id)).category;

      const res = await request(app)
        .post(`/api/v1/incidents/${testIncident._id}/recommendations/feedback`)
        .set('Cookie', engineerCookie)
        .send({
          decision: 'rejected',
          method: 'rule_based',
          suggestedCategory: 'security',
          feedbackNotes: 'False positive keyword trigger',
        });

      assert.equal(res.status, 200);
      const incAfter = await Incident.findById(testIncident._id);
      assert.equal(incAfter.category, prevCategory, 'Rejected decision must not mutate incident fields');

      const log = await AuditLog.findOne({
        incidentId: testIncident._id,
        action: 'RECOMMENDATION_REJECTED',
      });
      assert.ok(log, 'Audit log must record RECOMMENDATION_REJECTED');
    });
  });

  // =========================================================================
  // 7. Labeled Evaluation Dataset & Benchmark Metrics
  // =========================================================================
  describe('7. Ground-Truth Benchmark Evaluation', () => {
    test('Measures deterministic classification accuracy and per-class precision/recall on N=24 dataset', async () => {
      const dataset = loadEvaluationDataset();
      assert.equal(dataset.incidents.length, 24);

      const stats = await evaluateClassification(dataset);

      assert.ok(stats.categoryAccuracy >= 0.80, `Expected category accuracy >= 80%, got ${stats.categoryAccuracy}`);
      assert.equal(stats.priorityAccuracy, 1.0, 'Priority matrix should have 100% deterministic accuracy');
      assert.ok(stats.teamAccuracy >= 0.70, `Expected team accuracy >= 70%, got ${stats.teamAccuracy}`);

      // Check per-class precision & recall for security and latency
      assert.ok(stats.perClassCategory.security.precision >= 0.90);
      assert.ok(stats.perClassCategory.security.recall >= 0.90);
      assert.ok(stats.perClassCategory.latency.recall >= 0.90);
    });

    test('Measures duplicate detection precision, recall, and F1 on M=16 labeled pairs', () => {
      const dataset = loadEvaluationDataset();
      assert.equal(dataset.duplicatePairs.length, 16);

      const dupStats = evaluateDuplicateDetection(dataset, { threshold: 0.50 });

      assert.ok(dupStats.accuracy >= 0.85, `Expected duplicate accuracy >= 85%, got ${dupStats.accuracy}`);
      assert.ok(dupStats.precision >= 0.90, `Expected duplicate precision >= 90%, got ${dupStats.precision}`);
      assert.ok(dupStats.recall >= 0.80, `Expected duplicate recall >= 80%, got ${dupStats.recall}`);
      assert.ok(dupStats.f1 >= 0.85, `Expected duplicate F1 >= 0.85, got ${dupStats.f1}`);
    });

    test('runEvaluationBenchmark generates structured report with documented sample size and limitations', async () => {
      const report = await runEvaluationBenchmark();
      assert.equal(report.metadata.sampleSizeIncidents, 24);
      assert.equal(report.metadata.sampleSizeDuplicatePairs, 16);
      assert.ok(report.classification.categoryAccuracy);
      assert.ok(report.duplicateDetection.f1Score);
      assert.ok(Array.isArray(report.limitations) && report.limitations.length >= 2);
    });
  });
});
