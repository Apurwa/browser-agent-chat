# Agent Learning System — Design Specification

## Overview

A closed-loop learning system where browser agents improve over time through user feedback, statistical pattern extraction, and cross-agent knowledge sharing. Binary feedback gates which runs enter the learning pool; dominant workflows emerge through aggregation across multiple runs — never from a single execution.

**Core Principle:** Pattern learning must be statistical, not event-based. Never learn from one run.

**Strategic Value:** Over time, the platform accumulates a structured workflow knowledge graph across hundreds of applications. This becomes a compounding moat — every user's agent benefits from collective intelligence.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Feedback granularity | Binary (thumbs up/down) + optional correction | Minimizes friction; binary is a gate, not a teacher |
| Learning approach | Statistical aggregation (N≥5 runs) | Single-run learning encodes noise (UI lag, A/B tests, agent confusion) |
| Pattern retrieval | Semantic similarity (pgvector) + URL gating | Keyword matching is brittle; "create pipeline" ≠ "set up CI workflow" |
| Cold start solution | Bootstrap with nav graph/features + cross-agent sharing | Don't lower statistical standards; share intelligence instead |
| Storage architecture | Separate tables per pipeline stage | `task_feedback` (user input) → `learning_pool` (raw runs) → `task_clusters` (groupings) → `learned_patterns` (extracted knowledge) |
| Feedback UI | Integrated task completion card | Follows Claude Code Desktop / Lovable pattern — completion message IS the feedback surface |
| Embedding provider | OpenAI `text-embedding-3-small` (1536 dimensions) | Cost-effective, high quality, widely used. Env var: `OPENAI_API_KEY` |
| Task summary LLM | Claude Haiku (`claude-haiku-4-5-20251001`) | Cheapest Anthropic model, sufficient for summarization. Falls back to raw prompt if call fails |

---

## 1. Data Model

### Prerequisites

- Enable pgvector: `CREATE EXTENSION IF NOT EXISTS vector;` (via Supabase dashboard or migration)
- Migration file: `006_learning_system.sql` (next after existing `005_rename_to_agents.sql`)

### New Table: `task_feedback`

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID | PK, default gen_random_uuid() | |
| agent_id | UUID | FK → agents, NOT NULL | |
| task_id | UUID | FK → tasks ON DELETE CASCADE, NOT NULL, UNIQUE | One feedback per task |
| session_id | UUID | FK → sessions ON DELETE SET NULL | Session context |
| rating | TEXT | NOT NULL, CHECK (rating IN ('positive', 'negative')) | Binary rating |
| correction | TEXT | Nullable | What should have happened (on negative) |
| created_at | TIMESTAMPTZ | DEFAULT now() | |

RLS: `agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())`

Indexes: `(agent_id, created_at)`, `(task_id)`, `(rating)`

### New Table: `learning_pool`

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID | PK, default gen_random_uuid() | |
| cluster_id | UUID | FK → task_clusters ON DELETE SET NULL, nullable | Assigned cluster |
| task_id | UUID | FK → tasks ON DELETE CASCADE, NOT NULL | Original task |
| agent_id | UUID | FK → agents, NOT NULL | |
| feedback | TEXT | NOT NULL, CHECK (feedback IN ('positive', 'negative')) | Positive enters extraction; negative kept for failure analysis |
| task_prompt | TEXT | NOT NULL | Raw task prompt |
| task_prompt_embedding | vector(1536) | | For clustering |
| task_summary | TEXT | | LLM-generated clean summary |
| task_summary_embedding | vector(1536) | | For retrieval matching |
| steps | JSONB | NOT NULL | Denormalized from execution_steps |
| step_count | INT | NOT NULL | Number of steps |
| duration_ms | INT | | Total duration |
| created_at | TIMESTAMPTZ | DEFAULT now() | |

RLS: `agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())`

Indexes: `(cluster_id)`, `(agent_id, created_at)`, `(feedback)`

### New Table: `task_clusters`

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID | PK, default gen_random_uuid() | |
| agent_id | UUID | FK → agents, nullable | NULL for org/global clusters |
| org_id | UUID | Nullable | NULL for agent/global clusters |
| centroid_embedding | vector(1536) | NOT NULL | Cluster center |
| task_summary | TEXT | NOT NULL | Human-readable cluster label |
| run_count | INT | DEFAULT 0 | Total eligible runs |
| app_fingerprint | TEXT | Nullable | Application identity (jenkins, github_actions, etc.) |
| created_at | TIMESTAMPTZ | DEFAULT now() | |

