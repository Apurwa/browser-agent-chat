import { createStep } from '@mastra/core/workflows';
import { InitializedContextSchema, PlannedContextSchema } from '../schemas.js';
import { getSessionContext } from '../../session-registry.js';
import { planStrategy } from '../../planner.js';

// ---------------------------------------------------------------------------
// planStrategyStep
//
// Calls the existing planStrategy() function to decompose the goal into
// intents. Creates the initial TaskMemory object and takes a budget snapshot
// from the registry.
// ---------------------------------------------------------------------------

export const planStrategyStep = createStep({
  id: 'plan-strategy',
  description: 'Decompose the user goal into a prioritised list of intents',
  inputSchema: InitializedContextSchema,
  outputSchema: PlannedContextSchema,
  execute: async ({ inputData }) => {
    const ctx = getSessionContext(inputData.sessionId);

    const maxSteps = inputData.taskType === 'explore' ? 50 : 20;
    const maxIntents = Math.min(7, Math.floor(maxSteps / 3));

    const { plan } = await planStrategy(
      ctx.session.agent,
      inputData.goal,
      inputData.worldContext,
      inputData.currentUrl,
      maxIntents,
    );

    // Activate first pending intent
    const intents = plan.intents.map((intent, idx) => {
      const firstPendingIdx = plan.intents.findIndex(i => i.status === 'pending');
      if (idx === firstPendingIdx) {
        return { ...intent, status: 'active' as const };
      }
      return intent;
    });

    // Create initial TaskMemory
    const taskMemory = {
      taskId: crypto.randomUUID(),
      goal: inputData.goal,
      intents,
      visitedPages: inputData.currentUrl ? [inputData.currentUrl] : [],
      actionsAttempted: [],
      failedActions: [],
      replanCount: 0,
      progressScore: 0,
      stuckSignals: {
        repeatedActionCount: 0,
        samePageCount: 0,
        failedExecutionCount: 0,
        stepsSinceProgress: 0,
      },
    };

    return {
      ...inputData,
      intents,
      taskMemory,
      budgetSnapshot: ctx.budget.snapshot(),
      taskComplete: false,
      escalated: false,
    };
  },
});
