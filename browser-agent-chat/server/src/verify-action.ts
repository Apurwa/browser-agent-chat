import type { AgentAction, ActionVerification, ExecutionResult } from './agent-types.js';

// ---------------------------------------------------------------------------
// verifyAction — pure heuristic, no LLM, no I/O
// ---------------------------------------------------------------------------

/**
 * Verify whether an executed action produced the expected outcome.
 *
 * Heuristics (in priority order):
 *  1. result.error exists → passed=false
 *  2. result.success === false → passed=false, confidence=1.0
 *  3. URL changed → navigation effect detected, confidence += 0.3
 *  4. result.data is non-empty → extraction succeeded, confidence += 0.3
 *  5. No negative or positive signals → passed=true, confidence=0.6
 *  6. At least one positive signal → confidence capped at 0.8
 *
 * LLM-based comparison of expectedOutcome vs actual is a future enhancement.
 */
export function verifyAction(
  action: AgentAction,
  result: ExecutionResult,
  urlBefore: string,
  urlAfter: string,
): ActionVerification {
  // Negative signal: explicit error
  if (result.error) {
    return {
      passed: false,
      confidence: 1.0,
      findings: [
        {
          title: 'Action error',
          description: result.error,
          severity: 'high',
        },
      ],
    };
  }

  // Negative signal: execution reported failure
  if (!result.success) {
    return {
      passed: false,
      confidence: 1.0,
      findings: [
        {
          title: 'Execution failed',
          description: `Action ${action.type} did not succeed. Expected: ${action.expectedOutcome}`,
          severity: 'high',
        },
      ],
    };
  }

  // Positive signals
  const urlChanged = urlBefore !== urlAfter;
  const dataExtracted = isNonEmpty(result.data);

  if (!urlChanged && !dataExtracted) {
    return { passed: true, confidence: 0.6, findings: [] };
  }

  // At least one positive signal → boost to 0.8
  return { passed: true, confidence: 0.8, findings: [] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}
