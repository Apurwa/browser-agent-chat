-- Memory suggestions table (staging area for agent discoveries)
CREATE TABLE IF NOT EXISTS memory_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('feature', 'flow', 'behavior')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  data JSONB NOT NULL,
  source_session UUID REFERENCES sessions(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_suggestions_project_status
  ON memory_suggestions(project_id, status);

-- RPC for atomic behavior append (avoids read-then-write race conditions)
CREATE OR REPLACE FUNCTION append_expected_behavior(feature_uuid UUID, new_behavior TEXT)
RETURNS void AS $$
BEGIN
  UPDATE memory_features
  SET expected_behaviors = expected_behaviors || to_jsonb(new_behavior),
      updated_at = now()
  WHERE id = feature_uuid;
END;
$$ LANGUAGE plpgsql;
