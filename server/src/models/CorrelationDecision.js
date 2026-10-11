import mongoose from 'mongoose';

const correlationDecisionSchema = new mongoose.Schema(
  {
    sourceIncidentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      required: true,
      index: true,
    },
    targetIncidentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      default: null,
      index: true,
    },
    deploymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeploymentEvent',
      default: null,
      index: true,
    },
    relationshipType: {
      type: String,
      enum: ['incident_to_incident', 'deployment_to_incident', 'cluster_group'],
      default: 'incident_to_incident',
    },
    decision: {
      type: String,
      enum: ['confirmed', 'rejected', 'unverified'],
      required: true,
      default: 'unverified',
      index: true,
    },
    isRootCause: {
      type: Boolean,
      default: false,
      index: true,
    },
    verifiedRootCause: {
      type: String,
      default: '',
    },
    rationale: {
      type: String,
      default: '',
    },
    factors: [
      {
        factor: String,
        weight: Number,
        evidence: String,
      },
    ],
    confidenceScore: {
      type: Number,
      default: 0,
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decidedByName: {
      type: String,
      default: 'System Correlation Engine',
    },
    decidedByRole: {
      type: String,
      default: 'system',
    },
    decidedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

const CorrelationDecision = mongoose.model('CorrelationDecision', correlationDecisionSchema);
export default CorrelationDecision;
