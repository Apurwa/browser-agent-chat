import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerSession, removeSession } from '../src/session-registry.js';
import { createBudgetTracker } from '../src/budget.js';

// ---------------------------------------------------------------------------
// Mock external modules before importing the Mastra instance.
// The workflow steps call world-model, planner, planner-confirm, perception,
// policy, executor, verify-action, verify-intent, evaluate-progress, etc.
// We mock the subset needed by the single-shot workflow:
//   initializeStep → world-model (getWorldContext)
//   executeSingleShotStep → session.agent.act (from registry, not a module)
//   cleanupStep → session registry broadcast (no external deps)
// ---------------------------------------------------------------------------

vi.mock('../src/world-model.js', () => ({
  getWorldContext: vi.fn().mockResolvedValue(''),
}));

// These are only needed if multi-step steps get pulled in transitively
vi.mock('../src/planner.js', () => ({
  planStrategy: vi.fn().mockResolvedValue({
    plan: { intents: [] },
    prompt: '',
  }),
}));

vi.mock('../src/planner-confirm.js', () => ({
  confirmGoalCompletion: vi.fn().mockReturnValue({
    achieved: true,
    remainingWork: undefined,
  }),
}));

vi.mock('../src/perception.js', () => ({
  perceive: vi.fn().mockResolvedValue({
    uiElements: [],
    pageTitle: 'Mock Page',
    structuredContent: '',
  }),
}));

vi.mock('../src/policy.js', () => ({
  decideNextAction: vi.fn().mockResolvedValue({
    action: { type: 'click', elementId: 'btn', expectedOutcome: 'test', intentId: 'i1' },
    prompt: '',
  }),
  categorizeElements: vi.fn().mockReturnValue({ navigation: [], actions: [] }),
}));

vi.mock('../src/executor.js', () => ({
  executeAction: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../src/verify-action.js', () => ({
  verifyAction: vi.fn().mockReturnValue({ passed: true, confidence: 1 }),
}));

vi.mock('../src/verify-intent.js', () => ({
  verifyIntent: vi.fn().mockResolvedValue({ passed: true, confidence: 1 }),
}));

vi.mock('../src/evaluate-progress.js', () => ({
  evaluateProgress: vi.fn().mockReturnValue({
    decision: 'done',
    reason: 'mock done',
    signals: {
      repeatedActionCount: 0,
      samePageCount: 0,
      failedExecutionCount: 0,
      stepsSinceProgress: 0,
    },
  }),
  updateTaskMemory: vi.fn().mockImplementation((mem) => mem),
}));

vi.mock('../src/nav-graph.js', () => ({
  recordNavigation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/login-detector.js', () => ({
  detectLoginPage: vi.fn().mockResolvedValue({ isLoginPage: false, score: 0 }),
}));

// Mock Langfuse so telemetry doesn't fire
vi.mock('../src/langfuse.js', () => ({
  getLangfuse: vi.fn().mockReturnValue(null),
  initLangfuse: vi.fn(),
  shutdownLangfuse: vi.fn().mockResolvedValue(undefined),
  isLangfuseEnabled: vi.fn().mockReturnValue(false),
}));

// ---------------------------------------------------------------------------
// Import Mastra instance (after mocks)
// ---------------------------------------------------------------------------

import { mastra } from '../src/mastra/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SID = 'e2e-session';

