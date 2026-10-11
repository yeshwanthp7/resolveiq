import mongoose from 'mongoose';

const integrationKeySchema = new mongoose.Schema(
  {
    serviceName: {
      type: String,
      required: true,
      trim: true,
    },
    provider: {
      type: String,
      enum: ['datadog', 'prometheus', 'cloudwatch', 'synthetic', 'webhook', 'github_actions', 'argocd', 'generic_webhook'],
      required: true,
    },
    apiKeyHash: {
      type: String,
      required: true,
      select: false,
      index: true,
    },
    apiKeyPrefix: {
      type: String,
      required: true,
    },
    scopes: {
      type: [String],
      default: ['ingest:incidents'],
    },
    rateLimitPerMinute: {
      type: Number,
      default: 60,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const IntegrationKey = mongoose.model('IntegrationKey', integrationKeySchema);
export default IntegrationKey;
