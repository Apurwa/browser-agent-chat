-- Learned patterns (login flows, navigation shortcuts)
CREATE TABLE learned_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('login', 'navigation')),
  trigger JSONB NOT NULL,
  steps JSONB NOT NULL,
  consecutive_failures INT DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stale')),
  use_count INT DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Only one active login pattern per project
CREATE UNIQUE INDEX learned_patterns_project_type_login
  ON learned_patterns (project_id, pattern_type)
  WHERE pattern_type = 'login';

CREATE INDEX idx_learned_patterns_project ON learned_patterns(project_id);

ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their project patterns"
  ON learned_patterns FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- Add raw_target column to nav_edges for cleaner text during replay
ALTER TABLE nav_edges ADD COLUMN raw_target TEXT;

-- RPC function to atomically increment use_count
CREATE OR REPLACE FUNCTION increment_pattern_use_count(pattern_uuid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE learned_patterns
  SET use_count = use_count + 1
  WHERE id = pattern_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
