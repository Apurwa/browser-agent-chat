import { createStep } from '@mastra/core/workflows';
import { TaskResultSchema } from '../schemas.js';
import { getSessionContext } from '../../session-registry.js';

// ---------------------------------------------------------------------------
// cleanupStep
//
// Broadcasts taskComplete + idle status. Single source of completion
// broadcast — eliminates the double-broadcast issue in the current code.
// ---------------------------------------------------------------------------

export const cleanupStep = createStep({
  id: 'cleanup',
  description: 'Broadcast task completion and set status to idle',
  inputSchema: TaskResultSchema,
  outputSchema: TaskResultSchema,
  execute: async ({ inputData }) => {
    const ctx = getSessionContext(inputData.sessionId);

    ctx.broadcast({ type: 'taskComplete', success: inputData.success });
    ctx.broadcast({ type: 'status', status: 'idle' });

    return inputData;
  },
});
