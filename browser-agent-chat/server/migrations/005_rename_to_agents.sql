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
