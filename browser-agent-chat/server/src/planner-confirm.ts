import type { Intent, GoalConfirmation } from './agent-types.js';

// ---------------------------------------------------------------------------
// confirmGoalCompletion — pure heuristic, no LLM, no I/O
// ---------------------------------------------------------------------------

/**
 * Determine whether the overall goal has been achieved based on the current
 * status of its constituent intents.
 *
 * Rules for 'task' type (priority order):
 *  1. Any intent is 'failed'  → achieved=false, mention the failed intents
 *  2. Any intent is 'pending' or 'active' → achieved=false, mention them
 *  3. All intents are 'completed' → achieved=true
 *
 * Rules for 'explore' type (relaxed):
 *  1. ≥1 completed intent → achieved=true (any meaningful discovery = success)
 *  2. 0 completed intents → achieved=false
 */
export function confirmGoalCompletion(
  goal: string,
  intents: Intent[],
  taskType: 'task' | 'explore' = 'task',
  pagesVisited: number = 0,
): GoalConfirmation {
  if (intents.length === 0) {
    return { achieved: true };
  }

  const completed = intents.filter(i => i.status === 'completed');

  if (taskType === 'explore') {
    // For exploration, any meaningful discovery = success
    if (completed.length >= 1 && pagesVisited >= 2) {
      return { achieved: true };
    }
    if (completed.length >= 1) {
      return { achieved: true };
    }
    return {
      achieved: false,
      remainingWork: `Explored ${pagesVisited} pages but no intents completed`,
    };
  }

  // For user tasks: all intents must complete
  const failed = intents.filter(i => i.status === 'failed');
  if (failed.length > 0) {
    return {
      achieved: false,
      remainingWork: `Failed: ${failed.map(i => i.description).join(', ')}`,
    };
  }

  const pending = intents.filter(i => i.status === 'pending' || i.status === 'active');
  if (pending.length > 0) {
    return {
      achieved: false,
      remainingWork: `Incomplete: ${pending.map(i => i.description).join(', ')}`,
    };
  }

  return { achieved: true };
}
