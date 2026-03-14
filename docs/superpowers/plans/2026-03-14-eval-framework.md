# Evaluation Framework Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone evaluation framework that runs browser agent tasks, scores results with layered checks (code-based + LLM-as-judge), classifies failures by error taxonomy, and surfaces insights through a dashboard UI.

**Architecture:** New `server/src/eval/` module with 4 files (eval-runner, checks, llm-judge, error-analyzer) + new `routes/evals.ts` for REST API + 4 new client components. The eval runner bypasses `sessionManager` and manages browsers/agents directly via `browserManager.claimWarm()` and `createAgent()` with an eval-specific broadcast function. Three new Supabase tables (`eval_cases`, `eval_runs`, `eval_results`) + one new column on `projects`.

**Tech Stack:** TypeScript, Express, Supabase (Postgres), Playwright (via magnitude-core), Zod, node-cron, React 19, react-router-dom

**Spec:** `docs/superpowers/specs/2026-03-14-eval-framework-design.md`

---

## File Structure

### Server (new files)

| File | Responsibility |
|------|---------------|
| `server/src/eval/checks.ts` | Zod schema for Check type, `runChecks(page, checks)` function |
| `server/src/eval/llm-judge.ts` | `judgeWithLLM(screenshot, criteria)` — Claude call with structured output |
| `server/src/eval/error-analyzer.ts` | `classifyError(steps, finalUrl, failedChecks)` — heuristic + LLM fallback |
| `server/src/eval/eval-runner.ts` | `startEvalRun(projectId, trigger, tags?)` — orchestrates full run |
| `server/src/eval/seed.ts` | `seedEvalCases(projectId)` — generates cases from features/flows/findings |
| `server/src/routes/evals.ts` | Express router for eval CRUD + run trigger + cancel + schedule |
| `client/src/components/EvalDashboard.tsx` | Runs overview, "Run All" button, case management |
| `client/src/components/EvalRunDetail.tsx` | Single run results with pass/fail per case |
| `client/src/components/EvalCaseEditor.tsx` | Create/edit eval case form |
| `client/src/components/EvalResultDetail.tsx` | Failed case drill-down with error analysis |

### Server (modified files)

| File | Change |
|------|--------|
| `server/src/types.ts` | Add eval types + new `ServerMessage` variants for evalProgress/evalComplete |
| `server/src/db.ts` | Add eval CRUD functions (eval_cases, eval_runs, eval_results) |
| `server/src/index.ts` | Mount evals router, add cron setup on startup |

### Client (modified files)

| File | Change |
|------|--------|
| `client/src/App.tsx` | Add `/projects/:id/evals` route |
| `client/src/components/Sidebar.tsx` | Add "Evals" nav item |

---

## Chunk 1: Data Model & Types

### Task 1: Add eval types to types.ts

**Files:**
- Modify: `browser-agent-chat/server/src/types.ts`

- [ ] **Step 1: Add eval type definitions**

Add after the `ServerMessage` type union (around line 240) — find the end of the type definitions section:

```typescript
// === Eval Framework Types ===

export type CheckType = 'url_matches' | 'element_exists' | 'element_absent' | 'text_contains' | 'page_title' | 'custom_js';

export type Check =
  | { type: 'url_matches'; pattern: string }
  | { type: 'element_exists'; selector: string }
  | { type: 'element_absent'; selector: string }
  | { type: 'text_contains'; selector: string; text: string }
  | { type: 'page_title'; pattern: string }
  | { type: 'custom_js'; script: string; expected: any };

export type EvalCaseSourceType = 'feature' | 'flow' | 'finding' | 'manual';
export type EvalCaseStatus = 'active' | 'disabled';
export type EvalRunTrigger = 'manual' | 'scheduled' | 'ci';
export type EvalRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type EvalVerdict = 'pass' | 'fail' | 'error';

export type ErrorType =
  | 'navigation_failure'
  | 'element_not_found'
  | 'wrong_element'
  | 'action_timeout'
  | 'reasoning_error'
  | 'hallucination'
  | 'partial_completion'
  | 'unexpected_state'
  | 'tool_misuse';

export interface EvalCase {
  id: string;
  project_id: string;
  name: string;
  task_prompt: string;
  source_type: EvalCaseSourceType;
  source_id: string | null;
  checks: Check[];
  llm_judge_criteria: string | null;
  tags: string[];
  status: EvalCaseStatus;
  created_at: string;
  updated_at: string;
}

export interface EvalRun {
  id: string;
  project_id: string;
  trigger: EvalRunTrigger;
  status: EvalRunStatus;
  summary: {
    total?: number;
    passed?: number;
    failed?: number;
    errored?: number;
    error_breakdown?: Record<string, number>;
  };
  started_at: string;
  completed_at: string | null;
}

export interface EvalResult {
  id: string;
  run_id: string;
  case_id: string;
  session_id: string | null;
  verdict: EvalVerdict;
  code_checks: Record<string, boolean>;
  llm_judge: { verdict: string; reasoning: string } | null;
  error_type: ErrorType | null;
  steps_taken: Array<{ order: number; action: string; target?: string }>;
  duration_ms: number | null;
  screenshots: string[];
}
```

- [ ] **Step 2: Add eval WebSocket message types to ServerMessage union**

Add to the `ServerMessage` type union in `types.ts`:

```typescript
  | { type: 'evalProgress'; runId: string; completed: number; total: number; latest: { case: string; verdict: string } }
  | { type: 'evalComplete'; runId: string; summary: { total: number; passed: number; failed: number; errorBreakdown: Record<string, number> } }
```

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/server/src/types.ts
git commit -m "feat(eval): add eval framework type definitions"
```

---

### Task 2: Supabase migration

**Files:**
- Create: `browser-agent-chat/server/src/migrations/eval-tables.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Eval Framework Tables

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

CREATE TABLE eval_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES eval_cases(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id),
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
  USING (run_id IN (
    SELECT id FROM eval_runs WHERE project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  ));

-- Add cron schedule column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS eval_cron_schedule TEXT;
```

- [ ] **Step 2: Run migration against Supabase**

```bash
# Via Supabase dashboard SQL editor or CLI
# Copy contents of eval-tables.sql and execute
```

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/server/src/migrations/eval-tables.sql
git commit -m "feat(eval): add eval tables migration"
```

---

### Task 3: Add eval CRUD functions to db.ts

**Files:**
- Modify: `browser-agent-chat/server/src/db.ts`

- [ ] **Step 1: Add eval case CRUD functions**

Add at the end of `db.ts`, following the existing query patterns:

```typescript
// === Eval Framework DB Functions ===

export async function createEvalCase(
  evalCase: Omit<EvalCase, 'id' | 'created_at' | 'updated_at'>
): Promise<EvalCase | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('eval_cases')
    .insert(evalCase)
    .select()
    .single();
  if (error) { console.error('createEvalCase error:', error); return null; }
  return data;
}

export async function listEvalCases(
  projectId: string,
  filters?: { status?: string; tags?: string[] }
): Promise<EvalCase[]> {
  if (!isSupabaseEnabled()) return [];
  let query = supabase!
    .from('eval_cases')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.tags?.length) query = query.overlaps('tags', filters.tags);
  const { data, error } = await query;
  if (error) { console.error('listEvalCases error:', error); return []; }
  return data ?? [];
}

export async function getEvalCase(caseId: string): Promise<EvalCase | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('eval_cases')
    .select('*')
    .eq('id', caseId)
    .single();
  if (error) return null;
  return data;
}

export async function updateEvalCase(
  caseId: string,
  updates: Partial<Pick<EvalCase, 'name' | 'task_prompt' | 'checks' | 'llm_judge_criteria' | 'tags' | 'status'>>
): Promise<EvalCase | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('eval_cases')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', caseId)
    .select()
    .single();
  if (error) { console.error('updateEvalCase error:', error); return null; }
  return data;
}

export async function deleteEvalCase(caseId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;
  const { error } = await supabase!
    .from('eval_cases')
    .delete()
    .eq('id', caseId);
  if (error) { console.error('deleteEvalCase error:', error); return false; }
  return true;
}
```

