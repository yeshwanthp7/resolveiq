import mongoose from 'mongoose';

const slaPolicySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Policy name is required'],
      unique: true,
      trim: true,
    },
    priority: {
      type: String,
      enum: ['P1', 'P2', 'P3', 'P4', 'P5'],
      required: true,
      unique: true,
      index: true,
    },
    responseTargetMinutes: {
      type: Number,
      required: true,
    },
    resolutionTargetMinutes: {
      type: Number,
      required: true,
    },
    businessHoursOnly: {
      type: Boolean,
      default: false,
    },
    escalationWarningPercent: {
      type: Number,
      default: 80, // Warn when 80% of budget has elapsed
    },
  },
  {
    timestamps: true,
  }
);

const SLAPolicy = mongoose.model('SLAPolicy', slaPolicySchema);
export default SLAPolicy;
