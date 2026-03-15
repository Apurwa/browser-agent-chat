# Agent Learning System — Phase 1A Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a closed-loop learning system where browser agents improve over time through binary user feedback, statistical pattern extraction from aggregated runs, and semantic retrieval for prompt injection.

**Architecture:** User gives thumbs up/down on task completions → positive runs enter a learning pool → runs are clustered by semantic similarity → when a cluster reaches 5+ runs, a dominant workflow pattern is extracted via sequence alignment → patterns go through a candidate→active→dominant lifecycle → active patterns are injected into agent prompts via semantic retrieval, making the agent faster at previously-seen tasks.

**Tech Stack:** PostgreSQL (Supabase) with pgvector, OpenAI `text-embedding-3-small` for embeddings, Claude Haiku for task summarization, node-cron for background jobs, React for feedback UI.

**Spec:** `docs/superpowers/specs/2026-03-15-agent-learning-system-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `server/src/migrations/006_learning_system.sql` | Schema: new tables + learned_patterns extensions |
| `server/src/learning/embedding.ts` | OpenAI embedding + Haiku task summarization |
| `server/src/learning/clustering.ts` | Cluster assignment, centroid updates |
| `server/src/learning/extraction.ts` | LCS-based dominant path extraction from cluster runs |
| `server/src/learning/lifecycle.ts` | Pattern state transitions (candidate→active→dominant→stale→archived) |
| `server/src/learning/retrieval.ts` | Two-stage cluster→pattern semantic retrieval with scoring |
| `server/src/learning/jobs.ts` | Background cron jobs (merge, consolidation, health, usage) |
| `server/src/learning/pipeline.ts` | Orchestrates feedback→embed→cluster→extract flow |
| `server/src/routes/feedback.ts` | REST endpoints for feedback + pattern management |
| `client/src/components/TaskCompletionCard.tsx` | Feedback UI integrated in chat |
| `client/src/components/TaskCompletionCard.css` | Styles for completion card |

### Modified Files

| File | Changes |
|---|---|
| `server/src/types.ts` | Add TaskFeedback, LearningPoolEntry, TaskCluster types. Extend ServerMessage/ClientMessage unions. Extend LearnedPattern with new fields. |
| `server/src/db.ts` | Add CRUD functions for task_feedback, learning_pool, task_clusters. Extend learned_patterns functions. |
| `server/src/memory-engine.ts` | Add pattern retrieval + prompt injection |
| `server/src/muscle-memory.ts` | Rename `status` → `pattern_state` references |
| `server/src/index.ts` | Mount feedback route, handle WS `taskFeedback`, enrich `taskComplete` with taskId/stepCount/durationMs |
| `client/src/types.ts` | Add taskStarted to ServerMessage, taskFeedback to ClientMessage, enrich taskComplete |
| `client/src/contexts/WebSocketContext.tsx` | Handle taskStarted, enriched taskComplete, patternLearned, send taskFeedback |
| `client/src/components/ChatPanel.tsx` | Render TaskCompletionCard instead of plain system message |
| `client/src/lib/api.ts` | Add feedback API functions |

---

## Chunk 1: Foundation (Schema, Types, DB Layer)

### Task 1: Database Migration

**Files:**
- Create: `browser-agent-chat/server/src/migrations/006_learning_system.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 006_learning_system.sql
-- Agent Learning System: feedback, learning pool, clusters, pattern extensions

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Task feedback table
CREATE TABLE task_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
  correction TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT task_feedback_task_unique UNIQUE (task_id)
);

CREATE INDEX task_feedback_agent_created ON task_feedback(agent_id, created_at);
CREATE INDEX task_feedback_rating ON task_feedback(rating);

ALTER TABLE task_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their task feedback"
  ON task_feedback FOR ALL
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

-- Task clusters table
CREATE TABLE task_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  org_id UUID,
  centroid_embedding vector(1536) NOT NULL,
  task_summary TEXT NOT NULL,
  run_count INT DEFAULT 0,
  app_fingerprint TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX task_clusters_agent ON task_clusters(agent_id);
CREATE INDEX task_clusters_app ON task_clusters(app_fingerprint);

ALTER TABLE task_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their task clusters"
  ON task_clusters FOR ALL
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

-- Learning pool table
CREATE TABLE learning_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID REFERENCES task_clusters(id) ON DELETE SET NULL,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  feedback TEXT NOT NULL CHECK (feedback IN ('positive', 'negative')),
  task_prompt TEXT NOT NULL,
  task_prompt_embedding vector(1536),
  task_summary TEXT,
  task_summary_embedding vector(1536),
  steps JSONB NOT NULL,
  step_count INT NOT NULL,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX learning_pool_cluster ON learning_pool(cluster_id);
CREATE INDEX learning_pool_agent_created ON learning_pool(agent_id, created_at);
CREATE INDEX learning_pool_feedback ON learning_pool(feedback);

ALTER TABLE learning_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their learning pool"
  ON learning_pool FOR ALL
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

-- Extend learned_patterns
ALTER TABLE learned_patterns RENAME COLUMN status TO pattern_state;
ALTER TABLE learned_patterns DROP CONSTRAINT IF EXISTS learned_patterns_status_check;
ALTER TABLE learned_patterns ADD CONSTRAINT learned_patterns_pattern_state_check
  CHECK (pattern_state IN ('candidate', 'active', 'dominant', 'stale', 'archived'));

ALTER TABLE learned_patterns DROP CONSTRAINT IF EXISTS learned_patterns_pattern_type_check;
ALTER TABLE learned_patterns ADD CONSTRAINT learned_patterns_pattern_type_check
  CHECK (pattern_type IN ('login', 'navigation', 'task'));

ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'agent'
  CHECK (scope IN ('agent', 'org', 'candidate_global', 'verified_global', 'global'));
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS cluster_id UUID REFERENCES task_clusters(id) ON DELETE SET NULL;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS avg_steps INT;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS avg_duration_ms INT;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS success_rate NUMERIC;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS variance NUMERIC;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS score NUMERIC;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS source_agent_id UUID;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS app_fingerprint TEXT;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS last_verified_success TIMESTAMPTZ;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS portability_score NUMERIC;
```

- [ ] **Step 2: Apply migration to Supabase**

Run via Supabase SQL Editor or CLI:
```bash
# Using supabase CLI if available:
cd browser-agent-chat
npx supabase db push --db-url "postgresql://..." < server/src/migrations/006_learning_system.sql
```

Or paste into Supabase Dashboard → SQL Editor → Run.

Expected: All statements succeed. Verify with `\dt` that `task_feedback`, `task_clusters`, `learning_pool` exist. Verify `learned_patterns` has new columns.

- [ ] **Step 3: Commit**

```bash
git add server/src/migrations/006_learning_system.sql
git commit -m "feat: add learning system schema (006_learning_system.sql)"
```

---

### Task 2: Server Types

**Files:**
- Modify: `browser-agent-chat/server/src/types.ts`

**Context:** The existing file defines `LearnedPattern` (lines ~156-168) with `status: 'active' | 'stale'`, `ServerMessage` union (~lines 200+), and `ClientMessage` union. We need to extend all of these.

- [ ] **Step 1: Add learning system types after existing LearnedPattern**

Add these types after the existing `LearnedPattern` interface in `types.ts`:

```typescript
// --- Learning System Types ---

export type FeedbackRating = 'positive' | 'negative';

export interface TaskFeedback {
  id: string;
  agent_id: string;
  task_id: string;
  session_id: string | null;
  rating: FeedbackRating;
  correction: string | null;
  created_at: string;
}

export interface LearningPoolEntry {
  id: string;
  cluster_id: string | null;
  task_id: string;
  agent_id: string;
  feedback: FeedbackRating;
  task_prompt: string;
  task_prompt_embedding: number[] | null;
  task_summary: string | null;
  task_summary_embedding: number[] | null;
  steps: Array<{ step_order: number; step_type: string; content: string; target?: string; duration_ms?: number }>;
  step_count: number;
  duration_ms: number | null;
  created_at: string;
}

export interface TaskCluster {
  id: string;
  agent_id: string | null;
  org_id: string | null;
  centroid_embedding: number[];
  task_summary: string;
  run_count: number;
  app_fingerprint: string | null;
  created_at: string;
}

export type PatternState = 'candidate' | 'active' | 'dominant' | 'stale' | 'archived';
export type PatternScope = 'agent' | 'org' | 'candidate_global' | 'verified_global' | 'global';
```

- [ ] **Step 2: Update LearnedPattern interface**

Replace the existing `LearnedPattern` interface. Change `status` to `pattern_state` and add new fields:

```typescript
export interface LearnedPattern {
  id: string;
  agent_id: string;
  pattern_type: 'login' | 'navigation' | 'task';
  trigger: LoginTrigger;
  steps: PlaywrightStep[];
  consecutive_failures: number;
  pattern_state: PatternState;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  // Learning system extensions
  scope: PatternScope;
  embedding: number[] | null;
  cluster_id: string | null;
  avg_steps: number | null;
  avg_duration_ms: number | null;
  success_rate: number | null;
  variance: number | null;
  score: number | null;
  org_id: string | null;
  source_agent_id: string | null;
  app_fingerprint: string | null;
  last_verified_success: string | null;
  portability_score: number | null;
}
```

- [ ] **Step 3: Add new ServerMessage variants**

Add to the `ServerMessage` union type:

```typescript
  | { type: 'taskStarted'; taskId: string }
  | { type: 'taskComplete'; success: boolean; taskId?: string; stepCount?: number; durationMs?: number }
  | { type: 'patternLearned'; name: string; steps: string[]; success_rate: number; avg_steps: number; runs: number }
  | { type: 'patternStale'; name: string; reason: string }
