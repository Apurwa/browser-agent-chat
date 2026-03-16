import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Tool: Extract structured data from the current page via Magnitude.
 * Implementation deferred to Plan 2.
 */
export const magnitudeExtractTool = createTool({
  id: 'magnitude-extract',
  description: 'Extract structured data from the current page via Magnitude',
  inputSchema: z.object({
    prompt: z.string().describe('What to extract from the page'),
    schemaDescription: z.string().describe('Human-readable description of the expected data shape'),
  }),
  outputSchema: z.object({
    data: z.unknown(),
    error: z.string().optional(),
  }),
  execute: async (_input) => {
    throw new Error('Not implemented — Plan 2');
  },
});
