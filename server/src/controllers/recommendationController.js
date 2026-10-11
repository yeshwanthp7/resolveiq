import Incident from '../models/Incident.js';
import AuditLog from '../models/AuditLog.js';
import RecommendationFeedback from '../models/RecommendationFeedback.js';
import { getGeminiAssistedRecommendations } from '../services/geminiService.js';
import { detectDuplicateIncidents } from '../services/duplicateDetector.js';
import { normalizeRole } from '../middleware/auth.js';

/**
 * Generates structured recommendations and searches for suspected duplicate incidents.
 * Can be called during ticket drafting in the intake form or on an existing ticket.
 */
export async function getRecommendations(req, res, next) {
  try {
    const { title, description, affectedService, impact, urgency, reproductionSteps, category } = req.body;

    const incidentInput = {
      title: title || '',
      description: description || '',
      affectedService: affectedService || '',
      impact: impact || 'department',
      urgency: urgency || 'moderate',
      reproductionSteps: reproductionSteps || '',
      category: category || null,
    };

    // 1. Get structured classification, prioritization & routing recommendations
    const recommendation = await getGeminiAssistedRecommendations(incidentInput);

    // 2. Scan corpus for potential duplicate tickets
    const duplicateCandidates = await detectDuplicateIncidents(incidentInput, {
      threshold: 0.65,
      maxResults: 5,
    });

    res.status(200).json({
      success: true,
      recommendation,
      duplicateCandidates,
      duplicateCount: duplicateCandidates.filter((d) => d.isSuspectedDuplicate).length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Retrieves recommendations and duplicate scan for an existing incident by ID or INC-number
 */
export async function getIncidentRecommendations(req, res, next) {
  try {
    const { id } = req.params;
    const query = id.startsWith('INC-') ? { incidentNumber: id } : { _id: id };

    const incident = await Incident.findOne(query);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const recommendation = await getGeminiAssistedRecommendations(incident);
    const duplicateCandidates = await detectDuplicateIncidents(incident, {
      threshold: 0.65,
      maxResults: 5,
    });

    res.status(200).json({
      success: true,
      incidentNumber: incident.incidentNumber,
      recommendation,
      duplicateCandidates,
      duplicateCount: duplicateCandidates.filter((d) => d.isSuspectedDuplicate).length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Records responder feedback on suggestions (Accept, Edit, Reject)
 * Updates incident properties if accepted/edited, persists RecommendationFeedback,
 * and records immutable AuditLog entry.
 */
export async function submitRecommendationFeedback(req, res, next) {
  try {
    const { id } = req.params;
    const {
      decision, // 'accepted' | 'edited' | 'rejected'
      method, // 'rule_based' | 'ai_assisted' | 'manually_overridden'
      suggestedCategory,
      suggestedPriority,
      suggestedTeam,
      finalCategory,
      finalPriority,
      finalTeam,
      explanation,
      evidence,
      feedbackNotes,
      scoreGiven,
    } = req.body;

    if (!decision || !['accepted', 'edited', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        error: "Decision is required and must be one of: 'accepted', 'edited', 'rejected'",
      });
    }

    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const chosenMethod = method || 'rule_based';

    // Persist feedback document
    const feedback = await RecommendationFeedback.create({
      incidentId: incident._id,
      recommendationType: 'classification_and_routing',
      suggestedCategory: suggestedCategory || '',
      suggestedPriority: suggestedPriority || '',
      suggestedTeam: suggestedTeam || '',
      finalCategory: finalCategory || incident.category,
      finalPriority: finalPriority || incident.priority,
      finalTeam: finalTeam || incident.assignedTeam,
      decision,
      method: chosenMethod,
      explanation: explanation || '',
      evidence: Array.isArray(evidence) ? evidence : [],
      reviewerId: req.user._id,
      reviewerName: req.user.name,
      feedbackNotes: feedbackNotes || '',
      scoreGiven: scoreGiven || null,
    });

    // If accepted or edited, apply suggested/final values to incident
    let auditAction = 'RECOMMENDATION_ACCEPTED';
    if (decision === 'rejected') {
      auditAction = 'RECOMMENDATION_REJECTED';
    } else if (decision === 'edited' || chosenMethod === 'manually_overridden') {
      auditAction = 'RECOMMENDATION_OVERRIDDEN';
    }

    if (decision === 'accepted' || decision === 'edited') {
      const prevProps = {
        category: incident.category,
        priority: incident.priority,
        assignedTeam: incident.assignedTeam,
      };

      if (finalCategory) incident.category = finalCategory;
      if (finalPriority) incident.priority = finalPriority;
      if (finalTeam) incident.assignedTeam = finalTeam;

      await incident.save();

      await AuditLog.create({
        incidentId: incident._id,
        actorId: req.user._id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: auditAction,
        previousState: prevProps,
        newState: {
          category: incident.category,
          priority: incident.priority,
          assignedTeam: incident.assignedTeam,
          method: chosenMethod,
          decision,
        },
        reason: `Recommendation ${decision} via ${chosenMethod}: ${feedbackNotes || explanation || 'Triage review completed'}`,
      });
    } else {
      await AuditLog.create({
        incidentId: incident._id,
        actorId: req.user._id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: auditAction,
        newState: { decision: 'rejected', method: chosenMethod },
        reason: `Recommendation rejected: ${feedbackNotes || 'Responder declined suggestion'}`,
      });
    }

    res.status(200).json({
      success: true,
      message: `Recommendation feedback recorded as ${decision} (${chosenMethod}).`,
      feedback,
      incident,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Dedicated duplicate search endpoint
 */
export async function getDuplicates(req, res, next) {
  try {
    const { id } = req.params;
    const query = id.startsWith('INC-') ? { incidentNumber: id } : { _id: id };

    const incident = await Incident.findOne(query);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const duplicates = await detectDuplicateIncidents(incident, { threshold: 0.60 });

    res.status(200).json({
      success: true,
      incidentNumber: incident.incidentNumber,
      duplicates,
      duplicateCount: duplicates.length,
    });
  } catch (err) {
    next(err);
  }
}
