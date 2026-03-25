import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { UIElementSchema } from '../../agent-types.js';
import { perceive } from '../../perception.js';

/**
 * Tool: Capture compressed UI state (screenshot + parsed UI elements).
 */
export const perceptionTool = createTool({
  id: 'perception',
  description: 'Capture the current UI state: screenshot, interactive elements, URL, and page title',
  inputSchema: z.object({
    agentId: z.string().describe('Unique identifier of the running agent session'),
    pageRef: z.any().optional().describe('Playwright page instance (injected at runtime)'),
  }),
  outputSchema: z.object({
    screenshot: z.string().optional().describe('Base64-encoded screenshot'),
    uiElements: z.array(UIElementSchema).describe('Parsed interactive UI elements'),
    url: z.string().describe('Current page URL'),
    pageTitle: z.string().describe('Current page title'),
  }),
  execute: async (input) => {
    const { pageRef: page } = input;

    if (!page) {
      throw new Error('perception tool requires pageRef in context — inject at runtime');
    }

    const result = await perceive(page, null, '');
    return {
      screenshot: result.screenshot,
      uiElements: result.uiElements,
      url: result.url,
      pageTitle: result.pageTitle,
    };
  },
});