- [ ] **Step 2: Add eval run CRUD functions**

```typescript
export async function createEvalRun(
  projectId: string,
  trigger: EvalRunTrigger
): Promise<EvalRun | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('eval_runs')
    .insert({ project_id: projectId, trigger })
    .select()
    .single();
  if (error) { console.error('createEvalRun error:', error); return null; }
  return data;
}

export async function getEvalRun(runId: string): Promise<EvalRun | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('eval_runs')
    .select('*')
    .eq('id', runId)
    .single();
  if (error) return null;
  return data;
}

export async function listEvalRuns(
  projectId: string,
  limit = 20
): Promise<EvalRun[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('eval_runs')
    .select('*')
    .eq('project_id', projectId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('listEvalRuns error:', error); return []; }
  return data ?? [];
}

export async function updateEvalRun(
  runId: string,
  updates: Partial<Pick<EvalRun, 'status' | 'summary' | 'completed_at'>>
): Promise<EvalRun | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('eval_runs')
    .update(updates)
    .eq('id', runId)
    .select()
    .single();
  if (error) { console.error('updateEvalRun error:', error); return null; }
  return data;
}
```

- [ ] **Step 3: Add eval result functions**

```typescript
export async function createEvalResult(
  result: Omit<EvalResult, 'id'>
): Promise<EvalResult | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('eval_results')
    .insert(result)
    .select()
    .single();
  if (error) { console.error('createEvalResult error:', error); return null; }
  return data;
}

export async function listEvalResults(runId: string): Promise<EvalResult[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('eval_results')
    .select('*')
    .eq('run_id', runId)
    .order('duration_ms', { ascending: true });
  if (error) { console.error('listEvalResults error:', error); return []; }
  return data ?? [];
}

export async function getEvalRunStatus(runId: string): Promise<EvalRunStatus | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('eval_runs')
    .select('status')
    .eq('id', runId)
    .single();
  if (error) return null;
  return data?.status ?? null;
}
```

- [ ] **Step 3b: Add project eval schedule function**

```typescript
export async function updateProjectEvalSchedule(
  projectId: string,
  cronSchedule: string | null
): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;
  const { error } = await supabase!
    .from('projects')
    .update({ eval_cron_schedule: cronSchedule })
    .eq('id', projectId);
  if (error) { console.error('updateProjectEvalSchedule error:', error); return false; }
  return true;
}

export async function getProjectsWithEvalSchedule(): Promise<Array<{ id: string; eval_cron_schedule: string }>> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('projects')
    .select('id, eval_cron_schedule')
    .not('eval_cron_schedule', 'is', null);
  if (error) { console.error('getProjectsWithEvalSchedule error:', error); return []; }
  return data ?? [];
}
```

- [ ] **Step 4: Add import for new types at top of db.ts**

Add to the existing import from `./types`:

```typescript
import type {
  // ... existing imports ...
  EvalCase, EvalRun, EvalResult, EvalRunTrigger, EvalRunStatus
} from './types';
```

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/db.ts
git commit -m "feat(eval): add eval CRUD functions to db.ts"
```

---

## Chunk 2: Eval Engine Core

### Task 4: Implement checks.ts

**Files:**
- Create: `browser-agent-chat/server/src/eval/checks.ts`

- [ ] **Step 1: Create the checks module**

```typescript
import { z } from 'zod';
import type { Page } from 'playwright';
import type { Check } from '../types';

// Zod schema for validating Check objects from user input
export const CheckSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url_matches'), pattern: z.string() }),
  z.object({ type: z.literal('element_exists'), selector: z.string() }),
  z.object({ type: z.literal('element_absent'), selector: z.string() }),
  z.object({ type: z.literal('text_contains'), selector: z.string(), text: z.string() }),
  z.object({ type: z.literal('page_title'), pattern: z.string() }),
  z.object({ type: z.literal('custom_js'), script: z.string(), expected: z.any() }),
]);

export const CheckArraySchema = z.array(CheckSchema);

export interface CheckResult {
  check: Check;
  passed: boolean;
  actual?: string;
  error?: string;
}

