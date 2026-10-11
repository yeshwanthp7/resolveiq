import mongoose from 'mongoose';
import Incident from '../models/Incident.js';
import Resolution from '../models/Resolution.js';
import {
  buildCorpusStats,
  computeTfIdfVector,
  calculateCosineSimilarity,
} from './textProcessing.js';

export const RELEVANCE_THRESHOLD = 0.35;
export const SUFFICIENT_EVIDENCE_THRESHOLD = 0.40;

/**
 * Combines incident and resolution fields into a unified document text representation for lexical matching
 */
export function caseToKnowledgeText(inc, res) {
  const parts = [
    inc.title || '',
    inc.affectedService || '',
    inc.description || '',
    inc.category || '',
  ];
  if (res) {
    parts.push(res.rootCauseCategory || '');
    parts.push(res.summary || '');
    if (Array.isArray(res.remediationSteps)) {
      parts.push(res.remediationSteps.join(' '));
    }
    if (Array.isArray(res.preventativeActions)) {
      parts.push(res.preventativeActions.join(' '));
    }
    if (res.confirmedRootCause) parts.push(res.confirmedRootCause);
  }
  return parts.join(' ').trim();
}

/**
 * Searches and ranks verified historical resolutions against a target incident or search query.
 * Strictly filters for verified resolutions (`isVerified: true`).
 */
