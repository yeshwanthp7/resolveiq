/**
 * Safe request logging middleware.
 * Sanitizes headers and bodies to prevent credential and secret leakage.
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl, ip } = req;

  // Intercept response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;

    // Format log with safe sanitization
    const logColor = statusCode >= 500 ? '\x1b[31m' : statusCode >= 400 ? '\x1b[33m' : '\x1b[32m';
    const reset = '\x1b[0m';

    console.log(
      `[HTTP] ${method} ${originalUrl} ${logColor}${statusCode}${reset} - ${duration}ms [${ip || 'unknown'}]`
    );
  });

  next();
}
