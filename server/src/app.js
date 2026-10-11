import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/healthRoutes.js';
import authRoutes from './routes/authRoutes.js';
import incidentRoutes from './routes/incidentRoutes.js';
import serviceRoutes from './routes/serviceRoutes.js';
import slaRoutes from './routes/slaRoutes.js';
import integrationRoutes from './routes/integrationRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import deploymentRoutes from './routes/deploymentRoutes.js';
import correlationRoutes from './routes/correlationRoutes.js';
import ingestRoutes from './routes/ingestRoutes.js';

export function createApp() {
  const app = express();

  // 1. Safe Request Logging
  app.use(requestLogger);

  // 2. Cookie Parser for secure HttpOnly cookie handling
  app.use(cookieParser());

  // 3. Restricted Credentialed CORS Configuration
  const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    if (env.CLIENT_URL && origin === env.CLIENT_URL) return true;
    if (process.env.CLIENT_ORIGIN && origin === process.env.CLIENT_ORIGIN) return true;
    if (origin.endsWith('.vercel.app')) return true;
    if (['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'].includes(origin)) return true;
    return false;
  };

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (curl, mobile, supertest)
        if (!origin || isAllowedOrigin(origin)) {
          return callback(null, true);
        }

        const msg = `CORS Policy Block: Origin ${origin} is not authorized for this API.`;
        return callback(new Error(msg), false);
      },
      credentials: true, // Enables HttpOnly cookie transport across origins
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key', 'X-Event-ID', 'Idempotency-Key', 'X-Idempotency-Key'],
    })
  );

  // 4. Body parsers
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 5. Unversioned Health Check
  app.use('/api', healthRoutes);

  // 6. Versioned API Routes (v1)
  app.use('/api/v1', healthRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/incidents', incidentRoutes);
  app.use('/api/v1/services', serviceRoutes);
  app.use('/api/v1/teams', serviceRoutes);
  app.use('/api/v1/sla-policies', slaRoutes);
  app.use('/api/v1/integrations', integrationRoutes);
  app.use('/api/v1/ingest', ingestRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/v1/deployments', deploymentRoutes);
  app.use('/api/v1/correlations', correlationRoutes);

  // 7. Catch-All 404 Handler
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: `Endpoint not found: ${req.method} ${req.originalUrl}`,
    });
  });

  // 8. Centralized Error Middleware
  app.use(errorHandler);

  return app;
}
