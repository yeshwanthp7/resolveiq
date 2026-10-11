import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { env } from '../config/env.js';

// Canonical role definitions and aliases
const ROLE_ALIASES = {
  commander: 'manager',
  resolver: 'support_engineer',
  observer: 'end_user',
};

export function normalizeRole(role) {
  return ROLE_ALIASES[role] || role;
}

export function generateToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: '24h',
  });
}

/**
 * Attaches signed JWT as secure HttpOnly cookie.
 * In development, sameSite='lax' and secure=false allows localhost credentials.
 * In production, sameSite='none' (or 'lax' if same-site) and secure=true.
 */
export function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
  });
}

export function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie('token', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
  });
}

/**
 * Authenticates request via HttpOnly cookie (primary) or Bearer header (API testing).
 */
export async function authenticate(req, res, next) {
  try {
    let token = req.cookies?.token;

    // Fallback to Bearer token header for CLI/Supertest
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. No session cookie or Bearer token provided.',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (jwtErr) {
      clearAuthCookie(res);
      return res.status(401).json({
        success: false,
        error: 'Session expired or token invalid. Please sign in again.',
      });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      clearAuthCookie(res);
      return res.status(401).json({
        success: false,
        error: 'User profile associated with this session no longer exists.',
      });
    }

    // Inactive user restriction
    if (!user.isActive) {
      clearAuthCookie(res);
      return res.status(403).json({
        success: false,
        error: 'Account access revoked. This user profile is deactivated.',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Role-Based Access Control Middleware.
 * Normalizes roles and prevents unauthorized operational access.
 */
export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required before checking permissions.',
      });
    }

    const userRole = normalizeRole(req.user.role);
    const normalizedAllowed = roles.map(normalizeRole);

    if (!normalizedAllowed.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: `Access forbidden: Your role ('${req.user.role}') lacks permission for this operation. Required: [${roles.join(', ')}]`,
      });
    }

    next();
  };
}
