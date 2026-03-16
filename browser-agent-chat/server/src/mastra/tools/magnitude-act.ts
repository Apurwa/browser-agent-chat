import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { executeAction } from '../../executor.js';

/**
 * Tool: Execute a browser action via Magnitude.
 */
export const magnitudeActTool = createTool({
  id: 'magnitude-act',
  description: 'Execute a browser action via Magnitude (click, type, navigate, etc.)',
  inputSchema: z.object({
    instruction: z.string().describe('Natural-language instruction for the browser action'),
    agentRef: z.any().optional().describe('Magnitude BrowserAgent instance (injected at runtime)'),
    pageRef: z.any().optional().describe('Playwright page instance (injected at runtime)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    newUrl: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const { agentRef: agent, pageRef: page, instruction } = input;

    if (!agent || !page) {
      throw new Error(
        'magnitude-act requires agentRef and pageRef in context — inject at runtime',
      );
    }

    const action = {
      type: 'submit' as const,
      value: instruction,
      expectedOutcome: instruction,
      intentId: 'runtime',
    };

    const result = await executeAction(agent, page, action, []);
    return {
      success: result.success,
      newUrl: result.newUrl,
      error: result.error,
    };
  },
});
