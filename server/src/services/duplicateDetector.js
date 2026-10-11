import Incident from '../models/Incident.js';
import {
  buildCorpusStats,
  computeTfIdfVector,
  calculateCosineSimilarity,
} from './textProcessing.js';

export const DUPLICATE_CONFIDENCE_THRESHOLD = 0.65;

/**
 * Combines incident fields into a cohesive text representation for lexical matching
 */
export function incidentToDocumentText(inc) {
  const parts = [
    inc.title || '',
    inc.affectedService || '',
    inc.description || '',
    inc.reproductionSteps || '',
    inc.category || '',
  ];
  if (inc.classificationMetadata?.tags) {
    parts.push(inc.classificationMetadata.tags.join(' '));
  }
  return parts.join(' ').trim();
}

/**
 * Searches existing incidents in database for suspected duplicates using TF-IDF and Cosine similarity.
 * Never automatically deletes or merges tickets. Returns candidate matches for engineer inspection.
 */
export async function detectDuplicateIncidents(targetIncident, { threshold = DUPLICATE_CONFIDENCE_THRESHOLD, maxResults = 5 } = {}) {
  const targetId = targetIncident._id ? targetIncident._id.toString() : null;
  const targetText = incidentToDocumentText(targetIncident);

  if (!targetText.trim()) {
    return [];
  }

  // Retrieve candidate incidents from MongoDB (all recent or active incidents, excluding self)
  const query = {};
  if (targetId) {
    query._id = { $ne: targetIncident._id };
  }

  const existingIncidents = await Incident.find(query)
    .select('incidentNumber title affectedService description reproductionSteps category status priority createdAt')
    .sort({ createdAt: -1 })
    .limit(100);

  if (existingIncidents.length === 0) {
    return [];
  }

  // Construct corpus including all historical incidents plus current target
  const corpusDocs = existingIncidents.map(incidentToDocumentText);
  corpusDocs.push(targetText);

  const corpusStats = buildCorpusStats(corpusDocs);
  const targetVector = computeTfIdfVector(targetText, corpusStats);

  const scoredCandidates = [];

  for (const candidate of existingIncidents) {
    const candidateText = incidentToDocumentText(candidate);
    const candidateVector = computeTfIdfVector(candidateText, corpusStats);
    const { similarity, matchedEvidence } = calculateCosineSimilarity(targetVector, candidateVector);

    // Boost similarity slightly if affected services match exactly
    let adjustedSimilarity = similarity;
    if (
      targetIncident.affectedService &&
      candidate.affectedService &&
      targetIncident.affectedService.toLowerCase().trim() === candidate.affectedService.toLowerCase().trim()
    ) {
      adjustedSimilarity = Math.min(1.0, similarity * 1.1 + 0.05);
    }
    adjustedSimilarity = Math.round(adjustedSimilarity * 1000) / 1000;

    if (adjustedSimilarity >= 0.35) { // Filter out purely zero or trivial noise
      scoredCandidates.push({
        candidateId: candidate._id,
        incidentNumber: candidate.incidentNumber,
        title: candidate.title,
        affectedService: candidate.affectedService,
        status: candidate.status,
        priority: candidate.priority,
        createdAt: candidate.createdAt,
        similarityScore: adjustedSimilarity,
        matchingEvidence: matchedEvidence.slice(0, 6),
        isSuspectedDuplicate: adjustedSimilarity >= threshold,
      });
    }
  }

  // Sort by similarity score descending
  scoredCandidates.sort((a, b) => b.similarityScore - a.similarityScore);

  return scoredCandidates.slice(0, maxResults);
}
