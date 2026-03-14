# Evaluation Framework — Design Spec

## Goal

Build a standalone evaluation framework for browser agents that follows the Hamel-Hussain methodology: task-level pass/fail as the primary metric, step-level error analysis as the diagnostic layer, and continuous improvement driven by error taxonomy insights.

## Scope

**In scope (v1):**
- Eval case CRUD (create, read, update, delete)
- Eval case seeding from existing features, flows, and findings
- Layered scoring: code-based checks first, LLM-as-judge fallback
- Error taxonomy with 9 browser-agent-specific failure types
- Eval runner that reuses existing agent/browser/session infrastructure
- Dashboard UI at `/projects/:id/evals`
- Manual, scheduled, and API-triggered eval runs
- WebSocket live progress during runs

**Out of scope (future):**
- A/B comparison between agent versions
- Statistical significance testing
- Parallel eval execution (v1 runs cases sequentially)
- Cross-project eval sharing
- Eval case versioning

---

## Data Model

### New table: `eval_cases`

```sql
CREATE TABLE eval_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  task_prompt TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('feature', 'flow', 'finding', 'manual')),
  source_id UUID,
  checks JSONB NOT NULL DEFAULT '[]',
  llm_judge_criteria TEXT,
  tags TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX eval_cases_project_id ON eval_cases(project_id);

ALTER TABLE eval_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their project eval cases"
  ON eval_cases FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
```

### New table: `eval_runs`

```sql
CREATE TABLE eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled', 'ci')),
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  summary JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX eval_runs_project_id ON eval_runs(project_id);

ALTER TABLE eval_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their project eval runs"
  ON eval_runs FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
```

### New table: `eval_results`

```sql
CREATE TABLE eval_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES eval_cases(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id),  -- nullable; eval results do not create session rows
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fail', 'error')),
  code_checks JSONB DEFAULT '{}',
  llm_judge JSONB,
  error_type TEXT CHECK (error_type IN (
    'navigation_failure', 'element_not_found', 'wrong_element',
    'action_timeout', 'reasoning_error', 'hallucination',
    'partial_completion', 'unexpected_state', 'tool_misuse'
  )),
  steps_taken JSONB DEFAULT '[]',
  duration_ms INT,
  screenshots TEXT[] DEFAULT '{}'
);

CREATE INDEX eval_results_run_id ON eval_results(run_id);
CREATE INDEX eval_results_case_id ON eval_results(case_id);

ALTER TABLE eval_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their eval results"
  ON eval_results FOR ALL
  USING (run_id IN (SELECT id FROM eval_runs WHERE project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())));
```

---

## Error Taxonomy

Nine browser-agent-specific failure types, classified by the error analyzer after a failed eval:

| Error Type | Description | Example |
|---|---|---|
| `navigation_failure` | Agent couldn't reach the right page | Clicked wrong link, got lost in menu hierarchy |
| `element_not_found` | Target element missing or changed | Button renamed, selector stale, page redesigned |
| `wrong_element` | Agent interacted with wrong element | Clicked "Delete" instead of "Edit" |
| `action_timeout` | Page didn't respond in time | Slow load, spinner never resolved |
| `reasoning_error` | Agent misunderstood the task | Interpreted "create pipeline" as "view pipelines" |
| `hallucination` | Agent claimed success but didn't complete | Said "done" but form wasn't submitted |
| `partial_completion` | Got partway then stopped | Filled form but didn't click submit |
| `unexpected_state` | Page in unexpected state | Login session expired, modal blocking, error page |
| `tool_misuse` | Used extract when should act, or vice versa | Tried to extract from a page that needs interaction |

The distribution of error types across eval runs drives improvement priorities. If 40% of failures are `navigation_failure`, invest in the nav graph — not prompt tuning.

---

## Architecture

### New module: `server/src/eval/`

```
server/src/eval/
├── eval-runner.ts      — Orchestrates eval runs
├── checks.ts           — Code-based check engine
├── llm-judge.ts        — LLM-as-judge scorer
└── error-analyzer.ts   — Classifies failures into error taxonomy
```

### Eval Session Lifecycle

The eval runner **bypasses `sessionManager`** and manages browsers/agents directly. This avoids conflicts with user sessions (which are 1:1 keyed by `projectId` in `sessionManager`) and prevents unwanted side effects (nav graph writes, finding detection, suggestion creation).

**How it works:**

1. **Browser:** Eval runner calls `browserManager.claimWarm()` directly to get a Chromium instance from the warm pool. The browser is released back after each case.

2. **Agent:** Eval runner calls `createAgent()` from `agent.ts` with an **eval-specific broadcast function** that:
   - Captures `thought` and `actionDone` events into the `steps_taken` array (for recording)
   - Captures screenshots (for the `screenshots` field)
   - Does **NOT** write to Redis session state
   - Does **NOT** trigger finding detection or suggestion creation
   - Does **NOT** write to the nav graph
   - Optionally broadcasts `evalProgress` to any connected WebSocket clients

