import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { FrontierItemSchema } from '../../agent-types.js';

/**
 * Tool: Get the next highest-priority frontier item.
 * Implementation deferred to Plan 3.
 */
export const frontierTool = createTool({
  id: 'frontier-next',
  description: 'Get the next unexplored frontier item, optionally filtered by active intent',
  inputSchema: z.object({
    agentId: z.string().describe('Agent session identifier'),
    intentId: z.string().optional().describe('Filter frontier items relevant to this intent'),
  }),
  outputSchema: z.object({
    item: FrontierItemSchema.nullable().describe('Next frontier item, or null if frontier is empty'),
  }),
  execute: async (_input) => {
    throw new Error('Not implemented — Plan 3');
  },
});