export async function runChecks(page: Page, checks: Check[]): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const check of checks) {
    try {
      const result = await runSingleCheck(page, check);
      results.push(result);
    } catch (err) {
      results.push({
        check,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

async function runSingleCheck(page: Page, check: Check): Promise<CheckResult> {
  switch (check.type) {
    case 'url_matches': {
      const url = page.url();
      const passed = new RegExp(check.pattern).test(url);
      return { check, passed, actual: url };
    }

    case 'element_exists': {
      const element = await page.$(check.selector);
      return { check, passed: element !== null };
    }

    case 'element_absent': {
      const element = await page.$(check.selector);
      return { check, passed: element === null };
    }

    case 'text_contains': {
      const element = await page.$(check.selector);
      if (!element) {
        return { check, passed: false, actual: '<element not found>' };
      }
      const text = await element.textContent() ?? '';
      const passed = text.includes(check.text);
      return { check, passed, actual: text.slice(0, 200) };
    }

    case 'page_title': {
      const title = await page.title();
      const passed = new RegExp(check.pattern).test(title);
      return { check, passed, actual: title };
    }

    case 'custom_js': {
      const result = await page.evaluate(check.script);
      const passed = JSON.stringify(result) === JSON.stringify(check.expected);
      return { check, passed, actual: JSON.stringify(result) };
    }
  }
}

export function summarizeChecks(results: CheckResult[]): Record<string, boolean> {
  const summary: Record<string, boolean> = {};
  for (const r of results) {
    const key = r.check.type === 'custom_js'
      ? `custom_js`
      : `${r.check.type}:${'pattern' in r.check ? r.check.pattern : 'selector' in r.check ? r.check.selector : ''}`;
    summary[key] = r.passed;
  }
  return summary;
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/server/src/eval/checks.ts
git commit -m "feat(eval): implement code-based check engine"
```

---

### Task 5: Implement llm-judge.ts

**Files:**
- Create: `browser-agent-chat/server/src/eval/llm-judge.ts`

- [ ] **Step 0: Install Anthropic SDK**

```bash
cd browser-agent-chat && npm install @anthropic-ai/sdk node-cron @types/node-cron --workspace=server
```

- [ ] **Step 1: Create the LLM judge module**

```typescript
import Anthropic from '@anthropic-ai/sdk';

export interface JudgeResult {
  verdict: 'pass' | 'fail';
  reasoning: string;
}

const client = new Anthropic();

export async function judgeWithLLM(
  screenshotBase64: string,
  criteria: string,
  taskPrompt: string,
  stepsDescription: string,
): Promise<JudgeResult> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: screenshotBase64,
            },
          },
          {
            type: 'text',
            text: `You are an evaluation judge for a browser automation agent.

The agent was given this task: "${taskPrompt}"

The agent took these steps:
${stepsDescription}

The screenshot shows the final browser state.

Evaluate whether the task was completed successfully based on this criteria:
${criteria}

Respond with EXACTLY this JSON format, no other text:
{"verdict": "pass" or "fail", "reasoning": "one sentence explanation"}`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const parsed = JSON.parse(text);
    return {
      verdict: parsed.verdict === 'pass' ? 'pass' : 'fail',
      reasoning: parsed.reasoning ?? 'No reasoning provided',
    };
  } catch {
    // If parsing fails, try to extract verdict from text
    const isPass = text.toLowerCase().includes('"verdict": "pass"') || text.toLowerCase().includes('"verdict":"pass"');
    return {
      verdict: isPass ? 'pass' : 'fail',
      reasoning: text.slice(0, 200),
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/server/src/eval/llm-judge.ts
git commit -m "feat(eval): implement LLM-as-judge scorer"
```

---

### Task 6: Implement error-analyzer.ts

**Files:**
- Create: `browser-agent-chat/server/src/eval/error-analyzer.ts`

- [ ] **Step 1: Create the error analyzer module**

```typescript
import type { ErrorType, Check } from '../types';
import type { CheckResult } from './checks';

interface AnalysisInput {
  steps: Array<{ order: number; action: string; target?: string }>;
  finalUrl: string;
  failedChecks: CheckResult[];
  taskPrompt: string;
}

export function classifyError(input: AnalysisInput): ErrorType {
  const { steps, finalUrl, failedChecks, taskPrompt } = input;

  // No steps taken at all → likely a startup/connection issue
  if (steps.length === 0) {
    return 'unexpected_state';
  }

  // Check for URL-based failures first (navigation problems)
  const urlCheck = failedChecks.find(c => c.check.type === 'url_matches');
  if (urlCheck) {
    return 'navigation_failure';
  }

  // Check if agent stopped too early (partial completion)
  const lastStep = steps[steps.length - 1];
  if (steps.length <= 2 && failedChecks.length > 0) {
    return 'partial_completion';
  }

  // Check for element-related failures
  const elementChecks = failedChecks.filter(
    c => c.check.type === 'element_exists' || c.check.type === 'element_absent'
  );
  if (elementChecks.length > 0 && elementChecks.length === failedChecks.length) {
    // All failures are element-related
    // If agent navigated to the right page but elements are wrong
    if (!urlCheck) {
      return 'element_not_found';
    }
  }

  // Check for text content mismatches (could be wrong element or hallucination)
  const textChecks = failedChecks.filter(c => c.check.type === 'text_contains');
  if (textChecks.length > 0) {
    // Agent found the element but text is wrong — likely interacted with wrong thing
    const hasCorrectNav = !urlCheck;
    if (hasCorrectNav && steps.length > 3) {
      return 'wrong_element';
    }
    return 'hallucination';
  }

  // Check for timeout patterns in step descriptions
  const hasTimeout = steps.some(s =>
    s.action.toLowerCase().includes('timeout') ||
    s.action.toLowerCase().includes('timed out')
  );
  if (hasTimeout) {
    return 'action_timeout';
  }

  // Check for extract vs act confusion
  const hasExtractAfterAct = steps.some((s, i) =>
    s.action.includes('extract') && i > 0 && steps[i - 1].action.includes('act')
  );
  if (hasExtractAfterAct && failedChecks.length > 0) {
    return 'tool_misuse';
  }

  // If many steps taken but still failed — likely reasoning error
  if (steps.length > 5) {
    return 'reasoning_error';
  }

  // Default
  return 'partial_completion';
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/server/src/eval/error-analyzer.ts
git commit -m "feat(eval): implement error taxonomy classifier"
```

---

### Task 7: Implement eval-runner.ts

**Files:**
- Create: `browser-agent-chat/server/src/eval/eval-runner.ts`

- [ ] **Step 1: Create the eval runner module**

```typescript
import { createAgent, executeTask } from '../agent';
import { claimWarm, killBrowser, launchBrowser } from '../browserManager';
import {
  createEvalRun, updateEvalRun, createEvalResult,
  listEvalCases, getEvalRunStatus,
} from '../db';
import type { EvalRunTrigger, EvalRun, EvalCase, ServerMessage } from '../types';
import { runChecks, summarizeChecks } from './checks';
import { judgeWithLLM } from './llm-judge';
import { classifyError } from './error-analyzer';

interface EvalBroadcast {
  (msg: ServerMessage): void;
}

// Active runs tracked for cancellation
const activeRuns = new Map<string, { cancelled: boolean }>();

export function cancelRun(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (run) {
    run.cancelled = true;
    return true;
  }
  return false;
}

export async function startEvalRun(
  projectId: string,
  trigger: EvalRunTrigger,
  broadcast: EvalBroadcast,
  tags?: string[],
): Promise<EvalRun | null> {
  // Create the run record
  const run = await createEvalRun(projectId, trigger);
  if (!run) return null;

  const runState = { cancelled: false };
  activeRuns.set(run.id, runState);

  // Load eval cases
  const cases = await listEvalCases(projectId, { status: 'active', tags });
  if (cases.length === 0) {
    await updateEvalRun(run.id, {
      status: 'completed',
      summary: { total: 0, passed: 0, failed: 0, errored: 0, error_breakdown: {} },
      completed_at: new Date().toISOString(),
    });
    activeRuns.delete(run.id);
    return run;
  }

  // Run cases sequentially (async, don't await here to return immediately)
  runCasesSequentially(run.id, projectId, cases, broadcast, runState).catch(err => {
    console.error(`Eval run ${run.id} failed:`, err);
    updateEvalRun(run.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
    });
    activeRuns.delete(run.id);
  });

  return run;
}

async function runCasesSequentially(
  runId: string,
  projectId: string,
  cases: EvalCase[],
  broadcast: EvalBroadcast,
  runState: { cancelled: boolean },
) {
  let passed = 0;
  let failed = 0;
  let errored = 0;
  const errorBreakdown: Record<string, number> = {};

  for (let i = 0; i < cases.length; i++) {
    // Check for cancellation between cases
    if (runState.cancelled) {
      await updateEvalRun(runId, {
        status: 'cancelled',
        summary: { total: cases.length, passed, failed, errored, error_breakdown: errorBreakdown },
        completed_at: new Date().toISOString(),
      });
      activeRuns.delete(runId);
      return;
    }

    const evalCase = cases[i];
    const startTime = Date.now();

    try {
      const result = await runSingleCase(runId, projectId, evalCase);
      const duration = Date.now() - startTime;

      // Persist result
      await createEvalResult({
        run_id: runId,
        case_id: evalCase.id,
        session_id: null,
        verdict: result.verdict,
        code_checks: result.codeChecks,
        llm_judge: result.llmJudge,
        error_type: result.errorType,
        steps_taken: result.steps,
        duration_ms: duration,
        screenshots: result.screenshots,
      });

      if (result.verdict === 'pass') passed++;
      else if (result.verdict === 'fail') {
        failed++;
        if (result.errorType) {
          errorBreakdown[result.errorType] = (errorBreakdown[result.errorType] ?? 0) + 1;
        }
      } else {
        errored++;
      }

      // Broadcast progress
      broadcast({
        type: 'evalProgress',
        runId,
        completed: i + 1,
        total: cases.length,
        latest: { case: evalCase.name, verdict: result.verdict },
      });
    } catch (err) {
      errored++;
      console.error(`Eval case ${evalCase.id} error:`, err);
      await createEvalResult({
        run_id: runId,
        case_id: evalCase.id,
        session_id: null,
        verdict: 'error',
        code_checks: {},
        llm_judge: null,
        error_type: 'unexpected_state',
        steps_taken: [],
        duration_ms: Date.now() - startTime,
        screenshots: [],
      });
    }
  }

  // Finalize
  const summary = { total: cases.length, passed, failed, errored, error_breakdown: errorBreakdown };
  await updateEvalRun(runId, {
    status: 'completed',
    summary,
    completed_at: new Date().toISOString(),
  });
  activeRuns.delete(runId);

  broadcast({
    type: 'evalComplete',
    runId,
    summary: { total: cases.length, passed, failed, errorBreakdown },
  });
}

interface CaseResult {
  verdict: 'pass' | 'fail' | 'error';
  codeChecks: Record<string, boolean>;
  llmJudge: { verdict: string; reasoning: string } | null;
  errorType: string | null;
  steps: Array<{ order: number; action: string; target?: string }>;
  screenshots: string[];
}

async function runSingleCase(
  runId: string,
  projectId: string,
  evalCase: EvalCase,
): Promise<CaseResult> {
  // Claim a browser
  let browserInfo = await claimWarm(projectId);
  if (!browserInfo) {
    // Launch a new one if warm pool is empty
    try {
      browserInfo = await launchBrowser(projectId);
    } catch (err) {
      console.error('Failed to launch browser for eval:', err);
      return {
        verdict: 'error',
        codeChecks: {},
        llmJudge: null,
        errorType: 'unexpected_state',
        steps: [],
        screenshots: [],
      };
    }
  }

  const steps: Array<{ order: number; action: string; target?: string }> = [];
  const screenshots: string[] = [];
  let lastScreenshot = '';

  // Eval-specific broadcast: captures steps and screenshots, no side effects
  const evalBroadcast = (msg: ServerMessage) => {
    if (msg.type === 'action') {
      steps.push({ order: steps.length + 1, action: msg.action, target: msg.target });
    } else if (msg.type === 'screenshot') {
      lastScreenshot = msg.data;
    }
  };

  try {
    // Create agent with eval broadcast (no Redis writes, no findings, no nav graph)
    // Pass projectId=null to prevent nav graph writes and finding/suggestion detection
    // (those are gated on `if (projectId && sessionId)` in agent.ts)
    const agentSession = await createAgent(
      evalBroadcast,
      browserInfo.cdpEndpoint,
      null, // no session ID — prevents finding/suggestion detection
      null, // no project ID — prevents nav graph writes
    );

    // Execute the task
    await executeTask(agentSession, evalCase.task_prompt, evalBroadcast);

    // Capture final screenshot
    if (lastScreenshot) {
      screenshots.push(lastScreenshot);
    }

    // Run code-based checks against the live page
    const page = agentSession.connector.getHarness().page;
    const checkResults = await runChecks(page, evalCase.checks);
    const codeChecks = summarizeChecks(checkResults);
    const allChecksPassed = checkResults.every(r => r.passed);

    let verdict: 'pass' | 'fail' = allChecksPassed ? 'pass' : 'fail';
    let llmJudge: { verdict: string; reasoning: string } | null = null;

    // LLM judge only runs if code checks pass AND criteria is set
    if (allChecksPassed && evalCase.llm_judge_criteria && lastScreenshot) {
      const stepsDesc = steps.map(s => `${s.order}. ${s.action}${s.target ? ` (${s.target})` : ''}`).join('\n');
      llmJudge = await judgeWithLLM(
        lastScreenshot,
        evalCase.llm_judge_criteria,
        evalCase.task_prompt,
        stepsDesc,
      );
      verdict = llmJudge.verdict === 'pass' ? 'pass' : 'fail';
    }

    // Classify error if failed
    let errorType: string | null = null;
    if (verdict === 'fail') {
      const failedChecks = checkResults.filter(r => !r.passed);
      errorType = classifyError({
        steps,
        finalUrl: page.url(),
        failedChecks,
        taskPrompt: evalCase.task_prompt,
      });
    }

    // Clean up agent
    await agentSession.close();

    return { verdict, codeChecks, llmJudge, errorType, steps, screenshots };
  } finally {
    // Always kill the browser to ensure clean state for next case
    await killBrowser(browserInfo.pid, browserInfo.port);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/server/src/eval/eval-runner.ts
git commit -m "feat(eval): implement eval runner orchestrator"
```

---

### Task 8: Implement seed.ts

**Files:**
- Create: `browser-agent-chat/server/src/eval/seed.ts`

- [ ] **Step 1: Create the eval case seeding module**

```typescript
import { listFeatures, listFindings, createEvalCase } from '../db';
import type { EvalCase, Check } from '../types';

interface SeedResult {
  created: number;
  skipped: number;
  cases: Array<{ name: string; source_type: string }>;
}

export async function seedEvalCases(projectId: string): Promise<SeedResult> {
  const result: SeedResult = { created: 0, skipped: 0, cases: [] };

  // Seed from features (features include nested flows via listFeatures)
  const features = await listFeatures(projectId);
  for (const feature of features) {
    if (!feature.expected_behaviors?.length) continue;

    for (const behavior of feature.expected_behaviors) {
      const name = `${feature.name}: ${behavior}`;
      const created = await createEvalCase({
        project_id: projectId,
        name,
        task_prompt: `Test the "${feature.name}" feature. Verify: ${behavior}`,
        source_type: 'feature',
        source_id: feature.id,
        checks: [], // User will add specific checks later
        llm_judge_criteria: `Verify that: ${behavior}`,
        tags: ['seeded', 'feature'],
        status: 'active',
      });
      if (created) {
        result.created++;
        result.cases.push({ name, source_type: 'feature' });
      } else {
        result.skipped++;
      }
    }

    // Seed from flows embedded in each feature
    if (feature.flows?.length) {
      for (const flow of feature.flows) {
        const name = `Flow: ${flow.name}`;
        const checks: Check[] = [];
        const criteria = flow.checkpoints?.length
          ? `Verify these checkpoints are met: ${flow.checkpoints.map((c: any) => c.description ?? c).join('; ')}`
          : null;

        const created = await createEvalCase({
          project_id: projectId,
          name,
          task_prompt: `Complete the flow: ${flow.name}. Steps: ${flow.steps?.map((s: any) => s.description ?? s).join(' → ') ?? 'follow the standard flow'}`,
          source_type: 'flow',
          source_id: flow.id,
          checks,
          llm_judge_criteria: criteria,
          tags: ['seeded', 'flow'],
          status: 'active',
        });
        if (created) {
          result.created++;
          result.cases.push({ name, source_type: 'flow' });
        } else {
          result.skipped++;
        }
      }
    }
  }

  // Seed from findings (regression tests)
  const { findings } = await listFindings(projectId, { status: 'confirmed' as any });
  for (const finding of findings) {
    if (!finding.steps_to_reproduce?.length) continue;

    const name = `Regression: ${finding.title}`;
    const created = await createEvalCase({
      project_id: projectId,
      name,
      // steps_to_reproduce is ReproStep[] with { order, action, target? }
      task_prompt: finding.steps_to_reproduce.map((s: any) => s.action ?? s).join('. '),
      source_type: 'finding',
      source_id: finding.id,
      checks: [],
      llm_judge_criteria: finding.expected_behavior
        ? `Verify that: ${finding.expected_behavior}`
        : null,
      tags: ['seeded', 'regression'],
      status: 'active',
    });
    if (created) {
      result.created++;
      result.cases.push({ name, source_type: 'finding' });
    } else {
      result.skipped++;
    }
  }

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/server/src/eval/seed.ts
git commit -m "feat(eval): implement eval case seeding from features/flows/findings"
```

---

## Chunk 3: REST API Routes

### Task 9: Create evals router

**Files:**
- Create: `browser-agent-chat/server/src/routes/evals.ts`

- [ ] **Step 1: Create the evals router**

```typescript
import { Router } from 'express';
import { requireAuth } from '../auth';
import {
  listEvalCases, createEvalCase, getEvalCase, updateEvalCase, deleteEvalCase,
  listEvalRuns, getEvalRun, updateEvalRun, listEvalResults,
  getProject,
} from '../db';
import { startEvalRun, cancelRun } from '../eval/eval-runner';
import { seedEvalCases } from '../eval/seed';
import { CheckArraySchema } from '../eval/checks';
import type { ServerMessage } from '../types';

const router = Router({ mergeParams: true });

// --- Eval Cases ---

router.get('/cases', requireAuth, async (req, res) => {
  const projectId = req.params.id;
  const status = req.query.status as string | undefined;
  const tags = req.query.tags ? (req.query.tags as string).split(',') : undefined;
  const cases = await listEvalCases(projectId, { status, tags });
  res.json({ cases });
});

router.post('/cases', requireAuth, async (req, res) => {
  const projectId = req.params.id;
  const { name, task_prompt, checks, llm_judge_criteria, tags } = req.body;

  if (!name || !task_prompt) {
    return res.status(400).json({ error: 'name and task_prompt are required' });
  }

  // Validate checks with Zod
  if (checks) {
    const parsed = CheckArraySchema.safeParse(checks);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid checks format', details: parsed.error.issues });
    }
  }

  const evalCase = await createEvalCase({
    project_id: projectId,
    name,
    task_prompt,
    source_type: 'manual',
    source_id: null,
    checks: checks ?? [],
    llm_judge_criteria: llm_judge_criteria ?? null,
    tags: tags ?? [],
    status: 'active',
  });

  if (!evalCase) return res.status(500).json({ error: 'Failed to create eval case' });
  res.status(201).json(evalCase);
});

router.put('/cases/:caseId', requireAuth, async (req, res) => {
  const { caseId } = req.params;
  const { name, task_prompt, checks, llm_judge_criteria, tags, status } = req.body;

  if (checks) {
    const parsed = CheckArraySchema.safeParse(checks);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid checks format', details: parsed.error.issues });
    }
  }

  const updated = await updateEvalCase(caseId, { name, task_prompt, checks, llm_judge_criteria, tags, status });
  if (!updated) return res.status(404).json({ error: 'Eval case not found' });
  res.json(updated);
});

router.delete('/cases/:caseId', requireAuth, async (req, res) => {
  const { caseId } = req.params;
  const deleted = await deleteEvalCase(caseId);
  if (!deleted) return res.status(404).json({ error: 'Eval case not found' });
  res.status(204).end();
});

// --- Eval Runs ---

router.post('/run', requireAuth, async (req, res) => {
  const projectId = req.params.id;
  const tags = req.body.tags as string[] | undefined;

  // Import broadcastToProject from index.ts to send eval progress to connected WS clients
  const { broadcastToProject } = await import('../index');
  const broadcast: (msg: ServerMessage) => void = (msg) => {
    broadcastToProject(projectId, msg);
  };

  const run = await startEvalRun(projectId, 'manual', broadcast, tags);
  if (!run) return res.status(500).json({ error: 'Failed to start eval run' });
  res.status(201).json(run);
});

router.get('/runs', requireAuth, async (req, res) => {
  const projectId = req.params.id;
  const limit = parseInt(req.query.limit as string) || 20;
  const runs = await listEvalRuns(projectId, limit);
  res.json({ runs });
});

router.get('/runs/:runId', requireAuth, async (req, res) => {
  const { runId } = req.params;
  const run = await getEvalRun(runId);
  if (!run) return res.status(404).json({ error: 'Eval run not found' });
  const results = await listEvalResults(runId);
  // Enrich results with case names for display
  const cases = await listEvalCases(run.project_id);
  const caseMap = new Map(cases.map(c => [c.id, c]));
  const enrichedResults = results.map(r => ({
    ...r,
    case_name: caseMap.get(r.case_id)?.name ?? r.case_id,
    case_source_type: caseMap.get(r.case_id)?.source_type ?? 'unknown',
  }));
  res.json({ run, results: enrichedResults });
});

router.post('/runs/:runId/cancel', requireAuth, async (req, res) => {
  const { runId } = req.params;
  const cancelled = cancelRun(runId);
  if (!cancelled) {
    // Try DB-level cancellation for runs not in this server instance
    const updated = await updateEvalRun(runId, { status: 'cancelled', completed_at: new Date().toISOString() });
    if (!updated) return res.status(404).json({ error: 'Eval run not found' });
  }
  res.json({ status: 'cancelled' });
});

// --- Seeding ---

router.post('/seed', requireAuth, async (req, res) => {
  const projectId = req.params.id;
  const result = await seedEvalCases(projectId);
  res.json(result);
});

// --- Scheduling ---

router.post('/schedule', requireAuth, async (req, res) => {
  const projectId = req.params.id;
  const { cron_schedule } = req.body;

  // Update the project's eval_cron_schedule column
  const project = await getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Validate cron expression (basic check)
  if (cron_schedule && !/^[\d\*\/\-\,\s]+$/.test(cron_schedule)) {
    return res.status(400).json({ error: 'Invalid cron expression' });
  }

  // Persist the schedule
  const { updateProjectEvalSchedule } = await import('../db');
  const updated = await updateProjectEvalSchedule(projectId, cron_schedule ?? null);
  if (!updated) return res.status(500).json({ error: 'Failed to update schedule' });

  // Re-register cron timer (import from index.ts or a cron manager)
  res.json({ project_id: projectId, eval_cron_schedule: cron_schedule ?? null });
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/server/src/routes/evals.ts
git commit -m "feat(eval): add REST API routes for eval CRUD and execution"
```

---

### Task 10: Mount evals router and wire up WebSocket broadcast in index.ts

**Files:**
- Modify: `browser-agent-chat/server/src/index.ts`

- [ ] **Step 1: Add import for evals router**

Add alongside the existing route imports (around line 7-10):

```typescript
import evalsRouter from './routes/evals';
```

- [ ] **Step 2: Mount the router**

Add alongside the existing `app.use()` calls (around line 56-60):

```typescript
app.use('/api/projects/:id/evals', evalsRouter);
```

- [ ] **Step 3: Export a broadcast-to-project utility for eval progress**

Add a helper that the evals router can use to broadcast eval progress to connected WebSocket clients. Find the `wss` WebSocket server instance and add this after its initialization:

```typescript
// Eval progress broadcast — sends to all WS clients connected to a project
export function broadcastToProject(projectId: string, msg: ServerMessage) {
  const clients = wsClients.get(projectId);
  if (!clients) return;
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}
```

Then update the evals router import in `routes/evals.ts` to accept a broadcast function. Add to the router setup:

```typescript
// In routes/evals.ts, update the run endpoint to use the broadcast:
// Pass broadcastToProject to startEvalRun instead of the console.log stub
```

Alternatively, export `broadcastToProject` from `index.ts` and import it in `routes/evals.ts`.

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/server/src/index.ts
git commit -m "feat(eval): mount evals router and wire up WS broadcast"
```

---

## Chunk 4: Client UI

### Task 11: Create EvalDashboard component

**Files:**
- Create: `browser-agent-chat/client/src/components/EvalDashboard.tsx`

- [ ] **Step 1: Create the eval dashboard component**

```tsx
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { apiAuthFetch } from '../lib/api';
import type { EvalRun, EvalCase } from '../types/eval';
import EvalRunDetail from './EvalRunDetail';
import EvalCaseEditor from './EvalCaseEditor';

// Note: Use apiAuthFetch() from lib/api.ts for all API calls.
// It prepends VITE_API_URL (needed in production) and attaches auth headers.

export default function EvalDashboard() {
  const { id: projectId } = useParams<{ id: string }>();
  const { getAccessToken } = useAuth();
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [selectedRun, setSelectedRun] = useState<EvalRun | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<'runs' | 'cases'>('runs');

  const fetchData = async () => {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    const [runsRes, casesRes] = await Promise.all([
      apiAuthFetch(`/api/projects/${projectId}/evals/runs`, token),
      apiAuthFetch(`/api/projects/${projectId}/evals/cases`, token),
    ]);

    if (runsRes.ok) {
      const data = await runsRes.json();
      setRuns(data.runs);
    }
    if (casesRes.ok) {
      const data = await casesRes.json();
      setCases(data.cases);
    }
  };

  useEffect(() => { fetchData(); }, [projectId]);

  const handleRunAll = async () => {
    setRunning(true);
    const token = await getAccessToken();
    const res = await apiAuthFetch(`/api/projects/${projectId}/evals/run`, token, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const run = await res.json();
      setRuns(prev => [run, ...prev]);
    }
    setRunning(false);
  };

  const handleSeed = async () => {
    const token = await getAccessToken();
    const res = await apiAuthFetch(`/api/projects/${projectId}/evals/seed`, token, {
      method: 'POST',
    });
    if (res.ok) {
      await fetchData();
    }
  };

  if (selectedRun) {
    return (
      <EvalRunDetail
        run={selectedRun}
        onBack={() => { setSelectedRun(null); fetchData(); }}
      />
    );
  }

  if (showEditor) {
    return (
      <EvalCaseEditor
        projectId={projectId!}
        onSave={() => { setShowEditor(false); fetchData(); }}
        onCancel={() => setShowEditor(false)}
      />
    );
  }

  return (
    <div className="eval-dashboard">
      <div className="eval-header">
        <div className="eval-title-row">
          <h2>Evaluations</h2>
          <span className="eval-badge">{cases.length} cases</span>
        </div>
        <div className="eval-actions">
          <div className="eval-tabs">
            <button
              className={`eval-tab ${view === 'runs' ? 'active' : ''}`}
              onClick={() => setView('runs')}
            >
              Runs
            </button>
            <button
              className={`eval-tab ${view === 'cases' ? 'active' : ''}`}
              onClick={() => setView('cases')}
            >
              Cases
            </button>
          </div>
          <button className="eval-btn primary" onClick={handleRunAll} disabled={running || cases.length === 0}>
            {running ? 'Running...' : '▶ Run All'}
          </button>
          <button className="eval-btn" onClick={() => setShowEditor(true)}>+ New Case</button>
          {cases.length === 0 && (
            <button className="eval-btn" onClick={handleSeed}>Seed from Features</button>
          )}
        </div>
      </div>

      {view === 'runs' ? (
        <div className="eval-runs-list">
          {runs.length === 0 ? (
            <div className="eval-empty">No eval runs yet. Create some cases and click "Run All".</div>
          ) : (
            runs.map(run => (
              <div
                key={run.id}
                className="eval-run-row"
                onClick={() => setSelectedRun(run)}
              >
                <span className={`eval-dot ${run.status === 'completed' && (run.summary.failed ?? 0) === 0 ? 'green' : run.status === 'running' ? 'blue' : 'red'}`} />
                <span className="eval-run-id">Run #{runs.indexOf(run) + 1}</span>
                <span className="eval-trigger">{run.trigger}</span>
                <span className="eval-results-summary">
                  <span className="pass">{run.summary.passed ?? 0} pass</span>
                  {' · '}
                  <span className="fail">{run.summary.failed ?? 0} fail</span>
                </span>
                <span className="eval-status">{run.status}</span>
                <span className="eval-time">{new Date(run.started_at).toLocaleDateString()}</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="eval-cases-list">
          {cases.map(c => (
            <div key={c.id} className="eval-case-row">
              <span className={`eval-case-status ${c.status}`}>{c.status === 'active' ? '●' : '○'}</span>
              <span className="eval-case-name">{c.name}</span>
              <span className="eval-case-source">{c.source_type}</span>
              <span className="eval-case-checks">{c.checks.length} checks</span>
              {c.llm_judge_criteria && <span className="eval-case-judge">+ judge</span>}
              <div className="eval-case-tags">
                {c.tags.map(t => <span key={t} className="eval-tag">{t}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/src/components/EvalDashboard.tsx
git commit -m "feat(eval): add EvalDashboard component"
```

---

### Task 12: Create EvalRunDetail component

**Files:**
- Create: `browser-agent-chat/client/src/components/EvalRunDetail.tsx`

- [ ] **Step 1: Create the run detail component**

```tsx
import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiAuthFetch } from '../lib/api';
import type { EvalRun, EvalResult } from '../types/eval';
import EvalResultDetail from './EvalResultDetail';

interface Props {
  run: EvalRun;
  onBack: () => void;
}

export default function EvalRunDetail({ run, onBack }: Props) {
  const { getAccessToken } = useAuth();
  const [results, setResults] = useState<EvalResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<EvalResult | null>(null);

  useEffect(() => {
    const load = async () => {
      const token = await getAccessToken();
      const res = await apiAuthFetch(`/api/projects/${run.project_id}/evals/runs/${run.id}`, token);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results);
      }
    };
    load();
  }, [run.id]);

  const passRate = run.summary.total
    ? Math.round(((run.summary.passed ?? 0) / run.summary.total) * 100)
    : 0;

  const topError = run.summary.error_breakdown
    ? Object.entries(run.summary.error_breakdown).sort(([, a], [, b]) => b - a)[0]
    : null;

  if (selectedResult) {
    return <EvalResultDetail result={selectedResult} onBack={() => setSelectedResult(null)} />;
  }

  return (
    <div className="eval-run-detail">
      <button className="eval-back-btn" onClick={onBack}>← Back to runs</button>

      <div className="eval-summary-bar">
        <div className="eval-stat">
          <span className="eval-stat-value pass-rate">{passRate}%</span>
          <span className="eval-stat-label">PASS RATE</span>
        </div>
        <div className="eval-stat">
          <span className="eval-stat-value">{run.summary.total ?? 0}</span>
          <span className="eval-stat-label">TOTAL</span>
        </div>
        <div className="eval-stat">
          <span className="eval-stat-value pass">{run.summary.passed ?? 0}</span>
          <span className="eval-stat-label">PASSED</span>
        </div>
        <div className="eval-stat">
          <span className="eval-stat-value fail">{run.summary.failed ?? 0}</span>
          <span className="eval-stat-label">FAILED</span>
        </div>
        {topError && (
          <div className="eval-stat">
            <span className="eval-stat-value error-type">{topError[0].replace('_', ' ')}</span>
            <span className="eval-stat-label">TOP ERROR</span>
          </div>
        )}
      </div>

      <div className="eval-results-list">
        {results.map(result => (
          <div
            key={result.id}
            className={`eval-result-row ${result.verdict}`}
            onClick={() => result.verdict !== 'pass' ? setSelectedResult(result) : undefined}
          >
            <span className={`eval-verdict-icon ${result.verdict}`}>
              {result.verdict === 'pass' ? '✓' : result.verdict === 'fail' ? '✗' : '!'}
            </span>
            <span className="eval-result-name">{(result as any).case_name ?? result.case_id}</span>
            <span className="eval-result-checks">
              {Object.values(result.code_checks).filter(Boolean).length}/
              {Object.keys(result.code_checks).length} checks
              {result.llm_judge && ` + judge ${result.llm_judge.verdict === 'pass' ? '✓' : '✗'}`}
            </span>
            {result.error_type && (
              <span className="eval-error-type">{result.error_type.replace(/_/g, ' ')}</span>
            )}
            <span className="eval-duration">{result.duration_ms ? `${(result.duration_ms / 1000).toFixed(1)}s` : '-'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/src/components/EvalRunDetail.tsx
git commit -m "feat(eval): add EvalRunDetail component"
```

---

### Task 13: Create EvalResultDetail component

**Files:**
- Create: `browser-agent-chat/client/src/components/EvalResultDetail.tsx`

- [ ] **Step 1: Create the result detail component**

```tsx
import type { EvalResult } from '../types/eval';

interface Props {
  result: EvalResult;
  onBack: () => void;
}

export default function EvalResultDetail({ result, onBack }: Props) {
  return (
    <div className="eval-result-detail">
      <button className="eval-back-btn" onClick={onBack}>← Back to results</button>

      <div className="eval-detail-grid">
        <div className="eval-detail-section">
          <h3>Error Type</h3>
          <span className="eval-error-type-large">
            {result.error_type?.replace(/_/g, ' ') ?? 'Unknown'}
          </span>
        </div>

        <div className="eval-detail-section">
          <h3>Failed Checks</h3>
          {Object.entries(result.code_checks).map(([check, passed]) => (
            <div key={check} className={`eval-check-item ${passed ? 'pass' : 'fail'}`}>
              <span>{passed ? '✓' : '✗'}</span>
              <span>{check}</span>
            </div>
          ))}
        </div>

        {result.llm_judge && (
          <div className="eval-detail-section">
            <h3>LLM Judge</h3>
            <div className={`eval-judge-verdict ${result.llm_judge.verdict}`}>
              {result.llm_judge.verdict}
            </div>
            <p className="eval-judge-reasoning">{result.llm_judge.reasoning}</p>
          </div>
        )}

        <div className="eval-detail-section">
          <h3>Agent Steps</h3>
          <ol className="eval-steps-list">
            {result.steps_taken.map((step, i) => (
              <li key={i}>
                {step.action}
                {step.target && <span className="eval-step-target">({step.target})</span>}
              </li>
            ))}
          </ol>
        </div>

        {result.screenshots.length > 0 && (
          <div className="eval-detail-section">
            <h3>Final Screenshot</h3>
            <img
              className="eval-screenshot"
              src={`data:image/png;base64,${result.screenshots[result.screenshots.length - 1]}`}
              alt="Final browser state"
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/src/components/EvalResultDetail.tsx
git commit -m "feat(eval): add EvalResultDetail component"
```

---

### Task 14: Create EvalCaseEditor component

**Files:**
- Create: `browser-agent-chat/client/src/components/EvalCaseEditor.tsx`

- [ ] **Step 1: Create the case editor component**

```tsx
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiAuthFetch } from '../lib/api';

interface Props {
  projectId: string;
  onSave: () => void;
  onCancel: () => void;
}

export default function EvalCaseEditor({ projectId, onSave, onCancel }: Props) {
  const { getAccessToken } = useAuth();
  const [name, setName] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [llmJudgeCriteria, setLlmJudgeCriteria] = useState('');
  const [tags, setTags] = useState('');
  const [checksJson, setChecksJson] = useState('[]');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !taskPrompt.trim()) {
      setError('Name and task prompt are required');
      return;
    }

    let checks;
    try {
      checks = JSON.parse(checksJson);
    } catch {
      setError('Invalid JSON in checks field');
      return;
    }

    setSaving(true);
    setError('');

    const token = await getAccessToken();
    const res = await apiAuthFetch(`/api/projects/${projectId}/evals/cases`, token, {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        task_prompt: taskPrompt.trim(),
        checks,
        llm_judge_criteria: llmJudgeCriteria.trim() || null,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      }),
    });

    if (res.ok) {
      onSave();
    } else {
      const data = await res.json();
      setError(data.error || 'Failed to create eval case');
    }
    setSaving(false);
  };

  return (
    <div className="eval-case-editor">
      <h2>New Eval Case</h2>

      {error && <div className="eval-error">{error}</div>}

      <label>
        <span>Name</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Login with valid credentials" />
      </label>

      <label>
        <span>Task Prompt</span>
        <textarea value={taskPrompt} onChange={e => setTaskPrompt(e.target.value)} placeholder="Log in with username admin and password test123" rows={3} />
      </label>

      <label>
        <span>Checks (JSON)</span>
        <textarea value={checksJson} onChange={e => setChecksJson(e.target.value)} rows={5} className="mono" placeholder='[{"type": "url_matches", "pattern": "/dashboard"}]' />
      </label>

      <label>
        <span>LLM Judge Criteria (optional)</span>
        <textarea value={llmJudgeCriteria} onChange={e => setLlmJudgeCriteria(e.target.value)} placeholder="Verify the dashboard shows the user's name and recent activity" rows={2} />
      </label>

      <label>
        <span>Tags (comma-separated)</span>
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="login, critical, regression" />
      </label>

      <div className="eval-editor-actions">
        <button className="eval-btn" onClick={onCancel}>Cancel</button>
        <button className="eval-btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Create Case'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/src/components/EvalCaseEditor.tsx
git commit -m "feat(eval): add EvalCaseEditor component"
```

---

### Task 15: Add client-side eval types

**Files:**
- Create: `browser-agent-chat/client/src/types/eval.ts`

- [ ] **Step 1: Create client eval types**

```typescript
export interface EvalCase {
  id: string;
  project_id: string;
  name: string;
  task_prompt: string;
  source_type: 'feature' | 'flow' | 'finding' | 'manual';
  source_id: string | null;
  checks: any[];
  llm_judge_criteria: string | null;
  tags: string[];
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface EvalRun {
  id: string;
  project_id: string;
  trigger: 'manual' | 'scheduled' | 'ci';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  summary: {
    total?: number;
    passed?: number;
    failed?: number;
    errored?: number;
    error_breakdown?: Record<string, number>;
  };
  started_at: string;
  completed_at: string | null;
}

export interface EvalResult {
  id: string;
  run_id: string;
  case_id: string;
  session_id: string | null;
  verdict: 'pass' | 'fail' | 'error';
  code_checks: Record<string, boolean>;
  llm_judge: { verdict: string; reasoning: string } | null;
  error_type: string | null;
  steps_taken: Array<{ order: number; action: string; target?: string }>;
  duration_ms: number | null;
  screenshots: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/src/types/eval.ts
git commit -m "feat(eval): add client-side eval types"
```

---

## Chunk 5: Wiring & Integration

### Task 16: Add eval route to App.tsx

**Files:**
- Modify: `browser-agent-chat/client/src/App.tsx`

- [ ] **Step 1: Add import and route**

Add import:
```typescript
import EvalDashboard from './components/EvalDashboard';
```

Add route alongside existing project routes:
```tsx
<Route path="/projects/:id/evals" element={<ProtectedRoute><EvalDashboard /></ProtectedRoute>} />
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/src/App.tsx
git commit -m "feat(eval): add /projects/:id/evals route"
```

---

### Task 17: Add Evals link to Sidebar

**Files:**
- Modify: `browser-agent-chat/client/src/components/Sidebar.tsx`

- [ ] **Step 1: Add Evals navigation item**

Add an "Evals" entry in the sidebar navigation list, following the existing pattern for Findings/Memory/Settings links. Use the `ClipboardCheck` icon from lucide-react (or `BarChart3` if that's more fitting). Place it after "Findings" in the nav order.

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/src/components/Sidebar.tsx
git commit -m "feat(eval): add Evals link to sidebar navigation"
```

---

### Task 18: Add CSS styles for eval components

**Files:**
- Modify: `browser-agent-chat/client/src/App.css`

- [ ] **Step 1: Add eval-specific CSS**

Add eval styles at the end of App.css, using existing CSS variables for theming consistency:

```css
/* === Eval Dashboard Styles === */

.eval-dashboard, .eval-run-detail, .eval-result-detail, .eval-case-editor {
  padding: 1.5rem;
  max-width: 900px;
}

.eval-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.eval-title-row {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.eval-title-row h2 { margin: 0; }

.eval-badge {
  padding: 0.2rem 0.6rem;
  border-radius: 12px;
  background: var(--accent-bg, rgba(34, 197, 94, 0.15));
  color: var(--accent, #22c55e);
  font-size: 12px;
}

.eval-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.eval-tabs {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  margin-right: 0.5rem;
}

.eval-tab {
  padding: 0.4rem 1rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
}

.eval-tab.active {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.eval-btn {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
}

.eval-btn.primary {
  background: #6366f1;
  color: white;
  border: none;
}

.eval-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Run rows */
.eval-run-row {
  display: flex;
  align-items: center;
  padding: 0.8rem 1rem;
  gap: 1rem;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 0.3rem;
}

.eval-run-row:hover {
  background: var(--bg-secondary);
}

.eval-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.eval-dot.green { background: #22c55e; }
.eval-dot.red { background: #ef4444; }
.eval-dot.blue { background: #3b82f6; }

.eval-run-id { flex: 1; font-weight: 500; }
.eval-trigger { opacity: 0.6; font-size: 13px; }
.eval-status { opacity: 0.5; font-size: 12px; }
.eval-time { opacity: 0.4; font-size: 12px; }

.pass { color: #22c55e; }
.fail { color: #ef4444; }

/* Summary bar */
.eval-summary-bar {
  display: flex;
  gap: 1.5rem;
  padding: 1rem 1.5rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 1.5rem;
}

.eval-stat { text-align: center; }
.eval-stat-value { display: block; font-size: 24px; font-weight: 700; }
.eval-stat-value.pass { color: #22c55e; }
.eval-stat-value.fail { color: #ef4444; }
.eval-stat-value.error-type { font-size: 14px; color: #f59e0b; }
.eval-stat-label { font-size: 11px; opacity: 0.5; text-transform: uppercase; letter-spacing: 1px; }

/* Result rows */
.eval-result-row {
  display: flex;
  align-items: center;
  padding: 0.7rem 1rem;
  gap: 1rem;
  border-radius: 6px;
  margin-bottom: 0.2rem;
}

.eval-result-row.fail { background: rgba(239, 68, 68, 0.05); cursor: pointer; }
.eval-result-row.fail:hover { background: rgba(239, 68, 68, 0.1); }

.eval-verdict-icon { font-size: 16px; }
.eval-verdict-icon.pass { color: #22c55e; }
.eval-verdict-icon.fail { color: #ef4444; }
.eval-verdict-icon.error { color: #f59e0b; }

.eval-result-name { flex: 1; }
.eval-result-checks { font-size: 12px; }
.eval-error-type { font-size: 12px; padding: 0.2rem 0.5rem; border-radius: 4px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
.eval-duration { opacity: 0.5; font-size: 12px; }

/* Detail view */
.eval-back-btn { background: none; border: none; cursor: pointer; color: var(--text-secondary); margin-bottom: 1rem; padding: 0; }

.eval-detail-grid {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.eval-detail-section h3 { margin: 0 0 0.5rem; font-size: 11px; text-transform: uppercase; opacity: 0.5; letter-spacing: 1px; }

.eval-error-type-large { color: #f59e0b; font-size: 18px; font-weight: 600; text-transform: capitalize; }

.eval-check-item { display: flex; gap: 0.5rem; padding: 0.3rem 0; }
.eval-check-item.pass { color: #22c55e; }
.eval-check-item.fail { color: #ef4444; }

.eval-steps-list { padding-left: 1.5rem; line-height: 1.8; }
.eval-step-target { opacity: 0.5; margin-left: 0.3rem; }

.eval-screenshot { max-width: 100%; border: 1px solid var(--border); border-radius: 8px; }

.eval-empty { text-align: center; padding: 3rem; opacity: 0.5; }

/* Case list */
.eval-case-row {
  display: flex;
  align-items: center;
  padding: 0.7rem 1rem;
  gap: 0.8rem;
  border-radius: 6px;
  margin-bottom: 0.2rem;
}

.eval-case-status { font-size: 10px; }
.eval-case-status.active { color: #22c55e; }
.eval-case-status.disabled { color: var(--text-secondary); }
.eval-case-name { flex: 1; }
.eval-case-source { font-size: 12px; padding: 0.2rem 0.5rem; border-radius: 4px; background: var(--bg-secondary); }
.eval-case-checks { font-size: 12px; opacity: 0.6; }
.eval-case-judge { font-size: 12px; color: #6366f1; }
.eval-tag { font-size: 11px; padding: 0.1rem 0.4rem; border-radius: 4px; background: var(--bg-secondary); margin-left: 0.3rem; }

/* Case editor */
.eval-case-editor label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 1rem;
}

.eval-case-editor label span { font-size: 13px; font-weight: 500; }
.eval-case-editor input, .eval-case-editor textarea {
  padding: 0.6rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
}
.eval-case-editor textarea.mono { font-family: monospace; font-size: 13px; }

.eval-editor-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }

.eval-error { padding: 0.6rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; color: #ef4444; margin-bottom: 1rem; font-size: 13px; }

.eval-judge-verdict { font-weight: 600; text-transform: uppercase; }
.eval-judge-verdict.pass { color: #22c55e; }
.eval-judge-verdict.fail { color: #ef4444; }
.eval-judge-reasoning { opacity: 0.7; margin-top: 0.3rem; }
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/src/App.css
git commit -m "feat(eval): add eval dashboard CSS styles"
```

---

### Task 19: Final integration verification

- [ ] **Step 1: Run Supabase migration**

Execute the SQL from `server/src/migrations/eval-tables.sql` against the Supabase project.

- [ ] **Step 2: Start dev server and verify**

```bash
cd browser-agent-chat && npm run dev
```

- [ ] **Step 3: Verify routes load**

1. Navigate to `/projects/:id/evals` — should show empty dashboard
2. Click "Seed from Features" — should populate cases from existing data
3. Click "New Case" — should show editor form
4. Create a case and verify it appears in the list

- [ ] **Step 4: Run an eval (manual test)**

1. Click "Run All" with at least one eval case
2. Verify the run appears in the runs list
3. Click into the run to see results
4. Click a failed result to see error analysis

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(eval): complete evaluation framework integration"
```
