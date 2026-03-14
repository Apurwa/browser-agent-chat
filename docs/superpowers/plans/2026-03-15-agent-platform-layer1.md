# Layer 1 — Agent Platform Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Projects → Agents throughout the stack, add Task + Execution Step entities for structured execution tracking.

**Architecture:** Three independent work streams: (1) Database migration, (2) Server-side rename + new task/step logic, (3) Client-side rename + route updates. Each stream can be done in isolation and tested independently.

**Tech Stack:** Supabase (PostgreSQL + RLS), Express + WebSocket, React 19 + TypeScript, Redis

**Spec:** `docs/superpowers/specs/2026-03-15-agent-platform-layer1-design.md`

---

## Chunk 1: Database Migration + Server Types

### Task 1: Create and apply the database migration

**Files:**
- Create: `server/migrations/005_rename_to_agents.sql`

- [ ] **Step 1: Create the migration file**

Copy the complete SQL from spec Section 8 into `server/migrations/005_rename_to_agents.sql`. The SQL is already written in the spec — copy it verbatim.

- [ ] **Step 2: Apply migration to Supabase**

Run via Supabase SQL Editor (Dashboard → SQL Editor → paste and run). Alternatively:

```bash
# If using Supabase CLI with branch:
supabase db push
```

Verify by checking the Supabase Table Editor that:
- `projects` table no longer exists
- `agents` table exists with all data intact
- `tasks` and `execution_steps` tables exist
- All FK columns show `agent_id` (not `project_id`)

- [ ] **Step 3: Verify RLS policies**

In Supabase SQL Editor, run:
```sql
SELECT schemaname, tablename, policyname FROM pg_policies WHERE tablename IN ('agents', 'sessions', 'memory_features', 'tasks', 'execution_steps') ORDER BY tablename;
```

Expected: All policy names reference "agents" not "projects". `tasks` and `execution_steps` have their own policies.

- [ ] **Step 4: Commit**

```bash
git add server/migrations/005_rename_to_agents.sql
git commit -m "feat: add migration 005 — rename projects to agents, add tasks + execution_steps"
```

### Task 2: Rename server types (`types.ts`)

**Files:**
- Modify: `server/src/types.ts`

- [ ] **Step 1: Rename `Project` interface to `Agent`**

Find and rename these interfaces/types:
- `interface Project` → `interface Agent`
- `CreateProjectRequest` → `CreateAgentRequest`
- `ProjectResponse` → `AgentResponse`
- `ProjectListItem` → `AgentListItem`

Rename all `project_id` fields to `agent_id` in all interfaces (`Feature`, `Flow`, `Finding`, `Suggestion`, `NavNode`, `NavEdge`, `LearnedPattern`, `EvalCase`, `EvalRun`, `Session`).

- [ ] **Step 2: Rename `projectId` in `ClientMessage` type**

Change:
```typescript
| { type: 'start'; projectId: string; resumeUrl?: string }
| { type: 'resume'; projectId: string }
| { type: 'explore'; projectId: string }
```
To:
```typescript
| { type: 'start'; agentId: string; resumeUrl?: string }
| { type: 'resume'; agentId: string }
| { type: 'explore'; agentId: string }
```

- [ ] **Step 3: Add `taskStarted` to `ServerMessage` type**

Add to the `ServerMessage` union:
```typescript
| { type: 'taskStarted'; taskId: string }
```

And update the existing `taskComplete` variant to include `taskId`:
```typescript
| { type: 'taskComplete'; taskId: string; success: boolean }
```

- [ ] **Step 4: Add Task and ExecutionStep interfaces**

```typescript
export interface Task {
  id: string;
  session_id: string;
  agent_id: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  success: boolean | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export type StepType = 'thought' | 'action' | 'screenshot' | 'navigation' | 'finding' | 'error';

export interface ExecutionStep {
  id: string;
  task_id: string;
  step_order: number;
  step_type: StepType;
  content: string | null;
  target: string | null;
  screenshot_url: string | null;
  duration_ms: number | null;
  created_at: string;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd browser-agent-chat/server && npx tsc --noEmit 2>&1 | head -50
```