```

Note: `taskComplete` already exists — update its shape to include optional `taskId`, `stepCount`, `durationMs`. Also add `taskStarted` if not already present. Check existing variants and merge.

- [ ] **Step 4: Add new ClientMessage variant**

Add to the `ClientMessage` union type:

```typescript
  | { type: 'taskFeedback'; task_id: string; rating: FeedbackRating; correction?: string }
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd browser-agent-chat && npx tsc --noEmit --skipLibCheck --project server/tsconfig.json
```

Expected: 0 errors (may have warnings about muscle-memory.ts `status` references — that's fixed in Task 3).

- [ ] **Step 6: Commit**

```bash
git add server/src/types.ts
git commit -m "feat: add learning system types and extend ServerMessage/ClientMessage"
```

---

### Task 3: Update muscle-memory.ts References

**Files:**
- Modify: `browser-agent-chat/server/src/muscle-memory.ts`

**Context:** This file references `.eq('status', 'active')` and writes `status: 'stale'`. The migration renamed the column to `pattern_state`. **IMPORTANT:** This task MUST be deployed atomically with the migration (Task 1) — the migration renames the column, so any code referencing `status` will break immediately.

- [ ] **Step 1: Update all status → pattern_state references**

Find and replace **all 5 occurrences** in `muscle-memory.ts`:

1. `loadPatterns()` (~line 15): Change `.eq('status', 'active')` → `.eq('pattern_state', 'active')`
2. `markStale()` (~line 30): Change `{ status: 'stale' }` → `{ pattern_state: 'stale' }`
3. `incrementFailures()` (~line 66): Change `updates.status = 'stale'` → `updates.pattern_state = 'stale'`
4. `upsertLoginPattern()` (~line 284): Change `status: 'active' as const` → `pattern_state: 'active' as const`
5. `replayLogin()` (~line 316): Change `p.status === 'active'` → `p.pattern_state === 'active'`

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd browser-agent-chat && npx tsc --noEmit --skipLibCheck --project server/tsconfig.json
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/muscle-memory.ts
git commit -m "fix: rename status to pattern_state in muscle-memory.ts"
```

---

### Task 4: Database CRUD Functions

**Files:**
- Modify: `browser-agent-chat/server/src/db.ts`

**Context:** Follow the existing pattern in db.ts — functions use `supabase.from('table').select/insert/update/delete`, return typed data, handle errors with console.error. Look at existing `createEvalCase`, `listEvalCases` as templates.

- [ ] **Step 1: Add task_feedback CRUD functions**

Add at the end of `db.ts`:

```typescript
// --- Learning System: Task Feedback ---

export async function createTaskFeedback(feedback: {
  agent_id: string;
  task_id: string;
  session_id: string | null;
  rating: FeedbackRating;
  correction: string | null;
}): Promise<TaskFeedback | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('task_feedback')
    .insert(feedback)
    .select()
    .single();
  if (error) { console.error('createTaskFeedback error:', error); return null; }
  return data;
}

export async function getTaskFeedbackByTask(taskId: string): Promise<TaskFeedback | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('task_feedback')
    .select('*')
    .eq('task_id', taskId)
    .single();
  if (error) return null;
  return data;
}

export async function listTaskFeedback(
  agentId: string,
  filters?: { rating?: FeedbackRating; limit?: number }
): Promise<TaskFeedback[]> {
  if (!isSupabaseEnabled()) return [];
  let query = supabase!
    .from('task_feedback')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });
  if (filters?.rating) query = query.eq('rating', filters.rating);
  if (filters?.limit) query = query.limit(filters.limit);
  const { data, error } = await query;
  if (error) { console.error('listTaskFeedback error:', error); return []; }
  return data ?? [];
}
```

- [ ] **Step 2: Add learning_pool CRUD functions**

```typescript
// --- Learning System: Learning Pool ---

export async function addToLearningPool(entry: {
  task_id: string;
  agent_id: string;
  feedback: FeedbackRating;
  task_prompt: string;
  task_prompt_embedding: number[] | null;
  task_summary: string | null;
  task_summary_embedding: number[] | null;
  steps: any[];
  step_count: number;
  duration_ms: number | null;
  cluster_id?: string | null;
}): Promise<LearningPoolEntry | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('learning_pool')
    .insert(entry)
    .select()
    .single();
  if (error) { console.error('addToLearningPool error:', error); return null; }
  return data;
}

export async function listLearningPoolByCluster(
  clusterId: string,
  feedbackFilter?: FeedbackRating
): Promise<LearningPoolEntry[]> {
  if (!isSupabaseEnabled()) return [];
  let query = supabase!
    .from('learning_pool')
    .select('*')
    .eq('cluster_id', clusterId)
    .order('created_at', { ascending: true });
  if (feedbackFilter) query = query.eq('feedback', feedbackFilter);
  const { data, error } = await query;
  if (error) { console.error('listLearningPoolByCluster error:', error); return []; }
  return data ?? [];
}

export async function updateLearningPoolCluster(
  entryId: string,
  clusterId: string
): Promise<void> {
  if (!isSupabaseEnabled()) return;
  const { error } = await supabase!
    .from('learning_pool')
    .update({ cluster_id: clusterId })
    .eq('id', entryId);
  if (error) console.error('updateLearningPoolCluster error:', error);
}

export async function getLearningPoolStats(agentId: string): Promise<{
  total: number;
  positive: number;
  negative: number;
  clustered: number;
}> {
  if (!isSupabaseEnabled()) return { total: 0, positive: 0, negative: 0, clustered: 0 };
  const { data, error } = await supabase!
    .from('learning_pool')
    .select('feedback, cluster_id')
    .eq('agent_id', agentId);
  if (error || !data) return { total: 0, positive: 0, negative: 0, clustered: 0 };
  return {
    total: data.length,
    positive: data.filter(d => d.feedback === 'positive').length,
    negative: data.filter(d => d.feedback === 'negative').length,
    clustered: data.filter(d => d.cluster_id !== null).length,
  };
}
```

- [ ] **Step 3: Add task_clusters CRUD functions**

```typescript
// --- Learning System: Task Clusters ---

export async function createTaskCluster(cluster: {
  agent_id: string;
  centroid_embedding: number[];
  task_summary: string;
  run_count?: number;
  app_fingerprint?: string | null;
}): Promise<TaskCluster | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('task_clusters')
    .insert({ ...cluster, run_count: cluster.run_count ?? 1 })
    .select()
    .single();
  if (error) { console.error('createTaskCluster error:', error); return null; }
  return data;
}

export async function getTaskCluster(clusterId: string): Promise<TaskCluster | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('task_clusters')
    .select('*')
    .eq('id', clusterId)
    .single();
  if (error) return null;
  return data;
}

export async function listTaskClusters(agentId: string): Promise<TaskCluster[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('task_clusters')
    .select('*')
    .eq('agent_id', agentId)
    .order('run_count', { ascending: false });
  if (error) { console.error('listTaskClusters error:', error); return []; }
  return data ?? [];
}

export async function updateTaskCluster(
  clusterId: string,
  updates: Partial<Pick<TaskCluster, 'centroid_embedding' | 'run_count' | 'task_summary'>>
): Promise<void> {
  if (!isSupabaseEnabled()) return;
  const { error } = await supabase!
    .from('task_clusters')
    .update(updates)
    .eq('id', clusterId);
  if (error) console.error('updateTaskCluster error:', error);
}

export async function incrementClusterRunCount(clusterId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;
  const cluster = await getTaskCluster(clusterId);
  if (cluster) {
    await updateTaskCluster(clusterId, { run_count: cluster.run_count + 1 });
  }
}
```

- [ ] **Step 4: Add extended learned_patterns functions**

```typescript
// --- Learning System: Extended Pattern Functions ---

export async function createTaskPattern(pattern: {
  agent_id: string;
  trigger: any;
  steps: any[];
  cluster_id: string;
  embedding: number[] | null;
  avg_steps: number;
  avg_duration_ms: number;
  success_rate: number;
  variance: number;
  score: number;
  app_fingerprint?: string | null;
}): Promise<LearnedPattern | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('learned_patterns')
    .insert({
      ...pattern,
      pattern_type: 'task',
      pattern_state: 'candidate',
      scope: 'agent',
      consecutive_failures: 0,
      use_count: 0,
    })
    .select()
    .single();
  if (error) { console.error('createTaskPattern error:', error); return null; }
  return data;
}

export async function listActivePatterns(
  agentId: string,
  patternType?: 'login' | 'navigation' | 'task'
): Promise<LearnedPattern[]> {
  if (!isSupabaseEnabled()) return [];
  let query = supabase!
    .from('learned_patterns')
    .select('*')
    .eq('agent_id', agentId)
    .in('pattern_state', ['active', 'dominant']);
  if (patternType) query = query.eq('pattern_type', patternType);
  const { data, error } = await query;
  if (error) { console.error('listActivePatterns error:', error); return []; }
  return data ?? [];
}

export async function updatePatternState(
  patternId: string,
  state: PatternState,
  updates?: Partial<Pick<LearnedPattern, 'success_rate' | 'score' | 'consecutive_failures' | 'last_verified_success' | 'use_count' | 'last_used_at'>>
): Promise<void> {
  if (!isSupabaseEnabled()) return;
  const { error } = await supabase!
    .from('learned_patterns')
    .update({ pattern_state: state, ...updates, updated_at: new Date().toISOString() })
    .eq('id', patternId);
  if (error) console.error('updatePatternState error:', error);
}

export async function listPatternsByCluster(clusterId: string): Promise<LearnedPattern[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('learned_patterns')
    .select('*')
    .eq('cluster_id', clusterId)
    .not('pattern_state', 'eq', 'archived');
  if (error) { console.error('listPatternsByCluster error:', error); return []; }
  return data ?? [];
}

export async function deletePattern(patternId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;
  const { error } = await supabase!
    .from('learned_patterns')
    .delete()
    .eq('id', patternId);
  if (error) { console.error('deletePattern error:', error); return false; }
  return true;
}

export async function getPatternStats(agentId: string): Promise<{
  total: number;
  candidate: number;
  active: number;
  dominant: number;
  stale: number;
}> {
  if (!isSupabaseEnabled()) return { total: 0, candidate: 0, active: 0, dominant: 0, stale: 0 };
  const { data, error } = await supabase!
    .from('learned_patterns')
    .select('pattern_state')
    .eq('agent_id', agentId)
    .eq('pattern_type', 'task')
    .not('pattern_state', 'eq', 'archived');
  if (error || !data) return { total: 0, candidate: 0, active: 0, dominant: 0, stale: 0 };
  return {
    total: data.length,
    candidate: data.filter(d => d.pattern_state === 'candidate').length,
    active: data.filter(d => d.pattern_state === 'active').length,
    dominant: data.filter(d => d.pattern_state === 'dominant').length,
    stale: data.filter(d => d.pattern_state === 'stale').length,
  };
}

export async function listExecutionSteps(taskId: string): Promise<Array<{
  id: string; task_id: string; step_order: number; step_type: string;
  content: string; target: string | null; screenshot_url: string | null;
  duration_ms: number | null; created_at: string;
}>> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('execution_steps')
    .select('*')
    .eq('task_id', taskId)
    .order('step_order', { ascending: true });
  if (error) { console.error('listExecutionSteps error:', error); return []; }
  return data ?? [];
}
```

