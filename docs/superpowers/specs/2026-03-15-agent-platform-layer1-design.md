# Layer 1 — Core Agent Platform (Rename + Restructure)

**Date:** 2026-03-15
**Status:** Draft
**Scope:** Rename Projects → Agents, add Task + Execution Step entities, update all routes/UI

## 1. Overview

Transform the current "project-centric" QA tool into an "agent-centric" platform. This is a rename and restructure — the product focus (browser QA testing) stays the same. Users create Agents instead of Projects, and each piece of work the agent does is tracked as a Task with Execution Steps.

**What changes:**
- `projects` table → `agents` table (full rename, all FKs)
- New `tasks` table — one row per user-initiated action
- New `execution_steps` table — structured log of agent work
- All API routes `/projects` → `/agents`
- All client routes `/projects` → `/agents`
- All UI labels "Project" → "Agent"

**What stays the same:**
- Browser automation via Magnitude
- Sessions, Messages (chat log), Findings, Features, Flows, Suggestions
- Eval framework, Nav Graph, Learned Patterns
- WebSocket-based real-time communication
- Authentication (Supabase GitHub OAuth)
- Redis session persistence, browser pool management

## 2. Data Model

### 2.1 Renamed Table: `agents` (was `projects`)

```sql
ALTER TABLE projects RENAME TO agents;
```

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Unchanged |
| user_id | UUID FK → auth.users | Unchanged |
| name | TEXT | Unchanged |
| url | TEXT | The target website URL |
| credentials | JSONB | Encrypted login credentials |
| context | TEXT | Agent-specific notes/instructions |
| eval_cron_schedule | TEXT | Optional cron for scheduled evals |
| created_at | TIMESTAMPTZ | Unchanged |
| updated_at | TIMESTAMPTZ | Unchanged |

### 2.2 Renamed FK Columns

All `project_id` columns across these tables rename to `agent_id`:

- `sessions`
- `memory_features`
- `memory_flows`
- `findings`
- `memory_suggestions`
- `nav_nodes`
- `nav_edges`
- `learned_patterns`
- `eval_cases`
- `eval_runs`

**Tables with no `project_id` column (no column rename needed, but RLS policies reference `projects`):**
- `messages` (joins through `sessions`)
- `nav_node_features` (joins through `nav_nodes`)
- `eval_results` (joins through `eval_runs`)

### 2.3 New Table: `tasks`

One row per user-initiated action within a session.

```sql
CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  prompt          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  success         BOOLEAN,
  error_message   TEXT,
  started_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_session ON tasks(session_id);
CREATE INDEX idx_tasks_agent ON tasks(agent_id);
```

**Lifecycle:** Tasks are created as `running` (there is no queue). End states: `completed`, `failed`, or `cancelled` (user stops mid-task).

### 2.4 New Table: `execution_steps`

Each discrete action the agent takes during a task.

```sql
CREATE TABLE execution_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  step_type       TEXT NOT NULL
                    CHECK (step_type IN ('thought', 'action', 'screenshot', 'navigation', 'finding', 'error')),
  content         TEXT,
  target          TEXT,
  screenshot_url  TEXT,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_steps_task ON execution_steps(task_id);
CREATE UNIQUE INDEX idx_steps_order ON execution_steps(task_id, step_order);
```

**Step types and column usage:**

| step_type | content | target | screenshot_url |
|-----------|---------|--------|----------------|
| `thought` | Reasoning text | NULL | NULL |
| `action` | Action description (e.g., "click login button") | CSS selector or element description | NULL |
| `screenshot` | NULL | NULL | S3 path |
| `navigation` | URL navigated to | NULL | NULL |
| `finding` | Finding title | NULL | NULL |
| `error` | Error message | NULL | NULL |

### 2.5 Entity Hierarchy

```
User (auth.users)
  └─ Agent (was Project)
       ├─ Session
       │    ├─ Message (chat log — unchanged)
       │    └─ Task
       │         └─ Execution Step
       ├─ Feature → Flow
       ├─ Finding
       ├─ Suggestion
       ├─ Nav Node → Nav Edge
       ├─ Learned Pattern
       └─ Eval Case → Eval Run → Eval Result
```

### 2.6 RLS Policies

All existing RLS policies that reference `projects` or `project_id` must be updated to reference `agents` and `agent_id`. New tables (`tasks`, `execution_steps`) get policies following the same pattern:

```sql
-- tasks: user can access tasks for their own agents
CREATE POLICY tasks_user_isolation ON tasks
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

-- execution_steps: user can access steps for their own tasks
CREATE POLICY steps_user_isolation ON execution_steps
  USING (task_id IN (SELECT id FROM tasks WHERE agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())));
```

## 3. API Routes

### 3.1 Renamed Routes

