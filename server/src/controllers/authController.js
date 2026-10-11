import User from '../models/User.js';
import { generateToken, setAuthCookie, clearAuthCookie, normalizeRole } from '../middleware/auth.js';

export async function register(req, res, next) {
  try {
    const { name, email, password, role, team, skills } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide name, email, and password.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters.',
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email address already exists.',
      });
    }

    // Security Rule: Public registration NEVER allows the 'admin' role.
    let assignedRole = 'end_user';
    if (role && role !== 'admin') {
      assignedRole = role;
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: assignedRole,
      team: team || 'Platform SRE',
      skills: Array.isArray(skills) && skills.length > 0 ? skills : ['general-triage'],
      isActive: true,
    });

    const token = generateToken({
      id: user._id,
      email: user.email,
      role: user.role,
    });

    // Set secure HttpOnly cookie
    setAuthCookie(res, token);

    res.status(201).json({
      success: true,
      token, // Also returned for Supertest assertions
      user: user.toSafeObject(),
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide both corporate email and password.',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    // Inactive user restriction
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        error: 'Account access is deactivated. Please contact your system administrator.',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    const token = generateToken({
      id: user._id,
      email: user.email,
      role: user.role,
    });

    // Set secure HttpOnly cookie
    setAuthCookie(res, token);

    res.status(200).json({
      success: true,
      token,
      user: user.toSafeObject(),
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res) {
  clearAuthCookie(res);
  res.status(200).json({
    success: true,
    message: 'Successfully signed out of enterprise session.',
  });
}

export async function getMe(req, res, next) {
  try {
    res.status(200).json({
      success: true,
      user: req.user.toSafeObject(),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Explicit Initial-Admin Setup Process.
 * Only allowed if zero administrators exist in the database.
 */
export async function setupInitialAdmin(req, res, next) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Please provide name, email, and password (minimum 6 characters).',
      });
    }

    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount > 0) {
      return res.status(403).json({
        success: false,
        error: 'Initial administrator already exists. Setup process is locked.',
      });
    }

    const adminUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: 'admin',
      team: 'Platform Ops',
      skills: ['security', 'iam', 'cluster-admin'],
      isActive: true,
    });

    const token = generateToken({
      id: adminUser._id,
      email: adminUser.email,
      role: adminUser.role,
    });

    setAuthCookie(res, token);

    res.status(201).json({
      success: true,
      message: 'Initial administrator provisioned successfully.',
      user: adminUser.toSafeObject(),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin-Only User Management (Update role or isActive flag).
 */
export async function updateUserRole(req, res, next) {
  try {
    const { id } = req.params;
    const { role, isActive } = req.body;

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (role) targetUser.role = role;
    if (typeof isActive === 'boolean') targetUser.isActive = isActive;

    await targetUser.save();

    res.status(200).json({
      success: true,
      user: targetUser.toSafeObject(),
    });
  } catch (err) {
    next(err);
  }
}

export async function getUsers(req, res, next) {
  try {
    const { role, team } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (team) filter.team = team;

    const users = await User.find(filter).select('-password');
    res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (err) {
    next(err);
  }
}