RLS: For Phase 1 (agent_id NOT NULL): `agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())`. For Phase 2+ (org/global clusters where agent_id IS NULL): RLS policy will be extended to check `org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid())` OR `scope = 'global'`. Phase 1 migration only creates the agent-scoped policy.

Indexes: `(agent_id)`, `(app_fingerprint)`

### Extended: `learned_patterns`

**Migration note:** The existing table has a `status` column with CHECK IN `('active', 'stale')`. This column is **renamed** to `pattern_state` and its CHECK constraint is updated to include the full lifecycle: `('candidate', 'active', 'dominant', 'stale', 'archived')`. Existing rows are migrated: `'active'` → `'active'`, `'stale'` → `'stale'`. The existing `muscle-memory.ts` must be updated in **all** paths: `loadPatterns()` reads `.eq('status', 'active')`, `markStale()` writes `status: 'stale'`, and `incrementFailures()` also references `status`. All must change from `status` to `pattern_state`.

**Column rename note:** The `005_rename_to_agents.sql` migration renamed `project_id` → `agent_id` across all tables including `learned_patterns`. Verify this was applied. If not, the `006_learning_system.sql` migration must include `ALTER TABLE learned_patterns RENAME COLUMN project_id TO agent_id`.

**Client type sync note:** The server `ServerMessage` type already includes `taskStarted` with `taskId`, but the client `ServerMessage` type in `client/src/types.ts` is currently out of sync (missing `taskStarted`). This predates the learning system — the migration must fix this existing inconsistency alongside adding new message types.

**Existing columns used by learning system** (already present, no migration needed): `use_count`, `consecutive_failures`, `last_used_at`, `trigger` (JSONB), `steps` (JSONB).

New columns added to existing table:

| Column | Type | Default | Purpose |
|---|---|---|---|
| scope | TEXT | 'agent' | CHECK (scope IN ('agent', 'org', 'candidate_global', 'verified_global', 'global')) |
| pattern_state | TEXT | 'candidate' | CHECK (pattern_state IN ('candidate', 'active', 'dominant', 'stale', 'archived')) — **renamed from `status`** |
| embedding | vector(1536) | | Semantic retrieval |
| cluster_id | UUID | Nullable | FK → task_clusters |
| avg_steps | INT | | Efficiency metric |
| avg_duration_ms | INT | | Speed metric |
| success_rate | NUMERIC | | Reliability metric |
| variance | NUMERIC | | Stability metric |
| score | NUMERIC | | Computed: `0.5×success + 0.25×efficiency + 0.15×stability + 0.1×recency` |
| org_id | UUID | Nullable | For org-level patterns |
| source_agent_id | UUID | Nullable | Original agent for promoted patterns |
| app_fingerprint | TEXT | Nullable | Application identity |
| last_verified_success | TIMESTAMPTZ | | For freshness tracking |
| portability_score | NUMERIC | Nullable | `success_across_orgs - variance_between_orgs` |

Extend `pattern_type` CHECK to include `'task'` alongside `'login'`, `'navigation'`.

### Schema: `organizations` (Phase 2)

| Column | Type | Purpose |
|---|---|---|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| created_at | TIMESTAMPTZ | |

### Schema: `organization_members` (Phase 2)

| Column | Type | Purpose |
|---|---|---|
| org_id | UUID FK → organizations | |
| user_id | UUID FK → auth.users | |
| role | TEXT | admin / member |

---

## 2. Learning Pipeline

Five stages, running asynchronously after each feedback event.

### Stage 1 — Feedback Capture

User gives thumbs up/down on task completion card. Write to `task_feedback`.

**Both positive and negative runs enter `learning_pool`** with a `feedback` flag. Negative runs are excluded from pattern extraction (`WHERE feedback = 'positive'`) but kept for failure analysis and pattern weakening.

### Stage 2 — Embedding & Pool Entry

On any feedback:
1. Embed the raw task prompt → `task_prompt_embedding`
2. Generate clean task summary via LLM → embed → `task_summary_embedding`
3. Copy execution steps from `execution_steps` as denormalized JSONB snapshot into `learning_pool`
4. Raw steps are preserved — never throw away the original

