import { executeTask, executeExplore } from './agent.js';
import { executeAgentLoop } from './agent-loop.js';
import { getLangfuse } from './langfuse.js';
import type { AgentSession } from './agent.js';
import type { ServerMessage } from './types.js';

// ---------------------------------------------------------------------------
// Execution Strategy types
// ---------------------------------------------------------------------------

export type ExecutionStrategy = 'single_shot' | 'multi_step';

export interface ExecutionResult {
  success: boolean;
  stepsCompleted: number;
  strategy: ExecutionStrategy;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Strategy selection heuristic (v1)
// ---------------------------------------------------------------------------

const ACTION_KEYWORDS = [
  'click', 'navigate', 'create', 'test', 'fill', 'submit',
  'login', 'sign in', 'go to', 'open', 'press', 'type',
  'enter', 'delete', 'remove', 'update', 'edit',
];

export function selectStrategy(
  goal: string,
  taskType: 'task' | 'explore',
): ExecutionStrategy {
  if (taskType === 'explore') return 'multi_step';

  const lower = goal.toLowerCase();

  // Action keywords -> multi-step
  if (ACTION_KEYWORDS.some(kw => lower.includes(kw))) return 'multi_step';

  // Default: single-shot (extraction/observation — fast path)
  return 'single_shot';
}

// ---------------------------------------------------------------------------
// Task dispatch
// ---------------------------------------------------------------------------

export async function dispatchTask(
  session: AgentSession,
  task: string,
  broadcast: (msg: ServerMessage) => void,
): Promise<void> {
  const strategy = selectStrategy(task, 'task');
  const startTime = Date.now();

  // Create Langfuse trace
  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: 'user-task',
    sessionId: session.sessionId ?? undefined,
    metadata: { agentId: session.agentId, strategy },
    tags: [`agent:${session.agentId}`],
    input: { task, strategy },
  }) ?? null;
  session.currentTrace = trace;

  let result: { success: boolean; stepsCompleted: number };

  if (strategy === 'single_shot') {
    // Fast path: executeTask handles broadcast (taskComplete, idle) in its finally block.
    // We only wrap it to capture success/failure for the trace.
    try {
      await executeTask(session, task, broadcast);
      result = { success: true, stepsCompleted: session.stepsHistory.length };
    } catch {
      result = { success: false, stepsCompleted: session.stepsHistory.length };
    }
  } else {
    // Multi-step: agent loop does NOT broadcast taskComplete or idle status
    broadcast({ type: 'status', status: 'working' });
    await session.loginDone;
    result = await executeAgentLoop(session, task, 'task', broadcast);
    broadcast({ type: 'taskComplete', success: result.success });
    broadcast({ type: 'status', status: 'idle' });
  }

  const durationMs = Date.now() - startTime;
  trace?.update({
    output: {
      success: result.success,
      stepsCompleted: result.stepsCompleted,
      strategy,
      durationMs,
    },
  });
  session.currentTrace = null;
  langfuse?.flushAsync().catch(() => {});

  console.log(
    `[DISPATCH] Task completed: strategy=${strategy} success=${result.success} steps=${result.stepsCompleted} duration=${durationMs}ms`,
  );
}

// ---------------------------------------------------------------------------
// Explore dispatch (always multi_step)
// ---------------------------------------------------------------------------

export async function dispatchExplore(
  session: AgentSession,
  context: string | null,
  broadcast: (msg: ServerMessage) => void,
): Promise<void> {
  const strategy: ExecutionStrategy = 'multi_step';
  const startTime = Date.now();

  broadcast({ type: 'status', status: 'working' });
  await session.loginDone;

  const goal = context
    ? `Explore this application and discover its features. Context: ${context}`
    : 'Explore this application and discover all features, pages, and flows.';

  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: 'explore',
    sessionId: session.sessionId ?? undefined,
    metadata: { agentId: session.agentId, strategy },
    tags: [`agent:${session.agentId}`],
    input: { goal, context, strategy },
  }) ?? null;
  session.currentTrace = trace;

  const result = await executeAgentLoop(session, goal, 'explore', broadcast);

  const durationMs = Date.now() - startTime;
  trace?.update({
    output: {
      success: result.success,
      stepsCompleted: result.stepsCompleted,
      strategy,
      durationMs,
    },
  });
  session.currentTrace = null;
  langfuse?.flushAsync().catch(() => {});

  broadcast({ type: 'taskComplete', success: result.success });
  broadcast({ type: 'status', status: 'idle' });

  console.log(
    `[DISPATCH] Explore completed: strategy=${strategy} success=${result.success} steps=${result.stepsCompleted} duration=${durationMs}ms`,
  );
}
