# ResolveIQ — Classroom Presentation Outline & Defense Q&A

This document prepares the team for academic demonstration, technical presentation, and faculty defense of the ResolveIQ Enterprise Incident Intelligence platform.

---

## 1. Classroom Presentation Outline

### Slide 1: Title & Executive Summary
- **Title**: ResolveIQ: An Explainable Incident Intelligence & Lifecycle Platform
- **Sub-bullet**: Bridging Deterministic SRE Systems Engineering with Human-in-the-Loop AI Co-Pilots
- **Core Value Proposition**: Reduces Mean Time to Resolution (MTTR) by eliminating noisy duplicate alert storms, automating ITIL-grounded triage, identifying preceding CI/CD deployment culprits, and surfacing verified historical remediation runbooks without ungrounded AI hallucinations.

### Slide 2: The Industry Problem
- **The Modern Observability Crisis**: Alert fatigue from Datadog, Prometheus, and CloudWatch produces hundreds of simultaneous tickets during cascading microservice failures.
- **Cognitive Overload**: On-call engineers spend 15–30 minutes merely triaging who owns a service, whether an alert is a duplicate, or if someone pushed bad code 10 minutes ago.
- **The Danger of Black-Box AI**: Naive LLM chatbots in production invent non-existent commands or hallucinate root causes, creating catastrophic secondary outages.
- **Solution Requirement**: A system where deterministic operational rules govern SLAs and routing, and AI is strictly sandboxed behind structured validation and human approval.

### Slide 3: Architecture & Tech Stack (Why Modular-Monolith MERN?)
- **Single Runtime**: Node.js + Express backend with React (Vite) frontend and MongoDB.
- **Why No Microservices / Kafka?**: For an enterprise triage prototype, in-process deterministic services provide sub-millisecond scoring, zero network hop latency, simple atomic transactions, and zero operational infrastructure maintenance.
- **Realtime Fabric**: Authenticated Socket.IO transports live incident broadcasts and SLA warning events directly to active responder dashboards.
- **Strict Separation of Concerns**: Controllers $\to$ Services $\to$ Deterministic Math & Heuristic Engines $\to$ Sandboxed LLM Gateways.

### Slide 4: Deterministic Triage & ITIL Priority Matrix
- **Automated Ingestion**: Ingests tickets from manual user portals or M2M monitoring webhooks.
- **ITIL 3×3 Impact vs. Urgency Matrix**:
  - Impact (`enterprise`, `department`, `single_user`) $\times$ Urgency (`critical`, `moderate`, `low`) $\to$ Priority `P1`–`P5`.
  - Guarantees predictable, non-arbitrary priority assignments that cannot be manipulated by client overrides.
- **Sequential Ticket Sequence**: Atomic MongoDB counter guarantees unique, non-colliding `INC-XXXX` ticket IDs even under high concurrent load.

### Slide 5: Lexical Duplicate Detection vs. Semantic Search
- **Explainable TF-IDF Vectorization**: Tokenizes titles, error messages, and descriptions into normalized n-grams.
- **Cosine Similarity Scoring**: Computes mathematical token overlap against active incidents.
- **Human Review Only**: Suspected duplicates ($\theta \ge 0.50$) are flagged with candidate IDs and matching evidence tokens. The platform **never** automatically deletes or merges tickets.

### Slide 6: Historical Retrieval vs. Generative AI
- **Knowledge Base Grounding**: MongoDB stores verified past incidents with structured `Resolution` records.
- **Deterministic Precedent Ranking**:
  $$\text{FinalScore} = \text{BaseCosineSim} + \text{ServiceBoost} + \text{OutcomeBoost} - \text{OutcomePenalty} - \text{OutdatedPenalty}$$
- **Anti-Hallucination Gate**: Gemini is strictly provided the top retrieved historical records. If retrieval finds insufficient evidence ($< 0.40$), the system returns an explicit `insufficient_evidence` result.
- **Schema Validation**: Outputs missing root cause, investigation steps, resolution steps, or prevention advice are rejected, falling back to deterministic synthesis.