Two embeddings serve different purposes:
- `task_prompt_embedding` — for clustering (raw prompts can be messy)
- `task_summary_embedding` — for pattern retrieval (cleaner matching)

**Embedding provider:** OpenAI `text-embedding-3-small` (1536 dimensions).
- Env var: `OPENAI_API_KEY` (add to server `.env`)
- Cost: ~$0.02 per 1M tokens — negligible at our scale
- Rate limit: batch up to 100 embeddings per request if needed
- Dependency: `openai` npm package
- Fallback: if embedding call fails, store entry without embeddings and retry via background job

**Task summary generation:** Claude Haiku (`claude-haiku-4-5-20251001`) via existing `@anthropic-ai/sdk`.
- Prompt: `"Summarize this browser automation task in one concise sentence: {task_prompt}"`
- Fallback: if LLM call fails, use raw task prompt as summary (skip summary embedding until retry)
- Cost: ~$0.001 per summary — negligible

### Stage 3 — Task Clustering

Find or create a cluster for this run:
1. Query `task_clusters` for nearest centroid by cosine similarity
2. If similarity > 0.85: assign to existing cluster, increment `run_count`, update centroid
3. If no match: create new cluster with this run's embedding as centroid

**Centroid update formula:** Running mean — `new_centroid = (old_centroid * (n-1) + new_embedding) / n` where `n` is the updated `run_count`. This avoids recalculating from all entries while maintaining accuracy.

Clustering happens at scope level — agent clusters in Phase 1, org/global in Phase 2+.

### Stage 4 — Pattern Extraction

**Triggered when** `cluster.run_count >= 5` (positive runs only).

From all positive runs in the cluster:
1. **Sequence alignment** (not strict frequency matching):
   - Find longest common subsequence across runs
   - Remove low-frequency steps (appearing in <40% of runs)
   - Detect stable transition pairs
2. Calculate metrics: `avg_steps`, `avg_duration_ms`, `success_rate`, `variance`
3. Score: `0.5 × success_rate + 0.25 × (1/avg_steps normalized) + 0.15 × (1/variance normalized) + 0.1 × recency`
4. Write to `learned_patterns` with `pattern_state = 'candidate'`

**Why sequence alignment, not frequency matching:** UI execution sequences vary slightly between runs. Strict matching would incorrectly include one-off detour steps. LCS extracts the stable core path.

### Stage 5 — Pattern Activation

A candidate pattern becomes `active` when:
- `use_count >= 3` (injected into prompts and the task succeeded)
- `success_rate > 0.8`
- `min_cluster_runs >= 5`

An active pattern becomes `dominant` when it has the highest score in its cluster.

**Negative feedback handling:**
- Does NOT contribute to pattern extraction
- Increments `consecutive_failures` on matching active patterns
- Triggers pattern re-evaluation if consecutive failures spike
- Correction text stored for future analysis

### Pattern Lifecycle

```
candidate → active → dominant → stale → archived
```

| Transition | Trigger |
|---|---|
| candidate → active | use_count ≥ 3, success_rate > 0.8, cluster_runs ≥ 5 |
| active → dominant | Highest score in cluster |
| active/dominant → stale | consecutive_failures ≥ 3 AND rolling_success_rate_last_20 < 0.6 |
| stale → active | Success rate recovers during 24h cooldown window |
| stale → archived | Stale for 30+ days OR unused for 60+ days |

---

## 3. Retrieval & Prompt Injection

### Two-Stage Retrieval

```
Incoming task prompt
    → embed prompt
    → Stage 1: retrieve matching task_cluster (nearest centroid)
    → Stage 2: retrieve patterns within cluster
    → filter: pattern_state IN ('active', 'dominant')
    → apply scope hierarchy: agent (1.0) → org (0.8) → global (0.6)
    → rank by weighted sum
    → diversity filter (pattern_similarity < 0.85)
    → top-3 within 500 token cap
    → inject into prompt
```

### Ranking Formula

```
final_score =
    0.50 × semantic_similarity
  + 0.25 × pattern_score
  + 0.15 × scope_weight
  + 0.10 × recency
```

Weighted sum, not multiplication — prevents high similarity from masking low pattern quality.

### Scope Weights

