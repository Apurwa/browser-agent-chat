import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { FrontierItemSchema } from '../../agent-types.js';
import { getNextFrontier } from '../../frontier.js';

/**
 * Tool: Get the next highest-priority frontier item.
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
  execute: async (input) => {
    const { agentId, intentId } = input;
    const item = await getNextFrontier(agentId, intentId);
    return { item };
  },
});
