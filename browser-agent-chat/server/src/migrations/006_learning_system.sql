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
