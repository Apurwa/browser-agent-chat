import type {
  TaskMemory,
  ActionVerification,
  EvaluateProgressDecision,
  StuckSignals,
} from './agent-types.js';
import type { BudgetTracker } from './budget.js';

// ---------------------------------------------------------------------------
// evaluateProgress — pure function, no LLM, no I/O
// ---------------------------------------------------------------------------

/**
 * Decide the next high-level control action for the agent loop.
 *
 * Logic:
 *  1. Update stuck signals based on last action outcome.
 *  2. If budget exhausted → 'done'
 *  3. If stuck rule fires:
 *     - repeatedAction >= 3 OR samePage >= 4 OR failedExecution >= 2
 *       AND stepsSinceProgress >= 5
 *     → if replans available → 'replan', else → 'escalate_to_user'
 *  4. If lastVerification failed → 'retry_action'
 *  5. Otherwise → 'continue'
 *
 * Intent completion check (→ VERIFY_INTENT) is handled by the caller in the workflow.
 *
 * Note: This function mutates `taskMemory.stuckSignals` in place to reflect
 * the updated counts after processing the last action. This is intentional —
 * the caller owns the memory object and should treat evaluateProgress as the
 * authoritative updater of stuck signal state.
 */
export function evaluateProgress(
  taskMemory: TaskMemory,
  budget: BudgetTracker,
  lastVerification: ActionVerification,
  urlBefore: string,
  urlAfter: string,
): { decision: EvaluateProgressDecision; reason: string } {
  // 1. Update stuck signals
  const signals = updateStuckSignals(
    taskMemory.stuckSignals,
    taskMemory.actionsAttempted,
    lastVerification,
    urlBefore,
    urlAfter,
  );

  // Persist updated signals back into memory (caller-owned object)
  taskMemory.stuckSignals = signals;

  // 2. Budget exhausted
  if (budget.exhausted()) {
    return { decision: 'done', reason: 'Agent budget exhausted' };
  }

  // 3. Stuck rule
  const isStuck =
    (signals.repeatedActionCount >= 3 ||
      signals.samePageCount >= 4 ||
      signals.failedExecutionCount >= 2) &&
    signals.stepsSinceProgress >= 5;

  if (isStuck) {
    if (budget.canReplan()) {
      return {
        decision: 'replan',
        reason: buildStuckReason(signals),
      };
    }
    return {
      decision: 'escalate_to_user',
      reason: `${buildStuckReason(signals)}. No replan attempts remaining.`,
    };
  }

  // 4. Last verification failed — retry
  if (!lastVerification.passed) {
    return { decision: 'retry_action', reason: 'Last action verification failed' };
  }

  // 5. Continue
  return { decision: 'continue', reason: 'Progress detected, continuing execution' };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateStuckSignals(
  prev: StuckSignals,
  actionsAttempted: TaskMemory['actionsAttempted'],
  lastVerification: ActionVerification,
  urlBefore: string,
  urlAfter: string,
): StuckSignals {
  const urlChanged = urlBefore !== urlAfter;

  // Detect repeated action: same type + elementId as the previous action
  let repeatedActionCount = prev.repeatedActionCount;
  if (actionsAttempted.length >= 2) {
    const last = actionsAttempted[actionsAttempted.length - 1];
    const prev2 = actionsAttempted[actionsAttempted.length - 2];
    if (last.type === prev2.type && last.elementId === prev2.elementId) {
      repeatedActionCount += 1;
    }
  }

  const samePageCount = urlChanged ? 0 : prev.samePageCount + 1;
  const failedExecutionCount = lastVerification.passed
    ? prev.failedExecutionCount
    : prev.failedExecutionCount + 1;

  // stepsSinceProgress: reset to 0 if URL changed (navigation = progress)
  // also reset if data was extracted (handled by caller providing differing urls)
  const stepsSinceProgress = urlChanged ? 0 : prev.stepsSinceProgress + 1;

  return {
    repeatedActionCount,
    samePageCount,
    failedExecutionCount,
    stepsSinceProgress,
  };
}

function buildStuckReason(signals: StuckSignals): string {
  const parts: string[] = [];
  if (signals.repeatedActionCount >= 3) parts.push(`repeated action ${signals.repeatedActionCount}x`);
  if (signals.samePageCount >= 4) parts.push(`same page ${signals.samePageCount}x`);
  if (signals.failedExecutionCount >= 2) parts.push(`${signals.failedExecutionCount} failed executions`);
  parts.push(`${signals.stepsSinceProgress} steps without progress`);
  return `Agent stuck: ${parts.join(', ')}`;
}
