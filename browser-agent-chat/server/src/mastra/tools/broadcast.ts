import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Tool: Send a message to the connected client via WebSocket.
 * Implementation deferred to Plan 5.
 */
export const broadcastTool = createTool({
  id: 'broadcast',
  description: 'Send a typed message to the client browser via WebSocket',
  inputSchema: z.object({
    type: z.string().describe('Message type identifier (e.g. "thought", "status", "result")'),
    content: z.string().describe('Message payload to send to the client'),
  }),
  outputSchema: z.object({
    sent: z.boolean().describe('Whether the message was successfully sent'),
  }),
  execute: async (_input) => {
    throw new Error('Not implemented — Plan 5');
  },
});
