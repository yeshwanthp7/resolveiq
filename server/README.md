# ResolveIQ — Backend Server & Data Foundation (Phase 2)

Node.js, Express, and MongoDB + Mongoose data layer for the ResolveIQ enterprise incident intelligence platform.

---

## 1. Architecture & Core Subsystems

- **Environment & Configuration Validation (`src/config/env.js`):** Validates all required parameters at startup. Masks passwords and credentials to prevent secret leakage in console logs.
- **Persistent Database Engine (`src/config/db.js`):** Connects to real MongoDB Atlas or local daemon with timeout guards and latency measurements.
- **Repeatable Idempotent Seeder (`src/config/seed.js`):** Automatically initializes foundational teams, demo responder accounts, standard ITIL SLA policies, and verified historical incidents without duplicating records on re-runs.
- **Safe Request Logger (`src/middleware/requestLogger.js`):** Structured HTTP access logging with automatic sanitization of authorization headers and passwords.
- **Centralized Error Handler (`src/middleware/errorHandler.js`):** Formats Mongoose validation, CastErrors, and duplicate key (E11000) errors into standard JSON responses.
- **Restricted CORS Policy (`src/app.js`):** Restricts API origin access to configured client URLs (`http://localhost:5173`, `http://localhost:5174`).
- **Health Diagnostics (`/api/health` & `/api/v1/health`):** Real-time diagnostic ping of database connection, round-trip latency, service uptime, and AI fallback mode.

---

## 2. Implemented Domain Data Models

| Model | Schema File | Key Features |
|---|---|---|
| **User** | `src/models/User.js` | bcryptjs password hashing, role enum (`admin`, `commander`, `resolver`, `observer`), sanitization |
| **Team** | `src/models/Team.js` | Service ownership registry, tiering (`tier-1` to `tier-3`), escalation leads |
| **Incident** | `src/models/Incident.js` | Sequential ticket generator (`INC-1001`), ITIL impact/urgency, source enum, SLA deadlines, text indexes |
| **Resolution** | `src/models/Resolution.js` | Root cause category enum, step-by-step remediation procedures, preventative actions |
| **AuditLog** | `src/models/AuditLog.js` | Immutable chronological trail of status transitions, priority overrides, and reviewer actions |
| **SLAPolicy** | `src/models/SLAPolicy.js` | Configurable response/resolution targets for P1 through P5 |
| **DeploymentEvent** | `src/models/DeploymentEvent.js` | CI/CD change markers designed for release correlation |
| **IntegrationKey** | `src/models/IntegrationKey.js` | Ingress API key hashes for webhook authentication |
| **RecommendationFeedback**| `src/models/RecommendationFeedback.js` | Reviewer acceptance scores for AI and routing metrics |

---

## 3. Running & Verifying

### Run Backend Server:
```bash
npm start
```

### Run Automated Test Suite:
```bash
npm test
```
Runs 16 integration tests verifying:
- Live database connectivity and latency ping
- `/api/health` and `/api/v1/health` endpoints
- Schema constraints and bcrypt hashing
- Concurrent sequential ticket generation
- Repeatable idempotent seeding
