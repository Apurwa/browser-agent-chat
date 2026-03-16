import { executeTask, executeExplore } from './agent.js';
import { executeAgentLoop } from './agent-loop.js';
import type { AgentSession } from './agent.js';
import type { ServerMessage } from './types.js';

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

const useNewAgent = (): boolean => process.env.USE_NEW_AGENT === 'true';

// ---------------------------------------------------------------------------
// Task dispatch
// ---------------------------------------------------------------------------

export async function dispatchTask(
  session: AgentSession,
  task: string,
  broadcast: (msg: ServerMessage) => void,
): Promise<void> {
  if (useNewAgent()) {
    broadcast({ type: 'status', status: 'working' });
    await session.loginDone;
    const result = await executeAgentLoop(session, task, 'task', broadcast);
    broadcast({ type: 'taskComplete', success: result.success });
    broadcast({ type: 'status', status: 'idle' });
  } else {
    await executeTask(session, task, broadcast);
  }
}

// ---------------------------------------------------------------------------
// Explore dispatch
// ---------------------------------------------------------------------------

export async function dispatchExplore(
  session: AgentSession,
  context: string | null,
  broadcast: (msg: ServerMessage) => void,
): Promise<void> {
  if (useNewAgent()) {
    broadcast({ type: 'status', status: 'working' });
    await session.loginDone;
    const goal = context
      ? `Explore this application and discover its features. Context: ${context}`
      : 'Explore this application and discover all features, pages, and flows.';
    const result = await executeAgentLoop(session, goal, 'explore', broadcast);
    broadcast({ type: 'taskComplete', success: result.success });
    broadcast({ type: 'status', status: 'idle' });
  } else {
    await executeExplore(session, context, broadcast);
  }
}
