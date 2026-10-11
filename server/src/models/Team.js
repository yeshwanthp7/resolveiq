import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Team name is required'],
      unique: true,
      trim: true,
      index: true,
    },
    tier: {
      type: String,
      enum: ['tier-1', 'tier-2', 'tier-3'],
      default: 'tier-2',
    },
    services: {
      type: [String],
      default: [],
      index: true,
    },
    serviceResponsibilities: {
      type: [String],
      default: [],
      index: true,
    },
    skillTags: {
      type: [String],
      default: [],
    },
    maxWorkloadPerEngineer: {
      type: Number,
      default: 5,
    },
    onCallLead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    description: {
      type: String,
      default: '',
    },
    escalationPolicy: {
      firstEscalationMinutes: { type: Number, default: 15 },
      secondaryLead: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
  },
  {
    timestamps: true,
  }
);

// Keep services and serviceResponsibilities aligned
teamSchema.pre('save', function (next) {
  if (this.services && this.services.length > 0 && (!this.serviceResponsibilities || this.serviceResponsibilities.length === 0)) {
    this.serviceResponsibilities = [...this.services];
  } else if (this.serviceResponsibilities && this.serviceResponsibilities.length > 0 && (!this.services || this.services.length === 0)) {
    this.services = [...this.serviceResponsibilities];
  }
  next();
});

const Team = mongoose.model('Team', teamSchema);
export default Team;
