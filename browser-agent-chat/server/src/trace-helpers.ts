import { getLangfuse } from './langfuse.js';
import type { LangfuseTraceClient } from 'langfuse';

export interface TraceFailure {
  errorType:
    | 'element_not_found'
    | 'element_not_interactable'
    | 'navigation_timeout'
    | 'llm_parse_error'
    | 'llm_hallucination'
    | 'page_context_lost'
    | 'login_required'
    | 'extraction_empty'
    | 'budget_exhausted'
    | 'stuck_loop'
    | 'unknown';
  errorMessage: string;
}

export function classifyError(error: string): TraceFailure['errorType'] {
  if (
    error.includes('Target page') ||
    error.includes('browser has been closed') ||
    error.includes('Execution context')
  ) {
    return 'page_context_lost';
  }
  if (error.includes('element') && error.includes('not found')) {
    return 'element_not_found';
  }
  if (error.includes('not interactable') || error.includes('not clickable')) {
    return 'element_not_interactable';
  }
  if (error.includes('timeout') || error.includes('Timeout')) {
    return 'navigation_timeout';
  }
  if (error.includes('ZodError') || error.includes('parse')) {
    return 'llm_parse_error';
  }
  if (error.includes('login') || error.includes('LOGIN_REQUIRED')) {
    return 'login_required';
  }
  return 'unknown';
}

export function createTaskTrace(
  goal: string,
  taskType: string,
  agentId: string | null,
  sessionId: string | null,
): LangfuseTraceClient | null {
  const langfuse = getLangfuse();
  if (!langfuse) return null;
  return langfuse.trace({
    name: `agent-${taskType}`,
    input: { goal, taskType },
    sessionId: sessionId ?? undefined,
    tags: agentId ? [`agent:${agentId}`] : [],
    metadata: { agentId, taskType },
  });
}
