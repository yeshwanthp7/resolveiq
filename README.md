# ResolveIQ — Enterprise Incident Intelligence & Lifecycle Platform

ResolveIQ is a full-stack, industry-inspired incident intelligence platform designed for Site Reliability Engineers (SREs), Incident Commanders, and DevOps teams. It deterministically classifies incidents, tracks SLA breach risk, discovers duplicates, pinpoints blast radii, recommends on-call resolvers, and provides evidence-backed AI hypotheses with strict human-in-the-loop validation.

---

## 1. System Architecture

```mermaid
graph TD
    subgraph Client [React 19 + Vite Frontend]
        UI[Operational UI & Views]
        SocketClient[Socket.IO Client]
        AuthCtx[AuthContext / HttpOnly Session]
    end

    subgraph Server [Node.js + Express Modular Monolith]
        Router[API Versioned Router /api/v1]
        AuthMW[JWT & RBAC Middleware]
        Sanitizer[Security Sanitizer & Prompt Defenses]
        
        subgraph CoreServices [Deterministic Core Engines]
            PMatrix[ITIL 3x3 Priority Matrix]
            SLAEngine[Continuous SLA Calculator]
            TFIDF[In-Process TF-IDF Vectorizer]
            CorrelEngine[Multi-Factor Correlation Engine]
            AssignEngine[Workload-Aware Scorer]
            Simulator[Non-Mutating What-If Simulator]
        end

        subgraph IntegrationIngest [M2M Ingestion Gateway]
            KeyHasher[SHA-256 Key Verifier]
            IdempEngine[Idempotency & Deduplication]
            RateLimiter[Per-Key Token Bucket]
        end

        subgraph AICoPilot [AI Reliability Co-Pilot]
            GeminiGateway[Google Gemini 1.5 Flash]
            JSONValidator[Strict Output Schema Validator]
            OfflineFallback[Deterministic Rule Fallback]
        end

        SocketServer[Socket.IO Realtime Bus]
    end

    subgraph Database [MongoDB Layer]
        Atlas[(MongoDB Production / Atlas)]
        MemDB[(In-Memory DB for Tests)]
    end

    subgraph MonitoringTools [External Telemetry]
        Datadog[Datadog Webhook]
        Prometheus[Alertmanager]
    end

    UI -->|HTTP / Cookies| Router
    SocketClient <-->|WebSockets| SocketServer
    MonitoringTools -->|POST /api/v1/ingest/incidents| IntegrationIngest
    IntegrationIngest --> KeyHasher --> IdempEngine --> CoreServices
    Router --> AuthMW --> Sanitizer --> CoreServices
    CoreServices --> AICoPilot
    AICoPilot --> GeminiGateway
    GeminiGateway -.->|Failure / No Key| OfflineFallback
    AICoPilot --> JSONValidator
    CoreServices --> Atlas
    CoreServices -.->|Test Runner| MemDB
    CoreServices --> SocketServer
```

---

## 2. Database Relationship Diagram

