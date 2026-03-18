/**
 * Observability module — LLM call tracking, failure taxonomy, cost aggregation.
 *
 * This wraps LLM calls made by our code (planner, policy, executor) with
 * structured tracking. Magnitude-core's internal calls are tracked via
 * Mastra's LangfuseExporter which auto-instruments workflow steps.
 */

import { getLangfuse } from './langfuse.js';

// ---------------------------------------------------------------------------
// Prompt Versioning
// ---------------------------------------------------------------------------

export const PROMPT_VERSIONS = {
  planner: 'planner_v3.0_structured_intents',
  policy: 'policy_v2.1_progress_context',
  executor: 'executor_v1.0_extract_schema',
  taskPrompt: 'task_v2.0_credential_policy',
} as const;

// ---------------------------------------------------------------------------
// Failure Taxonomy
// ---------------------------------------------------------------------------

export type FailureCategory =
  | 'llm_error'
  | 'llm_timeout'
  | 'element_not_found'
  | 'navigation_failed'
  | 'auth_required'
  | 'auth_failed'
  | 'browser_crashed'
  | 'browser_hung'
  | 'budget_exhausted'
  | 'stuck_loop'
  | 'schema_mismatch'
  | 'unknown';

export interface FailureRecord {
  category: FailureCategory;
  message: string;
  step?: number;
  intentId?: string;
  actionType?: string;
  recoverable: boolean;
}

export function classifyFailure(error: string): FailureCategory {
  const lower = error.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) return 'llm_timeout';
  if (lower.includes('api_error') || lower.includes('500 internal')) return 'llm_error';
  if (lower.includes('element') || lower.includes('selector') || lower.includes('not found')) return 'element_not_found';
  if (lower.includes('navigation') || lower.includes('goto') || lower.includes('net::err')) return 'navigation_failed';
  if (lower.includes('login') || lower.includes('auth') || lower.includes('credential_needed')) return 'auth_required';
  if (lower.includes('login failed') || lower.includes('credential') && lower.includes('failed')) return 'auth_failed';
  if (lower.includes('cdp') || lower.includes('closed') || lower.includes('target page')) return 'browser_crashed';
  if (lower.includes('hung') || lower.includes('evaluate')) return 'browser_hung';
  if (lower.includes('budget') || lower.includes('exhausted')) return 'budget_exhausted';
  if (lower.includes('stuck') || lower.includes('repeated')) return 'stuck_loop';
  if (lower.includes('parse') || lower.includes('schema') || lower.includes('zod')) return 'schema_mismatch';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Cost Model
// ---------------------------------------------------------------------------

const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
};

export interface LLMCallMetrics {
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  durationMs: number;
  model: string;
  cacheRead?: number;
  cacheWrite?: number;
}

export function computeCost(model: string, tokensInput: number, tokensOutput: number): number {
  const rates = COST_PER_1K_TOKENS[model] ?? COST_PER_1K_TOKENS['claude-sonnet-4-20250514'];
  return (tokensInput / 1000) * rates.input + (tokensOutput / 1000) * rates.output;
}

// ---------------------------------------------------------------------------
// Task Cost Aggregator
// ---------------------------------------------------------------------------

export interface TaskCostSummary {
  llmCalls: number;
  tokensInput: number;
  tokensOutput: number;
  totalCostUsd: number;
  failures: FailureRecord[];
}

export class TaskCostAggregator {
  private calls: LLMCallMetrics[] = [];
  private _failures: FailureRecord[] = [];

  recordLLMCall(metrics: LLMCallMetrics): void {
    this.calls.push(metrics);
  }

  recordFailure(failure: FailureRecord): void {
    this._failures.push(failure);
  }

  summarize(): TaskCostSummary {
    return {
      llmCalls: this.calls.length,
      tokensInput: this.calls.reduce((sum, c) => sum + c.tokensInput, 0),
      tokensOutput: this.calls.reduce((sum, c) => sum + c.tokensOutput, 0),
      totalCostUsd: this.calls.reduce((sum, c) => sum + c.costUsd, 0),
      failures: [...this._failures],
    };
  }
}

// ---------------------------------------------------------------------------
// LLM Call Wrapper — use this around agent.extract() calls
// ---------------------------------------------------------------------------

export interface TrackedLLMCallOptions {
  caller: 'planner' | 'policy' | 'executor';
  promptVersion: string;
  input: unknown;
  traceSpan?: any; // Langfuse span to nest generation under
  aggregator?: TaskCostAggregator;
}

/**
 * Wrap an agent.extract() call with Langfuse generation tracking.
 * Captures full prompt input, LLM response, duration, and token metrics.
 */
export async function trackLLMCall<T>(
  fn: () => Promise<T>,
  options: TrackedLLMCallOptions,
): Promise<{ result: T; metrics: LLMCallMetrics }> {
  const { caller, promptVersion, input, traceSpan, aggregator } = options;
  const startTime = Date.now();

  const generation = traceSpan?.generation({
    name: `llm-${caller}`,
    input,
    metadata: { promptVersion, caller },
    model: 'claude-sonnet-4-20250514',
  });

  try {
    const result = await fn();
    const durationMs = Date.now() - startTime;

    // Token counts not available from agent.extract() — estimate from response size
    const responseStr = JSON.stringify(result);
    const estimatedOutputTokens = Math.ceil(responseStr.length / 4);
    const inputStr = JSON.stringify(input);
    const estimatedInputTokens = Math.ceil(inputStr.length / 4);

    const metrics: LLMCallMetrics = {
      tokensInput: estimatedInputTokens,
      tokensOutput: estimatedOutputTokens,
      costUsd: computeCost('claude-sonnet-4-20250514', estimatedInputTokens, estimatedOutputTokens),
      durationMs,
      model: 'claude-sonnet-4-20250514',
    };

    generation?.end({
      output: result,
      metadata: { promptVersion, ...metrics },
    });

    aggregator?.recordLLMCall(metrics);

    return { result, metrics };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);

    generation?.end({
      output: { error: errMsg },
      level: 'ERROR',
      metadata: { promptVersion, durationMs, failureCategory: classifyFailure(errMsg) },
    });

    aggregator?.recordFailure({
      category: classifyFailure(errMsg),
      message: errMsg,
      recoverable: false,
    });

    throw error;
  }
}
