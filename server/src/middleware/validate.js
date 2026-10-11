/**
 * Lightweight deterministic request validation middleware.
 * Validates request body fields against expected types, presence, and enum constraints.
 */
export function validateBody(rules) {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rule] of Object.entries(rules)) {
      const val = req.body[field];

      if (rule.required && (val === undefined || val === null || val === '')) {
        errors.push({ field, message: `${field} is required.` });
        continue;
      }

      if (val !== undefined && val !== null) {
        if (rule.type === 'string' && typeof val !== 'string') {
          errors.push({ field, message: `${field} must be a string.` });
        } else if (rule.type === 'number' && typeof val !== 'number') {
          errors.push({ field, message: `${field} must be a number.` });
        } else if (rule.type === 'array' && !Array.isArray(val)) {
          errors.push({ field, message: `${field} must be an array.` });
        }

        if (rule.enum && !rule.enum.includes(val)) {
          errors.push({
            field,
            message: `${field} must be one of: ${rule.enum.join(', ')}. Received: '${val}'`,
          });
        }

        if (rule.minLength && typeof val === 'string' && val.length < rule.minLength) {
          errors.push({
            field,
            message: `${field} must be at least ${rule.minLength} characters long.`,
          });
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed.',
        details: errors,
      });
    }

    next();
  };
}