```mermaid
erDiagram
    USER ||--o{ INCIDENT : "reports or assigned to"
    TEAM ||--o{ USER : "employs"
    TEAM ||--o{ INCIDENT : "responsible for"
    INCIDENT ||--o{ RESOLUTION : "documented by"
    INCIDENT ||--o{ AUDITLOG : "generates immutable"
    INCIDENT ||--o{ DEPLOYMENTEVENT : "correlates with preceding"
    INCIDENT ||--o{ RECOMMENDATIONFEEDBACK : "evaluates AI/KB"
    USER ||--o{ INTEGRATIONKEY : "provisions"
    INCIDENT ||--o{ CORRELATIONDECISION : "links related"

    USER {
        ObjectId _id PK
        string name
        string email UK
        string password
        string role
        string team
        string[] skillTags
        string availabilityStatus
        number maxConcurrentIncidents
        boolean isActive
    }

    TEAM {
        ObjectId _id PK
        string name UK
        string tier
        string[] services
        string[] skillTags
        number maxActiveCapacity
    }

    INCIDENT {
        ObjectId _id PK
        string incidentNumber UK
        string title
        string description
        string affectedService
        string impact
        string urgency
        string priority
        string status
        string assignedTeam
        ObjectId assignee FK
        object sla
        string source
        string idempotencyKey
        string externalEventId
    }

    RESOLUTION {
        ObjectId _id PK
        ObjectId incidentId FK
        string rootCauseCategory
        string summary
        string[] remediationSteps
        string[] preventativeActions
        boolean isVerified
        boolean isOutdated
    }

    DEPLOYMENTEVENT {
        ObjectId _id PK
        string service
        string version
        string environment
        date deployedAt
        string status
        string changeSummary
    }

    INTEGRATIONKEY {
        ObjectId _id PK
        string serviceName
        string provider
        string apiKeyHash UK
        string apiKeyPrefix
        string[] scopes
        number rateLimitPerMinute
        boolean isActive
    }

    RECOMMENDATIONFEEDBACK {
        ObjectId _id PK
        ObjectId incidentId FK
        string recommendationSource
        string decision
        boolean fixAttempted
        boolean fixWorked
        string engineerConfirmedRootCause
        string verifiedResolution
        ObjectId reviewerId FK
    }

    AUDITLOG {
        ObjectId _id PK
        ObjectId incidentId FK
        ObjectId actorId FK
        string actorName
        string actorRole
        string action
        object previousState
        object newState
        date timestamp
    }
```

---

## 3. Incident Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> Triggered : Automated Ingestion / Manual Creation
    [*] --> New : User Portal Intake
    
    Triggered --> Acknowledged : Responder Acknowledges (Response Clock Stops)
    New --> Acknowledged : Responder Acknowledges
    
    Acknowledged --> Investigating : Root Cause Investigation & KB Retrieval
    Investigating --> In_Progress : Remediation Fix Applied
    
    In_Progress --> Mitigated : Interim Mitigation Deployed
    Mitigated --> Resolved : Fix Verified (Resolution Clock Stops)
    In_Progress --> Resolved : Root Cause Fully Remediated
    
    Resolved --> Closed : Post-Incident Review Complete
    
    Resolved --> Reopened : Regression Detected (Clock Resumes)
    Closed --> Reopened : Re-emerging Outage
    
    Reopened --> Investigating : Re-Investigation
    Closed --> [*]
```

---

## 4. Correlation, Recommendation & Learning Loop Flow

```mermaid
sequenceDiagram
    autonumber
    actor Monitoring as External APM / User
    participant Router as Express API Gateway
    participant Ingest as Ingestion & Idempotency
    participant Core as Incident & SLA Engine
    participant Correl as Correlation Graph
    participant KB as Knowledge Base (TF-IDF)
    participant Gemini as Gemini AI Co-Pilot
    actor Engineer as Authorized SRE Responder

    Monitoring->>Router: POST /api/v1/ingest/incidents (with X-Idempotency-Key)
    Router->>Ingest: Verify SHA-256 API Key & Idempotency Key
    Ingest->>Core: Persist Incident & Compute ITIL Priority (P1-P5)
    Core->>Core: Initialize 24x7 SLA Deadlines (Response & Resolution)
    
    Core->>Correl: Evaluate Shared Service, Topo Dependencies & Deployments
    Correl-->>Core: Flag Suspected Correlation & Blast Radius
    
    Core->>KB: Lexical TF-IDF Search on Verified Past Resolutions
    KB-->>Core: Ranked Historical Precedents (Boosted/Penalized)
    
    alt Gemini Key Present & Healthy
        Core->>Gemini: Synthesize Root Cause & Investigation Runbook
        Gemini-->>Core: Structured JSON Output
    else Offline Fallback Mode
        Core->>Core: Deterministic Rule-Based Runbook Synthesis
    end
    
    Core-->>Engineer: Dashboard Notification & Structured Recommendations
    
    Engineer->>Router: POST /what-if (Simulate Reassignment / Delay)
    Router-->>Engineer: Projected Queue Impact (0 DB Mutations)
    
    Engineer->>Router: PATCH /status (Resolve with Confirmed Cause)
    Engineer->>Router: POST /resolution-recommendations/feedback
    Router->>KB: Record Learning Loop Feedback (Tune Precedent Weights)