| Scope | Weight | Rationale |
|---|---|---|
| agent | 1.0 | Most specific, highest trust |
| org | 0.8 | Same organization, similar setup |
| global | 0.6 | Universal workflow, may need adaptation |

### Prompt Injection Format

```
These workflows are examples of previously successful approaches.
Use them as guidance, but adapt to the current UI state.
If elements differ, reason about the closest equivalent action.

## Learned Workflows

Workflow: Create Jenkins Pipeline
Confidence: 0.92
Successful Runs: 7
Scope: agent

Steps:
1. Dashboard → New Item
2. Enter pipeline name
3. Select Pipeline type
4. Configure SCM
5. Save
```

- Anti-anchoring guard instruction above patterns
- Structured metadata (success_rate, avg_steps, runs) — LLMs reason better with explicit metrics
- Diversity filter ensures injected patterns represent different approaches

### Token Budget

Hard cap: 500 tokens for injected patterns. Existing nav graph (~600-1200 tokens) and features (~200-400 tokens) already consume prompt space. Target total system context: <2000 tokens.

### Pattern Debugging ("Why This Pattern")

For observability, log per-task:
- Retrieved patterns with similarity scores
- Scope weighting applied
- Final ranking
- Which patterns were injected vs filtered

Exposed via REST endpoint and visible in patterns management UI.

---

## 4. Feedback UI

### Task Completion Card (Integrated in Chat)

The completion message IS the feedback surface. Five states:

**State 1 — Task Completed (awaiting feedback)**
- Green dot + "Task completed" + step count + duration
- Summary of what was done
- 👍 Correct / 👎 Incorrect buttons

**State 2 — After 👍 (positive)**
- Card collapses
- Shows "Marked as correct · Added to learning pool"
- Chat continues normally

**State 3 — After 👎 (negative, expanded)**
- Card border turns red
- "What should have happened?" textarea expands
- Submit / Skip buttons
- Correction is optional — skip still records the negative rating

**State 4 — Pattern Learned Notification**
- Shown once when a pattern transitions candidate → active
- Purple accent card with ✨
- Shows: workflow name, compressed steps, success_rate, avg_steps, runs
- This is the "wow moment" — users see the system getting smarter

**State 5 — Task Failed**
- Red dot + "Task failed" + step count + duration
- Error description
- "What went wrong?" textarea (optional correction)
- No thumbs up option — failed tasks always enter learning pool as negative

### Implementation Notes

- Feedback via WebSocket (`taskFeedback` message) — user is already connected, no HTTP round trip
- Task completion card replaces the plain "Task completed." system message
- Uses existing CSS variables for theme support
- Follows existing component patterns (FindingAlert, credential form)

### Required WebSocket Pipeline Changes

The feedback UI depends on the client knowing which task to rate. Current gaps:

1. **`taskStarted` message** — server already broadcasts this with `taskId`, but `WebSocketContext.tsx` does not handle it. Must add handler to store the active `taskId` in context state.
2. **`taskComplete` message** — server must enrich with `taskId`, `stepCount`, and `durationMs` before broadcasting. Currently only sends `{ type: 'taskComplete', success: boolean }`. The `activeTasks` map in `index.ts` tracks `{ taskId, stepCount }` but does NOT track `startedAt`. Must extend to include `startedAt: Date.now()` when task starts, then compute `durationMs = Date.now() - startedAt` at completion. Alternatively, query `tasks.created_at` from DB.
3. **Client `ServerMessage` type** — must be extended with `taskStarted: { taskId: string }` and `taskComplete` enriched with `{ taskId, stepCount, durationMs }`.
4. **Client `ClientMessage` type** — must be extended with `taskFeedback: { task_id, rating, correction? }`.
5. **Primary WS handler** — `WebSocketContext.tsx` is the active provider (not `useWebSocket.ts`). All new message handling goes there.

### Feedback Error Handling

If WS disconnects between task completion and feedback submission:
- Feedback card persists in chat UI (keyed by `taskId`)
- On reconnect, user can still submit — feedback is sent via REST fallback (`POST /api/agents/:id/feedback`)
- Unsent feedback is not lost

---

## 5. Background Jobs

### Daily Jobs