### Slide 7: Incident Correlation Graph & Deployment Causality
- **Topological Service Graph**: Evaluates direct and 2-hop transitive dependencies across microservices.
- **Multi-Factor Correlation Scoring**: Combines shared service (+0.35), dependency topology (+0.25), error symptom overlap (+0.25), and temporal proximity (+0.15).
- **Deployment Proximity**: Correlates preceding CI/CD deployment events on the same service within a 4-hour window.
- **Causation Integrity Principle**: Timestamp proximity alone **never** constitutes proof of causality. All relationships remain `suspected` until an engineer confirms or establishes verified root cause.

### Slide 8: Workload-Aware Assignment & What-If Simulation
- **Candidate Responder Scoring**: Deterministically scores eligible engineers out of 100 points based on team ownership (30 pts), skill tags (25 pts), queue headroom (20 pts), active P1 load (15 pts), and on-call status (10 pts).
- **Eligibility Gatekeepers**: Deactivated users, end users, observers, and off-duty responders are strictly excluded.
- **Non-Mutating What-If Simulator**: Clones incident state in-memory to project SLA breach risks and queue saturation for hypothetical delays or reassignments with **zero database mutations**.

### Slide 9: The Resolution Learning Loop
- **Human-in-the-Loop Feedback**: `RecommendationFeedback` logs whether proposed fixes were attempted, whether they worked, engineer-confirmed root cause, and verified outcome.
- **Deterministic Retrieval Tuning**: Precedents that repeatedly resolve incidents gain ranking boosts; refuted or outdated precedents receive ranking penalties.
- **Zero Retraining Principle**: The platform **never** retrains the base Google Gemini foundation model, preventing catastrophic forgetting, model drift, and data poisoning.

### Slide 10: Quantitative Evaluation & Test Verification
- **Automated Regression Suite**: 188 automated tests across 62 suites passing with 100% success rate.
- **Labelled Synthetic Benchmark**:
  - Classification Accuracy: **83.3%** (20/24 correct).
  - Priority Accuracy: **100.0%** (24/24 correct via ITIL matrix).
  - Duplicate Detection Precision: **100.0%**, Recall: **87.5%**, F1 Score: **0.933**.
- **Comparative Workflow Analysis**: Simulated scenario MTTR reduced by **77.1%** across standardized operational incident scenarios.

---

## 2. 20+ Teacher & Student Defense Questions with Technical Answers

