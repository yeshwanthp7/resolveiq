/**
 * In-memory sliding window rate limiter middleware for authentication routes.
 * Protects against brute-force password guessing and registration floods.
 */
const ipRequestMap = new Map();

export function createRateLimiter({ windowMs = 60 * 1000, maxRequests = 15, message = 'Too many requests. Please try again later.' } = {}) {
  // Cleanup stale IP entries every 2 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of ipRequestMap.entries()) {
      if (now - data.startTime > windowMs * 2) {
        ipRequestMap.delete(ip);
      }
    }
  }, 120000).unref();

  return (req, res, next) => {
    // Disable rate limiting in test environment
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let clientData = ipRequestMap.get(ip);
    if (!clientData || now - clientData.startTime > windowMs) {
      clientData = { startTime: now, count: 1 };
      ipRequestMap.set(ip, clientData);
      return next();
    }

    clientData.count += 1;
    if (clientData.count > maxRequests) {
      const remainingSeconds = Math.ceil((windowMs - (now - clientData.startTime)) / 1000);
      res.setHeader('Retry-After', remainingSeconds);
      return res.status(429).json({
        success: false,
        error: message,
        retryAfterSeconds: remainingSeconds,
      });
    }

    next();
  };
}

export const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: 'Too many authentication attempts from this IP address. Please wait a minute before retrying.',
});