- [ ] **Step 5: Add imports at top of db.ts**

Add to the imports section:

```typescript
import type {
  TaskFeedback, LearningPoolEntry, TaskCluster, LearnedPattern,
  FeedbackRating, PatternState
} from './types.js';
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd browser-agent-chat && npx tsc --noEmit --skipLibCheck --project server/tsconfig.json
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/db.ts
git commit -m "feat: add learning system CRUD functions (feedback, pool, clusters, patterns)"
```

---

## Chunk 2: Learning Engine (Embedding, Clustering, Extraction, Lifecycle)

### Task 5: Embedding Service

**Files:**
- Create: `browser-agent-chat/server/src/learning/embedding.ts`

**Context:** Uses OpenAI `text-embedding-3-small` for embeddings and Claude Haiku for task summarization. The project already has `@anthropic-ai/sdk` installed. Need to install `openai` package.

- [ ] **Step 1: Install openai package**

```bash
cd browser-agent-chat && npm install openai --workspace=server
```

- [ ] **Step 2: Write embedding.ts**

```typescript
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic();

/**
 * Embed text using OpenAI text-embedding-3-small (1536 dimensions).
 * Returns null if the API call fails.
 */
export async function embedText(text: string): Promise<number[] | null> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  } catch (err) {
    console.error('[EMBEDDING] Failed to embed text:', err);
    return null;
  }
}

/**
 * Embed multiple texts in a single batch request.
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });
    return response.data.map(d => d.embedding);
  } catch (err) {
    console.error('[EMBEDDING] Batch embed failed:', err);
    return texts.map(() => null);
  }
}

/**
 * Generate a clean one-sentence task summary using Claude Haiku.
 * Falls back to the raw prompt if the call fails.
 */
export async function summarizeTask(taskPrompt: string): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Summarize this browser automation task in one concise sentence. Only output the summary, nothing else.\n\nTask: ${taskPrompt}`,
      }],
    });
    const block = response.content[0];
    if (block.type === 'text') return block.text.trim();
    return taskPrompt;
  } catch (err) {
    console.error('[EMBEDDING] Task summarization failed, using raw prompt:', err);
    return taskPrompt;
  }
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd browser-agent-chat && npx tsc --noEmit --skipLibCheck --project server/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add server/src/learning/embedding.ts
git commit -m "feat: add embedding service (OpenAI + Haiku summarization)"
```

---

### Task 6: Clustering Logic

**Files:**
- Create: `browser-agent-chat/server/src/learning/clustering.ts`

**Context:** Assigns learning pool entries to clusters by cosine similarity of embeddings. Creates new clusters when no match exceeds threshold. Updates centroids using running mean.

- [ ] **Step 1: Write clustering.ts**

```typescript
import { cosineSimilarity } from './embedding.js';
import {
  listTaskClusters, createTaskCluster, updateTaskCluster,
  incrementClusterRunCount, updateLearningPoolCluster,
} from '../db.js';
import type { TaskCluster } from '../types.js';

const CLUSTER_SIMILARITY_THRESHOLD = 0.85;

/**
 * Find the best matching cluster for a given embedding, or create a new one.
 * Returns the cluster ID.
 */
export async function assignToCluster(
  agentId: string,
  embedding: number[],
  taskSummary: string,
  entryId: string,
): Promise<string> {
  const clusters = await listTaskClusters(agentId);

  let bestCluster: TaskCluster | null = null;
  let bestSimilarity = 0;

  for (const cluster of clusters) {
    const sim = cosineSimilarity(embedding, cluster.centroid_embedding);
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestCluster = cluster;
    }
  }

  let clusterId: string;

  if (bestCluster && bestSimilarity >= CLUSTER_SIMILARITY_THRESHOLD) {
    // Assign to existing cluster, update centroid via running mean
    clusterId = bestCluster.id;
    const n = bestCluster.run_count + 1;
    const newCentroid = bestCluster.centroid_embedding.map(
      (val, i) => (val * (n - 1) + embedding[i]) / n
    );
    await updateTaskCluster(clusterId, {
      centroid_embedding: newCentroid,
      run_count: n,
    });
  } else {
    // Create new cluster
    const newCluster = await createTaskCluster({
      agent_id: agentId,
      centroid_embedding: embedding,
      task_summary: taskSummary,
      run_count: 1,
    });
    if (!newCluster) throw new Error('Failed to create task cluster');
    clusterId = newCluster.id;
  }

  // Link the learning pool entry to this cluster
  await updateLearningPoolCluster(entryId, clusterId);

  return clusterId;
}

/**
 * Check if two clusters should be merged (for background job).
 * Returns true if both centroid similarity and step overlap exceed thresholds.
 */
