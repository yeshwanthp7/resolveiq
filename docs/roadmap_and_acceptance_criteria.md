# ResolveIQ — Roadmap & Acceptance Criteria

## Phase 0: Architecture, Data Design & Planning
- [x] Produce architecture overview & modular-monolith directory layout.
- [x] Design data models (`User`, `Team`, `Incident`, `Resolution`, `AuditLog`, `SLAPolicy`, `DeploymentEvent`, `IntegrationKey`, `RecommendationFeedback`).
- [x] Plan deterministic engines, SLA rules, AI safety gate, and fallback behavior.
- [x] Produce `.env.example`, `.gitignore`, MongoDB Atlas setup guide, and optional integration analysis.
- **Acceptance Criteria:** Architecture documents reviewed and approved; zero secrets in version control.

---

## Phase 1: Polished Enterprise Frontend Shell & Reusable Design System
- [ ] Build React 19 + Vite frontend in pure JavaScript and JSX (no TypeScript, no Next.js).
- [ ] Implement warm ivory (`#F7F7F4`), charcoal (`#242824`), forest green (`#526B58`), and neutral borders (`#E3E5E2`).
- [ ] Build 13 core views:
  1. Login (`/login`)
  2. Registration (`/register`)
  3. Dashboard (`/`)
  4. Incident list and filters (`/incidents`)
  5. New incident form (`/incidents/new`)
  6. Incident detail page (`/incidents/:id`)
  7. Knowledge base (`/knowledge-base`)
  8. Incident correlation graph (`/correlation-graph`)
  9. Deployment events (`/deployments`)
  10. Analytics and evaluation (`/analytics`)
  11. Team workload (`/team-workload`)
  12. Integration settings (`/settings/integrations`)
  13. General settings (`/settings/general`)
- [ ] Implement reusable UI components: `AppLayout`, `Sidebar`, `Topbar`, `PageHeader`, `StatCard`, `DataTable`, `SearchInput`, `FilterBar`, `PriorityBadge`, `StatusBadge`, `EmptyState`, `LoadingState`, `ErrorState`, `ConfirmDialog`, `Toast`.
- [ ] Ensure all visible buttons and links navigate, trigger valid actions, or show disabled states.
- [ ] Isolate preview data cleanly with explicit labeling (`[PREVIEW DATA]`).
- [ ] Vite build completes with zero errors.
- **Acceptance Criteria:** Frontend navigation, responsive layout, accessible forms, and UI components verified in browser.

---

## Phase 2: Core Incident Management, Deterministic ITIL Matrix & SLA Engine
- [ ] Implement Incident and ServiceRegistry Mongoose models.
- [ ] Unit test 3×3 ITIL priority calculation matrix (`priorityMatrix.js`).
- [ ] Unit test SLA deadline and breach evaluation engine (`slaEngine.js`).
- [ ] Implement immutable audit logs (`AuditLog`) for all status transitions and priority overrides.
- [ ] Integrate frontend incident triage queue with live backend API.
- **Acceptance Criteria:** Deterministic priority calculations verified; SLA breach countdowns accurate; audit trail immutability verified with automated tests.

---

## Phase 3: Resolver Recommendation Engine, Duplicate Detection & Ingestion
- [ ] Ingest alerts (`/api/v1/ingest/alerts`) and deployments (`/api/v1/ingest/deployments`).
- [ ] Deterministic TF-IDF duplicate incident detection ($\ge 65\%$ confidence).
- [ ] Multi-factor resolver recommendation engine (service ownership, skills, current workload).
- **Acceptance Criteria:** Automated webhook ingestion; explainable resolver recommendations; automated tests for TF-IDF similarity.

---

## Phase 4: Correlation Graphs, Blast Radius, What-If Simulator & Untrusted AI Co-Pilot
- [ ] Service dependency directed graph & cascade blast radius visualization.
- [ ] What-If degradation simulator for failure scenario modeling.
- [ ] Backend Google Gemini integration with strict JSON schema validation and deterministic offline fallback.
- [ ] Incident Commander human approval gate for AI suggestions.
- **Acceptance Criteria:** AI recommendations cannot alter incident state without human approval; fallback engine operates smoothly if `GEMINI_API_KEY` is absent.

---

## Phase 5: Realtime Collaboration, Analytics Dashboard, End-to-End Tests & Final Polish
- [ ] Authenticated Socket.IO live updates for timeline, SLA breach warnings, and triage queue.
- [ ] MTTR (Mean Time to Resolution), MTTD (Mean Time to Detect), and recommendation accuracy analytics.
- [ ] Comprehensive test suite across API and frontend.
- [ ] Final demonstration seed scripts and classroom documentation.
- **Acceptance Criteria:** Production build succeeds; all test suites pass; zero hardcoded fake metrics.
