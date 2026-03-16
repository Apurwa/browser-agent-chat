import type { Intent, GoalConfirmation } from './agent-types.js';

// ---------------------------------------------------------------------------
// confirmGoalCompletion — pure heuristic, no LLM, no I/O
// ---------------------------------------------------------------------------

/**
 * Determine whether the overall goal has been achieved based on the current
 * status of its constituent intents.
 *
 * Rules (priority order):
 *  1. Any intent is 'failed'  → achieved=false, mention the failed intent
 *  2. Any intent is 'pending' → achieved=false, mention the pending intent
 *  3. All intents are 'completed' with confidence >= 0.6 → achieved=true
 *  4. Any completed intent has confidence < 0.6 → achieved=false
 *
 * LLM-based semantic judgment of goal completion is a future enhancement.
 */
export function confirmGoalCompletion(
  goal: string,
  intents: Intent[],
): GoalConfirmation {
  if (intents.length === 0) {
    return { achieved: true };
  }

  // 1. Failed intents take top priority
  const failedIntent = intents.find(i => i.status === 'failed');
  if (failedIntent) {
    return {
      achieved: false,
      remainingWork: `Failed intent: ${failedIntent.id} — ${failedIntent.description}`,
    };
  }

  // 2. Pending intents
  const pendingIntent = intents.find(i => i.status === 'pending');
  if (pendingIntent) {
    return {
      achieved: false,
      remainingWork: `Incomplete intent: ${pendingIntent.id} — ${pendingIntent.description}`,
    };
  }

  // 3. Active intents (not yet completed)
  const activeIntent = intents.find(i => i.status === 'active');
  if (activeIntent) {
    return {
      achieved: false,
      remainingWork: `Incomplete intent: ${activeIntent.id} — ${activeIntent.description}`,
    };
  }

  // All intents are completed — check confidence
  const lowConfidence = intents.find(i => i.confidence < 0.6);
  if (lowConfidence) {
    return {
      achieved: false,
      remainingWork: `Low-confidence completion for intent: ${lowConfidence.id} — ${lowConfidence.description}`,
    };
  }

  return { achieved: true };
}
