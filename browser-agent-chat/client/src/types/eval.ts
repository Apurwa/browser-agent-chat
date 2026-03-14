export interface EvalCase {
  id: string;
  agent_id: string;
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
  agent_id: string;
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
  case_name?: string;
  case_source_type?: string;
  session_id: string | null;
  verdict: 'pass' | 'fail' | 'error';
  code_checks: Record<string, boolean>;
  llm_judge: { verdict: string; reasoning: string } | null;
  error_type: string | null;
  steps_taken: Array<{ order: number; action: string; target?: string }>;
  duration_ms: number | null;
  screenshots: string[];
}
