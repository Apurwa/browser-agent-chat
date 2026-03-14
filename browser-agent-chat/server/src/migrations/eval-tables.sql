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
