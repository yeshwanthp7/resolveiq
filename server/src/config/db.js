import mongoose from 'mongoose';
import { env } from './env.js';

let memoryServerInstance = null;

/**
 * Connect to MongoDB with safe logging and graceful error explanation.
 */
export async function connectDB(overrideUri = null) {
  // Directly use isolated in-memory instance during automated unit tests
  if (process.env.NODE_ENV === 'test' && !overrideUri && !process.env.TEST_REAL_DB) {
    if (!memoryServerInstance) {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServerInstance = await MongoMemoryServer.create();
    }
    const memUri = memoryServerInstance.getUri();
    await mongoose.connect(memUri);
    console.log(`[Database] Connected to memory server for testing: ${memUri}`);
    return mongoose.connection;
  }

  const uri = overrideUri || env.MONGODB_URI;
  const safeUri = uri ? uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:********@') : 'undefined';

  try {
    console.log(`[Database] Connecting to MongoDB: ${safeUri}`);

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 7000,
    });

    console.log(`[Database] Connected successfully to: ${safeUri}`);
    return mongoose.connection;
  } catch (err) {
    console.error(`[Database Error] Failed to connect to MongoDB: ${err.message}`);
    console.error('[Database Diagnostics] Check your network connectivity, MongoDB Atlas IP whitelist (0.0.0.0/0 or local IP), and credentials in server/.env.');

    // Fallback to in-memory instance if external connection fails in development or test
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      console.warn('[Database] Remote MongoDB unreachable. Falling back to embedded MongoMemoryServer for local run.');
      if (!memoryServerInstance) {
        const { MongoMemoryServer } = await import('mongodb-memory-server');
        memoryServerInstance = await MongoMemoryServer.create();
      }
      const memUri = memoryServerInstance.getUri();
      await mongoose.connect(memUri);
      console.log(`[Database] Connected to memory server: ${memUri}`);
      return mongoose.connection;
    }

    throw err;
  }
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memoryServerInstance) {
    await memoryServerInstance.stop();
    memoryServerInstance = null;
  }
  console.log('[Database] Disconnected.');
}