```

---

## 5. Setup & Execution (Windows Instructions)

### Prerequisites
- **Node.js**: v18.0.0+ (Tested on Node.js v20.20.2)
- **npm**: v9.0.0+
- **MongoDB**: Local MongoDB community instance running on `localhost:27017` OR a MongoDB Atlas cluster URI.

### 1. Environment Variable Reference

#### Backend Configuration (`server/.env`):
Create `server/.env` with the following variables:
```env
# Application Port and Runtime Mode
PORT=5000
NODE_ENV=development

# MongoDB Connection String (Atlas or Local Community Server)
MONGODB_URI=mongodb://localhost:27017/resolveiq

# JWT Cryptographic Secret Key for HttpOnly Sessions
JWT_SECRET=resolveiq_super_secret_jwt_enterprise_key_2026_dev

# Permitted Frontend CORS Origin
CLIENT_ORIGIN=http://localhost:5173

# Optional: Google Gemini API Key (https://aistudio.google.com/)
# If empty or omitted, platform seamlessly executes deterministic rule fallbacks
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash
```

#### Frontend Configuration (`client/.env`):
Create `client/.env` with the following variables:
```env
VITE_API_URL=http://localhost:5000/api/v1
VITE_SOCKET_URL=http://localhost:5000
```

---

### 2. Windows Startup Commands

#### Step A: Install Dependencies
Open **PowerShell** or **Command Prompt** at repository root:
```powershell
# Install backend dependencies
cd server
npm install

# Install frontend dependencies
cd ..\client
npm install
cd ..
```

#### Step B: Launch Backend Server
In the first PowerShell window:
```powershell
cd server
npm run dev
```
*(Runs on `http://localhost:5000`. Auto-seeds default demo users on initial database connection).*

#### Step C: Launch Frontend Client
In a second PowerShell window:
```powershell
cd client
npm run dev
```
*(Runs on `http://localhost:5173`).*

---

## 6. Seeded Demo Accounts

The database seeder automatically provisions four distinct enterprise personas:

| Role | Email | Password | Team / Permissions |
|---|---|---|---|
| **Incident Commander** | `commander.chen@resolveiq.io` | `EnterprisePass123!` | Core Incident Response (Full assignment & What-If) |
| **SRE Resolver** | `resolver.raj@resolveiq.io` | `EnterprisePass123!` | Platform SRE (Investigation, mitigation & resolutions) |
| **Platform Admin** | `admin.ops@resolveiq.io` | `EnterprisePass123!` | Platform Ops (User management & M2M Integrations) |
| **Observer** | `observer.taylor@resolveiq.io` | `EnterprisePass123!` | Compliance & Risk (Read-only auditor access) |

---

## 7. API Reference & Sample Requests

### A. Machine-to-Machine Ingestion (`POST /api/v1/ingest/incidents`)
```bash
curl -X POST http://localhost:5000/api/v1/ingest/incidents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer riq_live_f89a241b72e90c1284d72819034aa102bc45" \
  -H "X-Idempotency-Key: dd_alert_pg_pool_8812" \
  -d '{
    "title": "PostgreSQL Active Connections Reached 98%",
    "description": "Connection pool saturation on payments-db. Active client connections: 492 / 500.",
    "affectedService": "payment-service",
    "severity": "critical",
    "source": "datadog",
    "externalEventId": "dd_event_pg_pool_8812",
    "environment": "production",
    "tags": ["database", "postgres", "pool-saturation"]
  }'
```
**Response (201 Created on first ingestion, 200 OK on duplicate retry):**
```json
{
  "success": true,
  "isDuplicateRetry": false,
  "incident": {
    "_id": "6aca84ec6e91d31babdb51c0",
    "incidentNumber": "INC-1002",
    "title": "PostgreSQL Active Connections Reached 98%",
    "priority": "P1",
    "status": "triggered",
    "sla": {
      "responseDeadline": "2026-10-11T00:20:00.000Z",
      "resolutionDeadline": "2026-10-11T02:05:00.000Z"
    }
  }
}
```