**Cluster Merging**
- Scan for cluster pairs with `centroid_similarity > 0.9` AND `step_sequence_similarity > 0.7`
- Merge smaller into larger (reassign learning_pool entries, recalculate centroid)
- Step similarity check prevents merging semantically similar but operationally different tasks (e.g., "create pipeline" vs "update pipeline")

**Pattern Consolidation**
- Within each cluster, find patterns with `step_similarity > 0.85` AND `success_rate difference < 0.1`
- Merge: keep higher score, archive the other
- Success rate check prevents merging reliable and unreliable variants

**Pattern Usage Analytics**
- Detect patterns unused for 30+ days → mark stale
- After 60 days unused → archive
- Prevents pattern accumulation

### Hourly Jobs

**Pattern Health Monitor**
- Check active/dominant patterns for declining success_rate
- Stale trigger: `consecutive_failures >= 3 AND rolling_success_rate_last_20 < 0.6`
- 24h cooldown window on stale transition — observe recovery before injecting
- If cluster's dominant pattern goes stale → re-run extraction from recent learning pool entries
- Track `last_verified_success` — reduce score after 60 days without verified success

### Event-Driven

**Pattern Failure → Immediate Health Check**
- On negative feedback matching an active pattern, run health check immediately
- Faster reaction to drift without waiting for hourly scan

### Operational Safeguards

- **Leader lock:** Redis `SET NX` with TTL (using existing `redisStore.ts` connection). Key: `learning:job:{jobName}:lock`, TTL: 6 minutes (slightly longer than max runtime). Check lock before starting, release on completion or timeout.
- **Job timeout:** Max 5 minutes per job to prevent overlapping executions
- **Node-cron in server process** — appropriate for current scale, extract to workers later if needed. `node-cron` dependency already exists in `server/package.json`.

---

## 6. Cross-Agent Pattern Sharing (Phase 2+)

### Three-Tier Hierarchy

| Tier | Scope | Trust | Context Level |
|---|---|---|---|
| Agent | Single agent | Highest | Full specificity (URLs, selectors) |
| Org | All agents in workspace | High | Generalized (URL patterns, abstract selectors) |
| Global | All agents on platform | Moderate | Workflow skeleton only |

### Promotion Rules

**Agent → Org:**
- `unique_agents >= 3`
- `total_runs >= 10`
- `success_rate >= 0.85`
- Cross-agent pattern conflict detection: consolidation job runs across agent patterns before promotion

**Org → Global:**
- `unique_orgs >= 3`
- `total_runs >= 30`
- `success_rate >= 0.90`
- `portability_score` above threshold (`success_across_orgs - variance_between_orgs`)

### Global Pattern Quarantine

```
org pattern → candidate_global → verified_global → global
```

- `candidate_global`: shadow tested in 5-10% of eligible runs
- `verified_global`: shadow testing confirms success
- `global`: fully promoted, available to all agents

### Anonymization

**Agent → Org:**
- Replace specific URLs with patterns (`https://jenkins.acme.com/` → `{jenkins_base_url}/`)
- Normalize selectors: `#pipeline-project-acme-prod` → `action_type: click, element_role: create_button, page_type: dashboard`
- Strip text content containing customer data

**Org → Global:**
- Remove all URL references, keep page types only
- Remove org-specific terminology
- Keep workflow skeleton: action sequence + page transitions

### App Fingerprinting

Global patterns are scoped by `app_fingerprint` (jenkins, github_actions, gitlab_ci, pagerduty, okta, etc.). A "Create pipeline" pattern for Jenkins doesn't apply to GitHub Actions.

### "Instant Knowledge" for New Agents (Phase 3)

When a new agent is created and connects to a URL:
1. Detect app fingerprint from page structure
2. Query global patterns matching that fingerprint
3. Inject immediately — agent has workflow knowledge from minute one
4. Cold start disappears

---

## 7. API Surface

### REST Endpoints

All mounted at `/api/agents/:id`.

| Method | Path | Purpose | Phase |
|---|---|---|---|
| POST | `/feedback` | Submit task feedback | 1A |
| GET | `/feedback` | List feedback (filters: rating, date range) | 1A |
| GET | `/patterns` | List learned patterns | 1B |
| GET | `/patterns/:pid` | Pattern detail with cluster info | 1B |
| PATCH | `/patterns/:pid` | Update pattern state (manual stale/archive) | 1B |
| DELETE | `/patterns/:pid` | Delete pattern (unteach) | 1B |
| GET | `/learning/stats` | Pool size, cluster count, active patterns, coverage | 1B |
| GET | `/learning/clusters` | List clusters with run counts | 1B |