function makeMockSession() {
  return {
    loginDone: Promise.resolve(),
    currentUrl: 'http://app.test',
    connector: {
      getHarness: () => ({
        page: {
          evaluate: vi.fn().mockResolvedValue('http://app.test'),
          title: vi.fn().mockResolvedValue('App Test'),
          url: vi.fn().mockReturnValue('http://app.test'),
        },
      }),
    },
    agent: {
      act: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockResolvedValue({}),
      page: {
        evaluate: vi.fn().mockResolvedValue('http://app.test'),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Mastra workflow E2E', () => {
  let broadcastMessages: Record<string, unknown>[];

  beforeEach(() => {
    broadcastMessages = [];
    registerSession(SID, {
      session: makeMockSession(),
      budget: createBudgetTracker({ maxSteps: 5 }),
      broadcast: vi.fn((msg: Record<string, unknown>) => {
        broadcastMessages.push(msg);
      }),
    });
  });

  afterEach(() => {
    removeSession(SID);
    vi.restoreAllMocks();
  });

  it('single-shot workflow completes successfully', async () => {
    const wf = mastra.getWorkflow('singleShotWorkflow');
    const run = await wf.createRun();
    const result = await run.start({
      inputData: {
        sessionId: SID,
        agentId: 'a1',
        goal: 'click submit',
        taskType: 'task' as const,
        mode: 'single_shot' as const,
      },
    });

    expect(result.status).toBe('success');
  });

  it('single-shot workflow calls agent.act with the goal', async () => {
    const wf = mastra.getWorkflow('singleShotWorkflow');
    const run = await wf.createRun();
    await run.start({
      inputData: {
        sessionId: SID,
        agentId: 'a1',
        goal: 'fill in the form',
        taskType: 'task' as const,
        mode: 'single_shot' as const,
      },
    });

    const { session } = await import('../src/session-registry.js').then(m =>
      m.getSessionContext(SID),
    );
    expect(session.agent.act).toHaveBeenCalledWith('fill in the form');
  });

  it('single-shot workflow broadcasts working, taskComplete, and idle', async () => {
    const wf = mastra.getWorkflow('singleShotWorkflow');
    const run = await wf.createRun();
    await run.start({
      inputData: {
        sessionId: SID,
        agentId: 'a1',
        goal: 'do something',
        taskType: 'task' as const,
        mode: 'single_shot' as const,
      },
    });

    // initializeStep broadcasts { type: 'status', status: 'working' }
    expect(broadcastMessages).toContainEqual({ type: 'status', status: 'working' });
    // cleanupStep broadcasts taskComplete + idle
    expect(broadcastMessages).toContainEqual({ type: 'taskComplete', success: true });
    expect(broadcastMessages).toContainEqual({ type: 'status', status: 'idle' });
  });

  it('single-shot workflow handles agent.act failure', async () => {
    // Replace session with one whose agent.act throws
    removeSession(SID);
    const failingSession = makeMockSession();
    failingSession.agent.act = vi.fn().mockRejectedValue(new Error('timeout'));
    registerSession(SID, {
      session: failingSession,
      budget: createBudgetTracker({ maxSteps: 5 }),
      broadcast: vi.fn((msg: Record<string, unknown>) => {
        broadcastMessages.push(msg);
      }),
    });

    const wf = mastra.getWorkflow('singleShotWorkflow');
    const run = await wf.createRun();
    const result = await run.start({
      inputData: {
        sessionId: SID,
        agentId: 'a1',
        goal: 'impossible action',
        taskType: 'task' as const,
        mode: 'single_shot' as const,
      },
    });

    // Workflow still completes (step catches the error)
    expect(result.status).toBe('success');
    // Broadcasts error and taskComplete with success=false
    expect(broadcastMessages).toContainEqual(
      expect.objectContaining({ type: 'error', message: 'timeout' }),
    );
    expect(broadcastMessages).toContainEqual({ type: 'taskComplete', success: false });
  });

  it('single-shot workflow returns correct output shape', async () => {
    const wf = mastra.getWorkflow('singleShotWorkflow');
    const run = await wf.createRun();
    const result = await run.start({
      inputData: {
        sessionId: SID,
        agentId: 'a1',
        goal: 'verify output',
        taskType: 'task' as const,
        mode: 'single_shot' as const,
      },
    });

    if (result.status === 'success' && result.result) {
      const output = result.result as Record<string, unknown>;
      expect(output).toHaveProperty('sessionId', SID);
      expect(output).toHaveProperty('agentId', 'a1');
      expect(output).toHaveProperty('goal', 'verify output');
      expect(output).toHaveProperty('success', true);
      expect(output).toHaveProperty('stepsCompleted', 1);
    }
  });

  it('session not found throws during workflow execution', async () => {
    removeSession(SID);

    const wf = mastra.getWorkflow('singleShotWorkflow');
    const run = await wf.createRun();
    const result = await run.start({
      inputData: {
        sessionId: SID,
        agentId: 'a1',
        goal: 'no session',
        taskType: 'task' as const,
        mode: 'single_shot' as const,
      },
    });

    // Workflow should fail since session isn't in registry
    expect(result.status).toBe('failed');
  });
});