### B. What-If Incident Simulator (`POST /api/v1/incidents/:id/what-if`)
```bash
curl -X POST http://localhost:5000/api/v1/incidents/6aca84ec6e91d31babdb51c0/what-if \
  -H "Content-Type: application/json" \
  -H "Cookie: token=<jwt_cookie>" \
  -d '{
    "delayMinutes": 45,
    "targetAssigneeId": "6aca84eb6e91d31babdb518d"
  }'
```
**Response (Pure In-Memory Projection, 0 Database Mutations):**
```json
{
  "success": true,
  "simulation": {
    "meta": {
      "isHypothetical": true,
      "disclaimer": "Projection only. Live records are unchanged."
    },
    "slaProjections": {
      "simulatedAckTime": "2026-10-11T00:50:00.000Z",
      "projectedResponseState": "Breached",
      "responseBreachMinutes": 30
    }
  }
}
```

---

## 8. Quantitative Evaluation & Test Verification

All tests run in an isolated in-memory MongoDB environment (`mongodb-memory-server`) to guarantee that development records are never mutated or erased.

### 1. Test Suite Summary
- **Backend Regression Suite**: `npm test` inside `server/`
  - **Suites**: 62 test suites
  - **Tests**: 188 automated unit and integration tests
  - **Pass Rate**: **100% (188 / 188 PASS, 0 FAIL)**
  - **Execution Duration**: ~39.1 seconds
- **Frontend Production Build**: `npm run build` inside `client/`
  - **Modules**: 2032 modules transformed
  - **Errors / Warnings**: **0 errors**
  - **Build Duration**: 411 ms

### 2. Labelled Benchmark Evaluation Results

The evaluation benchmark (`server/src/utils/evaluationBenchmark.js`) was executed against the synthetic dataset (`server/src/data/evaluationDataset.json`) containing **24 labelled incidents** and **16 duplicate candidate pairs**:

| Metric | Sample Size | Measured Score | Evaluation Notes |
| :--- | :---: | :---: | :--- |
| **Category Classification Accuracy** | N = 24 | **83.3%** (20 / 24) | High precision on availability, latency, and security; token overlap in multi-symptom alerts caused 4 misses. |
| **Priority Derivation Accuracy** | N = 24 | **100.0%** (24 / 24) | Verified across all impact and urgency combinations via deterministic ITIL 3×3 matrix. |
| **Duplicate Detection Precision** | M = 16 | **100.0%** (7 / 7) | Zero false positives: distinct operational alerts are never falsely flagged as duplicates. |
| **Duplicate Detection Recall** | M = 16 | **87.5%** (7 / 8) | Detected 7 of 8 duplicate pairs; 1 false negative caused by disjoint synonym vocabulary. |
| **Duplicate Detection F1 Score** | M = 16 | **0.933** | Strong balance of precision and recall. |

### 3. Workflow Time-Savings Comparison (Baseline vs. Assisted)

> **Disclosure**: *Simulated time savings are derived from standardized ITIL response phases (Triage, Assignment, Diagnosis, Mitigation) under controlled scenario assumptions. They do not constitute empirical field production SLA guarantees.*

| Scenario | Incident Context | Baseline MTTR | ResolveIQ MTTR | Time Saved | Reduction |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Scenario A** | High-Severity Ingress Outage (Envoy 504s) | 60.0 min | 16.3 min | **43.7 min** | **72.8%** |
| **Scenario B** | Duplicate Alert Storm (APM Webhooks) | 51.0 min | 11.5 min | **39.5 min** | **77.5%** |
| **Scenario C** | Bad Release Deployment Regression | 65.0 min | 12.5 min | **52.5 min** | **80.8%** |
| **Aggregate** | **Standard Operational Triage Suite** | **176.0 min** | **40.3 min** | **135.7 min** | **77.1%** |

---

