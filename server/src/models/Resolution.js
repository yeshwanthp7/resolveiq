import mongoose from 'mongoose';

const resolutionSchema = new mongoose.Schema(
  {
    incidentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      required: [true, 'Incident reference is required'],
      unique: true,
      index: true,
    },
    rootCauseCategory: {
      type: String,
      enum: {
        values: [
          'code_defect',
          'configuration_drift',
          'hardware_failure',
          'third_party_outage',
          'capacity_exhaustion',
          'security_incident',
          'human_error',
        ],
        message: '{VALUE} is not a recognized root cause category',
      },
      required: [true, 'Root cause category is required'],
    },
    summary: {
      type: String,
      required: [true, 'Resolution summary is required'],
      trim: true,
    },
    remediationSteps: {
      type: [String],
      required: [true, 'Remediation steps are required'],
      validate: [(val) => Array.isArray(val) && val.length > 0, 'At least one remediation step is required'],
    },
    preventativeActions: {
      type: [String],
      default: [],
    },
    mitigatedAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: Date.now,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Resolving user is required'],
    },
    runbookUrl: {
      type: String,
      default: '',
    },
    isVerified: {
      type: Boolean,
      default: true,
      index: true,
    },
    isOutdated: {
      type: Boolean,
      default: false,
      index: true,
    },
    outdatedReason: {
      type: String,
      default: '',
    },
    outdatedFlaggedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    outdatedFlaggedAt: {
      type: Date,
      default: null,
    },
    verificationStatus: {
      type: String,
      enum: ['verified', 'pending_verification', 'disputed', 'outdated'],
      default: 'verified',
      index: true,
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: Date.now,
    },
    confirmedRootCause: {
      type: String,
      default: '',
    },
    confirmedOutcome: {
      type: String,
      default: '',
    },
    verificationNotes: {
      type: String,
      default: '',
    },
    successFeedbackCount: {
      type: Number,
      default: 0,
      index: true,
    },
    failureFeedbackCount: {
      type: Number,
      default: 0,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

resolutionSchema.index({ summary: 'text', confirmedRootCause: 'text' });

const Resolution = mongoose.model('Resolution', resolutionSchema);
export default Resolution;
