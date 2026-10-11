import mongoose from 'mongoose';

const recommendationFeedbackSchema = new mongoose.Schema(
  {
    incidentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      required: true,
      index: true,
    },
    recommendationType: {
      type: String,
      enum: [
        'resolution_recommendation',
        'root_cause_hypothesis',
        'classification_and_routing',
        'resolver_assignment',
        'runbook_suggestion',
      ],
      default: 'resolution_recommendation',
      index: true,
    },
    recommendationSource: {
      type: String,
      enum: ['gemini_ai_copilot', 'deterministic_kb', 'rule_based', 'historical_precedent'],
      default: 'gemini_ai_copilot',
      index: true,
    },
    // Historical precedent cases retrieved and presented to the model/user
    historicalEvidenceUsed: {
      type: [
        {
          ticketId: { type: String, default: '' },
          incidentNumber: { type: String, default: '' },
          similarityScore: { type: Number, default: 0 },
          rootCauseCategory: { type: String, default: '' },
          matchingEvidence: { type: [String], default: [] },
        },
      ],
      default: [],
    },
    // Engineer decision
    decision: {
      type: String,
      enum: ['accepted', 'edited', 'rejected'],
      required: true,
      index: true,
    },
    // Whether proposed fix was attempted
    fixAttempted: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Whether the proposed fix worked
    fixWorked: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Common rejection reasons
    rejectionReason: {
      type: String,
      enum: [
        'wrong_root_cause',
        'ineffective_remediation',
        'outdated_precedent',
        'harmful_steps',
        'insufficient_detail',
        'other',
        '',
      ],
      default: '',
      index: true,
    },
    // AI-generated hypothesis (kept separate from confirmed facts)
    suggestedHypothesis: {
      type: String,
      default: '',
    },
    suggestedRemediationSteps: {
      type: [String],
      default: [],
    },
    // Engineer-confirmed facts
    engineerConfirmedRootCause: {
      type: String,
      default: '',
    },
    verifiedResolution: {
      type: String,
      default: '',
    },
    appliedRemediationSteps: {
      type: [String],
      default: [],
    },
    // Triage fields (for backward compatibility with Phase 5 feedback)
    suggestedCategory: { type: String, default: '' },
    suggestedPriority: { type: String, default: '' },
    suggestedTeam: { type: String, default: '' },
    finalCategory: { type: String, default: '' },
    finalPriority: { type: String, default: '' },
    finalTeam: { type: String, default: '' },
    method: {
      type: String,
      enum: ['rule_based', 'ai_assisted', 'manually_overridden'],
      default: 'ai_assisted',
    },
    explanation: { type: String, default: '' },
    evidence: { type: [String], default: [] },
    // Authorized actor
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reviewerName: {
      type: String,
      default: 'Responder',
    },
    reviewerRole: {
      type: String,
      default: 'support_engineer',
    },
    reviewerTeam: {
      type: String,
      default: '',
    },
    incidentTeam: {
      type: String,
      default: '',
      index: true,
    },
    feedbackNotes: {
      type: String,
      default: '',
    },
    scoreGiven: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

recommendationFeedbackSchema.index({ incidentId: 1, recommendationType: 1, decision: 1 });

const RecommendationFeedback = mongoose.model('RecommendationFeedback', recommendationFeedbackSchema);
export default RecommendationFeedback;
