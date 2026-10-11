import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    incidentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      required: false,
      default: null,
      index: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actorName: {
      type: String,
      default: 'System Automation',
    },
    actorRole: {
      type: String,
      default: 'system',
    },
    action: {
      type: String,
      required: [true, 'Audit action is required'],
      enum: [
        'INCIDENT_CREATED',
        'INCIDENT_INGESTED',
        'STATUS_TRANSITION',
        'PRIORITY_OVERRIDE',
        'RESOLVER_ASSIGNED',
        'SLA_BREACH_DETECTED',
        'NOTE_ADDED',
        'RESOLUTION_RECORDED',
        'INCIDENT_EDITED',
        'INCIDENT_REOPENED',
        'RELATED_TICKET_LINKED',
        'RELATED_TICKET_UNLINKED',
        'RECOMMENDATION_RECORDED',
        'RECOMMENDATION_ACCEPTED',
        'RECOMMENDATION_REJECTED',
        'RECOMMENDATION_OVERRIDDEN',
        'AI_HYPOTHESIS_APPROVED',
        'AI_HYPOTHESIS_REJECTED',
        'RESOLUTION_RECOMMENDATION_ACCEPTED',
        'RESOLUTION_RECOMMENDATION_REJECTED',
        'RESOLUTION_RECOMMENDATION_OVERRIDDEN',
        'RESOLUTION_VERIFIED',
        'RESOLUTION_FLAGGED_OUTDATED',
        'RESOLUTION_REVERIFIED',
        'CORRELATION_CONFIRMED',
        'CORRELATION_REJECTED',
        'CORRELATION_DECIDED',
        'DEPLOYMENT_RECORDED',
        'ROOT_CAUSE_ESTABLISHED',
        'API_KEY_CREATED',
        'API_KEY_REVOKED',
      ],
    },
    previousState: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    newState: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reason: {
      type: String,
      default: '',
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
  }
);

auditLogSchema.index({ incidentId: 1, timestamp: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
