import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { UIElementSchema } from '../../agent-types.js';

/**
 * Tool: Capture compressed UI state (screenshot + parsed UI elements).
 * Implementation deferred to Plan 2.
 */
export const perceptionTool = createTool({
  id: 'perception',
  description: 'Capture the current UI state: screenshot, interactive elements, URL, and page title',
  inputSchema: z.object({
    agentId: z.string().describe('Unique identifier of the running agent session'),
  }),
  outputSchema: z.object({
    screenshot: z.string().optional().describe('Base64-encoded screenshot'),
    uiElements: z.array(UIElementSchema).describe('Parsed interactive UI elements'),
    url: z.string().describe('Current page URL'),
    pageTitle: z.string().describe('Current page title'),
  }),
  execute: async (_input) => {
    throw new Error('Not implemented — Plan 2');
  },
});
