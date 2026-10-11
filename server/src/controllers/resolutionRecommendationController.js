import mongoose from 'mongoose';
import Incident from '../models/Incident.js';
import AuditLog from '../models/AuditLog.js';
import Resolution from '../models/Resolution.js';
import RecommendationFeedback from '../models/RecommendationFeedback.js';
import { getEvidenceBackedResolutionRecommendation } from '../services/resolutionRecommendationService.js';
import { searchVerifiedResolutions } from '../services/knowledgeBaseService.js';
import { normalizeRole } from '../middleware/auth.js';

/**
 * 1. Generates an evidence-backed resolution recommendation for an existing incident
 */
export async function getResolutionRecommendation(req, res, next) {
  try {
    const { id } = req.params;
    const query = id.startsWith('INC-') ? { incidentNumber: id } : { _id: id };

    const incident = await Incident.findOne(query);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const recommendation = await getEvidenceBackedResolutionRecommendation(incident);

    res.status(200).json({
      success: true,
      incidentNumber: incident.incidentNumber,
      recommendation,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. Phase 10: Records engineer decision on resolution recommendation
 * Captures recommendation source, historical evidence used, fix attempted, fix worked,
 * engineer-confirmed root cause, and verified resolution.
 * Strictly enforces cross-team authorization to prevent one user's feedback from modifying another team's records.
 */
export async function submitResolutionFeedback(req, res, next) {
  try {
    const { id } = req.params;
    const query = id.startsWith('INC-') ? { incidentNumber: id } : { _id: id };

    const incident = await Incident.findOne(query);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    // Role-based boundary & team restriction check
    const userRole = normalizeRole(req.user.role);
    if (userRole === 'end_user') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: End users cannot submit resolution recommendation feedback.',
      });
    }

    if (userRole === 'support_engineer') {
      const isTeamIncident = incident.assignedTeam === req.user.team;
      const isAssigned =
        incident.assignee &&
        (incident.assignee._id || incident.assignee).toString() === req.user._id.toString();

      if (!isTeamIncident && !isAssigned) {
        return res.status(403).json({
          success: false,
          error:
            'Access denied: Support Engineers can only record resolution feedback for incidents assigned to their team or directly to them.',
        });
      }
    }

    const {
      decision, // 'accepted' | 'edited' | 'rejected'
      recommendationSource = 'gemini_ai_copilot',
      historicalEvidenceUsed = [],
      fixAttempted = true,
      fixWorked = true,
      rejectionReason = '',
      probableRootCause = '',
      confirmedRootCause = '',
      confirmedOutcome = '',
      feedbackNotes = '',
      selectedRemediationSteps = [],
      preventativeActions = [],
    } = req.body;

    if (!decision || !['accepted', 'edited', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        error: "Decision must be one of: 'accepted', 'edited', 'rejected'",
      });
    }

    let auditAction = 'RESOLUTION_RECOMMENDATION_ACCEPTED';
    let hypothesisStatus = 'approved';

    if (decision === 'rejected') {
      auditAction = 'RESOLUTION_RECOMMENDATION_REJECTED';
      hypothesisStatus = 'rejected';
    } else if (decision === 'edited') {
      auditAction = 'RESOLUTION_RECOMMENDATION_OVERRIDDEN';
      hypothesisStatus = 'approved';
    }

    // 1. Keep AI-generated hypothesis separate from confirmed incident facts
    incident.aiHypothesis = {
      hypothesisText: probableRootCause || '',
      evidencePoints: req.body.evidencePoints || [],
      recommendedRunbook: selectedRemediationSteps || [],
      status: hypothesisStatus,
      reviewedBy: req.user._id,
    };

    // If accepted or edited, record engineer-confirmed cause & outcome into investigation notes
    const finalCause = confirmedRootCause || probableRootCause || 'Investigated root cause';
    const finalOutcome = confirmedOutcome || 'Engineer verified remediation steps applied';

    const noteDetails = `[Verified Resolution Review - ${decision.toUpperCase()}]: Fix Attempted: ${fixAttempted ? 'Yes' : 'No'}, Fix Worked: ${fixWorked ? 'Yes' : 'No'}. Confirmed Root Cause: "${finalCause}". Outcome: "${finalOutcome}". Notes: ${feedbackNotes || 'None'}`;

    incident.investigationNotes.push({
      authorId: req.user._id,
      authorName: req.user.name,
      authorRole: req.user.role,
      note: noteDetails,
      createdAt: new Date(),
    });

    await incident.save();

    // 2. Format historical evidence references
    const formattedEvidence = (historicalEvidenceUsed || []).map((e) => {
      if (typeof e === 'string') {
        return { ticketId: e, incidentNumber: e };
      }
      return {
        ticketId: e.ticketId || e.incidentNumber || '',
        incidentNumber: e.incidentNumber || e.ticketId || '',
        similarityScore: e.similarityScore || 0,
        rootCauseCategory: e.rootCauseCategory || '',
        matchingEvidence: e.matchingEvidence || [],
      };
    });

    // 3. Create RecommendationFeedback document (Phase 10 Learning Loop Record)
    const feedbackRecord = await RecommendationFeedback.create({
      incidentId: incident._id,
      recommendationType: 'resolution_recommendation',
      recommendationSource,
      historicalEvidenceUsed: formattedEvidence,
      decision,
      fixAttempted: Boolean(fixAttempted),
      fixWorked: decision === 'rejected' ? false : Boolean(fixWorked),
      rejectionReason: decision === 'rejected' ? (rejectionReason || 'wrong_root_cause') : '',
      suggestedHypothesis: probableRootCause || '',
      suggestedRemediationSteps: selectedRemediationSteps || [],
      engineerConfirmedRootCause: finalCause,
      verifiedResolution: finalOutcome,
      appliedRemediationSteps: selectedRemediationSteps || [],
      reviewerId: req.user._id,
      reviewerName: req.user.name,
      reviewerRole: req.user.role,
      reviewerTeam: req.user.team || '',
      incidentTeam: incident.assignedTeam || '',
      feedbackNotes: feedbackNotes || '',
      timestamp: new Date(),
    });

    // 4. Update success/failure feedback counts on referenced historical resolutions
    const referencedTicketNumbers = formattedEvidence
      .map((e) => e.incidentNumber || e.ticketId)
      .filter(Boolean);

    if (referencedTicketNumbers.length > 0) {
      const matchedIncidents = await Incident.find({
        incidentNumber: { $in: referencedTicketNumbers },
      }).select('_id');
      const matchedIncIds = matchedIncidents.map((i) => i._id);

      if (matchedIncIds.length > 0) {
        const isSuccess = decision !== 'rejected' && Boolean(fixWorked);
        const updateOp = isSuccess
          ? { $inc: { successFeedbackCount: 1 } }
          : { $inc: { failureFeedbackCount: 1 } };

        await Resolution.updateMany({ incidentId: { $in: matchedIncIds } }, updateOp);
      }
    }

    // 5. Create immutable Audit Log entry
    await AuditLog.create({
      incidentId: incident._id,
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: auditAction,
      newState: {
        decision,
        fixAttempted,
        fixWorked,
        rejectionReason: decision === 'rejected' ? rejectionReason : null,
        confirmedRootCause: finalCause,
        confirmedOutcome: finalOutcome,
        hypothesisStatus,
      },
      reason: `Resolution recommendation ${decision} by ${req.user.name} (Worked: ${fixWorked ? 'Yes' : 'No'}): ${feedbackNotes || 'Review completed'}`,
    });

    res.status(200).json({
      success: true,
      message: `Resolution recommendation decision recorded as ${decision}.`,
      feedback: feedbackRecord,
      incident,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. Flag a historical resolution as outdated or disputed
 * Allows authorized engineers to flag outdated resolutions so they receive ranking penalties
 */
export async function flagResolutionOutdated(req, res, next) {
  try {
    const { id } = req.params;
    const { reason = 'Outdated procedure' } = req.body;

    let resolution = null;
    if (mongoose.isValidObjectId(id)) {
      resolution = await Resolution.findById(id);
    }
    if (!resolution) {
      // Try finding by incidentNumber or incidentId
      const inc = await Incident.findOne({
        $or: [{ incidentNumber: id }, ...(mongoose.isValidObjectId(id) ? [{ _id: id }] : [])],
      });
      if (inc) {
        resolution = await Resolution.findOne({ incidentId: inc._id });
      }
    }

    if (!resolution) {
      return res.status(404).json({ success: false, error: 'Resolution record not found.' });
    }

    resolution.isOutdated = true;
    resolution.outdatedReason = reason;
    resolution.verificationStatus = 'outdated';
    resolution.outdatedFlaggedBy = req.user._id;
    resolution.outdatedFlaggedAt = new Date();

    await resolution.save();

    await AuditLog.create({
      incidentId: resolution.incidentId,
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'RESOLUTION_FLAGGED_OUTDATED',
      reason: `Flagged as outdated by ${req.user.name}: ${reason}`,
      newState: { isOutdated: true, outdatedReason: reason, verificationStatus: 'outdated' },
    });

    res.status(200).json({
      success: true,
      message: 'Resolution flagged as outdated. It will receive a ranking penalty in retrieval.',
      resolution,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 4. Re-verify an outdated resolution (clear outdated flag)
 */
export async function unflagResolution(req, res, next) {
  try {
    const { id } = req.params;

    let resolution = null;
    if (mongoose.isValidObjectId(id)) {
      resolution = await Resolution.findById(id);
    }
    if (!resolution) {
      const inc = await Incident.findOne({
        $or: [{ incidentNumber: id }, ...(mongoose.isValidObjectId(id) ? [{ _id: id }] : [])],
      });
      if (inc) {
        resolution = await Resolution.findOne({ incidentId: inc._id });
      }
    }

    if (!resolution) {
      return res.status(404).json({ success: false, error: 'Resolution record not found.' });
    }

    resolution.isOutdated = false;
    resolution.outdatedReason = '';
    resolution.verificationStatus = 'verified';

    await resolution.save();

    await AuditLog.create({
      incidentId: resolution.incidentId,
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'RESOLUTION_REVERIFIED',
      reason: `Resolution re-verified by ${req.user.name}`,
      newState: { isOutdated: false, verificationStatus: 'verified' },
    });

    res.status(200).json({
      success: true,
      message: 'Resolution re-verified and returned to normal retrieval priority.',
      resolution,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 5. Phase 10: Feedback & Resolution Learning Loop Analytics
 * Aggregates reviews, acceptance/rejection counts, fix success rates, and resolutions requiring review
 */
export async function getFeedbackAnalytics(req, res, next) {
  try {
    const [allFeedback, resolutions] = await Promise.all([
      RecommendationFeedback.find().sort({ createdAt: -1 }).lean(),
      Resolution.find().populate('incidentId', 'incidentNumber title affectedService').lean(),
    ]);

    const totalReviewed = allFeedback.length;
    const acceptedCount = allFeedback.filter((f) => f.decision === 'accepted').length;
    const editedCount = allFeedback.filter((f) => f.decision === 'edited').length;
    const rejectedCount = allFeedback.filter((f) => f.decision === 'rejected').length;

    const attemptedCount = allFeedback.filter((f) => f.fixAttempted).length;
    const workedCount = allFeedback.filter((f) => f.fixAttempted && f.fixWorked).length;

    const fixSuccessRate =
      attemptedCount > 0 ? Number(((workedCount / attemptedCount) * 100).toFixed(1)) : 0;
    const acceptanceRate =
      totalReviewed > 0 ? Number(((acceptedCount / totalReviewed) * 100).toFixed(1)) : 0;
    const rejectionRate =
      totalReviewed > 0 ? Number(((rejectedCount / totalReviewed) * 100).toFixed(1)) : 0;

    // Common rejection reasons breakdown
    const rejectionReasonMap = {};
    for (const f of allFeedback) {
      if (f.decision === 'rejected' && f.rejectionReason) {
        rejectionReasonMap[f.rejectionReason] = (rejectionReasonMap[f.rejectionReason] || 0) + 1;
      }
    }

    // Historical resolutions requiring review (flagged outdated or multiple failures)
    const resolutionsRequiringReview = resolutions
      .filter((r) => r.isOutdated || r.verificationStatus === 'outdated' || r.failureFeedbackCount >= 2)
      .map((r) => ({
        resolutionId: r._id,
        incidentNumber: r.incidentId?.incidentNumber || 'N/A',
        title: r.incidentId?.title || r.summary,
        affectedService: r.incidentId?.affectedService || '',
        rootCauseCategory: r.rootCauseCategory,
        summary: r.summary,
        isOutdated: Boolean(r.isOutdated),
        outdatedReason: r.outdatedReason || '',
        verificationStatus: r.verificationStatus,
        failureFeedbackCount: r.failureFeedbackCount || 0,
        successFeedbackCount: r.successFeedbackCount || 0,
        flaggedAt: r.outdatedFlaggedAt,
      }));

    res.status(200).json({
      success: true,
      analytics: {
        recommendationsReviewed: totalReviewed,
        acceptanceCount: acceptedCount,
        editedCount: editedCount,
        rejectionCount: rejectedCount,
        acceptanceRate,
        rejectionRate,
        verifiedResolutionOutcomes: {
          fixesAttemptedCount: attemptedCount,
          fixesWorkedCount: workedCount,
          fixSuccessRate,
        },
        retrievalQualityIndicators: {
          usefulnessRate:
            totalReviewed > 0
              ? Number((((acceptedCount + editedCount) / totalReviewed) * 100).toFixed(1))
              : 0,
          totalVerifiedCasesInKnowledgeBase: resolutions.filter((r) => !r.isOutdated).length,
        },
        commonRejectionReasons: rejectionReasonMap,
        historicalResolutionsRequiringReview: resolutionsRequiringReview,
        learningLoopPolicy: {
          improvesRetrievalRanking: true,
          retrainsGemini: false,
          explanation:
            'Application deterministically tunes retrieval weighting and feedback boosts based on verified engineer decisions. The underlying Google Gemini model is NOT automatically retrained from unreviewed feedback.',
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 6. Searches knowledge base of verified resolutions
 */
export async function searchKnowledgeBaseEndpoint(req, res, next) {
  try {
    const { q, service, limit = 5, threshold = 0.35 } = req.query;

    const targetInput = {
      title: q || '',
      description: q || '',
      affectedService: service || '',
    };

    const results = await searchVerifiedResolutions(targetInput, {
      threshold: parseFloat(threshold),
      limit: parseInt(limit, 10),
    });

    res.status(200).json({
      success: true,
      query: q || '',
      service: service || '',
      ...results,
    });
  } catch (err) {
    next(err);
  }
}
