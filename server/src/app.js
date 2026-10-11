import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
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

  // 3. Credentialed CORS Configuration (reflects request origin)
  app.use(
    cors({
      origin: true, // Echoes the request origin so all deployed/tunnel origins work with cookies
      credentials: true,
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

  // 7. Static Asset Serving & Client Single Page App Routing
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const clientDistPath = path.resolve(__dirname, '../../client/dist');

  if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.get('*', (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(clientDistPath, 'index.html'));
    });
  }

  // 8. Catch-All 404 Handler for API
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: `Endpoint not found: ${req.method} ${req.originalUrl}`,
    });
  });

  // 9. Centralized Error Middleware
  app.use(errorHandler);

  return app;
}
