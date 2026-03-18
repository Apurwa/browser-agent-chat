import { getLangfuse } from './langfuse.js';
import { classifyFailure, type FailureCategory } from './observability.js';
import type { LangfuseTraceClient } from 'langfuse';

export interface TraceFailure {
  errorType: FailureCategory;
  errorMessage: string;
}

/**
 * Classify an error string into a failure category.
 * Delegates to the canonical classifyFailure() in observability.ts.
 */
export function classifyError(error: string): FailureCategory {
  return classifyFailure(error);
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