### WebSocket Messages

**Server → Client:**

| Type | Payload | When |
|---|---|---|
| `patternLearned` | `{ name, steps, success_rate, avg_steps, runs }` | Pattern → active |
| `patternStale` | `{ name, reason }` | Pattern drift detected |

**Client → Server:**

| Type | Payload | When |
|---|---|---|
| `taskFeedback` | `{ task_id, rating, correction? }` | User clicks 👍/👎 |

### Observability Metrics (Phase 1A)

| Metric | Purpose |
|---|---|
| `patterns_created` | Learning rate |
| `patterns_activated` | Successful learning |
| `pattern_success_rate` | Pattern quality |
| `pattern_usage_rate` | Whether retrieval works (`tasks_using_patterns / total_tasks`) |
| `cluster_count` | Fragmentation detection |

Critical alert: if `pattern_usage_rate < 10%`, retrieval is broken.

---

## 8. Phase Plan

### Phase 1A — Learning Engine (build first)

**Goal:** Agent improves automatically from user feedback.

| Component | Description |
|---|---|
| Database migration | `task_feedback`, `learning_pool`, `task_clusters` tables + `learned_patterns` extensions + pgvector extension |
| Server types | `TaskFeedback`, `LearningPoolEntry`, `TaskCluster`, extended `LearnedPattern` |
| DB functions | CRUD for all new tables |
| Embedding service | Embed task prompts, generate task summaries |
| Clustering logic | Assign runs to clusters, create new clusters, centroid updates |
| Extraction pipeline | LCS-based dominant path extraction (triggered at cluster_runs >= 5) |
| Pattern lifecycle | candidate → active → dominant → stale → archived |
| Retrieval integration | Two-stage cluster→pattern lookup in memory engine |
| Prompt injection | Structured hints + anti-anchoring + diversity filter + 500 token cap |
| Background jobs | Cluster merging, pattern consolidation, usage analytics, health monitor |
| Observability | Learning metrics: patterns_created, activated, usage_rate, cluster_count |
| Pattern debugging | "Why this pattern" logging per task |
| Feedback REST endpoints | POST/GET `/feedback` |
| WS: taskFeedback | Client → server feedback message |
| Feedback UI | Task completion card with 👍/👎 + correction textarea |

### Phase 1B — Learning UX (ship after engine stabilizes)

**Goal:** Users see and manage the learning system.

| Component | Description |
|---|---|
| Pattern learned notification | "Agent learned a workflow" chat card |
| Pattern stale notification | "Pattern drift detected" chat card |
| Patterns management UI | View, inspect, delete learned patterns |
| Learning stats dashboard | Pool size, cluster count, active patterns, coverage chart |
| Pattern debugging UI | "Why this pattern was chosen" per-task inspection |
| REST endpoints | Patterns CRUD, learning stats, clusters |

### Phase 2 — Org Intelligence (future)

| Component | Description |
|---|---|
| `organizations` + `organization_members` tables | Workspace entity |
| Agent → org promotion pipeline | 3+ agents, 10+ runs, >85% success |
| Cross-agent conflict detection | Consolidation across agent patterns before promotion |
| Anonymization layer | URL generalization, selector normalization |
| `app_fingerprint` detection | Auto-detect from URL/page structure |
| Org-level retrieval | Scope-weighted search (agent 1.0, org 0.8) |

### Phase 3 — Global Intelligence (future)

| Component | Description |
|---|---|
| Org → global promotion pipeline | 3+ orgs, 30+ runs, >90% success |
| Global quarantine | candidate_global → verified_global → global |
| Shadow testing | 5-10% of eligible runs try candidate patterns |
| Portability scoring | `success_across_orgs - variance_between_orgs` |
| "Instant Knowledge" UX | Auto-inject global patterns for new agents by app fingerprint |
| Global drift monitoring | Cross-org health checks |

---

## 9. Integration Points