export async function searchVerifiedResolutions(targetInput, {
  threshold = RELEVANCE_THRESHOLD,
  limit = 5,
  excludeId = null,
} = {}) {
  // 1. Prepare target search string
  let targetText = '';
  let targetService = '';

  if (typeof targetInput === 'string') {
    targetText = targetInput;
  } else if (targetInput && typeof targetInput === 'object') {
    targetText = [
      targetInput.title || '',
      targetInput.affectedService || '',
      targetInput.description || '',
      targetInput.reproductionSteps || '',
      targetInput.category || '',
    ].join(' ').trim();
    targetService = (targetInput.affectedService || '').toLowerCase().trim();
  }

  if (!targetText.trim()) {
    return {
      hasSufficientEvidence: false,
      candidates: [],
      totalVerifiedCases: 0,
    };
  }

  // 2. Query MongoDB for verified resolutions on closed/resolved incidents
  const incidentQuery = {
    status: { $in: ['resolved', 'closed'] },
  };
  if (excludeId) {
    incidentQuery._id = { $ne: excludeId };
  }

  let historicalIncidents = [];
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    historicalIncidents = await Incident.find(incidentQuery)
      .select('incidentNumber title affectedService description category status priority createdAt')
      .lean();
  }

  if (historicalIncidents.length === 0) {
    return {
      hasSufficientEvidence: false,
      candidates: [],
      totalVerifiedCases: 0,
    };
  }

  const incidentIds = historicalIncidents.map((i) => i._id);
  const resolutions = await Resolution.find({
    incidentId: { $in: incidentIds },
    isVerified: true, // Strictly confirmed resolutions only
  }).lean();

  const resolutionMap = new Map();
  for (const r of resolutions) {
    resolutionMap.set(r.incidentId.toString(), r);
  }

  // Filter to incidents that have an active verified resolution
  const verifiedCases = [];
  for (const inc of historicalIncidents) {
    const res = resolutionMap.get(inc._id.toString());
    if (res) {
      verifiedCases.push({ incident: inc, resolution: res });
    }
  }

  if (verifiedCases.length === 0) {
    return {
      hasSufficientEvidence: false,
      candidates: [],
      totalVerifiedCases: 0,
    };
  }

  // 3. Build TF-IDF corpus across verified historical cases + current target
  const corpusDocs = verifiedCases.map((c) => caseToKnowledgeText(c.incident, c.resolution));
  corpusDocs.push(targetText);

  const corpusStats = buildCorpusStats(corpusDocs);
  const targetVector = computeTfIdfVector(targetText, corpusStats);

  // 4. Score and rank candidates using documented relevance criteria
  const scoredCandidates = [];

  for (const { incident: inc, resolution: res } of verifiedCases) {
    const caseText = caseToKnowledgeText(inc, res);
    const caseVector = computeTfIdfVector(caseText, corpusStats);
    const { similarity, matchedEvidence } = calculateCosineSimilarity(targetVector, caseVector);

    // Documented Relevance Criteria:
    // A. Base TF-IDF Cosine Similarity
    // B. Service Match Boost (+0.08 if affected services match)
    // C. Phase 10 Deterministic Learning Loop Outcome Adjustments:
    //    - Verified successful resolutions with matching service receive ranking preference (+0.05 to +0.15)
    //    - Repeatedly failed/rejected resolutions receive ranking penalty (-0.08 to -0.25)
    //    - Outdated/disputed resolutions receive heavy ranking penalty (-0.40)
    let adjustedScore = similarity;
    const incService = (inc.affectedService || '').toLowerCase().trim();
    const isServiceMatch = Boolean(targetService && incService && targetService === incService);

    if (isServiceMatch) {
      adjustedScore = Math.min(1.0, adjustedScore * 1.15 + 0.08);
    }

    const successCount = res.successFeedbackCount || 0;
    const failureCount = res.failureFeedbackCount || 0;
    const isOutdated = Boolean(res.isOutdated || res.verificationStatus === 'outdated');

    let outcomeBoost = 0;
    let outcomePenalty = 0;
    let outdatedPenalty = 0;

    if (successCount > 0) {
      outcomeBoost = Math.min(0.15, successCount * 0.05);
      if (isServiceMatch) {
        outcomeBoost = Math.min(0.20, outcomeBoost + 0.05);
      }
    }

    if (failureCount > 0) {
      outcomePenalty = Math.min(0.25, failureCount * 0.08);
    }

    if (isOutdated) {
      outdatedPenalty = 0.20;
    }

    adjustedScore = Math.max(0.01, Math.min(1.0, adjustedScore + outcomeBoost - outcomePenalty - outdatedPenalty));
    adjustedScore = Math.round(adjustedScore * 1000) / 1000;

    if (adjustedScore >= threshold) {
      scoredCandidates.push({
        incidentId: inc._id,
        incidentNumber: inc.incidentNumber,
        title: inc.title,
        affectedService: inc.affectedService,
        category: inc.category,
        priority: inc.priority,
        status: inc.status,
        rootCauseCategory: res.rootCauseCategory,
        summary: res.summary,
        remediationSteps: res.remediationSteps || [],
        preventativeActions: res.preventativeActions || [],
        runbookUrl: res.runbookUrl || '',
        confirmedRootCause: res.confirmedRootCause || '',
        similarityScore: adjustedScore,
        matchingEvidence: matchedEvidence.slice(0, 6),
        isVerified: true,
        resolvedAt: res.resolvedAt,
        isOutdated,
        outdatedReason: res.outdatedReason || '',
        feedbackOutcomes: {
          successCount,
          failureCount,
          outcomeBoostApplied: Math.round(outcomeBoost * 1000) / 1000,
          outcomePenaltyApplied: Math.round(outcomePenalty * 1000) / 1000,
          isOutdated,
        },
      });
    }
  }

  // Sort by similarity score descending
  scoredCandidates.sort((a, b) => b.similarityScore - a.similarityScore);

  const topCandidates = scoredCandidates.slice(0, limit);
  const topScore = topCandidates.length > 0 ? topCandidates[0].similarityScore : 0;
  const hasSufficientEvidence = topScore >= SUFFICIENT_EVIDENCE_THRESHOLD;

  return {
    hasSufficientEvidence,
    candidates: topCandidates,
    totalVerifiedCases: verifiedCases.length,
    topScore,
    learningLoop: {
      applied: true,
      rankingMethod: 'deterministic_outcome_weighting',
      explanation:
        'Application improves retrieval ranking deterministically by prioritizing verified successful historical fixes and penalizing outdated/disputed precedents. This adjusts local ranking scores only and does NOT retrain or fine-tune the underlying Google Gemini model.',
    },
  };
}
