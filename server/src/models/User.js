import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Do not return password by default
    },
    role: {
      type: String,
      enum: {
        values: [
          'end_user',
          'support_engineer',
          'manager',
          'admin',
          // Aliases for compatibility
          'commander',
          'resolver',
          'observer',
        ],
        message: '{VALUE} is not an authorized role',
      },
      default: 'end_user', // Never default to admin
      index: true,
    },
    team: {
      type: String,
      trim: true,
      default: 'Platform SRE',
      index: true,
    },
    skills: {
      type: [String],
      default: ['general-triage'],
    },
    serviceResponsibilities: {
      type: [String],
      default: [],
    },
    availabilityStatus: {
      type: String,
      enum: ['available', 'busy', 'on_call', 'unavailable'],
      default: 'available',
      index: true,
    },
    maxConcurrentIncidents: {
      type: Number,
      default: 5,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    activeIncidentCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook to hash password
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Instance method to compare candidate password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Safe JSON serialization without password
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

const User = mongoose.model('User', userSchema);
export default User;
