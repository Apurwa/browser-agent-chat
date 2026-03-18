import { createStep } from '@mastra/core/workflows';
import { InitializedContextSchema, TaskResultSchema } from '../schemas.js';
import { getSessionContext } from '../../session-registry.js';

// ---------------------------------------------------------------------------
// executeSingleShotStep
//
// For single-shot mode: calls agent.act(goal) directly. No loop, no planning.
// Gives single-shot tasks the same observability and suspension support as
// multi-step tasks.
// ---------------------------------------------------------------------------

export const executeSingleShotStep = createStep({
  id: 'execute-single-shot',
  description: 'Execute a single-shot task via agent.act()',
  inputSchema: InitializedContextSchema,
  outputSchema: TaskResultSchema,
  execute: async ({ inputData }) => {
    const ctx = getSessionContext(inputData.sessionId);

    let success = false;
    try {
      await ctx.session.agent.act(inputData.goal);
      success = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SINGLE-SHOT] agent.act() failed:', message);
      ctx.broadcast({ type: 'error', message });
    }

    return {
      sessionId: inputData.sessionId,
      agentId: inputData.agentId,
      goal: inputData.goal,
      taskType: inputData.taskType,
      success,
      stepsCompleted: success ? 1 : 0,
    };
  },
});
