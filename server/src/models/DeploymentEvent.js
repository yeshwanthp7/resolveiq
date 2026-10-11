import mongoose from 'mongoose';

const deploymentEventSchema = new mongoose.Schema(
  {
    service: {
      type: String,
      required: [true, 'Service name is required'],
      trim: true,
      lowercase: true,
      index: true,
    },
    serviceName: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    environment: {
      type: String,
      enum: ['production', 'staging', 'development'],
      default: 'production',
      index: true,
    },
    version: {
      type: String,
      required: [true, 'Release version/tag is required'],
      trim: true,
    },
    commitHash: {
      type: String,
      default: function () {
        return `git-${Date.now().toString(16).slice(-7)}`;
      },
      trim: true,
    },
    changeReference: {
      type: String,
      default: '',
      trim: true,
    },
    deployedBy: {
      type: String,
      default: 'ci/cd-pipeline',
    },
    deployedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    status: {
      type: String,
      enum: ['success', 'failed', 'rolled_back', 'in_progress'],
      default: 'success',
      index: true,
    },
    changeSummary: {
      type: String,
      required: [true, 'Change summary is required'],
      trim: true,
    },
    correlatedIncidents: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Incident',
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Keep service and serviceName in sync
deploymentEventSchema.pre('validate', function (next) {
  if (this.service && !this.serviceName) {
    this.serviceName = this.service;
  } else if (this.serviceName && !this.service) {
    this.service = this.serviceName;
  }
  next();
});

// Virtual alias for deploymentTimestamp
deploymentEventSchema.virtual('deploymentTimestamp').get(function () {
  return this.deployedAt;
});

const DeploymentEvent = mongoose.model('DeploymentEvent', deploymentEventSchema);
export default DeploymentEvent;