## 9. Security Audit & Hardening Verification

1. **Authentication & Session Tokens**: Signed JWTs transported via encrypted, HttpOnly, SameSite cookies. Token tampering yields immediate `401 Unauthorized`.
2. **Role-Based Access Control**: Strict server-side `authorize` middleware blocks unauthorized users from viewing foreign team tickets, accessing manager analytics, or assigning tickets.
3. **Data Immutability & SLA Protection**: `updateIncident` rejects client-supplied `sla` objects (`resolutionDeadline`, `isResolutionBreached`), guaranteeing that deadlines remain calculated by the server.
4. **Integration Key Security**: M2M API keys stored as SHA-256 hashes (`apiKeyHash`). Plaintext keys are revealed only once upon provisioning.
5. **Prompt-Injection Sanitization**: All incident text is processed by `sanitizeUntrustedText` to strip secrets and neutralize prompt injection commands before being passed inside `<untrusted_incident_content>` boundary delimiters.
6. **Query & Network Safety**: Strict Mongoose schema models protect against NoSQL operator injection; CORS origins are locked down to configured origins.

---

## 10. Major Feature Implementation Status Matrix

| Subsystem / Feature | Implementation Status | Verification Evidence |
| :--- | :---: | :--- |
| **1. User Authentication & RBAC** | **Working** | bcryptjs hashing, HttpOnly cookies, 4 role tiers enforced across all routes. |
| **2. Sequential Incident Management** | **Working** | Atomic sequence generation (`INC-XXXX`), full lifecycle transitions. |
| **3. ITIL Priority Derivation** | **Working** | Deterministic 3×3 matrix mapping Impact & Urgency to P1–P5. |
| **4. Duplicate Detection Engine** | **Working** | TF-IDF Cosine Similarity ($P=100.0\%, R=87.5\%, F1=0.933$). |
| **5. Historical Resolution Knowledge Base** | **Working** | Deterministic lexical retrieval with verified outcome ranking. |
| **6. AI Reliability Co-Pilot** | **Working** | Gemini API integration with zero-downtime deterministic fallback. |
| **7. Continuous SLA Monitoring** | **Working** | Calendar-hours deadlines, On Track / At Risk / Breached / Met states. |
| **8. Incident & Deployment Correlation** | **Working** | Multi-factor topology and deployment causality graph. |
| **9. Workload-Aware Assignment** | **Working** | Deterministic 100-point candidate scoring with queue headroom weighting. |
| **10. What-If Incident Simulator** | **Working** | In-memory hypothetical scenario projections with 0 database mutations. |
| **11. Resolution Learning Loop** | **Working** | Captures engineer fix outcomes and tunes historical retrieval ranking. |
| **12. M2M REST Ingestion API** | **Working** | SHA-256 key verification, idempotency keys, and deduplication retries. |
| **13. Realtime Socket.IO Broadcasting** | **Working** | Realtime incident creation, status updates, and SLA alerts. |
| **14. Operational Analytics Dashboard** | **Working** | Realtime MTTR calculation, ageing buckets, and workload saturation. |
| **15. Inbound Email Ingestion** | **Not Implemented** | Explicitly unconfigured / disabled (requires dedicated SMTP/IMAP TLS gateway). |

---

## 11. Known Limitations & Future Improvements

1. **Lexical vs. Semantic Embedding Gap**: Current duplicate detection relies on TF-IDF surface token matching. Semantic synonyms without token overlap (e.g. "sluggish throughput" vs. "latency degradation") require hybrid vector search (such as MongoDB Atlas Vector Search or pgvector).
2. **Static Topology Bounds**: The correlation engine uses the configured microservice dependency dictionary. Dynamic, undeclared service-mesh routes require configuration updates.
3. **Calendar vs. Business Hours**: SLAs calculate continuous 24×7 calendar hours; business-hours calendars (9 AM–5 PM weekdays excluding holidays) require dedicated business calendar scheduling engines.
4. **Heuristic Confidence**: Confidence metrics indicate uncalibrated rule density and match strength, not calibrated Bayesian probabilities.