3. **Session ID:** Eval does **not** create rows in the `sessions` table. The `eval_results.session_id` column is nullable — eval results reference the `eval_runs` and `eval_cases` tables for traceability, not sessions.

4. **Langfuse:** Eval runner creates its own Langfuse trace per run (tagged `type: 'eval'`), independent of the interactive session tracing.

5. **Conflict avoidance:** Since eval bypasses `sessionManager` entirely, an eval run can execute while a user has an active interactive session for the same project. They share the browser warm pool but use separate browser instances.

### eval-runner.ts

Orchestrates a complete eval run:
1. Creates an `eval_runs` row with status `running`
2. Loads active `eval_cases` for the project (optionally filtered by tags)
3. For each case sequentially:
   a. Claims a browser from the warm pool via `browserManager.claimWarm()`
   b. Creates an agent via `createAgent()` with an eval-specific broadcast function (captures steps/screenshots, suppresses side effects)
   c. Runs `agent.act(case.task_prompt)`
   d. Runs code-based checks against the live browser state
   e. If code checks pass and `llm_judge_criteria` is set, runs LLM-as-judge
   f. If verdict is `fail`, runs error analyzer to classify failure type
   g. Records steps taken, screenshots, and duration
   h. Stores result in `eval_results`
   i. Broadcasts `evalProgress` via WebSocket (if clients connected)
   j. Destroys browser via `browserManager.killBrowser()` (no reuse across cases to ensure clean state)
4. Computes summary (total, passed, failed, error type breakdown)
5. Updates `eval_runs` with summary and status `completed`
6. Broadcasts `evalComplete` via WebSocket

### checks.ts

Code-based check engine. Each check is a deterministic assertion run against the live browser via Playwright:

```typescript
type Check =
  | { type: 'url_matches'; pattern: string }
  | { type: 'element_exists'; selector: string }
  | { type: 'element_absent'; selector: string }
  | { type: 'text_contains'; selector: string; text: string }
  | { type: 'page_title'; pattern: string }
  | { type: 'custom_js'; script: string; expected: any }
```