Expected: Many errors in files that still reference `Project` / `projectId` — that's correct, we fix those in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add server/src/types.ts
git commit -m "feat: rename Project→Agent in types, add Task + ExecutionStep interfaces"
```

### Task 3: Rename `db.ts` functions and add task/step DB functions

**Files:**
- Modify: `server/src/db.ts`

- [ ] **Step 1: Rename all project references**

Global find-and-replace within `db.ts`:
- `getProject` → `getAgent`
- `createProject` → `createAgent`
- `updateProject` → `updateAgent`
- `deleteProject` → `deleteAgent`
- `listProjects` → `listAgents`
- `getProjectListStats` → `getAgentListStats`
- `updateProjectEvalSchedule` → `updateAgentEvalSchedule`
- `getProjectsWithEvalSchedule` → `getAgentsWithEvalSchedule`
- `.from('projects')` → `.from('agents')`
- `project_id` → `agent_id` in all query column references
- `projectId` → `agentId` in all parameter names
- `Project` type references → `Agent`

- [ ] **Step 2: Add task CRUD functions**

Add to `db.ts`:

```typescript
export async function createTask(sessionId: string, agentId: string, prompt: string): Promise<string> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({ session_id: sessionId, agent_id: agentId, prompt, status: 'running', started_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateTask(taskId: string, updates: { status?: string; success?: boolean; error_message?: string; completed_at?: string }): Promise<void> {
  const { error } = await supabase.from('tasks').update(updates).eq('id', taskId);
  if (error) throw error;
}

export async function getTasksBySession(sessionId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 3: Add execution step functions**

```typescript
export async function createExecutionStep(taskId: string, stepOrder: number, stepType: StepType, fields: { content?: string; target?: string; screenshot_url?: string; duration_ms?: number }): Promise<string> {
  const { data, error } = await supabase
    .from('execution_steps')
    .insert({ task_id: taskId, step_order: stepOrder, step_type: stepType, ...fields })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function getStepsByTask(taskId: string): Promise<ExecutionStep[]> {
  const { data, error } = await supabase
    .from('execution_steps')
    .select('*')
    .eq('task_id', taskId)
    .order('step_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd browser-agent-chat/server && npx tsc --noEmit 2>&1 | head -50
```

- [ ] **Step 5: Commit**

```bash
git add server/src/db.ts
git commit -m "feat: rename project→agent in db.ts, add task + execution step CRUD"
```

## Chunk 2: Server Core Rename

### Task 4: Rename `routes/projects.ts` → `routes/agents.ts`

**Files:**
- Rename: `server/src/routes/projects.ts` → `server/src/routes/agents.ts`
- Modify: `server/src/index.ts` (route mounting)

- [ ] **Step 1: Rename the file**

```bash
cd browser-agent-chat && mv server/src/routes/projects.ts server/src/routes/agents.ts
```

- [ ] **Step 2: Rename all project references inside `agents.ts`**

Global find-and-replace within `server/src/routes/agents.ts`:
- `projectId` → `agentId`
- `project` → `agent` (in variable names)
- `getProject` → `getAgent`, `createProject` → `createAgent`, etc. (matching db.ts renames)

- [ ] **Step 3: Add new session/task/step read endpoints to `agents.ts`**

```typescript
// GET /api/agents/:id/sessions
router.get('/:id/sessions', async (req, res) => {
  const agentId = req.params.id;
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// GET /api/agents/:id/sessions/:sid/tasks
router.get('/:id/sessions/:sid/tasks', async (req, res) => {
  const tasks = await getTasksBySession(req.params.sid);
  res.json(tasks);
});

// GET /api/agents/:id/tasks/:tid/steps
router.get('/:id/tasks/:tid/steps', async (req, res) => {
  const steps = await getStepsByTask(req.params.tid);
  res.json(steps);
});
```

- [ ] **Step 4: Update route mounting in `index.ts`**

In `server/src/index.ts`, change:
```typescript
import projectsRouter from './routes/projects';
app.use('/api/projects', requireAuth, projectsRouter);
```
To:
```typescript
import agentsRouter from './routes/agents';
app.use('/api/agents', agentsRouter);  // Note: requireAuth is applied per-handler inside route files, NOT at mount level
```

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/agents.ts server/src/index.ts
git rm server/src/routes/projects.ts  # if git doesn't auto-detect the rename
git commit -m "feat: rename routes/projects→agents, add session/task/step endpoints"
```

### Task 5: Rename all remaining server route files

**Files:**
- Modify: `server/src/routes/findings.ts`
- Modify: `server/src/routes/memory.ts`
- Modify: `server/src/routes/suggestions.ts`
- Modify: `server/src/routes/evals.ts`

- [ ] **Step 1: Rename in each route file**

For each file, find-and-replace:
- `projectId` → `agentId` (in `req.params` destructuring and variable usage)
- `project_id` → `agent_id` (in query column references)
- Any db function name changes (`getProject` → `getAgent`, etc.)

- [ ] **Step 2: Update route mounting in `index.ts`**

Update the route mounting paths:
```typescript
// Old
app.use('/api/projects/:id/findings', ...);
app.use('/api/projects/:id/memory', ...);
app.use('/api/projects/:id/suggestions', ...);
app.use('/api/projects/:id/evals', ...);

// New
app.use('/api/agents/:id/findings', ...);
app.use('/api/agents/:id/memory', ...);
app.use('/api/agents/:id/suggestions', ...);
app.use('/api/agents/:id/evals', ...);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/ server/src/index.ts
git commit -m "feat: rename project→agent in all route files"
```

### Task 6: Rename server core modules

**Files:**
- Modify: `server/src/sessionManager.ts`
- Modify: `server/src/browserManager.ts`
- Modify: `server/src/agent.ts`
- Modify: `server/src/redisStore.ts`
- Modify: `server/src/nav-graph.ts`
- Modify: `server/src/memory-engine.ts`
- Modify: `server/src/finding-detector.ts`
- Modify: `server/src/suggestion-detector.ts`
- Modify: `server/src/muscle-memory.ts`
- Modify: `server/src/eval/eval-runner.ts`
- Modify: `server/src/eval/seed.ts`

- [ ] **Step 1: Rename in each file**

For every file listed above, find-and-replace:
- `projectId` → `agentId` (parameter names, variable names, map keys)
- `project_id` → `agent_id` (DB column references)
- `Project` → `Agent` (type references)
- `clientProjects` → `clientAgents` (in `index.ts`)
- `broadcastToProject` → `broadcastToAgent` (in `index.ts` line 72 — also imported by `routes/evals.ts`)

**Key files with heavy usage:**
- `sessionManager.ts`: `projectId` parameter in `createSession`, `destroySession`, `recoverSession`, `hasSession`, `getAgent`, `addClient`, `removeClient`, `makeBroadcast`, `sendSnapshot`. Also `agents` map (was likely named differently).
- `redisStore.ts`: Only rename parameter names. Redis key format (`session:${id}`) stays — the `id` is a UUID, not the word "project".
- `index.ts`: `clientProjects` Map → `clientAgents`, all `msg.projectId` → `msg.agentId` in the WebSocket handler.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd browser-agent-chat/server && npx tsc --noEmit 2>&1 | head -20
```

Expected: Clean compile (zero errors).

- [ ] **Step 3: Commit**

```bash
git add server/src/
git commit -m "feat: rename project→agent in all server core modules"
```

### Task 7: Add task lifecycle to WebSocket handler

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Import new db functions**

Add to imports in `index.ts`:
```typescript
import { createTask, updateTask, createExecutionStep } from './db';
```

- [ ] **Step 2: Add task tracking state**

Add a Map to track active tasks per agent:
```typescript
const activeTasks = new Map<string, { taskId: string; stepCount: number }>();
```

- [ ] **Step 3: Create task on `task` message**

In the `msg.type === 'task'` handler, before calling the agent:

```typescript
const agentId = clientAgents.get(ws);
if (!agentId) return;
const session = sessionManager.getSession(agentId);
const dbSessionId = session?.dbSessionId;
if (dbSessionId) {
  const taskId = await createTask(dbSessionId, agentId, msg.content);
  activeTasks.set(agentId, { taskId, stepCount: 0 });
  ws.send(JSON.stringify({ type: 'taskStarted', taskId } as ServerMessage));
}
```

- [ ] **Step 4: Write execution steps during agent events**

In the broadcast function (where thoughts/actions/screenshots are sent to clients), add step recording:

```typescript
// Inside the broadcast callback that handles agent events:
const activeTask = activeTasks.get(agentId);
if (activeTask) {
  const stepOrder = ++activeTask.stepCount;
  const stepType = /* map event type to step_type */;
  createExecutionStep(activeTask.taskId, stepOrder, stepType, { content, target }).catch(err =>
    console.error('[STEP] Failed to record step:', err)
  );
}
```

- [ ] **Step 5: Complete task on `taskComplete`**

When the agent finishes a task:
```typescript
const activeTask = activeTasks.get(agentId);
if (activeTask) {
  await updateTask(activeTask.taskId, {
    status: success ? 'completed' : 'failed',
    success,
    completed_at: new Date().toISOString(),
  });
  activeTasks.delete(agentId);
}
```

- [ ] **Step 6: Cancel task on `stop`**

In the `msg.type === 'stop'` handler:
```typescript
const activeTask = activeTasks.get(agentId);
if (activeTask) {
  await updateTask(activeTask.taskId, { status: 'cancelled', completed_at: new Date().toISOString() });
  activeTasks.delete(agentId);
}
```

- [ ] **Step 7: Verify server compiles and starts**

```bash
cd browser-agent-chat/server && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: add task lifecycle tracking to WebSocket handler"
```

## Chunk 3: Client-Side Rename

### Task 8: Rename client types

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/types/eval.ts`

- [ ] **Step 1: Rename in `types.ts`**

- `ProjectListItem` → `AgentListItem`
- `project_id` → `agent_id` in all interfaces
- `projectId` → `agentId` in `ClientMessage` types

- [ ] **Step 2: Rename in `types/eval.ts`**

- `project_id` → `agent_id` in all eval-related interfaces

- [ ] **Step 3: Commit**

```bash
git add client/src/types.ts client/src/types/eval.ts
git commit -m "feat: rename project→agent in client types"
```

### Task 9: Rename WebSocket context and API lib

**Files:**
- Modify: `client/src/contexts/WebSocketContext.tsx`
- Modify: `client/src/hooks/useWebSocket.ts`
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Rename in `WebSocketContext.tsx`**

- `activeProjectId` → `activeAgentId`
- `activeProjectRef` → `activeAgentRef`
- `startAgent(projectId: string)` → `startAgent(agentId: string)`
- `send({ type: 'start', projectId, ... })` → `send({ type: 'start', agentId, ... })`
- Same for `resume`, `explore` messages
- Any `projectId` variables → `agentId`

- [ ] **Step 2: Rename in `useWebSocket.ts`**

- Same pattern as WebSocketContext: `projectId` → `agentId` in all function signatures and message payloads

- [ ] **Step 3: Rename in `api.ts`**

- All `/api/projects/` URL paths → `/api/agents/`

- [ ] **Step 4: Commit**

```bash
git add client/src/contexts/WebSocketContext.tsx client/src/hooks/useWebSocket.ts client/src/lib/api.ts
git commit -m "feat: rename project→agent in WebSocket context and API lib"
```

### Task 10: Rename all client components

**Files:**
- Modify: `client/src/components/Home.tsx`
- Modify: `client/src/components/TestingView.tsx`
- Modify: `client/src/components/ChatPanel.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/components/FindingAlert.tsx`
- Modify: `client/src/components/FindingsDashboard.tsx`
- Modify: `client/src/components/FindingDetail.tsx`
- Modify: `client/src/components/MemoryViewer.tsx`
- Modify: `client/src/components/FeatureDetail.tsx`
- Modify: `client/src/components/SuggestionCard.tsx`
- Modify: `client/src/components/EvalDashboard.tsx`
- Modify: `client/src/components/EvalCaseEditor.tsx`
- Modify: `client/src/components/EvalRunDetail.tsx`
- Modify: `client/src/components/EvalResultDetail.tsx`
- Rename: `client/src/components/ProjectSettings.tsx` → `client/src/components/AgentSettings.tsx`

- [ ] **Step 1: Rename `ProjectSettings.tsx` → `AgentSettings.tsx`**

```bash
cd browser-agent-chat && mv client/src/components/ProjectSettings.tsx client/src/components/AgentSettings.tsx
```

- [ ] **Step 2: Rename in `Home.tsx`**

- `ProjectListItem` → `AgentListItem`
- `projects` state variable → `agents`
- `setProjects` → `setAgents`
- `/api/projects` → `/api/agents`
- "project" labels → "agent" in UI text
- Navigation paths `/projects/` → `/agents/`

- [ ] **Step 3: Rename in all other components**

For each component file listed above, find-and-replace:
- `projectId` → `agentId` (props, variables, URL params)
- `project_id` → `agent_id` (data fields)
- `/projects/` → `/agents/` (navigation paths)
- "Project" → "Agent" and "project" → "agent" (UI labels only — be careful not to rename CSS class names)

- [ ] **Step 4: Rename in `Sidebar.tsx`**

- Navigation URLs: `/projects/${id}/` → `/agents/${id}/`

- [ ] **Step 5: Rename in `FindingAlert.tsx`**

- Navigation URLs: `/projects/${id}/findings` → `/agents/${id}/findings`

- [ ] **Step 6: Commit**

```bash
git add client/src/components/
git commit -m "feat: rename project→agent in all client components"
```

### Task 11: Update routes in `App.tsx` and add redirect

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Update route paths**

Change all route definitions:
```tsx
// Old
<Route path="/projects/:id/testing" element={...} />
<Route path="/projects/:id/findings" element={...} />
// etc.

// New
<Route path="/agents/:id/testing" element={...} />
<Route path="/agents/:id/findings" element={...} />
// etc.
```

- [ ] **Step 2: Update `ProjectSettings` import to `AgentSettings`**

```tsx
// Old
import ProjectSettings from './components/ProjectSettings';
// New
import AgentSettings from './components/AgentSettings';
```

- [ ] **Step 3: Add redirect from old routes**

```tsx
import { Navigate } from 'react-router-dom';

// Add catch-all redirect for bookmarked /projects/ URLs
<Route path="/projects/*" element={<Navigate to={window.location.pathname.replace('/projects/', '/agents/')} replace />} />
```

- [ ] **Step 4: Verify client compiles**

```bash
cd browser-agent-chat/client && npx tsc --noEmit
```

Expected: Clean compile (zero errors).

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: update routes /projects→/agents, add redirect for bookmarks"
```

## Chunk 4: Verification

### Task 12: Global search for remaining "project" references

- [ ] **Step 1: Search server code**

```bash
cd browser-agent-chat/server/src && grep -rn "project" --include="*.ts" -l
```

Expected: No matches (or only in comments/string literals that don't affect functionality).

- [ ] **Step 2: Search client code**

```bash
cd browser-agent-chat/client/src && grep -rn "project" --include="*.ts" --include="*.tsx" -l
```

Expected: No matches (except possibly CSS class names like `.home-project-card` which are cosmetic and can be renamed later).

- [ ] **Step 3: Fix any remaining references**

If any functional `project` references remain, fix them.

- [ ] **Step 4: Full compile check**

```bash
cd browser-agent-chat && npm run build
```

Expected: Clean build for both server and client.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: clean up remaining project→agent references"
```

### Task 13: End-to-end manual test

- [ ] **Step 1: Start the app**

```bash
cd browser-agent-chat && npm run dev
```

- [ ] **Step 2: Verify Home page**

Navigate to `http://localhost:5174`. Should show the agent list (renamed from project list). Create a new agent by pasting a URL.

- [ ] **Step 3: Verify agent testing view**

URL should be `/agents/:id/testing`. Start the agent, send a task via chat. Verify:
- Agent starts (status goes to `idle`)
- Chat messages work
- Browser view shows screenshots
- Suggestion chips appear when agent goes idle

- [ ] **Step 4: Verify task recording**

After a task completes, check Supabase:
```sql
SELECT * FROM tasks ORDER BY created_at DESC LIMIT 5;
SELECT * FROM execution_steps ORDER BY created_at DESC LIMIT 20;
```

Expected: Tasks and steps are being recorded.

- [ ] **Step 5: Verify all sidebar navigation**

Click through all sidebar links — Testing, Findings, Memory, Evals, Settings. All should load correctly at `/agents/:id/...` paths.

- [ ] **Step 6: Verify `/projects/` redirect**

Navigate to an old bookmark URL like `/projects/<uuid>/testing`. Should redirect to `/agents/<uuid>/testing`.

- [ ] **Step 7: Final commit if needed**

```bash
git add -A
git commit -m "fix: final adjustments after e2e testing"
```