| Old Route | New Route |
|-----------|-----------|
| `GET /api/projects` | `GET /api/agents` |
| `POST /api/projects` | `POST /api/agents` |
| `GET /api/projects/:id` | `GET /api/agents/:id` |
| `PUT /api/projects/:id` | `PUT /api/agents/:id` |
| `DELETE /api/projects/:id` | `DELETE /api/agents/:id` |
| `GET /api/projects/:id/findings` | `GET /api/agents/:id/findings` |
| `PUT /api/projects/:id/findings/:fid` | `PUT /api/agents/:id/findings/:fid` |
| `GET /api/projects/:id/memory/*` | `GET /api/agents/:id/memory/*` |
| `GET /api/projects/:id/suggestions/*` | `GET /api/agents/:id/suggestions/*` |
| `GET /api/projects/:id/evals/*` | `GET /api/agents/:id/evals/*` |

### 3.2 New Routes

```
GET  /api/agents/:id/sessions              — List sessions for agent
GET  /api/agents/:id/sessions/:sid/tasks   — List tasks in session
GET  /api/agents/:id/tasks/:tid/steps      — Get execution steps for task
```

These are read-only. Task creation and step recording happen server-side during agent execution (not via REST API from client).

## 4. WebSocket Protocol

### 4.1 Renamed Fields

All messages containing `projectId` change to `agentId`:

```typescript
// Client → Server
{ type: 'start', agentId: string, resumeUrl?: string }   // was projectId
{ type: 'resume', agentId: string }                        // was projectId
{ type: 'explore', agentId: string }                       // was projectId
{ type: 'task', content: string }                          // unchanged
{ type: 'stop' }                                           // unchanged
{ type: 'ping' }                                           // unchanged
```

### 4.2 New Messages

```typescript
// Server → Client (new)
{ type: 'taskStarted', taskId: string }    // when task row is created
{ type: 'taskComplete', taskId: string, success: boolean }  // enhanced with taskId
```

### 4.3 Server-Side Task Lifecycle

When a `task` message arrives:
1. Create `tasks` row (status: `running`, prompt: user message)
2. Send `taskStarted` to client
3. As agent emits events, write `execution_steps` rows:
   - `thought` event → step_type `thought`
   - `action` event → step_type `action`
   - `screenshot` event → step_type `screenshot`
   - `nav` event → step_type `navigation`
   - `finding` event → step_type `finding`
4. On completion: update task status to `completed`/`failed`, send `taskComplete`
5. On user `stop`: update task status to `cancelled`

Messages table continues to be written in parallel (for chat UI).

## 5. Client Routes

### 5.1 Updated Routes

| Old Route | New Route |
|-----------|-----------|
| `/` | `/` (unchanged — Home) |
| `/projects/:id/testing` | `/agents/:id/testing` |
| `/projects/:id/findings` | `/agents/:id/findings` |
| `/projects/:id/memory` | `/agents/:id/memory` |
| `/projects/:id/settings` | `/agents/:id/settings` |
| `/projects/:id/evals` | `/agents/:id/evals` |

### 5.2 Redirect

Add a redirect from `/projects/*` → `/agents/*` for any bookmarked URLs.

## 6. UI Changes

### 6.1 Terminology

Global find-and-replace in UI copy:
- "Project" → "Agent"
- "project" → "agent"
- "Create Project" → "Create Agent"
- "Project Settings" → "Agent Settings"

### 6.2 Home Page

- Headline stays: "What do you want to test?"
- Cards in the agent list show "Agent" label
- URL input creates an Agent

### 6.3 Sidebar

- Navigation labels updated (already icon-based, minimal text changes)

### 6.4 No New UI Screens in Layer 1

Task and Execution Step data is stored but not yet surfaced in a new UI. The chat panel continues to work as-is — structured task data is available for future features (execution history, analytics, replay).

## 7. Server Code Changes

### 7.1 File-Level Renames

| Area | Change |
|------|--------|
| `server/src/routes/projects.ts` | Rename to `agents.ts`, update all references |
| `server/src/db.ts` | All functions: `getProject` → `getAgent`, `createProject` → `createAgent`, etc. |
| `server/src/types.ts` | `Project` interface → `Agent`, `project_id` fields → `agent_id` |
| `server/src/index.ts` | Route mounting, WS handler: `projectId` → `agentId` |
| `server/src/sessionManager.ts` | `projectId` params → `agentId` |
| `server/src/browserManager.ts` | `projectId` params → `agentId` |
| `server/src/agent.ts` | `projectId` params → `agentId` |
| `server/src/redisStore.ts` | Key prefixes stay (internal), param names change |
| `server/src/nav-graph.ts` | `projectId` → `agentId` |
| `server/src/memory-engine.ts` | `projectId` → `agentId` |
| `server/src/finding-detector.ts` | `projectId` → `agentId` |
| `server/src/suggestion-detector.ts` | `projectId` → `agentId` |
| `server/src/routes/findings.ts` | `projectId` → `agentId` in params |
| `server/src/routes/memory.ts` | `projectId` → `agentId` in params |
| `server/src/routes/suggestions.ts` | `projectId` → `agentId` in params |
| `server/src/routes/evals.ts` | `projectId` → `agentId`, `updateProjectEvalSchedule` → `updateAgentEvalSchedule` |
| `server/src/eval/eval-runner.ts` | `projectId` → `agentId` throughout |
| `server/src/eval/seed.ts` | `project_id` → `agent_id` in `createEvalCase` calls |
| `server/src/muscle-memory.ts` | `projectId` → `agentId` in all functions |

