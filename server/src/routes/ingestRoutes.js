import { Router } from 'express';
import { ingestIncident } from '../controllers/ingestController.js';
import { authenticateApiKey } from '../middleware/apiKeyAuth.js';

const router = Router();

// Dedicated Machine-to-Machine Ingestion Endpoint
// POST /api/v1/ingest/incidents
router.post('/incidents', authenticateApiKey('ingest:incidents'), ingestIncident);

// Also accept POST /api/v1/ingest
router.post('/', authenticateApiKey('ingest:incidents'), ingestIncident);

export default router;