**Validation:** The `checks` JSONB column has no database-level schema constraint. Validation happens at the application layer using a Zod schema (consistent with the project's existing use of Zod) in the eval case create/update route handlers. Invalid checks are rejected before persistence.

**Security note on `custom_js`:** The `custom_js` check type executes arbitrary JavaScript via Playwright's `page.evaluate()`. This is acceptable because eval cases are created by the project owner (enforced by RLS policy) and execute in the owner's own browser session — the trust boundary is the same as the existing `agent.act()` capability.

Scoring logic:
- All code checks run first
- If all pass and no `llm_judge_criteria` → verdict `pass`
- If any fail → verdict `fail` (failing checks recorded in `code_checks`)
- If all pass but `llm_judge_criteria` is set → run LLM judge for final verdict

### llm-judge.ts

LLM-as-judge scorer for subjective/complex criteria:
- Input: final screenshot + DOM snapshot + `llm_judge_criteria` text
- Uses Claude (same model as agent) with a structured prompt
- Output: `{ verdict: 'pass' | 'fail', reasoning: string }`
- Only invoked when code checks can't determine the outcome
- Cost tracked via Langfuse trace

### error-analyzer.ts

Classifies failed eval results into the error taxonomy:
- Input: agent step log, final URL, final screenshot, failed checks
- Uses heuristics first (e.g., if final URL doesn't match expected → `navigation_failure`)
- Falls back to LLM classification for ambiguous cases
- Output: one of the 9 error types

---

## Eval Case Seeding

### From existing data

A `seed-evals.ts` script (or the `/api/projects/:id/evals/seed` endpoint) scans existing project data and generates draft eval cases:

**From `memory_features` table** (Supabase):
- Query: `SELECT * FROM memory_features WHERE project_id = $1`
- Each feature with `expected_behaviors[]` generates one eval case per behavior
- Checks derived from behavior descriptions (URL patterns, element selectors where inferrable)
- `source_type: 'feature'`, `source_id` → `memory_features.id`

**From `memory_flows` table** (Supabase):
- Query: `SELECT * FROM memory_flows WHERE project_id = $1`
- Each flow with `steps[]` and `checkpoints[]` generates one eval case
- Checkpoints become code-based checks where possible
- `source_type: 'flow'`, `source_id` → `memory_flows.id`

**From `findings` table** (Supabase):
- Query: `SELECT * FROM findings WHERE project_id = $1 AND status = 'confirmed'`
- Each finding with `steps_to_reproduce` and `expected_behavior` generates a regression eval case
- Tagged `['regression']` automatically
- `source_type: 'finding'`, `source_id` → `findings.id`

### Ongoing growth

- New accepted findings auto-propose an eval case (user confirms before activation)
- New accepted suggestions that add features/flows propose corresponding eval cases

---

## UI

### New route: `/projects/:id/evals`

Added to the project sidebar alongside Testing, Findings, Memory, and Settings.

### Three views:

**1. Runs Overview** — list of all eval runs
- Each row: run number, trigger type, pass/fail counts, duration, timestamp
- "Run All" button to trigger manual run
- "New Case" button to create eval case manually

**2. Run Detail** — click into a run to see individual results
- Summary bar: pass rate %, total/passed/failed counts, top error type
- Per-case rows: name, source type, checks passed, error type (if failed), duration
- Click a failed case to expand detail view

**3. Failed Case Detail** — expanded error analysis view
- Task prompt
- Error type classification
- Failed checks list
- Agent step trace (numbered actions)
- Final screenshot
- LLM judge reasoning (if applicable)

### New client components:
```
client/src/components/
├── EvalDashboard.tsx       — Runs overview + routing
├── EvalRunDetail.tsx        — Single run results
├── EvalCaseEditor.tsx       — Create/edit eval cases
└── EvalResultDetail.tsx     — Failed case drill-down
```

---

## API

### REST endpoints

```
POST   /api/projects/:id/evals/run              — trigger a new eval run
GET    /api/projects/:id/evals/runs              — list eval runs
GET    /api/projects/:id/evals/runs/:runId       — get run detail + results
POST   /api/projects/:id/evals/runs/:runId/cancel — cancel a running eval
POST   /api/projects/:id/evals/cases             — create eval case
GET    /api/projects/:id/evals/cases             — list eval cases
PUT    /api/projects/:id/evals/cases/:caseId     — update eval case
DELETE /api/projects/:id/evals/cases/:caseId     — delete eval case
POST   /api/projects/:id/evals/seed              — generate eval cases from features/flows/findings
POST   /api/projects/:id/evals/schedule          — set cron schedule for automated runs
```

All endpoints protected by `requireAuth` middleware (existing).

### WebSocket messages

```typescript
// Server → Client (broadcast during eval run)
{ type: 'evalProgress', runId: string, completed: number, total: number, latest: { case: string, verdict: string } }
{ type: 'evalComplete', runId: string, summary: { total: number, passed: number, failed: number, errorBreakdown: Record<string, number> } }
```

**Note:** WebSocket messages are a live convenience for connected clients. If no client is connected (e.g., CI-triggered or scheduled runs), progress is not lost — `eval_results` rows are persisted as each case completes, and the UI can load results via the REST API after the fact.

### Run cancellation

```
POST   /api/projects/:id/evals/runs/:runId/cancel  — cancel a running eval
```

The eval runner checks a cancellation flag (stored in `eval_runs.status = 'cancelled'`) between each case. In-progress cases complete before the run stops. The summary reflects results collected up to the cancellation point.

Add to `eval_runs.status` CHECK constraint: `'running', 'completed', 'failed', 'cancelled'`.

### Scheduled runs

- `POST /api/projects/:id/evals/schedule` stores a cron expression
- Cron config stored as a new column on the `projects` table:
  ```sql
  ALTER TABLE projects ADD COLUMN eval_cron_schedule TEXT;  -- e.g., '0 2 * * *' for daily at 2am
  ```
- Server loads all non-null `eval_cron_schedule` values on startup and registers `node-cron` timers
- `node-cron` timers are in-process only — if the server restarts, timers are re-registered from the database during the startup sequence
- No separate scheduler service for v1

---

## Integration with Existing Infrastructure

| Existing Component | How Eval Uses It | Changes Needed |
|---|---|---|
| `agent.ts` | Calls `createAgent()` with eval-specific broadcast function | None — `createAgent` accepts any broadcast callback; eval provides one that captures steps without side effects |
| `browserManager.ts` | Calls `claimWarm()` / releases after each case | None — eval is a consumer of the warm pool |
| `sessionManager.ts` | **Bypassed entirely** | None — eval manages its own agent/browser lifecycle to avoid 1:1 projectId session conflicts |
| `langfuse.ts` | Creates eval-tagged traces for cost tracking | None — eval creates its own traces |
| `index.ts` | New REST routes + WS message types | Minimal — route registration only (additive) |
| Supabase | 3 new tables + 1 new column on `projects` | Migration only |

**Conflict risk with other sessions: zero.** Eval bypasses `sessionManager` and creates no `sessions` rows. All new code lives in `server/src/eval/` and `client/src/components/Eval*.tsx`. The only shared file touched is `index.ts` for route registration (additive, no existing code modified). Eval and interactive sessions can run concurrently for the same project — they share the browser warm pool but use separate browser instances.

---

## Dependencies

**New npm packages:**
- `node-cron` — for scheduled eval runs (server)
- No other new dependencies; LLM calls use existing Anthropic SDK, browser access uses existing Playwright

---

## Testing Strategy

- Unit tests for `checks.ts` (deterministic, easy to test)
- Unit tests for `error-analyzer.ts` heuristics
- Integration test: seed eval cases from test fixtures, run against a mock page
- LLM judge tested with recorded screenshot fixtures (snapshot tests for prompt stability)
