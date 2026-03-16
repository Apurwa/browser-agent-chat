import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Tool: Execute a browser action via Magnitude.
 * Implementation deferred to Plan 2.
 */
export const magnitudeActTool = createTool({
  id: 'magnitude-act',
  description: 'Execute a browser action via Magnitude (click, type, navigate, etc.)',
  inputSchema: z.object({
    instruction: z.string().describe('Natural-language instruction for the browser action'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    newUrl: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (_input) => {
    throw new Error('Not implemented — Plan 2');
  },
});
