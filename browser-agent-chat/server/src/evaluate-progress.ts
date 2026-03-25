import type {
  TaskMemory,
  AgentAction,
  ActionVerification,
  EvaluateProgressDecision,
  StuckSignals,
} from './agent-types.js';
import type { BudgetTracker } from './budget.js';

// ---------------------------------------------------------------------------
// evaluateProgress — pure function, no LLM, no I/O, no mutation
// ---------------------------------------------------------------------------

/**
 * Decide the next high-level control action for the agent loop.
 *
 * Logic:
 *  1. Compute stuck signals based on last action outcome.
 *  2. If budget exhausted -> 'done'
 *  3. If stuck rule fires:
 *     - repeatedAction >= 3 OR samePage >= 4 OR failedExecution >= 2
 *       AND stepsSinceProgress >= 5
 *     -> if replans available -> 'replan', else -> 'escalate_to_user'
 *  4. If lastVerification failed -> 'retry_action'
 *  5. Otherwise -> 'continue'
 *
 * Intent completion check (-> VERIFY_INTENT) is handled by the caller in the workflow.
 *
 * PURE: This function does NOT mutate taskMemory. The computed signals are
 * returned alongside the decision so the caller can apply them immutably.
 */
export function evaluateProgress(
  taskMemory: Readonly<TaskMemory>,
  budget: BudgetTracker,
  lastVerification: ActionVerification,
  urlBefore: string,
  urlAfter: string,
): { decision: EvaluateProgressDecision; reason: string; signals: StuckSignals } {
  // 1. Compute stuck signals (no mutation)
  const signals = computeStuckSignals(
    taskMemory.stuckSignals,
    taskMemory.actionsAttempted,
    lastVerification,
    urlBefore,
    urlAfter,
  );

  // 2. Budget exhausted
  if (budget.exhausted()) {
    return { decision: 'done', reason: 'Agent budget exhausted', signals };
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
        signals,
      };
    }
    return {
      decision: 'escalate_to_user',
      reason: `${buildStuckReason(signals)}. No replan attempts remaining.`,
      signals,
    };
  }

  // 4. Last verification failed — retry (but escalate if too many consecutive failures)
  if (!lastVerification.passed) {
    if (signals.failedExecutionCount >= 3) {
      if (budget.canReplan()) {
        return { decision: 'replan', reason: `${signals.failedExecutionCount} consecutive action failures — replanning`, signals };
      }
      return { decision: 'escalate_to_user', reason: `${signals.failedExecutionCount} consecutive action failures. No replan attempts remaining.`, signals };
    }
    const errorDetail = lastVerification.findings?.[0]?.description ?? '';
    return { decision: 'retry_action', reason: `Last action verification failed${errorDetail ? ': ' + errorDetail : ''}`, signals };
  }

  // 5. Continue
  return { decision: 'continue', reason: 'Progress detected, continuing execution', signals };
}

// ---------------------------------------------------------------------------
// updateTaskMemory — pure function that returns a new TaskMemory
// ---------------------------------------------------------------------------

/**
 * Return a new TaskMemory with updated fields after an action + verification.
 * Does NOT mutate the input memory.
 */
export function updateTaskMemory(
  memory: Readonly<TaskMemory>,
  action: AgentAction,
  verification: ActionVerification,
  urlBefore: string,
  urlAfter: string,
): TaskMemory {
  const updatedActions = [...memory.actionsAttempted, action];

  const updatedFailed = verification.passed
    ? memory.failedActions
    : [...memory.failedActions, action];

  const updatedPages =
    urlAfter && !memory.visitedPages.includes(urlAfter)
      ? [...memory.visitedPages, urlAfter]
      : [...memory.visitedPages];

  const updatedSignals = computeStuckSignals(
    memory.stuckSignals,
    updatedActions,
    verification,
    urlBefore,
    urlAfter,
  );

  return {
    ...memory,
    actionsAttempted: updatedActions,
    failedActions: updatedFailed,
    visitedPages: updatedPages,
    stuckSignals: updatedSignals,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeStuckSignals(
  prev: Readonly<StuckSignals>,
  actionsAttempted: ReadonlyArray<AgentAction>,
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