### 7.2 Client Code Changes

| File | Change |
|------|--------|
| `client/src/types.ts` | `ProjectListItem` → `AgentListItem`, `project_id` → `agent_id` in all interfaces, `projectId` → `agentId` in `ClientMessage` |
| `client/src/types/eval.ts` | `project_id` → `agent_id` |
| `client/src/lib/api.ts` | All `/api/projects/` paths → `/api/agents/` |
| `client/src/contexts/WebSocketContext.tsx` | `activeProjectId` → `activeAgentId`, `startAgent(projectId)` → `startAgent(agentId)`, etc. |
| `client/src/components/Home.tsx` | `ProjectListItem` → `AgentListItem`, `projects` state → `agents`, API paths, labels |
| `client/src/components/ChatPanel.tsx` | `projectId` prop → `agentId` |
| `client/src/components/TestingView.tsx` | `projectId` references → `agentId` |
| `client/src/components/ProjectSettings.tsx` | Rename to `AgentSettings.tsx`, update all references |
| `client/src/components/MemoryViewer.tsx` | `projectId` → `agentId` |
| `client/src/components/FindingsDashboard.tsx` | `projectId` → `agentId` |
| `client/src/components/EvalDashboard.tsx` | `project_id` → `agent_id` |
| `client/src/components/EvalCaseEditor.tsx` | `project_id` → `agent_id` |
| `client/src/components/EvalRunDetail.tsx` | `project_id` → `agent_id` |
| `client/src/components/FeatureDetail.tsx` | `projectId` → `agentId` |
| `client/src/hooks/useWebSocket.ts` | `startAgent(projectId)` → `startAgent(agentId)`, WS message `projectId` → `agentId` |
| `client/src/components/Sidebar.tsx` | Navigation URLs `/projects/` → `/agents/` |
| `client/src/components/FindingAlert.tsx` | Navigation URLs `/projects/` → `/agents/` |
| `client/src/App.tsx` | Route paths `/projects/` → `/agents/`, add redirect |

### 7.3 New Server Code

- `server/src/db.ts` — Add `createTask()`, `updateTask()`, `createExecutionStep()`, `getTasksBySession()`, `getStepsByTask()`
- `server/src/routes/agents.ts` — Add session/task/step read endpoints
- `server/src/index.ts` — In WS task handler: create task row, write steps during execution, update on completion

## 8. Migration File

Single migration: `server/migrations/005_rename_to_agents.sql`

**Note on migration directory:** Numbered migrations (001-004) live in `server/migrations/`. The eval migration lives at `server/src/migrations/eval-tables.sql` (unnumbered). This migration follows the numbered convention.