export function shouldMergeClusters(
  clusterA: TaskCluster,
  clusterB: TaskCluster,
): boolean {
  const centroidSim = cosineSimilarity(
    clusterA.centroid_embedding,
    clusterB.centroid_embedding
  );
  // Step similarity check deferred to extraction — centroid check is the gate
  return centroidSim > 0.9;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/learning/clustering.ts
git commit -m "feat: add clustering logic with centroid matching and running mean"
```

---

### Task 7: Extraction Pipeline

**Files:**
- Create: `browser-agent-chat/server/src/learning/extraction.ts`

**Context:** Extracts dominant workflow patterns from clustered runs using Longest Common Subsequence (LCS). Only processes positive-feedback runs. Calculates metrics and creates candidate patterns.

- [ ] **Step 1: Write extraction.ts**

```typescript
import { listLearningPoolByCluster, createTaskPattern, listPatternsByCluster } from '../db.js';
import { embedText } from './embedding.js';
import type { LearningPoolEntry } from '../types.js';

const MIN_CLUSTER_RUNS = 5;
const MIN_STEP_FREQUENCY = 0.4; // Step must appear in 40%+ of runs

interface ExtractedStep {
  action: string;
  target?: string;
}

/**
 * Extract dominant path from a cluster's positive runs using LCS.
 * Returns null if cluster doesn't have enough runs.
 */
export async function extractPattern(
  clusterId: string,
  agentId: string,
  clusterSummary: string,
): Promise<{ steps: ExtractedStep[]; metrics: PatternMetrics } | null> {
  const positiveRuns = await listLearningPoolByCluster(clusterId, 'positive');
  if (positiveRuns.length < MIN_CLUSTER_RUNS) return null;

  // Also get negative runs to calculate real success rate
  const negativeRuns = await listLearningPoolByCluster(clusterId, 'negative');
  const totalRuns = positiveRuns.length + negativeRuns.length;
  const runs = positiveRuns;

  // Extract step sequences from each run
  const sequences = runs.map(run =>
    (run.steps as any[])
      .filter(s => s.step_type === 'action' || s.step_type === 'navigation')
      .map(s => ({ action: s.content, target: s.target ?? undefined }))
  );

  if (sequences.length === 0) return null;

  // Find dominant path using pairwise LCS
  const dominantPath = findDominantPath(sequences);
  if (dominantPath.length === 0) return null;

  // Calculate metrics (pass total runs including negatives for real success rate)
  const metrics = calculateMetrics(runs, dominantPath.length, totalRuns);

  // Check if a pattern already exists for this cluster
  const existingPatterns = await listPatternsByCluster(clusterId);
  if (existingPatterns.length > 0) {
    // Update existing pattern if new one is better (dominance rule)
    const best = existingPatterns.reduce((a, b) => (a.score ?? 0) > (b.score ?? 0) ? a : b);
    if ((best.success_rate ?? 0) >= metrics.successRate && (best.avg_steps ?? Infinity) <= metrics.avgSteps) {
      return null; // Existing pattern is at least as good
    }
  }

  // Create the pattern
  const embedding = await embedText(clusterSummary);

  await createTaskPattern({
    agent_id: agentId,
    trigger: { type: 'task', summary: clusterSummary },
    steps: dominantPath,
    cluster_id: clusterId,
    embedding,
    avg_steps: metrics.avgSteps,
    avg_duration_ms: metrics.avgDuration,
    success_rate: metrics.successRate,
    variance: metrics.variance,
    score: metrics.score,
  });

  return { steps: dominantPath, metrics };
}

interface PatternMetrics {
  avgSteps: number;
  avgDuration: number;
  successRate: number;
  variance: number;
  score: number;
}

function calculateMetrics(runs: LearningPoolEntry[], patternStepCount: number, totalRuns: number): PatternMetrics {
  const stepCounts = runs.map(r => r.step_count);
  const durations = runs.filter(r => r.duration_ms != null).map(r => r.duration_ms!);

  const avgSteps = stepCounts.reduce((a, b) => a + b, 0) / stepCounts.length;
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  // Success rate: positive runs / total runs in cluster (includes negatives)
  const successRate = totalRuns > 0 ? runs.length / totalRuns : 1.0;

  // Variance of step counts (lower = more stable)
  const mean = avgSteps;
  const variance = stepCounts.reduce((sum, sc) => sum + Math.pow(sc - mean, 2), 0) / stepCounts.length;

  // Normalized score: 0.5×success + 0.25×efficiency + 0.15×stability + 0.1×recency
  const maxSteps = Math.max(...stepCounts, 1);
  const efficiency = 1 - (patternStepCount / maxSteps); // Lower steps = higher efficiency
  const stability = 1 / (1 + variance); // Lower variance = higher stability
  const recency = 1.0; // All recent runs

  const score = 0.5 * successRate + 0.25 * Math.max(0, efficiency) + 0.15 * stability + 0.1 * recency;

  return { avgSteps: Math.round(avgSteps), avgDuration: Math.round(avgDuration), successRate, variance, score };
}

/**
 * Find the dominant path across multiple sequences using pairwise LCS.
 * Steps that appear in less than MIN_STEP_FREQUENCY of runs are removed.
 */
function findDominantPath(sequences: ExtractedStep[][]): ExtractedStep[] {
  if (sequences.length === 0) return [];
  if (sequences.length === 1) return sequences[0];

  // Count frequency of each step (by action string)
  const stepFrequency = new Map<string, number>();
  for (const seq of sequences) {
    const seen = new Set<string>();
    for (const step of seq) {
      const key = stepKey(step);
      if (!seen.has(key)) {
        stepFrequency.set(key, (stepFrequency.get(key) ?? 0) + 1);
        seen.add(key);
      }
    }
  }

  // Filter to steps appearing in MIN_STEP_FREQUENCY of runs
  const threshold = Math.ceil(sequences.length * MIN_STEP_FREQUENCY);
  const frequentSteps = new Set<string>();
  for (const [key, count] of stepFrequency) {
    if (count >= threshold) frequentSteps.add(key);
  }

  // Filter sequences to only frequent steps
  const filtered = sequences.map(seq =>
    seq.filter(s => frequentSteps.has(stepKey(s)))
  );

  // Find LCS of first two sequences, then iteratively with the rest
  let result = filtered[0];
  for (let i = 1; i < filtered.length; i++) {
    result = lcs(result, filtered[i]);
  }

  return result;
}

function stepKey(step: ExtractedStep): string {
  return `${step.action}|${step.target ?? ''}`;
}

/**
 * Longest Common Subsequence of two step sequences.
 */
function lcs(a: ExtractedStep[], b: ExtractedStep[]): ExtractedStep[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (stepKey(a[i - 1]) === stepKey(b[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the subsequence
  const result: ExtractedStep[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (stepKey(a[i - 1]) === stepKey(b[j - 1])) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/learning/extraction.ts
git commit -m "feat: add LCS-based pattern extraction from clustered runs"
```

---

### Task 8: Pattern Lifecycle

**Files:**
- Create: `browser-agent-chat/server/src/learning/lifecycle.ts`

**Context:** Manages pattern state transitions: candidate→active→dominant→stale→archived. Handles activation checks, failure tracking, and cooldown windows.

- [ ] **Step 1: Write lifecycle.ts**

```typescript
import {
  updatePatternState, listPatternsByCluster, listActivePatterns,
  getTaskCluster,
} from '../db.js';
import type { LearnedPattern, PatternState } from '../types.js';

const ACTIVATION_USE_COUNT = 3;
const ACTIVATION_SUCCESS_RATE = 0.8;
const FAILURE_THRESHOLD = 3;
const ROLLING_WINDOW = 20;
const ROLLING_SUCCESS_THRESHOLD = 0.6;
const STALE_DAYS = 30;
const UNUSED_DAYS = 60;

/**
 * Check if a candidate pattern should be activated.
 */
export async function checkActivation(pattern: LearnedPattern): Promise<boolean> {
  if (pattern.pattern_state !== 'candidate') return false;
  if (pattern.use_count < ACTIVATION_USE_COUNT) return false;
  if ((pattern.success_rate ?? 0) < ACTIVATION_SUCCESS_RATE) return false;

  // Check cluster has enough runs
  if (pattern.cluster_id) {
    const cluster = await getTaskCluster(pattern.cluster_id);
    if (cluster && cluster.run_count < 5) return false;
  }

  await updatePatternState(pattern.id, 'active', {
    last_verified_success: new Date().toISOString(),
  });

  // Check if this should become dominant
  await checkDominance(pattern);

  return true;
}

/**
 * Check if a pattern should become dominant in its cluster.
 */
async function checkDominance(pattern: LearnedPattern): Promise<void> {
  if (!pattern.cluster_id) return;

  const clusterPatterns = await listPatternsByCluster(pattern.cluster_id);
  const activePatterns = clusterPatterns.filter(
    p => p.pattern_state === 'active' || p.pattern_state === 'dominant'
  );

  if (activePatterns.length === 0) return;

  // Find pattern with highest score
  const best = activePatterns.reduce((a, b) => (a.score ?? 0) > (b.score ?? 0) ? a : b);

  // Demote current dominant if different
  for (const p of activePatterns) {
    if (p.pattern_state === 'dominant' && p.id !== best.id) {
      await updatePatternState(p.id, 'active');
    }
  }

  // Promote best to dominant
  if (best.pattern_state !== 'dominant') {
    await updatePatternState(best.id, 'dominant');
  }
}

/**
 * Record a pattern failure and check if it should go stale.
 * Returns true if pattern was marked stale.
 */
export async function recordPatternFailure(pattern: LearnedPattern): Promise<boolean> {
  const newFailures = pattern.consecutive_failures + 1;

  if (newFailures >= FAILURE_THRESHOLD) {
    // Check rolling success rate (approximate from success_rate and use_count)
    const estimatedSuccessRate = pattern.use_count > 0
      ? Math.max(0, ((pattern.success_rate ?? 1) * pattern.use_count - newFailures) / pattern.use_count)
      : 0;

    if (estimatedSuccessRate < ROLLING_SUCCESS_THRESHOLD) {
      await updatePatternState(pattern.id, 'stale', {
        consecutive_failures: newFailures,
        success_rate: estimatedSuccessRate,
      });
      return true;
    }
  }

  await updatePatternState(pattern.id, pattern.pattern_state, {
    consecutive_failures: newFailures,
  });
  return false;
}

/**
 * Record a pattern success. Reset failure count, update metrics.
 */
export async function recordPatternSuccess(pattern: LearnedPattern): Promise<void> {
  const newUseCount = pattern.use_count + 1;
  const newSuccessRate = pattern.use_count > 0
    ? ((pattern.success_rate ?? 1) * pattern.use_count + 1) / newUseCount
    : 1.0;

  // Use updatePatternState with extended fields (use_count, last_used_at added to its type)
  await updatePatternState(pattern.id, pattern.pattern_state, {
    use_count: newUseCount,
    consecutive_failures: 0,
    success_rate: newSuccessRate,
    last_used_at: new Date().toISOString(),
    last_verified_success: new Date().toISOString(),
  });

  // Check activation for candidates
  if (pattern.pattern_state === 'candidate') {
    await checkActivation({ ...pattern, use_count: newUseCount, success_rate: newSuccessRate });
  }
}

/**
 * Check patterns for staleness (used by background job).
 */
export async function checkPatternHealth(agentId: string): Promise<{
  staled: string[];
  archived: string[];
}> {
  const patterns = await listActivePatterns(agentId, 'task');
  const staled: string[] = [];
  const archived: string[] = [];
  const now = Date.now();

  for (const p of patterns) {
    // Check for unused patterns
    const lastUsed = p.last_used_at ? new Date(p.last_used_at).getTime() : new Date(p.created_at).getTime();
    const daysSinceUse = (now - lastUsed) / (1000 * 60 * 60 * 24);

    if (daysSinceUse > UNUSED_DAYS) {
      await updatePatternState(p.id, 'archived');
      archived.push(p.id);
      continue;
    }

    // Check last verified success freshness
    if (p.last_verified_success) {
      const lastSuccess = new Date(p.last_verified_success).getTime();
      const daysSinceSuccess = (now - lastSuccess) / (1000 * 60 * 60 * 24);
      if (daysSinceSuccess > STALE_DAYS && p.consecutive_failures >= FAILURE_THRESHOLD) {
        await updatePatternState(p.id, 'stale');
        staled.push(p.id);
      }
    }
  }

  return { staled, archived };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/learning/lifecycle.ts
git commit -m "feat: add pattern lifecycle management (activation, staleness, dominance)"
```

---

### Task 9: Retrieval Service

**Files:**
- Create: `browser-agent-chat/server/src/learning/retrieval.ts`

**Context:** Two-stage retrieval: find matching cluster → retrieve patterns within cluster. Rank by weighted sum. Diversity filter. Token budget cap.

- [ ] **Step 1: Write retrieval.ts**

```typescript
import { embedText, cosineSimilarity } from './embedding.js';
import { listTaskClusters, listPatternsByCluster } from '../db.js';
import type { LearnedPattern, TaskCluster } from '../types.js';

const MAX_PATTERNS = 3;
const MAX_TOKENS = 500;
const DIVERSITY_THRESHOLD = 0.85;

interface RetrievedPattern {
  pattern: LearnedPattern;
  similarity: number;
  finalScore: number;
}

/**
 * Retrieve relevant patterns for a task prompt.
 * Two-stage: cluster match → pattern retrieval within cluster.
 */
export async function retrievePatterns(
  agentId: string,
  taskPrompt: string,
): Promise<RetrievedPattern[]> {
  const promptEmbedding = await embedText(taskPrompt);
  if (!promptEmbedding) return [];

  // Stage 1: Find best matching cluster
  const clusters = await listTaskClusters(agentId);
  if (clusters.length === 0) return [];

  let bestCluster: TaskCluster | null = null;
  let bestClusterSim = 0;

  for (const cluster of clusters) {
    const sim = cosineSimilarity(promptEmbedding, cluster.centroid_embedding);
    if (sim > bestClusterSim) {
      bestClusterSim = sim;
      bestCluster = cluster;
    }
  }

  if (!bestCluster || bestClusterSim < 0.5) return []; // No relevant cluster

  // Stage 2: Retrieve patterns within cluster
  const patterns = await listPatternsByCluster(bestCluster.id);
  const activePatterns = patterns.filter(
    p => p.pattern_state === 'active' || p.pattern_state === 'dominant'
  );

  if (activePatterns.length === 0) return [];

  // Score each pattern
  const scored: RetrievedPattern[] = activePatterns.map(pattern => {
    const similarity = pattern.embedding
      ? cosineSimilarity(promptEmbedding, pattern.embedding)
      : bestClusterSim;

    const scopeWeight = pattern.scope === 'agent' ? 1.0
      : pattern.scope === 'org' ? 0.8
      : 0.6;

    // Recency: days since last use, normalized
    const lastUsed = pattern.last_used_at
      ? (Date.now() - new Date(pattern.last_used_at).getTime()) / (1000 * 60 * 60 * 24)
      : 30;
    const recency = Math.max(0, 1 - lastUsed / 90); // Decays over 90 days

    const finalScore =
      0.50 * similarity +
      0.25 * (pattern.score ?? 0) +
      0.15 * scopeWeight +
      0.10 * recency;

    return { pattern, similarity, finalScore };
  });

  // Sort by score descending
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Diversity filter: remove patterns too similar to already-selected ones
  const selected: RetrievedPattern[] = [];
  for (const candidate of scored) {
    if (selected.length >= MAX_PATTERNS) break;

    const tooSimilar = selected.some(s => {
      if (!s.pattern.embedding || !candidate.pattern.embedding) return false;
      return cosineSimilarity(s.pattern.embedding, candidate.pattern.embedding) > DIVERSITY_THRESHOLD;
    });

    if (!tooSimilar) {
      selected.push(candidate);
    }
  }

  return selected;
}

/**
 * Format retrieved patterns for prompt injection.
 * Respects the 500-token budget (rough estimate: 1 token ≈ 4 chars).
 */
export function formatPatternsForPrompt(retrieved: RetrievedPattern[]): string {
  if (retrieved.length === 0) return '';

  const lines: string[] = [
    'These workflows are examples of previously successful approaches.',
    'Use them as guidance, but adapt to the current UI state.',
    'If elements differ, reason about the closest equivalent action.',
    '',
    '## Learned Workflows',
    '',
  ];

  let totalChars = lines.join('\n').length;

  for (const { pattern } of retrieved) {
    const trigger = pattern.trigger as any;
    const name = trigger?.summary ?? 'Unnamed workflow';
    const steps = (pattern.steps as any[]).map(
      (s, i) => `${i + 1}. ${s.action}${s.target ? ` → ${s.target}` : ''}`
    );

    const block = [
      `Workflow: ${name}`,
      `success_rate: ${(pattern.success_rate ?? 0).toFixed(2)}`,
      `avg_steps: ${pattern.avg_steps ?? steps.length}`,
      `runs: ${pattern.use_count}`,
      '',
      'Steps:',
      ...steps,
      '',
    ];

    const blockChars = block.join('\n').length;
    if (totalChars + blockChars > MAX_TOKENS * 4) break; // Token budget exceeded

    lines.push(...block);
    totalChars += blockChars;
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/learning/retrieval.ts
git commit -m "feat: add two-stage pattern retrieval with scoring and diversity filter"
```

---

### Task 10: Learning Pipeline Orchestrator

**Files:**
- Create: `browser-agent-chat/server/src/learning/pipeline.ts`

**Context:** Orchestrates the full feedback→embed→cluster→extract flow. Called when user submits feedback via WebSocket.

- [ ] **Step 1: Write pipeline.ts**

```typescript
import { createTaskFeedback, addToLearningPool, listExecutionSteps, getTaskCluster } from '../db.js';
import { embedText, summarizeTask } from './embedding.js';
import { assignToCluster } from './clustering.js';
import { extractPattern } from './extraction.js';
import type { FeedbackRating, ServerMessage } from '../types.js';

/**
 * Process user feedback on a task.
 * 1. Store feedback
 * 2. Embed and add to learning pool
 * 3. Assign to cluster
 * 4. Attempt pattern extraction if cluster is large enough
 */
export async function processFeedback(
  agentId: string,
  taskId: string,
  sessionId: string | null,
  taskPrompt: string,
  rating: FeedbackRating,
  correction: string | null,
  broadcast: (msg: ServerMessage) => void,
): Promise<void> {
  // Step 1: Store feedback
  const feedback = await createTaskFeedback({
    agent_id: agentId,
    task_id: taskId,
    session_id: sessionId,
    rating,
    correction,
  });

  if (!feedback) {
    console.error('[LEARNING] Failed to store feedback');
    return;
  }

  // Step 2: Embed task prompt and generate summary
  const [promptEmbedding, taskSummary] = await Promise.all([
    embedText(taskPrompt),
    summarizeTask(taskPrompt),
  ]);

  const summaryEmbedding = await embedText(taskSummary);

  // Step 3: Get execution steps and add to learning pool
  const executionSteps = await listExecutionSteps(taskId);
  const totalDuration = executionSteps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);

  const poolEntry = await addToLearningPool({
    task_id: taskId,
    agent_id: agentId,
    feedback: rating,
    task_prompt: taskPrompt,
    task_prompt_embedding: promptEmbedding,
    task_summary: taskSummary,
    task_summary_embedding: summaryEmbedding,
    steps: executionSteps.map(s => ({
      step_order: s.step_order,
      step_type: s.step_type,
      content: s.content,
      target: s.target ?? undefined,
      duration_ms: s.duration_ms ?? undefined,
    })),
    step_count: executionSteps.length,
    duration_ms: totalDuration || null,
  });

  if (!poolEntry) {
    console.error('[LEARNING] Failed to add to learning pool');
    return;
  }

  // Step 4: Cluster ALL runs (positive and negative) for accurate success rate
  if (!promptEmbedding) return;

  // Step 5: Assign to cluster
  const clusterId = await assignToCluster(agentId, promptEmbedding, taskSummary, poolEntry.id);

  // Step 6: Only attempt pattern extraction for positive runs
  if (rating !== 'positive') return;

  const cluster = await getTaskCluster(clusterId);
  if (!cluster) return;

  const result = await extractPattern(clusterId, agentId, cluster.task_summary);

  if (result) {
    console.log(`[LEARNING] Pattern extracted for cluster "${cluster.task_summary}": ${result.steps.length} steps`);
    // Broadcast patternLearned notification to connected clients
    broadcast({
      type: 'patternLearned',
      name: cluster.task_summary,
      steps: result.steps.map(s => s.action),
      success_rate: result.metrics.successRate,
      avg_steps: result.metrics.avgSteps,
      runs: cluster.run_count,
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/learning/pipeline.ts
git commit -m "feat: add learning pipeline orchestrator (feedback→embed→cluster→extract)"
```

---

## Chunk 3: Integration (Memory Engine, Background Jobs, WS Pipeline)

### Task 11: Memory Engine Integration

**Files:**
- Modify: `browser-agent-chat/server/src/memory-engine.ts`

**Context:** The memory engine currently has three functions:
- `serializeMemory(features)` — converts Feature[] to text
- `buildTaskPrompt(userMessage, memoryContext)` — builds the full prompt from user message + serialized memory context (a synchronous function)
- `loadMemoryContext(agentId)` — async, loads features + nav graph and returns combined context string

We need to add a new function that wraps `loadMemoryContext` + `buildTaskPrompt` while also retrieving and injecting learned patterns.

- [ ] **Step 1: Read current memory-engine.ts**

Read the file to understand exact function signatures and structure.

- [ ] **Step 2: Add pattern retrieval import**

Add import at top of `memory-engine.ts`:

```typescript
import { retrievePatterns, formatPatternsForPrompt } from './learning/retrieval.js';
```

- [ ] **Step 3: Add buildTaskPromptWithPatterns function**

Add a new exported function that wraps the existing flow and adds pattern retrieval. **Note:** `buildTaskPrompt(userMessage, memoryContext)` is synchronous and takes (userMessage, memoryContext) — NOT (agentId, taskPrompt). The new function loads memory context, retrieves patterns, builds the combined prompt.

```typescript
/**
 * Build a task prompt enriched with learned patterns.
 * Wraps loadMemoryContext + buildTaskPrompt + pattern retrieval.
 */
export async function buildTaskPromptWithPatterns(
  agentId: string,
  userMessage: string,
): Promise<{ prompt: string; patternIds: string[] }> {
  // Load existing memory context (features + nav graph)
  const memoryContext = await loadMemoryContext(agentId);

  // Retrieve learned patterns via semantic similarity
  const retrieved = await retrievePatterns(agentId, userMessage);
  const patternBlock = formatPatternsForPrompt(retrieved);
  const patternIds = retrieved.map(r => r.pattern.id);

  // Combine memory context with pattern block
  const enrichedContext = patternBlock
    ? `${memoryContext}\n\n${patternBlock}`
    : memoryContext;

  // Build the full prompt using existing function signature
  const prompt = buildTaskPrompt(userMessage, enrichedContext);

  return { prompt, patternIds };
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/memory-engine.ts
git commit -m "feat: integrate pattern retrieval into memory engine prompt building"
```

---

### Task 12: Background Jobs

**Files:**
- Create: `browser-agent-chat/server/src/learning/jobs.ts`

**Context:** Four background jobs using node-cron (already in package.json). Uses Redis SET NX for leader lock via existing redisStore.

- [ ] **Step 1: Write jobs.ts**

```typescript
import cron from 'node-cron';
import * as redisStore from '../redisStore.js';
import { listTaskClusters, listPatternsByCluster, updatePatternState } from '../db.js';
import { cosineSimilarity } from './embedding.js';
import { checkPatternHealth } from './lifecycle.js';
import { supabase, isSupabaseEnabled } from '../supabase.js';

const JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const LOCK_TTL_SECONDS = 360; // 6 minutes

/**
 * Acquire a distributed lock using Redis SET NX.
 */
async function acquireLock(jobName: string): Promise<boolean> {
  try {
    const redis = redisStore.getRedis();
    if (!redis) return true; // No Redis = single instance, proceed
    const key = `learning:job:${jobName}:lock`;
    const result = await redis.set(key, '1', { NX: true, EX: LOCK_TTL_SECONDS });
    return result === 'OK';
  } catch {
    return true; // Lock failure = proceed (single instance fallback)
  }
}

async function releaseLock(jobName: string): Promise<void> {
  try {
    const redis = redisStore.getRedis();
    if (!redis) return;
    await redis.del(`learning:job:${jobName}:lock`);
  } catch {
    // Ignore lock release errors
  }
}

/**
 * Run a job with lock acquisition and timeout.
 */
async function runWithLock(jobName: string, fn: () => Promise<void>): Promise<void> {
  if (!(await acquireLock(jobName))) {
    console.log(`[JOBS] ${jobName} skipped — another instance holds the lock`);
    return;
  }
  try {
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`Job ${jobName} timed out`)), JOB_TIMEOUT_MS)
    );
    await Promise.race([fn(), timeout]);
  } catch (err) {
    console.error(`[JOBS] ${jobName} error:`, err);
  } finally {
    await releaseLock(jobName);
  }
}

/**
 * Daily: Merge clusters with centroid similarity > 0.9
 */
async function clusterMerging(): Promise<void> {
  if (!isSupabaseEnabled()) return;
  console.log('[JOBS] Running cluster merging...');

  // Get all agents that have clusters
  const { data: agents } = await supabase!
    .from('task_clusters')
    .select('agent_id')
    .not('agent_id', 'is', null);

  if (!agents) return;

  const agentIds = [...new Set(agents.map(a => a.agent_id))];

  for (const agentId of agentIds) {
    const clusters = await listTaskClusters(agentId);
    const merged = new Set<string>();

    for (let i = 0; i < clusters.length; i++) {
      if (merged.has(clusters[i].id)) continue;
      for (let j = i + 1; j < clusters.length; j++) {
        if (merged.has(clusters[j].id)) continue;

        const sim = cosineSimilarity(
          clusters[i].centroid_embedding,
          clusters[j].centroid_embedding
        );

        if (sim > 0.9) {
          // Merge smaller into larger
          const [larger, smaller] = clusters[i].run_count >= clusters[j].run_count
            ? [clusters[i], clusters[j]]
            : [clusters[j], clusters[i]];

          // Reassign learning pool entries
          await supabase!
            .from('learning_pool')
            .update({ cluster_id: larger.id })
            .eq('cluster_id', smaller.id);

          // Reassign patterns
          await supabase!
            .from('learned_patterns')
            .update({ cluster_id: larger.id })
            .eq('cluster_id', smaller.id);

          // Update run count
          await supabase!
            .from('task_clusters')
            .update({ run_count: larger.run_count + smaller.run_count })
            .eq('id', larger.id);

          // Delete merged cluster
          await supabase!
            .from('task_clusters')
            .delete()
            .eq('id', smaller.id);

          merged.add(smaller.id);
          console.log(`[JOBS] Merged cluster "${smaller.task_summary}" into "${larger.task_summary}"`);
        }
      }
    }
  }
}

/**
 * Daily: Consolidate duplicate patterns within clusters.
 */
async function patternConsolidation(): Promise<void> {
  if (!isSupabaseEnabled()) return;
  console.log('[JOBS] Running pattern consolidation...');

  const { data: clusters } = await supabase!
    .from('task_clusters')
    .select('id');

  if (!clusters) return;

  for (const cluster of clusters) {
    const patterns = await listPatternsByCluster(cluster.id);
    if (patterns.length < 2) continue;

    const archived = new Set<string>();

    for (let i = 0; i < patterns.length; i++) {
      if (archived.has(patterns[i].id)) continue;
      for (let j = i + 1; j < patterns.length; j++) {
        if (archived.has(patterns[j].id)) continue;

        // Check embedding similarity
        if (patterns[i].embedding && patterns[j].embedding) {
          const sim = cosineSimilarity(patterns[i].embedding!, patterns[j].embedding!);
          if (sim > 0.85) {
            // Check success rate difference
            const rateDiff = Math.abs((patterns[i].success_rate ?? 0) - (patterns[j].success_rate ?? 0));
            if (rateDiff < 0.1) {
              // Archive the one with lower score
              const loser = (patterns[i].score ?? 0) >= (patterns[j].score ?? 0)
                ? patterns[j] : patterns[i];
              await updatePatternState(loser.id, 'archived');
              archived.add(loser.id);
            }
          }
        }
      }
    }
  }
}

/**
 * Daily: Mark unused patterns as stale/archived.
 */
async function patternUsageAnalytics(): Promise<void> {
  if (!isSupabaseEnabled()) return;
  console.log('[JOBS] Running pattern usage analytics...');

  const { data: agents } = await supabase!
    .from('learned_patterns')
    .select('agent_id')
    .eq('pattern_type', 'task')
    .not('pattern_state', 'eq', 'archived');

  if (!agents) return;

  const agentIds = [...new Set(agents.map(a => a.agent_id))];

  for (const agentId of agentIds) {
    await checkPatternHealth(agentId);
  }
}

/**
 * Initialize all background jobs.
 */
export function initLearningJobs(): void {
  // Daily at 2:00 AM
  cron.schedule('0 2 * * *', () => {
    runWithLock('cluster-merging', clusterMerging);
    runWithLock('pattern-consolidation', patternConsolidation);
    runWithLock('pattern-usage', patternUsageAnalytics);
  });

  // Hourly health monitor
  cron.schedule('0 * * * *', () => {
    runWithLock('pattern-health', patternUsageAnalytics);
  });

  console.log('[JOBS] Learning background jobs scheduled');
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/learning/jobs.ts
git commit -m "feat: add learning background jobs (merge, consolidation, health, usage)"
```

---

### Task 13: WebSocket Pipeline Changes

**Files:**
- Modify: `browser-agent-chat/server/src/index.ts`

**Context:** Need to: (1) enrich `taskComplete` with `taskId`, `stepCount`, `durationMs`, (2) handle incoming `taskFeedback` messages, (3) mount feedback routes, (4) init background jobs.

- [ ] **Step 1: Read current index.ts**

Read the file to find exact insertion points.

- [ ] **Step 2: Add imports**

At the top of `index.ts`, add:

```typescript
import feedbackRouter from './routes/feedback.js';
import { processFeedback } from './learning/pipeline.js';
import { initLearningJobs } from './learning/jobs.js';
```

- [ ] **Step 3: Mount feedback route**

After the existing route mounting (e.g., after `app.use('/api/agents/:id/evals', evalsRouter);`):

```typescript
app.use('/api/agents/:id/feedback', feedbackRouter);
```

- [ ] **Step 4: Extend activeTasks map to include startedAt and prompt**

Change the activeTasks type:

```typescript
const activeTasks = new Map<string, { taskId: string; stepCount: number; startedAt: number; prompt: string }>();
```

Where task is created (in the `'task'` case), update to:

```typescript
activeTasks.set(agentId, { taskId, stepCount: 0, startedAt: Date.now(), prompt: msg.content });
```

- [ ] **Step 5: Enrich taskComplete broadcast**

In the `taskBroadcast` wrapper, where `taskComplete` is intercepted, enrich the message:

```typescript
if (broadcastMsg.type === 'taskComplete') {
  const activeTask = activeTasks.get(agentId);
  if (activeTask) {
    // Enrich with metadata
    (broadcastMsg as any).taskId = activeTask.taskId;
    (broadcastMsg as any).stepCount = activeTask.stepCount;
    (broadcastMsg as any).durationMs = Date.now() - activeTask.startedAt;

    const success = broadcastMsg.success;
    updateTask(activeTask.taskId, {
      status: success ? 'completed' : 'failed',
      success,
      completed_at: new Date().toISOString(),
    }).catch(err => console.error('[TASK] Failed to update task:', err));
    // Don't delete from activeTasks yet — need it for feedback
  }
}
```

- [ ] **Step 6: Handle taskFeedback client message**

In the WebSocket message handler switch/case, add a new case:

```typescript
} else if (msg.type === 'taskFeedback') {
  const agentId = clientAgents.get(ws);
  if (!agentId) return;

  const activeTask = activeTasks.get(agentId);
  const agentSession = sessionManager.getAgent(agentId);

  processFeedback(
    agentId,
    msg.task_id,
    agentSession?.sessionId ?? null,
    activeTask?.prompt ?? '',
    msg.rating,
    msg.correction ?? null,
    (broadcastMsg) => broadcastToAgent(agentId, broadcastMsg),
  ).catch(err => console.error('[LEARNING] Feedback processing error:', err));

  // Now safe to clean up
  if (activeTask?.taskId === msg.task_id) {
    activeTasks.delete(agentId);
  }
```

- [ ] **Step 7: Initialize background jobs**

Near server startup (after `server.listen(...)` callback):

```typescript
initLearningJobs();
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd browser-agent-chat && npx tsc --noEmit --skipLibCheck --project server/tsconfig.json
```

- [ ] **Step 9: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: wire learning pipeline into WS handler and enrich taskComplete"
```

---

## Chunk 4: REST API & Client UI

### Task 14: Feedback REST Routes

**Files:**
- Create: `browser-agent-chat/server/src/routes/feedback.ts`

**Context:** Follow exact pattern from `routes/evals.ts`: Router with mergeParams, requireAuth middleware, req.params.id for agent ID.

- [ ] **Step 1: Write feedback.ts**

```typescript
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  listTaskFeedback, listActivePatterns, getPatternStats,
  getLearningPoolStats, listTaskClusters, deletePattern,
  updatePatternState,
} from '../db.js';
import type { PatternState } from '../types.js';

const router = Router({ mergeParams: true });

// POST /api/agents/:id/feedback — submit task feedback (REST fallback)
router.post('/', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const { task_id, rating, correction } = req.body;

  if (!task_id || !rating) {
    res.status(400).json({ error: 'task_id and rating are required' });
    return;
  }

  if (!['positive', 'negative'].includes(rating)) {
    res.status(400).json({ error: 'rating must be positive or negative' });
    return;
  }

  // Note: processFeedback should be imported at top of file (static import)
  // but we use dynamic import here for lazy loading since this is a REST fallback
  const { processFeedback } = await import('../learning/pipeline.js');
  await processFeedback(
    agentId, task_id, null, '', rating, correction ?? null,
    () => {}, // No broadcast for REST
  );

  res.status(201).json({ ok: true });
});

// GET /api/agents/:id/feedback — list feedback
router.get('/', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const rating = req.query.rating as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
  const feedback = await listTaskFeedback(agentId, {
    rating: rating as any,
    limit,
  });
  res.json({ feedback });
});

// GET /api/agents/:id/feedback/patterns — list learned patterns
router.get('/patterns', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const patterns = await listActivePatterns(agentId, 'task');
  res.json({ patterns });
});

// PATCH /api/agents/:id/feedback/patterns/:pid — update pattern state
router.patch('/patterns/:pid', requireAuth, async (req, res) => {
  const patternId = req.params.pid as string;
  const { pattern_state } = req.body;
  if (!pattern_state || !['stale', 'archived'].includes(pattern_state)) {
    res.status(400).json({ error: 'pattern_state must be stale or archived' });
    return;
  }
  await updatePatternState(patternId, pattern_state as PatternState);
  res.json({ ok: true });
});

// DELETE /api/agents/:id/feedback/patterns/:pid — delete pattern (unteach)
router.delete('/patterns/:pid', requireAuth, async (req, res) => {
  const patternId = req.params.pid as string;
  const success = await deletePattern(patternId);
  if (!success) { res.status(404).json({ error: 'Pattern not found' }); return; }
  res.json({ ok: true });
});

// GET /api/agents/:id/feedback/stats — learning stats
router.get('/stats', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const [patternStats, poolStats, clusters] = await Promise.all([
    getPatternStats(agentId),
    getLearningPoolStats(agentId),
    listTaskClusters(agentId),
  ]);
  res.json({
    patterns: patternStats,
    pool: poolStats,
    clusters: { count: clusters.length },
  });
});

export default router;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd browser-agent-chat && npx tsc --noEmit --skipLibCheck --project server/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/feedback.ts
git commit -m "feat: add feedback REST routes (CRUD, patterns, stats)"
```

---

### Task 15: Client Types Update

**Files:**
- Modify: `browser-agent-chat/client/src/types.ts`

**Context:** Current `ServerMessage` does not include `taskStarted`. Current `ClientMessage` does not include `taskFeedback`. `taskComplete` only has `success: boolean`.

- [ ] **Step 1: Update ServerMessage union**

Replace the existing `taskComplete` variant and add new types:

```typescript
export type ServerMessage =
  | { type: 'thought'; content: string }
  | { type: 'action'; action: string; target?: string }
  | { type: 'screenshot'; data: string }
  | { type: 'status'; status: AgentStatus }
  | { type: 'nav'; url: string }
  | { type: 'error'; message: string }
  | { type: 'taskStarted'; taskId: string }
  | { type: 'taskComplete'; success: boolean; taskId?: string; stepCount?: number; durationMs?: number }
  | { type: 'finding'; finding: Finding }
  | { type: 'suggestion'; suggestion: Suggestion }
  | { type: 'pong' }
  | { type: 'sessionRestore'; messages: ChatMessage[] }
  | { type: 'metrics'; metrics: StartupMetrics }
  | { type: 'sessionCrashed' }
  | { type: 'taskInterrupted'; task: string }
  | { type: 'patternLearned'; name: string; steps: string[]; success_rate: number; avg_steps: number; runs: number }
  | { type: 'patternStale'; name: string; reason: string };
```

- [ ] **Step 2: Update ClientMessage union**

Add `taskFeedback`:

```typescript
export type ClientMessage =
  | { type: 'start'; agentId: string; resumeUrl?: string }
  | { type: 'resume'; agentId: string }
  | { type: 'task'; content: string }
  | { type: 'explore'; agentId: string }
  | { type: 'stop' }
  | { type: 'ping' }
  | { type: 'taskFeedback'; task_id: string; rating: 'positive' | 'negative'; correction?: string };
```

- [ ] **Step 3: Commit**

```bash
git add client/src/types.ts
git commit -m "feat: add taskStarted, taskFeedback, patternLearned to client types"
```

---

### Task 16: WebSocketContext Updates

**Files:**
- Modify: `browser-agent-chat/client/src/contexts/WebSocketContext.tsx`

**Context:** Need to: (1) store active taskId, (2) handle taskStarted message, (3) enrich taskComplete handling with metadata, (4) provide sendFeedback function.

- [ ] **Step 1: Read current WebSocketContext.tsx**

Read the file to find exact insertion points.

- [ ] **Step 2: Add state for active task**

In the component state section, add:

```typescript
const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
const [lastCompletedTask, setLastCompletedTask] = useState<{
  taskId: string;
  success: boolean;
  stepCount: number;
  durationMs: number;
} | null>(null);
```

- [ ] **Step 3: Add taskStarted handler**

In the message switch/case, add:

```typescript
case 'taskStarted':
  setActiveTaskId(msg.taskId);
  break;
```

- [ ] **Step 4: Update taskComplete handler**

Replace existing taskComplete handler:

```typescript
case 'taskComplete': {
  const taskId = msg.taskId ?? activeTaskId ?? '';
  const stepCount = msg.stepCount ?? 0;
  const durationMs = msg.durationMs ?? 0;
  setLastCompletedTask({ taskId, success: msg.success, stepCount, durationMs });
  setActiveTaskId(null);
  // Don't add system message here — TaskCompletionCard handles it
  break;
}
```

- [ ] **Step 5: Add sendFeedback function**

```typescript
const sendFeedback = useCallback((taskId: string, rating: 'positive' | 'negative', correction?: string) => {
  send({ type: 'taskFeedback', task_id: taskId, rating, correction });
  setLastCompletedTask(null); // Hide feedback card after submission
}, [send]);
```

- [ ] **Step 6: Expose new state and functions in context value**

Add to the WebSocketState interface and context value:

```typescript
// In interface:
activeTaskId: string | null;
lastCompletedTask: { taskId: string; success: boolean; stepCount: number; durationMs: number } | null;
sendFeedback: (taskId: string, rating: 'positive' | 'negative', correction?: string) => void;
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd browser-agent-chat && npx tsc --noEmit --skipLibCheck --project client/tsconfig.json
```

- [ ] **Step 8: Commit**

```bash
git add client/src/contexts/WebSocketContext.tsx
git commit -m "feat: handle taskStarted, enriched taskComplete, and sendFeedback in WS context"
```

---

### Task 17: TaskCompletionCard Component

**Files:**
- Create: `browser-agent-chat/client/src/components/TaskCompletionCard.tsx`
- Create: `browser-agent-chat/client/src/components/TaskCompletionCard.css`

**Context:** Replaces the plain "Task completed." system message with a rich card containing feedback buttons.

- [ ] **Step 1: Write TaskCompletionCard.tsx**

```tsx
import { useState } from 'react';
import './TaskCompletionCard.css';

interface TaskCompletionCardProps {
  taskId: string;
  success: boolean;
  stepCount: number;
  durationMs: number;
  onFeedback: (taskId: string, rating: 'positive' | 'negative', correction?: string) => void;
}

export default function TaskCompletionCard({
  taskId,
  success,
  stepCount,
  durationMs,
  onFeedback,
}: TaskCompletionCardProps) {
  const [state, setState] = useState<'pending' | 'positive' | 'negative' | 'submitted'>('pending');
  const [submittedRating, setSubmittedRating] = useState<'positive' | 'negative'>('positive');
  const [correction, setCorrection] = useState('');

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${Math.round(ms / 1000)}s`;
  };

  const handlePositive = () => {
    setSubmittedRating('positive');
    setState('submitted');
    onFeedback(taskId, 'positive');
  };

  const handleNegative = () => {
    setState('negative');
  };

  const handleSubmitCorrection = () => {
    setSubmittedRating('negative');
    setState('submitted');
    onFeedback(taskId, 'negative', correction || undefined);
  };

  const handleSkipCorrection = () => {
    setSubmittedRating('negative');
    setState('submitted');
    onFeedback(taskId, 'negative');
  };

  if (state === 'submitted') {
    return (
      <div className={`task-completion-card task-completion-card--${success ? 'success' : 'failed'} task-completion-card--submitted`}>
        <div className="task-completion-card__header">
          <span className={`task-completion-card__dot task-completion-card__dot--${success ? 'success' : 'failed'}`} />
          <span className="task-completion-card__title">Task {success ? 'completed' : 'failed'}</span>
          <span className="task-completion-card__meta">{stepCount} steps · {formatDuration(durationMs)}</span>
        </div>
        <div className="task-completion-card__feedback-done">
          {submittedRating === 'positive'
            ? '👍 Marked as correct · Added to learning pool'
            : '👎 Marked as incorrect · Feedback recorded'}
        </div>
      </div>
    );
  }

  return (
    <div className={`task-completion-card task-completion-card--${success ? 'success' : 'failed'}`}>
      <div className="task-completion-card__header">
        <span className={`task-completion-card__dot task-completion-card__dot--${success ? 'success' : 'failed'}`} />
        <span className="task-completion-card__title">Task {success ? 'completed' : 'failed'}</span>
        <span className="task-completion-card__meta">{stepCount} steps · {formatDuration(durationMs)}</span>
      </div>

      {state === 'pending' && success && (
        <div className="task-completion-card__actions">
          <button className="task-completion-card__btn task-completion-card__btn--positive" onClick={handlePositive}>
            👍 Correct
          </button>
          <button className="task-completion-card__btn task-completion-card__btn--negative" onClick={handleNegative}>
            👎 Incorrect
          </button>
        </div>
      )}

      {state === 'pending' && !success && (
        <div className="task-completion-card__correction">
          <label className="task-completion-card__label">What went wrong? (optional)</label>
          <textarea
            className="task-completion-card__textarea"
            value={correction}
            onChange={e => setCorrection(e.target.value)}
            placeholder="e.g., Button was renamed to 'Create Job'..."
            rows={2}
          />
          <div className="task-completion-card__correction-actions">
            <button className="task-completion-card__btn task-completion-card__btn--skip" onClick={handleSkipCorrection}>
              Skip
            </button>
            <button className="task-completion-card__btn task-completion-card__btn--submit" onClick={handleSubmitCorrection}>
              Submit
            </button>
          </div>
        </div>
      )}

      {state === 'negative' && (
        <div className="task-completion-card__correction">
          <label className="task-completion-card__label">What should have happened?</label>
          <textarea
            className="task-completion-card__textarea"
            value={correction}
            onChange={e => setCorrection(e.target.value)}
            placeholder="e.g., Should have used Settings → Pipelines instead..."
            rows={2}
          />
          <div className="task-completion-card__correction-actions">
            <button className="task-completion-card__btn task-completion-card__btn--skip" onClick={handleSkipCorrection}>
              Skip
            </button>
            <button className="task-completion-card__btn task-completion-card__btn--submit" onClick={handleSubmitCorrection}>
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write TaskCompletionCard.css**

```css
.task-completion-card {
  background: linear-gradient(135deg, var(--bg-primary), var(--bg-secondary));
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task-completion-card--success {
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
}

.task-completion-card--failed {
  border-color: color-mix(in srgb, #ef4444 30%, transparent);
}

.task-completion-card--submitted {
  opacity: 0.8;
}

.task-completion-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-completion-card__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.task-completion-card__dot--success {
  background: #22c55e;
}

.task-completion-card__dot--failed {
  background: #ef4444;
}

.task-completion-card__title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
}

.task-completion-card__meta {
  color: var(--text-muted);
  font-size: 11px;
  margin-left: auto;
}

.task-completion-card__actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-secondary);
}

.task-completion-card__btn {
  flex: 1;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.15s;
}

.task-completion-card__btn:hover {
  opacity: 0.85;
}

.task-completion-card__btn--positive {
  background: color-mix(in srgb, #22c55e 15%, var(--bg-primary));
  border-color: color-mix(in srgb, #22c55e 25%, transparent);
  color: #4ade80;
}

.task-completion-card__btn--negative {
  background: color-mix(in srgb, #ef4444 15%, var(--bg-primary));
  border-color: color-mix(in srgb, #ef4444 25%, transparent);
  color: #f87171;
}

.task-completion-card__btn--skip {
  background: transparent;
  border: 1px solid var(--border-primary);
  color: var(--text-secondary);
}

.task-completion-card__btn--submit {
  background: var(--accent);
  color: white;
}

.task-completion-card__correction {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border-secondary);
}

.task-completion-card__label {
  color: #f87171;
  font-size: 11px;
  font-weight: 500;
}

.task-completion-card__textarea {
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 8px 10px;
  color: var(--text-primary);
  font-size: 12px;
  resize: none;
  font-family: inherit;
}

.task-completion-card__textarea::placeholder {
  color: var(--text-muted);
}

.task-completion-card__correction-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.task-completion-card__feedback-done {
  color: #4ade80;
  font-size: 11px;
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TaskCompletionCard.tsx client/src/components/TaskCompletionCard.css
git commit -m "feat: add TaskCompletionCard component with feedback UI"
```

---

### Task 18: Integrate TaskCompletionCard into ChatPanel

**Files:**
- Modify: `browser-agent-chat/client/src/components/ChatPanel.tsx`

**Context:** Replace the plain "Task completed." / "Task failed." system messages with the TaskCompletionCard. Need to access WS context for `lastCompletedTask` and `sendFeedback`.

- [ ] **Step 1: Read current ChatPanel.tsx**

Read the file to understand exact rendering logic.

- [ ] **Step 2: Add imports**

```typescript
import TaskCompletionCard from './TaskCompletionCard';
```

- [ ] **Step 3: Access WS context values**

The ChatPanel receives messages as a prop. The `lastCompletedTask` and `sendFeedback` need to be passed as props or accessed via context. Add new props:

```typescript
interface ChatPanelProps {
  // ... existing props ...
  lastCompletedTask: { taskId: string; success: boolean; stepCount: number; durationMs: number } | null;
  onFeedback: (taskId: string, rating: 'positive' | 'negative', correction?: string) => void;
}
```

- [ ] **Step 4: Render TaskCompletionCard**

In the messages rendering section, after the messages map, add the completion card:

```tsx
{lastCompletedTask && (
  <TaskCompletionCard
    taskId={lastCompletedTask.taskId}
    success={lastCompletedTask.success}
    stepCount={lastCompletedTask.stepCount}
    durationMs={lastCompletedTask.durationMs}
    onFeedback={onFeedback}
  />
)}
```

Also, in the message rendering, skip rendering "Task completed." and "Task failed." system messages (since the card replaces them):

```tsx
{messages.map(msg => {
  // Skip task completion system messages — handled by TaskCompletionCard
  if (msg.type === 'system' && (msg.content === 'Task completed.' || msg.content === 'Task failed.')) {
    return null;
  }
  // ... existing rendering ...
})}
```

- [ ] **Step 5: Wire props from parent component**

In the parent that renders `ChatPanel` (likely `App.tsx` or a testing view), pass the new props from the WS context:

```tsx
const { lastCompletedTask, sendFeedback } = useWebSocket(); // or context

<ChatPanel
  {...existingProps}
  lastCompletedTask={lastCompletedTask}
  onFeedback={sendFeedback}
/>
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd browser-agent-chat && npx tsc --noEmit --skipLibCheck --project client/tsconfig.json
```

- [ ] **Step 7: Commit**

```bash
git add client/src/components/ChatPanel.tsx
git commit -m "feat: integrate TaskCompletionCard into chat panel"
```

---

### Task 19: Client API Functions

**Files:**
- Modify: `browser-agent-chat/client/src/lib/api.ts`

**Context:** Add API functions for feedback endpoints (REST fallback and pattern management for Phase 1B).

- [ ] **Step 1: Add feedback API functions**

```typescript
// --- Learning System ---

export async function submitFeedback(
  agentId: string,
  taskId: string,
  rating: 'positive' | 'negative',
  correction: string | undefined,
  token: string | null,
): Promise<boolean> {
  const res = await apiAuthFetch(`/api/agents/${agentId}/feedback`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId, rating, correction }),
  });
  return res.ok;
}

export async function fetchLearningStats(agentId: string, token: string | null): Promise<any> {
  const res = await apiAuthFetch(`/api/agents/${agentId}/feedback/stats`, token);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchPatterns(agentId: string, token: string | null): Promise<any[]> {
  const res = await apiAuthFetch(`/api/agents/${agentId}/feedback/patterns`, token);
  if (!res.ok) return [];
  const data = await res.json();
  return data.patterns ?? [];
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat: add feedback and learning API functions"
```

---

### Task 20: Final Verification

- [ ] **Step 1: Verify server TypeScript compiles**

```bash
cd browser-agent-chat && npx tsc --noEmit --skipLibCheck --project server/tsconfig.json
```

Expected: 0 errors.

- [ ] **Step 2: Verify client TypeScript compiles**

```bash
cd browser-agent-chat && npx tsc --noEmit --skipLibCheck --project client/tsconfig.json
```

Expected: 0 errors.

- [ ] **Step 3: Verify dev server starts**

```bash
cd browser-agent-chat && npm run dev
```

Expected: Both server and client start without errors.

- [ ] **Step 4: Add OPENAI_API_KEY to .env**

In `browser-agent-chat/server/.env`, add:

```
OPENAI_API_KEY=your-openai-api-key-here
```

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve compilation issues from learning system integration"
```
