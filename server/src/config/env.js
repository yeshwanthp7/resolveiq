import dotenv from 'dotenv';
dotenv.config();

/**
 * Validates and exposes server environment configuration.
 * Never prints or leaks secrets in console logs.
 */
export function validateEnv() {
  const errors = [];

  const PORT = process.env.PORT || 5000;
  const MONGODB_URI = process.env.MONGODB_URI;
  const JWT_SECRET = process.env.JWT_SECRET;
  const CLIENT_URL = process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (!MONGODB_URI) {
    errors.push('MONGODB_URI is required. Please provide a MongoDB Atlas or local connection string in server/.env');
  }

  if (!JWT_SECRET || JWT_SECRET.length < 16) {
    errors.push('JWT_SECRET is required and should be at least 16 characters long for secure signing.');
  }

  if (errors.length > 0) {
    console.error('[Config Error] Missing or invalid environment configuration:');
    errors.forEach((err) => console.error(`  - ${err}`));
    throw new Error(`Environment validation failed: ${errors.join('; ')}`);
  }

  // Safe masked MongoDB URI for logging (hides password)
  const safeMongoUri = MONGODB_URI
    ? MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:********@')
    : 'none';

  return {
    PORT: Number(PORT),
    MONGODB_URI,
    safeMongoUri,
    JWT_SECRET,
    CLIENT_URL,
    NODE_ENV,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    hasGemini: Boolean(GEMINI_API_KEY),
  };
}

export const env = validateEnv();
