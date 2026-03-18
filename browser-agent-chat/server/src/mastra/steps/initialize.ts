import { createStep } from '@mastra/core/workflows';
import { WorkflowInputSchema, InitializedContextSchema } from '../schemas.js';
import { getSessionContext } from '../../session-registry.js';
import { getWorldContext } from '../../world-model.js';

// ---------------------------------------------------------------------------
// initializeStep
//
// Loads world context, waits for background login to complete, broadcasts
// 'working' status, and captures the starting URL. First step in both
// multi-step and single-shot workflows.
// ---------------------------------------------------------------------------

export const initializeStep = createStep({
  id: 'initialize',
  description: 'Wait for login, load world context, capture starting URL',
  inputSchema: WorkflowInputSchema,
  outputSchema: InitializedContextSchema,
  execute: async ({ inputData }) => {
    const ctx = getSessionContext(inputData.sessionId);

    // Wait for background login to finish (existing pattern)
    await ctx.session.loginDone;

    // Broadcast working status
    ctx.broadcast({ type: 'status', status: 'working' });

    // Get current URL from page
    let currentUrl = '';
    try {
      const page = ctx.session.connector.getHarness().page;
      currentUrl = (await page.evaluate('location.href')) as string;
    } catch {
      currentUrl = ctx.session.currentUrl ?? '';
    }

    // Load world context via world model
    const worldContext = inputData.agentId
      ? await getWorldContext(inputData.agentId)
      : '';

    return {
      ...inputData,
      currentUrl,
      worldContext,
    };
  },
});
