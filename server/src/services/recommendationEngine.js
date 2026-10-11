import mongoose from 'mongoose';
import Team from '../models/Team.js';
import { calculatePriority } from '../utils/priorityMatrix.js';
import { tokenize } from './textProcessing.js';

// Keyword dictionary mapping signals to incident categories
const CATEGORY_KEYWORDS = {
  availability: [
    'down', 'outage', 'unavailable', 'unreachable', 'timeout', '504', '502', '503',
    'crash', 'crashed', 'offline', 'dead', 'reboot', 'restarting', 'failover', 'panic', 'oom'
  ],
  latency: [
    'latency', 'slow', 'degraded', 'sluggish', 'spike', 'lag', 'high response time',
    'p99', 'p95', 'ms', 'seconds', 'stall', 'hanging', 'bottleneck'
  ],
  data_integrity: [
    'corruption', 'corrupt', 'data loss', 'mismatch', 'checksum', 'missing records',
    'duplicate transaction', 'inconsistent', 'drift', 'invalid state', 'poison pill'
  ],
  security: [
    'security', 'unauthorized', '401', '403', 'breach', 'leak', 'credential', 'token',
    'cve', 'vulnerability', 'ddos', 'malicious', 'certificate', 'expired ssl', 'tamper'
  ],
  infrastructure: [
    'disk full', 'disk', 'cpu', 'memory', 'k8s', 'node', 'hardware', 'filesystem',
    'pod eviction', 'cluster', 'packet drop', 'network interface', 'dns', 'ebs'
  ],
  deployment: [
    'deploy', 'deployment', 'release', 'rollout', 'rollback', 'bad commit', 'ci/cd',
    'pipeline', 'helm', 'docker image', 'version upgrade', 'migration'
  ],
};

// Known service patterns mapped to target teams
const SERVICE_TEAM_PATTERNS = {
  'edge': 'Edge & CDN',
  'cdn': 'Edge & CDN',
  'envoy': 'Edge & CDN',
  'ingress': 'Edge & CDN',
  'gateway': 'Edge & CDN',
  'payment': 'Payments Core',
  'checkout': 'Payments Core',
  'billing': 'Payments Core',
  'stripe': 'Payments Core',
  'ledger': 'Payments Core',
  'postgres': 'Database Ops',
  'database': 'Database Ops',
  'mongo': 'Database Ops',
  'redis': 'Database Ops',
  'db': 'Database Ops',
  'identity': 'Identity Service',
  'auth': 'Identity Service',
  'oauth': 'Identity Service',
  'iam': 'Identity Service',
  'user': 'Identity Service',
};

/**
 * Deterministic baseline recommendation engine
 * Employs explainable heuristic rule matching and deterministic ITIL priority matrix
 */
export async function getDeterministicRecommendations({
  title = '',
  description = '',
  affectedService = '',
  impact = 'department',
  urgency = 'moderate',
  reproductionSteps = '',
  category = null,
}) {
  const combinedText = `${title} ${description} ${reproductionSteps}`.toLowerCase();
  const tokens = tokenize(combinedText);
  const evidence = [];

  // 1. Determine Category
  const categoryScores = {
    availability: 0,
    latency: 0,
    data_integrity: 0,
    security: 0,
    infrastructure: 0,
    deployment: 0,
  };
  const categoryMatchedTokens = {};

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    categoryMatchedTokens[cat] = [];
    for (const kw of keywords) {
      if (combinedText.includes(kw)) {
        categoryScores[cat] += 2;
        categoryMatchedTokens[cat].push(kw);
      }
    }
  }

  // Find top scoring category
  let topCategory = 'availability';
  let topScore = categoryScores.availability;

  for (const [cat, score] of Object.entries(categoryScores)) {
    if (score > topScore) {
      topScore = score;
      topCategory = cat;
    }
  }

  if (topScore > 0) {
    const matchedStr = categoryMatchedTokens[topCategory].slice(0, 4).join(', ');
    evidence.push(`Category '${topCategory}' indicated by error terms: [${matchedStr}]`);
  } else {
    topCategory = category || 'availability';
    evidence.push(`Category defaulted to '${topCategory}' based on standard system availability baseline`);
  }

  // 2. Determine Priority deterministically from Impact & Urgency Matrix
  const priorityCalc = calculatePriority(impact, urgency);
  evidence.push(`Deterministic ITIL Matrix calculation: Impact (${impact}) x Urgency (${urgency}) => ${priorityCalc.code} (${priorityCalc.label})`);

  // 3. Determine Resolver Team from Team ownership records & service keywords
  let recommendedTeam = 'Platform SRE';
  let teamMatchFound = false;

  const normalizedService = (affectedService || '').toLowerCase().trim();

  // A. Check live MongoDB Team service registry if available and connected
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const teams = await Team.find().maxTimeMS(1000);
      for (const t of teams) {
        const matchInServices = t.services?.some((s) => normalizedService.includes(s.toLowerCase()) || s.toLowerCase().includes(normalizedService));
        if (matchInServices) {
          recommendedTeam = t.name;
          teamMatchFound = true;
          evidence.push(`Service ownership match: Team '${t.name}' is registered owner for '${affectedService}'`);
          break;
        }
      }
    } catch (err) {
      // If DB unavailable during isolated tests, proceed to heuristic patterns
    }
  }

  // B. Heuristic service-to-team keyword mapping if no exact DB match
  if (!teamMatchFound) {
    for (const [pattern, team] of Object.entries(SERVICE_TEAM_PATTERNS)) {
      if (normalizedService.includes(pattern) || combinedText.includes(pattern)) {
        recommendedTeam = team;
        teamMatchFound = true;
        evidence.push(`Service pattern match: keyword '${pattern}' routes to '${team}'`);
        break;
      }
    }
  }

  if (!teamMatchFound) {
    evidence.push(`Default fallback routing: unmapped service '${affectedService || 'general'}' assigned to 'Platform SRE'`);
  }

  // Calculate uncalibrated heuristic match score
  const totalEvidenceCount = evidence.length;
  const matchSignalScore = Math.min(0.95, Math.max(0.60, 0.55 + topScore * 0.05 + (teamMatchFound ? 0.20 : 0.05)));

  return {
    suggestedCategory: topCategory,
    suggestedPriority: priorityCalc.code,
    suggestedTeam: recommendedTeam,
    explanation: `Heuristic rule match identified ${topCategory} degradation on '${affectedService || 'system'}' routed to ${recommendedTeam} under ITIL ${priorityCalc.code}.`,
    evidence,
    confidenceInfo: {
      heuristicMatchScore: Math.round(matchSignalScore * 100) / 100,
      confidenceLevel: matchSignalScore >= 0.80 ? 'high' : matchSignalScore >= 0.65 ? 'medium' : 'low',
      confidenceType: 'heuristic_match_strength_uncalibrated',
      disclaimer: 'Heuristic match score reflecting keyword and service ownership rule density, not a calibrated statistical probability.',
    },
    classificationMethod: 'deterministic_rule_heuristic',
  };
}
