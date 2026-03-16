import { executeTask, executeExplore } from './agent.js';
import { executeAgentLoop } from './agent-loop.js';
import { getLangfuse } from './langfuse.js';
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

    const langfuse = getLangfuse();
    const trace = langfuse?.trace({
      name: 'user-task',
      sessionId: session.sessionId ?? undefined,
      metadata: { agentId: session.agentId },
      tags: [`agent:${session.agentId}`],
      input: { task },
    }) ?? null;
    session.currentTrace = trace;

    const result = await executeAgentLoop(session, task, 'task', broadcast);

    trace?.update({ output: { success: result.success, stepsCompleted: result.stepsCompleted } });
    session.currentTrace = null;
    langfuse?.flushAsync().catch(() => {});

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

    const langfuse = getLangfuse();
    const trace = langfuse?.trace({
      name: 'explore',
      sessionId: session.sessionId ?? undefined,
      metadata: { agentId: session.agentId },
      tags: [`agent:${session.agentId}`],
      input: { goal, context },
    }) ?? null;
    session.currentTrace = trace;

    const result = await executeAgentLoop(session, goal, 'explore', broadcast);

    trace?.update({ output: { success: result.success, stepsCompleted: result.stepsCompleted } });
    session.currentTrace = null;
    langfuse?.flushAsync().catch(() => {});

    broadcast({ type: 'taskComplete', success: result.success });
    broadcast({ type: 'status', status: 'idle' });
  } else {
    await executeExplore(session, context, broadcast);
  }
}
