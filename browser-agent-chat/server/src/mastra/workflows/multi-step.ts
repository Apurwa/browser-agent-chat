import { createWorkflow } from '@mastra/core/workflows';
import { WorkflowInputSchema, TaskResultSchema } from '../schemas.js';
import { getSessionContext } from '../../session-registry.js';
import { initializeStep } from '../steps/initialize.js';
import { planStrategyStep } from '../steps/plan-strategy.js';
import { agentCycleStep } from '../steps/agent-cycle.js';
import { confirmGoalStep } from '../steps/confirm-goal.js';
import { cleanupStep } from '../steps/cleanup.js';

// ---------------------------------------------------------------------------
// Multi-step workflow
//
// Flow: initialize -> plan-strategy -> [agent-cycle loop] -> confirm-goal -> cleanup
//
// The .dountil() loop runs agentCycleStep repeatedly until one of:
//   1. taskComplete or escalated flag is set by the step
//   2. Budget is exhausted (checked via live session registry)
//   3. Safety cap of 50 iterations
// ---------------------------------------------------------------------------

export const multiStepWorkflow = createWorkflow({
  id: 'agent-task-multistep',
  inputSchema: WorkflowInputSchema,
  outputSchema: TaskResultSchema,
  steps: [initializeStep, planStrategyStep, agentCycleStep, confirmGoalStep, cleanupStep],
})
  .then(initializeStep)
  .then(planStrategyStep)
  .dountil(
    agentCycleStep,
    async ({ inputData, iterationCount }) => {
      const data = inputData as Record<string, unknown>;

      // Exit conditions
      if (data.taskComplete || data.escalated) return true;

      try {
        const ctx = getSessionContext(data.sessionId as string);
        if (ctx.budget.exhausted()) return true;
      } catch {
        // Session gone — stop looping
        return true;
      }

      // Safety cap
      if (iterationCount >= 50) return true;

      return false;
    },
  )
  .then(confirmGoalStep)
  .then(cleanupStep)
  .commit();
