import { startBrowserAgent, BrowserConnector, type BrowserAgent } from 'magnitude-core';
import type { ServerMessage, Finding, Feature, Flow, Criticality } from './types.js';
import { saveMessage, createFeature, updateFeature } from './db.js';
import { loadMemoryContext, buildTaskPrompt } from './memory-engine.js';
import { parseFindingsFromText, parseMemoryUpdatesFromText, processFinding } from './finding-detector.js';

export interface AgentSession {
  agent: BrowserAgent;
  connector: BrowserConnector;
  sessionId: string | null;
  projectId: string | null;
  memoryContext: string;
  stepsHistory: Array<{ order: number; action: string; target?: string }>;
  close: () => Promise<void>;
}

export async function createAgent(
  url: string,
  broadcast: (msg: ServerMessage) => void,
  sessionId: string | null = null,
  projectId: string | null = null,
  credentials: { username: string; password: string } | null = null
): Promise<AgentSession> {
  broadcast({ type: 'status', status: 'working' });

  // Load memory context for prompt injection
  const memoryContext = projectId ? await loadMemoryContext(projectId) : '';

  const agent = await startBrowserAgent({
    url,
    narrate: false,
    llm: {
      provider: 'claude-code',
      options: {
        model: 'claude-sonnet-4-20250514'
      }
    }
  });

  const connector = agent.require(BrowserConnector);
  const stepsHistory: AgentSession['stepsHistory'] = [];
  let stepOrder = 0;

  // Helper to get screenshot as base64
  const getScreenshotBase64 = async (): Promise<string | null> => {
    try {
      const screenshot = await connector.getLastScreenshot();
      if (screenshot) return await screenshot.toBase64();
    } catch {}
    return null;
  };

  // Listen for agent thoughts — parse for findings and memory updates
  agent.events.on('thought', async (thought: string) => {
    broadcast({ type: 'thought', content: thought });
    if (sessionId) await saveMessage(sessionId, 'thought', thought);

    // Check for findings in thought text
    if (projectId && sessionId) {
      const rawFindings = parseFindingsFromText(thought);
      for (const raw of rawFindings) {
        const finding = await processFinding(
          raw, projectId, sessionId, [...stepsHistory], getScreenshotBase64
        );
        if (finding) {
          broadcast({ type: 'finding', finding });
        }
      }

      // Check for memory updates
      const memoryUpdates = parseMemoryUpdatesFromText(thought);
      for (const update of memoryUpdates) {
        if (update.action === 'create_feature' && update.data.name) {
          const feature = await createFeature(
            projectId,
            update.data.name as string,
            (update.data.description as string) ?? null,
            ((update.data.criticality as string) ?? 'medium') as Criticality,
            (update.data.expected_behaviors as string[]) ?? []
          );
          if (feature) broadcast({ type: 'memoryUpdate', feature });
        }
        // Additional memory update actions can be added here
      }
    }
  });

  // Listen for completed actions — track steps history
  agent.events.on('actionDone', async (action: { variant: string; target?: string; content?: string; [key: string]: unknown }) => {
    const actionName = action.variant;
    const target = action.target || action.content;
    stepOrder++;
    stepsHistory.push({ order: stepOrder, action: actionName, target: target as string | undefined });

    broadcast({ type: 'action', action: actionName, target: target as string | undefined });
    if (sessionId) {
      const actionContent = target ? `${actionName}: ${target}` : actionName;
      await saveMessage(sessionId, 'action', actionContent);
    }

    // Capture and broadcast screenshot
    try {
      const screenshot = await connector.getLastScreenshot();
      if (screenshot) {
        const base64 = await screenshot.toBase64();
        broadcast({ type: 'screenshot', data: base64 });
        // Live screenshots are ephemeral — not persisted (see spec: Screenshots Strategy)
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

  // Log in with credentials if provided
  if (credentials) {
    try {
      await agent.act(`Log in with username "${credentials.username}" and password "${credentials.password}"`);
    } catch (err) {
      console.error('Auto-login failed:', err);
      broadcast({ type: 'error', message: 'Failed to log in with stored credentials. You can try logging in manually via chat.' });
    }
  }

  broadcast({ type: 'status', status: 'idle' });
  broadcast({ type: 'nav', url });

  return {
    agent,
    connector,
    sessionId,
    projectId,
    memoryContext,
    stepsHistory,
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

  if (session.sessionId) {
    await saveMessage(session.sessionId, 'user', task);
  }

  // Build prompt with memory context
  const prompt = session.projectId
    ? buildTaskPrompt(task, session.memoryContext)
    : task;

  // Reset step counter for this task
  session.stepsHistory.length = 0;

  try {
    await session.agent.act(prompt);
    broadcast({ type: 'taskComplete', success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    broadcast({ type: 'error', message });
    broadcast({ type: 'taskComplete', success: false });
    if (session.sessionId) {
      await saveMessage(session.sessionId, 'system', `Error: ${message}`);
    }
  } finally {
    broadcast({ type: 'status', status: 'idle' });
  }
}
