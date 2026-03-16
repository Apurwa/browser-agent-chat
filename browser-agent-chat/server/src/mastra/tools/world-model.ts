import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { loadWorldModel, updatePagePurpose } from '../../world-model.js';

/**
 * Tool: Read the agent's world model (app graph + frontier).
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
  execute: async (input) => {
    const { agentId } = input;
    const model = await loadWorldModel(agentId);
    return {
      pages: model.pages,
      edges: model.edges,
      features: model.features,
      frontier: [],
    };
  },
});

/**
 * Tool: Update the agent's world model with new discoveries.
 */
export const worldModelUpdateTool = createTool({
  id: 'world-model-update',
  description: 'Update the world model for an agent with newly discovered pages, edges, or features',
  inputSchema: z.object({
    agentId: z.string().describe('Agent session identifier'),
    updates: z.object({
      nodeId: z.string().describe('The nav node ID to update'),
      purpose: z.string().describe('Human-readable purpose of this page'),
      availableActions: z.array(z.any()).default([]).describe('Actions available on this page'),
    }).describe('Page purpose update to apply'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async (input) => {
    const { updates } = input;
    await updatePagePurpose(updates.nodeId, updates.purpose, updates.availableActions ?? []);
    return { success: true };
  },
});
