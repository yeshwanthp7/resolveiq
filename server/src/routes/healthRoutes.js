import { Router } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env.js';

const router = Router();

async function getHealthStatus(req, res) {
  const dbState = mongoose.connection.readyState;
  const dbStatusMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  const isConnected = dbState === 1;
  let dbLatencyMs = null;

  if (isConnected) {
    try {
      const pingStart = Date.now();
      await mongoose.connection.db.admin().ping();
      dbLatencyMs = Date.now() - pingStart;
    } catch (pingErr) {
      // Ping failed
    }
  }

  const isHealthy = isConnected && dbLatencyMs !== null;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    service: 'resolveiq-api',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: dbStatusMap[dbState] || 'unknown',
      connected: isConnected,
      databaseName: mongoose.connection.name || 'none',
      latencyMs: dbLatencyMs,
      target: env.safeMongoUri,
    },
    aiIntegration: {
      geminiConfigured: env.hasGemini,
      model: env.GEMINI_MODEL,
      fallbackMode: !env.hasGemini,
    },
    environment: env.NODE_ENV,
  });
}

// Available at both unversioned /api/health and versioned /api/v1/health
router.get('/health', getHealthStatus);

export default router;
