import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Tool: Extract structured data from the current page via Magnitude.
 */
export const magnitudeExtractTool = createTool({
  id: 'magnitude-extract',
  description: 'Extract structured data from the current page via Magnitude',
  inputSchema: z.object({
    prompt: z.string().describe('What to extract from the page'),
    schemaDescription: z.string().describe('Human-readable description of the expected data shape'),
    agentRef: z.any().optional().describe('Magnitude BrowserAgent instance (injected at runtime)'),
  }),
  outputSchema: z.object({
    data: z.unknown(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const { agentRef: agent, prompt } = input;

    if (!agent) {
      throw new Error('magnitude-extract requires agentRef in context — inject at runtime');
    }

    try {
      const data = await agent.extract(prompt, {});
      return { data };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
