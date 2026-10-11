# ResolveIQ — API Contracts & Specifications

## Base URL
- Local: `http://localhost:5000/api/v1`
- Content Type: `application/json`
- Authentication: `Authorization: Bearer <jwt_token>`

---

## 1. Authentication & Users
- `POST /auth/register` — Register responder profile (name, email, password, role, team, skills).
- `POST /auth/login` — Authenticate and receive JWT token.
- `GET /auth/me` — Retrieve active user session.
- `GET /auth/users` — List responders (filter by `role`, `team`).

## 2. Incidents
- `POST /incidents` — Create incident (computes priority & SLA targets deterministically, emits socket event).
- `GET /incidents` — Query incidents (supports `status`, `priority`, `serviceName`, `assignedEngineer`, `search`).
- `GET /incidents/:id` — Get single incident with populated engineer and audit log timeline.
- `PATCH /incidents/:id/status` — Lifecycle transition (`triggered` -> `acknowledged` -> `investigating` -> `mitigated` -> `resolved` -> `closed`).
- `PATCH /incidents/:id/priority` — Commander override with mandatory reason.
- `PATCH /incidents/:id/assign` — Assign responder & team.
- `GET /incidents/:id/audit` — Get immutable audit trail.

## 3. Services & Teams
- `GET /services` — List service registry items and health statuses.
- `POST /services` — Register or update service dependencies.
- `GET /teams` — List teams and on-call rosters.

## 4. Ingestion & Machine-to-Machine Credentials (Phase 11)
- `POST /ingest/incidents` — Dedicated versioned M2M ingestion endpoint. Authenticated via `Authorization: Bearer <key>` or `X-API-Key: <key>`. Supports `X-Idempotency-Key` or `externalEventId` for deduplication. Reuses priority matrix, SLA engine, and deterministic triage.
- `GET /integrations` — Admin-only: list all provisioned M2M integrations with masked key prefixes. Hashes and raw keys are never exposed.
- `POST /integrations` — Admin-only: provision new M2M credentials with scopes and rate limits. Plaintext key is returned only once upon creation.
- `POST /integrations/:id/revoke` — Admin-only: revoke an active API key immediately.
- `PATCH /integrations/:id` — Admin-only: update rate limits, scopes, or active status.
- `DELETE /integrations/:id` — Admin-only: remove integration key credential.

## 5. AI Co-Pilot (Untrusted Human-in-the-Loop)
- `POST /ai/hypothesize/:incidentId` — Generate structured root-cause hypothesis (Gemini API with deterministic fallback).
- `POST /ai/hypothesize/:incidentId/approve` — Commander approves hypothesis to official record.
- `POST /ai/hypothesize/:incidentId/reject` — Commander rejects hypothesis.

## 6. Realtime Events (Socket.IO)
- `incident:created` — Emitted when a new incident is ingested.
- `incident:updated` — Emitted on state, priority, or assignment changes.
- `sla:warning` — Emitted when an incident is within 15% of SLA breach deadline.
