import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Tool: Read the agent's world model (app graph + frontier).
 * Implementation deferred to Plan 3.
 */
export const worldModelReadTool = createTool({
  id: 'world-model-read',
  description: 'Read the current world model for an agent: known pages, edges, features, and frontier',
  inputSchema: z.object({
    agentId: z.string().describe('Agent session identifier'),
    domain: z.string().optional().describe('Optional domain to filter results'),
  }),
  outputSchema: z.object({
    pages: z.array(z.any()).describe('Known pages in the app graph'),
    edges: z.array(z.any()).describe('Edges (transitions) between pages'),
    features: z.array(z.any()).describe('Detected UI features'),
    frontier: z.array(z.any()).describe('Unexplored frontier items'),
  }),
  execute: async (_input) => {
    throw new Error('Not implemented — Plan 3');
  },
});

/**
 * Tool: Update the agent's world model with new discoveries.
 * Implementation deferred to Plan 3.
 */
export const worldModelUpdateTool = createTool({
  id: 'world-model-update',
  description: 'Update the world model for an agent with newly discovered pages, edges, or features',
  inputSchema: z.object({
    agentId: z.string().describe('Agent session identifier'),
    updates: z.any().describe('Partial world model updates to merge'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async (_input) => {
    throw new Error('Not implemented — Plan 3');
  },
});
