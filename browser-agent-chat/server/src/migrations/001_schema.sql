-- 001_schema.sql
-- QA Agent v0 — Full schema (clean start, no migration from existing tables)

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing prototype tables
DROP TABLE IF EXISTS screenshots CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;

-- Projects
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  credentials jsonb, -- AES-256-GCM encrypted: { iv, encrypted, tag }
  context text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Memory: Features
CREATE TABLE memory_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  criticality text NOT NULL DEFAULT 'medium' CHECK (criticality IN ('critical','high','medium','low')),
  expected_behaviors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Memory: Flows
CREATE TABLE memory_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id uuid NOT NULL REFERENCES memory_features(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  checkpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  criticality text NOT NULL DEFAULT 'medium' CHECK (criticality IN ('critical','high','medium','low')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sessions
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  findings_count integer NOT NULL DEFAULT 0
);

-- Messages
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','agent','thought','action','system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Findings
CREATE TABLE findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  type text NOT NULL CHECK (type IN ('visual','functional','data','ux')),
  severity text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  feature text,
  flow text,
  steps_to_reproduce jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_behavior text,
  actual_behavior text,
  screenshot_url text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_memory_features_project_id ON memory_features(project_id);
CREATE INDEX idx_memory_flows_feature_id ON memory_flows(feature_id);
CREATE INDEX idx_memory_flows_project_id ON memory_flows(project_id);
CREATE INDEX idx_sessions_project_id ON sessions(project_id);
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_findings_project_id ON findings(project_id);
CREATE INDEX idx_findings_session_id ON findings(session_id);
CREATE INDEX idx_findings_status ON findings(status);

-- RLS Policies
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own projects"
  ON projects FOR ALL USING (auth.uid() = user_id);

ALTER TABLE memory_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD features of own projects"
  ON memory_features FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

ALTER TABLE memory_flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD flows of own projects"
  ON memory_flows FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can access sessions of own projects"
  ON sessions FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can access messages of own sessions"
  ON messages FOR ALL
  USING (session_id IN (
    SELECT s.id FROM sessions s
    JOIN projects p ON s.project_id = p.id
    WHERE p.user_id = auth.uid()
  ));

ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can access findings of own projects"
  ON findings FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- Storage bucket for finding screenshots
INSERT INTO storage.buckets (id, name, public) VALUES ('screenshots', 'screenshots', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload screenshots"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'screenshots' AND auth.role() = 'authenticated');

CREATE POLICY "Anyone can view screenshots"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'screenshots');

-- Function to increment findings count on sessions
CREATE OR REPLACE FUNCTION increment_findings_count(sid uuid)
RETURNS void AS $$
BEGIN
  UPDATE sessions SET findings_count = findings_count + 1 WHERE id = sid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
