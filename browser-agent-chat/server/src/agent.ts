import { startBrowserAgent, BrowserConnector, type BrowserAgent } from 'magnitude-core';
import type { ServerMessage } from './types.js';
import { saveMessage, saveScreenshot } from './db.js';

export interface AgentSession {
  agent: BrowserAgent;
  connector: BrowserConnector;
  sessionId: string | null;
  close: () => Promise<void>;
}

export async function createAgent(
  url: string,
  broadcast: (msg: ServerMessage) => void,
  sessionId: string | null = null
): Promise<AgentSession> {
  broadcast({ type: 'status', status: 'working' });

  const agent = await startBrowserAgent({
    url,
    narrate: false,
    llm: {
      provider: 'anthropic',
      options: {
        model: 'claude-sonnet-4-20250514',
        apiKey: process.env.ANTHROPIC_API_KEY
      }
    }
  });

  const connector = agent.require(BrowserConnector);

  // Listen for agent thoughts
  agent.events.on('thought', async (thought: string) => {
    broadcast({ type: 'thought', content: thought });
    if (sessionId) {
      await saveMessage(sessionId, 'thought', thought);
    }
  });

  // Listen for completed actions
  agent.events.on('actionDone', async (action: { variant: string; target?: string; content?: string; [key: string]: unknown }) => {
    const actionName = action.variant;
    const target = action.target || action.content;
    broadcast({
      type: 'action',
      action: actionName,
      target: target as string | undefined
    });

    // Save action to database
    if (sessionId) {
      const actionContent = target ? `${actionName}: ${target}` : actionName;
      await saveMessage(sessionId, 'action', actionContent);
    }

    // Capture screenshot after each action
    try {
      const screenshot = await connector.getLastScreenshot();
      if (screenshot) {
        const base64 = await screenshot.toBase64();
        broadcast({ type: 'screenshot', data: base64 });
        // Save screenshot to database
        if (sessionId) {
          await saveScreenshot(sessionId, base64);
        }
      }
    } catch (err) {
      console.error('Failed to capture screenshot:', err);
    }
  });

  // Listen for navigation events
  agent.browserAgentEvents.on('nav', (navUrl: string) => {
    broadcast({ type: 'nav', url: navUrl });
  });

  // Send initial screenshot
  try {
    const screenshot = await connector.getLastScreenshot();
    if (screenshot) {
      const base64 = await screenshot.toBase64();
      broadcast({ type: 'screenshot', data: base64 });
    }
  } catch (err) {
    console.error('Failed to capture initial screenshot:', err);
  }

  broadcast({ type: 'status', status: 'idle' });
  broadcast({ type: 'nav', url });

  return {
    agent,
    connector,
    sessionId,
    close: async () => {
      await agent.stop();
    }
  };
}

export async function executeTask(
  session: AgentSession,
  task: string,
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  broadcast({ type: 'status', status: 'working' });

  // Save user task to database
  if (session.sessionId) {
    await saveMessage(session.sessionId, 'user', task);
  }

  try {
    await session.agent.act(task);
    broadcast({ type: 'taskComplete', success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    broadcast({ type: 'error', message });
    broadcast({ type: 'taskComplete', success: false });
    // Save error to database
    if (session.sessionId) {
      await saveMessage(session.sessionId, 'system', `Error: ${message}`);
    }
  } finally {
    broadcast({ type: 'status', status: 'idle' });
  }
}
