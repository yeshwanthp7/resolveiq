import mongoose from 'mongoose';
import { getNextSequence } from './Sequence.js';

const incidentSchema = new mongoose.Schema(
  {
    incidentNumber: {
      type: String,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Incident title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      required: [true, 'Incident description is required'],
      trim: true,
    },
    reproductionSteps: {
      type: String,
      trim: true,
      default: '',
    },
    reporter: {
      type: mongoose.Schema.Types.Mixed,
      default: 'System Monitoring',
    },
    affectedService: {
      type: String,
      required: [true, 'Affected service is required'],
      trim: true,
      lowercase: true,
      index: true,
    },
    source: {
      type: String,
      enum: {
        values: ['manual', 'prometheus', 'datadog', 'cloudwatch', 'synthetic', 'webhook'],
        message: '{VALUE} is not a valid incident source',
      },
      default: 'manual',
      index: true,
    },
    category: {
      type: String,
      enum: {
        values: ['availability', 'latency', 'data_integrity', 'security', 'infrastructure', 'deployment'],
        message: '{VALUE} is not a valid incident category',
      },
      default: 'availability',
      index: true,
    },
    impact: {
      type: String,
      enum: ['enterprise', 'department', 'single_user'],
      required: [true, 'Impact severity is required'],
    },
    urgency: {
      type: String,
      enum: ['critical', 'moderate', 'low'],
      required: [true, 'Urgency level is required'],
    },
    priority: {
      type: String,
      enum: ['P1', 'P2', 'P3', 'P4', 'P5'],
      required: true,
      index: true,
    },
    priorityOverridden: {
      type: Boolean,
      default: false,
    },
    priorityOverrideReason: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: {
        values: [
          'triggered',
          'new',
          'acknowledged',
          'investigating',
          'in_progress',
          'mitigated',
          'resolved',
          'closed',
          'reopened',
        ],
        message: '{VALUE} is not a valid lifecycle status',
      },
      default: 'triggered',
      index: true,
    },
    assignedTeam: {
      type: String,
      default: 'Platform SRE',
      index: true,
    },
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
    mitigatedAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    reopenedAt: {
      type: Date,
      default: null,
    },
    reopenedCount: {
      type: Number,
      default: 0,
    },
    reopenReason: {
      type: String,
      default: '',
    },
    investigationNotes: [
      {
        authorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        authorName: {
          type: String,
          required: true,
        },
        authorRole: {
          type: String,
          default: 'support_engineer',
        },
        note: {
          type: String,
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    sla: {
      responseTargetMinutes: { type: Number, default: 240 },
      resolutionTargetMinutes: { type: Number, default: 1440 },
      responseDeadline: { type: Date, index: true },
      resolutionDeadline: { type: Date, index: true },
      isResponseBreached: { type: Boolean, default: false, index: true },
      isResolutionBreached: { type: Boolean, default: false, index: true },
    },
    relatedIncidents: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Incident',
      },
    ],
    classificationMetadata: {
      tags: { type: [String], default: [] },
      environment: {
        type: String,
        enum: ['production', 'staging', 'development'],
        default: 'production',
        index: true,
      },
      confidenceScore: { type: Number, default: 1.0 },
    },
    aiHypothesis: {
      hypothesisText: { type: String, default: null },
      evidencePoints: { type: [String], default: [] },
      recommendedRunbook: { type: [String], default: [] },
      status: {
        type: String,
        enum: ['none', 'pending_review', 'approved', 'rejected'],
        default: 'none',
      },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    externalEventId: {
      type: String,
      trim: true,
      default: null,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    integrationMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Compound text index for title and description similarity/search
incidentSchema.index({ title: 'text', description: 'text' });
incidentSchema.index({ source: 1, externalEventId: 1 }, { sparse: true });
incidentSchema.index({ idempotencyKey: 1 }, { sparse: true });

// Safe atomic ticket number generation on pre-save hook
incidentSchema.pre('save', async function (next) {
  if (!this.incidentNumber) {
    try {
      const nextNum = await getNextSequence('incidentNumber');
      this.incidentNumber = `INC-${nextNum}`;
    } catch (err) {
      // Fallback timestamp sequence if sequence collection is locked
      this.incidentNumber = `INC-${Date.now().toString().slice(-5)}`;
    }
  }
  next();
});

const Incident = mongoose.model('Incident', incidentSchema);
export default Incident;