```sql
-- ============================================================
-- Migration 005: Rename projects → agents, add tasks + steps
-- ============================================================

-- 1. Rename projects table → agents
ALTER TABLE projects RENAME TO agents;

-- 2. Rename project_id → agent_id across all tables
ALTER TABLE sessions RENAME COLUMN project_id TO agent_id;
ALTER TABLE memory_features RENAME COLUMN project_id TO agent_id;
ALTER TABLE memory_flows RENAME COLUMN project_id TO agent_id;
ALTER TABLE findings RENAME COLUMN project_id TO agent_id;
ALTER TABLE memory_suggestions RENAME COLUMN project_id TO agent_id;
ALTER TABLE nav_nodes RENAME COLUMN project_id TO agent_id;
ALTER TABLE nav_edges RENAME COLUMN project_id TO agent_id;
ALTER TABLE learned_patterns RENAME COLUMN project_id TO agent_id;
ALTER TABLE eval_cases RENAME COLUMN project_id TO agent_id;
ALTER TABLE eval_runs RENAME COLUMN project_id TO agent_id;

-- 3. Drop all existing RLS policies that reference 'projects'
DROP POLICY IF EXISTS "Users can CRUD own projects" ON agents;
DROP POLICY IF EXISTS "Users can CRUD features of own projects" ON memory_features;
DROP POLICY IF EXISTS "Users can CRUD flows of own projects" ON memory_flows;
DROP POLICY IF EXISTS "Users can access sessions of own projects" ON sessions;
DROP POLICY IF EXISTS "Users can access messages of own sessions" ON messages;
DROP POLICY IF EXISTS "Users can access findings of own projects" ON findings;
DROP POLICY IF EXISTS "Users can manage nav_nodes for their projects" ON nav_nodes;
DROP POLICY IF EXISTS "Users can manage nav_edges for their projects" ON nav_edges;
DROP POLICY IF EXISTS "Users can manage nav_node_features for their projects" ON nav_node_features;
DROP POLICY IF EXISTS "Users can manage their project patterns" ON learned_patterns;
DROP POLICY IF EXISTS "Users can manage their project eval cases" ON eval_cases;
DROP POLICY IF EXISTS "Users can manage their project eval runs" ON eval_runs;
DROP POLICY IF EXISTS "Users can view their eval results" ON eval_results;

-- 4. Recreate RLS policies referencing 'agents' and 'agent_id'
CREATE POLICY "Users can CRUD own agents" ON agents
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can CRUD features of own agents" ON memory_features
  FOR ALL USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can CRUD flows of own agents" ON memory_flows
  FOR ALL USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can access sessions of own agents" ON sessions
  FOR ALL USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can access messages of own sessions" ON messages
  FOR ALL USING (session_id IN (
    SELECT s.id FROM sessions s JOIN agents a ON s.agent_id = a.id WHERE a.user_id = auth.uid()
  ));

CREATE POLICY "Users can access findings of own agents" ON findings
  FOR ALL USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage nav_nodes for their agents" ON nav_nodes
  FOR ALL USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage nav_edges for their agents" ON nav_edges
  FOR ALL USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage nav_node_features for their agents" ON nav_node_features
  FOR ALL USING (nav_node_id IN (
    SELECT id FROM nav_nodes WHERE agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
  ));

CREATE POLICY "Users can manage their agent patterns" ON learned_patterns
  FOR ALL USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage their agent eval cases" ON eval_cases
  FOR ALL USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage their agent eval runs" ON eval_runs
  FOR ALL USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their eval results" ON eval_results
  FOR ALL USING (run_id IN (
    SELECT id FROM eval_runs WHERE agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
  ));

-- Note: memory_suggestions RLS policy — check if one exists in production.
-- If so, drop and recreate:
CREATE POLICY "Users can manage suggestions for own agents" ON memory_suggestions
  FOR ALL USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

-- 5. Create tasks table
CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  prompt          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  success         BOOLEAN,
  error_message   TEXT,
  started_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tasks_session ON tasks(session_id);
CREATE INDEX idx_tasks_agent ON tasks(agent_id);

CREATE POLICY "Users can access tasks of own agents" ON tasks
  FOR ALL USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

-- 6. Create execution_steps table
CREATE TABLE execution_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  step_type       TEXT NOT NULL
                    CHECK (step_type IN ('thought', 'action', 'screenshot', 'navigation', 'finding', 'error')),
  content         TEXT,
  target          TEXT,
  screenshot_url  TEXT,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE execution_steps ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_steps_task ON execution_steps(task_id);
CREATE UNIQUE INDEX idx_steps_order ON execution_steps(task_id, step_order);

CREATE POLICY "Users can access steps of own tasks" ON execution_steps
  FOR ALL USING (task_id IN (
    SELECT id FROM tasks WHERE agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
  ));
```

**Note on index names:** PostgreSQL does not auto-rename index names when columns are renamed. Existing indexes like `idx_sessions_project_id` will keep their old names. This is cosmetic only and does not affect functionality. We leave them as-is to avoid unnecessary complexity.

## 9. Testing Strategy

- Run existing eval cases after migration to verify nothing breaks
- Verify all REST endpoints respond correctly with new `/agents` routes
- Verify WebSocket flow: start → task → steps → complete
- Verify RLS: user A cannot see user B's agents/tasks/steps
- Verify redirect from `/projects/*` → `/agents/*`

## 10. Risk Assessment

| Risk | Mitigation |
|------|------------|
| Migration breaks existing data | Test on Supabase branch database first (project ID: `nzgomknojsgampfqvabr`) |
| Missed rename in code | Global search for "project" after migration, fix stragglers |
| Redis keys incompatible | **Safe.** Redis keys use UUIDs (`session:${uuid}`), not the string "project". Only parameter names in code change, not the stored values. In-flight sessions survive the rename. |
| Bookmark/URL breakage | `/projects/*` → `/agents/*` redirect handles this |
| `taskComplete` WS message change | Adding `taskId` field is additive — existing client handler reads `success` only, ignores unknown fields. Non-breaking. |

## 11. Out of Scope (Layer 1)

- Workspace / team features
- Multiple agent types (DevOps, Support, etc.)
- Tool/integration configuration UI
- Execution history/replay UI (data is stored, UI comes later)
- Agent-to-agent communication