| System | Integration | Impact |
|---|---|---|
| `memory-engine.ts` | Add pattern retrieval + prompt injection | Modified |
| `agent.ts` | Pass pattern context alongside nav graph/features | Modified |
| `index.ts` | Mount feedback route, handle WS `taskFeedback`, enrich `taskComplete` with `taskId`/`stepCount`/`durationMs` | Modified |
| `types.ts` (server) | Add `TaskFeedback`, `LearningPoolEntry`, `TaskCluster` types. Add `taskFeedback` to `ClientMessage` union. Add `patternLearned`, `patternStale` to `ServerMessage` union. Enrich `taskComplete` variant with `taskId`, `stepCount`, `durationMs` | Modified |
| `types.ts` (client) | Mirror server type changes. Add `taskStarted` to `ServerMessage`. Add `taskFeedback` to `ClientMessage` | Modified |
| `WebSocketContext.tsx` | Handle `taskStarted` (store `taskId`), `taskComplete` (with enriched data), `patternLearned`, `patternStale`. Send `taskFeedback` | Modified (primary WS handler) |
| `ChatPanel.tsx` | Replace "Task completed" system message with completion card component | Modified |
| `muscle-memory.ts` | Update `.eq('status', 'active')` → `.eq('pattern_state', 'active')` after column rename | Modified |
| `execution_steps` table | Read-only source for learning pool snapshots | Unchanged |
| `learned_patterns` table | Extended with new columns, `status` renamed to `pattern_state` | Modified |
| `nav_nodes` / `nav_edges` | Used for URL gating in retrieval | Unchanged |
| Eval system | Patterns can be validated via eval runs | Unchanged |

**New files:**

| File | Purpose | Phase |
|---|---|---|
| `server/src/learning/embedding.ts` | OpenAI embedding service + Haiku summarization | 1A |
| `server/src/learning/clustering.ts` | Cluster assignment, centroid updates, merge logic | 1A |
| `server/src/learning/extraction.ts` | LCS-based pattern extraction from cluster runs | 1A |
| `server/src/learning/retrieval.ts` | Two-stage pattern retrieval with scoring | 1A |
| `server/src/learning/lifecycle.ts` | Pattern state transitions, activation, decay | 1A |
| `server/src/learning/jobs.ts` | Background jobs: cluster merge, consolidation, health, usage | 1A |
| `server/src/routes/feedback.ts` | REST endpoints for feedback + patterns | 1A |
| `server/src/migrations/006_learning_system.sql` | All new tables + learned_patterns extensions | 1A |
| `client/src/components/TaskCompletionCard.tsx` | Feedback UI component | 1A |
| `client/src/components/PatternLearnedCard.tsx` | "Agent learned" notification | 1B |
| `client/src/components/LearningDashboard.tsx` | Pattern management + stats | 1B |

**Dependencies to add:**

| Package | Workspace | Purpose |
|---|---|---|
| `openai` | server | Embedding API |

Note: `@anthropic-ai/sdk` and `node-cron` are already in server `package.json`.

---

## 10. Testing Strategy

### Unit Tests
- Pattern extraction: LCS algorithm with various step sequence inputs
- Clustering: similarity threshold, centroid updates, merge logic
- Scoring: formula validation with edge cases
- Lifecycle transitions: all valid and invalid state transitions
- Anonymization: verify customer data is stripped at each promotion level

### Integration Tests
- Full pipeline: feedback → pool → cluster → extraction → activation → retrieval → injection
- Negative feedback: verify it weakens patterns, triggers re-evaluation
- Background jobs: cluster merging, consolidation, health monitor
- Retrieval: scope hierarchy, diversity filter, token budget

### Edge Cases
- First run for a new agent (no patterns, no clusters)
- Cluster with exactly 5 runs (threshold boundary)
- Pattern with 100% success rate that suddenly fails
- Two identical patterns from different clusters
- Correction text on negative feedback
- Task that matches multiple clusters equally

---

## 11. Pattern Drift Detection

Over months, workflows change due to UI redesigns, feature rollouts, and permission model changes. Patterns fail gradually, not catastrophically.

**Detection mechanisms:**
- Rolling success rate monitoring (last 20 runs)
- `last_verified_success` tracking — score reduction after 60 days
- Event-driven health checks on negative feedback
- Automatic re-extraction when dominant pattern goes stale

**Response:**
- Stale with 24h cooldown (observe recovery)
- Re-run extraction from recent learning pool entries
- If no dominant path emerges from recent data, cluster enters "learning mode" (no pattern injected, collecting new runs)
