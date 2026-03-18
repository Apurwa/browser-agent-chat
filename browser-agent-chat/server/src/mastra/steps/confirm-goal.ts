import { createStep } from '@mastra/core/workflows';
import { CycleSchema, TaskResultSchema } from '../schemas.js';
import { confirmGoalCompletion } from '../../planner-confirm.js';
import { getSessionContext } from '../../session-registry.js';

// ---------------------------------------------------------------------------
// confirmGoalStep
//
// Evaluates whether all intents were completed using the existing
// confirmGoalCompletion() pure function. Produces the final TaskResult.
// ---------------------------------------------------------------------------

export const confirmGoalStep = createStep({
  id: 'confirm-goal',
  description: 'Evaluate whether the overall goal has been achieved',
  inputSchema: CycleSchema,
  outputSchema: TaskResultSchema,
  execute: async ({ inputData }) => {
    const ctx = getSessionContext(inputData.sessionId);

    const confirmation = confirmGoalCompletion(
      inputData.goal,
      inputData.intents,
      inputData.taskType,
      inputData.taskMemory.visitedPages.length,
    );

    const stepsCompleted = ctx.budget.snapshot().stepsUsed;

    if (!confirmation.achieved && confirmation.remainingWork) {
      ctx.broadcast({
        type: 'thought',
        content: `Incomplete: ${confirmation.remainingWork}`,
      });
    }

    return {
      sessionId: inputData.sessionId,
      agentId: inputData.agentId,
      goal: inputData.goal,
      taskType: inputData.taskType,
      success: confirmation.achieved,
      stepsCompleted,
    };
  },
});