### Q1: Why is incident triage and resolution an urgent industry problem?
**Answer**: Modern cloud-native architectures consist of dozens of distributed microservices with complex mesh dependencies. When an infrastructure component degrades (e.g., an Envoy ingress proxy or database pool), downstream services trigger a storm of cascading alerts. On-call engineers experience alert fatigue, cross-team routing ping-pong, and delayed response times. Industry studies (such as Puppet's State of DevOps) show that uncoordinated triage consumes over 40% of incident resolution time, leading to millions of dollars in downtime losses.

### Q2: Why is the MERN stack suitable for an enterprise incident response prototype?
**Answer**: MERN (MongoDB, Express, React, Node.js) provides a unified JavaScript/JSON runtime from the browser DOM down to database documents. Incident records, triage schemas, LLM outputs, and WebSocket payloads are natively structured as JSON, eliminating object-relational mapping (ORM) impedance mismatch. In-process event handling and Node's event loop allow realtime scoring, graph traversal, and Socket.IO dispatching without managing external message brokers like Kafka or separate Python runtimes.

### Q3: How does ResolveIQ discover duplicate tickets without heavy machine learning?
**Answer**: ResolveIQ implements an explainable, in-process TF-IDF (Term Frequency-Inverse Document Frequency) vectorizer combined with Cosine Similarity. Incoming incident text (title, description, error patterns) is sanitized, tokenized, and stripped of common English stop words. Each document is mapped to a vector in term-frequency space. When comparing tickets, the cosine of the angle between their vectors produces a normalized similarity score between 0.0 and 1.0. If the score exceeds the configurable threshold ($\theta = 0.50$), it is flagged as a candidate duplicate with matching lexical token evidence.

### Q4: How does historical resolution retrieval differ from generative AI synthesis?
**Answer**: Historical retrieval is an information retrieval (IR) process that queries immutable, verified database records of past resolved incidents. It provides factual provenance, linking back to real ticket numbers, timestamps, and confirmed fixes. Generative AI (LLMs like Gemini), in contrast, produces probabilistic next-token predictions based on internal training weights. In ResolveIQ, the LLM is never allowed to invent historical tickets; it is strictly provided the top retrieved historical records as grounded context to synthesize actionable investigation steps.

### Q5: How does deployment correlation differ from proving the root cause of an incident?
**Answer**: Deployment correlation detects temporal and topological alignment—for example, Service A deployed version `v2.4.1` 15 minutes before Service A began throwing HTTP 504 timeouts. However, correlation is not causation: the deployment could be completely healthy while an upstream network gateway or cloud provider outage caused the failure. ResolveIQ strictly labels all discovered links as `suspected_correlation` with an `unverified` status. Only an authorized human engineer can inspect telemetry and promote an event to `verified_root_cause`.

### Q6: How does the correlation graph identify related incidents across services?
**Answer**: The graph engine evaluates four distinct dimensions:
1. **Shared Service**: Direct impact on the identical service (+0.35).
2. **Service Topology**: 1-hop direct or 2-hop transitive dependency in the configured service adjacency matrix (+0.25 direct, +0.15 transitive).
3. **Error Symptom Signatures**: Jaccard index of extracted technical tokens like `504`, `OOMKilled`, or `deadlock` (+0.25).
4. **Temporal Proximity**: Declared within overlapping 15-minute to 6-hour windows (+0.15).
If the composite score exceeds 0.25, a graph edge is rendered connecting the incidents.

### Q7: How does the deterministic assignment scoring algorithm rank eligible engineers?
**Answer**: The scoring formula evaluates candidates across five transparent operational factors totaling 100 points:
1. **Team & Service Compatibility (30 pts)**: Member of assigned team (+18), team owns service (+12), or designated service owner (+12).
2. **Relevant Technical Skills (25 pts)**: Matched against incident service, category, and triage tags.
3. **Workload Bandwidth (20 pts)**: Remaining headroom: $\max(0, 1 - \frac{\text{openTickets}}{\text{maxCapacity}}) \times 20$.
4. **Critical Incident Headroom (15 pts)**: Zero active P1/P2 tickets = 15 pts; 1 active P1/P2 = 8 pts; $\ge 2$ = 0 pts.
5. **Configured Availability (10 pts)**: Designated `on_call` shift = 10 pts; `available` = 7 pts; `busy` = 3 pts.

### Q8: What strict gatekeepers prevent assigning incidents to improper personnel?
**Answer**: Responders are filtered through binary eligibility checks before scoring occurs:
- `isActive === false`: Deactivated accounts are rejected.
- `role === 'end_user'` or `'observer'`: Non-responder roles cannot receive assignments.
- `availabilityStatus === 'unavailable'`: Engineers on PTO, sick leave, or off-duty are completely excluded.
Attempts to assign incidents to ineligible users return `400 Bad Request`.

### Q9: How are SLA deadlines and breach states calculated?
**Answer**: ResolveIQ enforces a continuous calendar-hours (24×7) standard. On incident declaration, the SLA engine evaluates priority (`P1`–`P5`) against configured targets:
- `P1`: 15m response target, 120m resolution target.
- `P2`: 30m response target, 240m resolution target.
- `P3`: 60m response target, 720m resolution target.
- `P4`: 120m response target, 1440m resolution target.
- `P5`: 240m response target, 2880m resolution target.
Deadlines are stored as absolute UTC timestamps (`createdAt + targetMinutes`). Current status transitions deterministically across four states: `On Track` (< 80% budget consumed), `At Risk` ($\ge$ 80% budget consumed), `Breached` (time remaining $\le 0$ unacknowledged/unresolved), or `Met` (completed before deadline).

### Q10: How does the What-If Simulator work without mutating live database records?
**Answer**: The simulator operates purely in Node.js memory. It clones the incident document and simulates hypothetical changes—such as delaying response time by $N$ minutes or transferring the ticket to another responder. It calculates projected SLA margin changes and target queue loads using pure mathematical functions. Live MongoDB records, collections, and audit logs are never modified, and outputs are tagged with `isHypothetical: true`.

### Q11: What does the Resolution Learning Loop learn, and how does it adjust rankings?
**Answer**: The learning loop captures structured human feedback on recommendations: whether the fix was attempted, whether it succeeded, and what the confirmed root cause was. These records adjust future historical knowledge retrieval deterministically:
- Verified successful resolutions receive a boost: $+ \min(0.15, \text{successCount} \times 0.05)$ (extra $+0.05$ if microservice matches).
- Repeatedly failed or rejected resolutions receive a penalty: $- \min(0.25, \text{failureCount} \times 0.08)$.
- Outdated or refuted runbooks receive an explicit penalty: $-0.20$ to $-0.40$.

### Q12: Why doesn't ResolveIQ fine-tune or retrain Google Gemini with user feedback?
**Answer**: Retraining or fine-tuning foundation LLMs from user feedback introduces severe operational risks: catastrophic forgetting, prompt-injection data poisoning, high GPU compute costs, and non-deterministic regression. Instead, ResolveIQ adopts a Retrieval-Augmented Generation (RAG) architecture where learning occurs deterministically in the application retrieval and ranking layer. The LLM remains a stateless inference engine operating over verified, auditable context.

### Q13: How were classification accuracy and duplicate detection precision/recall measured?
**Answer**: An independent synthetic benchmark (`server/src/utils/evaluationBenchmark.js`) was executed against a labelled dataset (`server/src/data/evaluationDataset.json`) containing 24 fictional incidents across 6 categories and 16 duplicate candidate pairs.
- **Classification Accuracy**: Measured by comparing deterministic rule outputs against ground-truth labels: $\frac{\text{Correct Predictions}}{\text{Total Samples}} = \frac{20}{24} = 83.3\%$.
- **Duplicate Precision**: $\frac{\text{TP}}{\text{TP} + \text{FP}} = \frac{7}{7 + 0} = 100.0\%$.
- **Duplicate Recall**: $\frac{\text{TP}}{\text{TP} + \text{FN}} = \frac{7}{7 + 1} = 87.5\%$.
- **Duplicate F1 Score**: $2 \times \frac{P \times R}{P + R} = 0.933$.

### Q14: How does the application function if Google Gemini is unavailable or unconfigured?
**Answer**: ResolveIQ features an automated, zero-downtime offline fallback mechanism. If `GEMINI_API_KEY` is missing, invalid, rate-limited (HTTP 429), or unavailable (HTTP 404/503), the backend catches the exception and routes the request to the deterministic heuristic engine (`recommendationEngine.js` and `resolutionRecommendationService.js`). Triage categories, priorities, teams, and runbooks are synthesized directly from historical precedents with zero user-facing errors.

### Q15: How are prompt-injection attacks mitigated in the AI Co-Pilot?
**Answer**: Ticket titles, descriptions, and reproduction steps are treated as untrusted user input. Before being passed to Gemini:
1. Inputs pass through `sanitizeUntrustedText`, which strips high-entropy secrets (API keys, JWTs, AWS credentials) and neutralizes prompt-injection keywords (`ignore previous instructions`, `system prompt override`).
2. The payload is encapsulated within explicit `<untrusted_incident_content>` boundary tags.
3. System prompts instruct the LLM that content inside delimiters must only be analyzed as passive data and never interpreted as instructions.

### Q16: How does the M2M Ingestion API prevent duplicate incidents when monitoring tools retry requests?
**Answer**: External monitoring systems frequently retry webhooks when network timeouts occur. ResolveIQ requires an idempotency key (`X-Idempotency-Key` header or `externalEventId` field). When an alert arrives, the system queries for existing incidents with matching idempotency keys or `(source, externalEventId)`. If an identical event exists, the API skips creation, avoids generating duplicate tickets or audit logs, and returns `HTTP 200 OK` with `isDuplicateRetry: true`.

### Q17: How are API keys secured for external monitoring integrations?
**Answer**: API keys are generated as cryptographically secure random tokens (`riq_live_${hex}`). Keys are **never** stored in plaintext. The backend computes and stores only the SHA-256 hash (`apiKeyHash`). When an incoming webhook authenticates, its key is hashed and matched in constant time. In the UI, the plaintext key is displayed exactly once upon provisioning; subsequent views display only the masked prefix (`riq_live_f89a...`).

### Q18: What role-based access control (RBAC) rules protect operational integrity?
**Answer**: Server-side middleware (`authenticate` and `authorize`) verifies JWT claims on every endpoint:
- **End Users**: Can create incidents and view only their own reported tickets. Forbidden from viewing other users' tickets, accessing manager analytics, assigning responders, or overriding SLA policies.
- **Support Engineers**: Can investigate, acknowledge, and resolve incidents assigned to their team; search knowledge bases; and submit recommendation feedback. Forbidden from modifying other teams' restricted tickets.
- **Managers / Incident Commanders**: Can reassign tickets, perform What-If simulations, view cross-team workload queues, and access operational analytics.
- **Admins**: Can manage users, teams, SLA policies, and M2M integration credentials.

### Q19: How are SLA deadlines protected from client tampering?
**Answer**: In the incident controller (`updateIncident`), client payloads attempting to supply `sla` objects (such as `resolutionDeadline` or `isResolutionBreached`) are discarded. SLA values are strictly derived on the backend using the deterministic SLA engine. Non-admin users cannot alter resolution deadlines or manipulate breach flags.

### Q20: What are the known limitations of the prototype?
**Answer**:
1. **Lexical Synonym Gap**: Pure TF-IDF duplicate search analyzes surface token overlap; semantic synonyms without token overlap (e.g., "sluggish throughput" vs. "high p99 latency") require dense vector embeddings.
2. **Static Service Topology**: The correlation graph relies on the configured service dependency dictionary; dynamic mesh routes outside the configuration require updates.
3. **Calendar Hours Default**: SLAs currently operate on continuous 24×7 calendar hours; business-hours calendars (9 AM–5 PM weekdays excluding public holidays) require calendar schedule engines.
4. **Heuristic Confidence**: Confidence metrics represent normalized rule density and match strength, not calibrated Bayesian posterior probabilities.

### Q21: What is the future scope for ResolveIQ in an enterprise environment?
**Answer**:
1. **Hybrid Dense Embeddings**: Combining BM25/TF-IDF lexical search with dense vector embeddings (e.g. pgvector or MongoDB Atlas Vector Search) for semantic duplicate detection.
2. **OpenTelemetry Trace Ingestion**: Ingesting distributed trace spans (`W3C TraceContext`) to calculate live latency graph edges rather than relying solely on static topology.
3. **Automated Runbook Execution**: Integrating with Kubernetes operators and AWS Step Functions to trigger automated canary rollbacks upon confirmed deployment causality.
4. **Multi-Region Tenant Isolation**: Extending MongoDB collections with tenant isolation keys and multi-region database sharding.
