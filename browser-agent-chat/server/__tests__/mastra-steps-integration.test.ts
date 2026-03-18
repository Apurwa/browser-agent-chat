import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerSession,
  getSessionContext,
  removeSession,
  type SessionContext,
} from '../src/session-registry.js';
import { createBudgetTracker, type BudgetTracker } from '../src/budget.js';

// ---------------------------------------------------------------------------
// Mock external modules used by the steps so we never hit real services.
// Must come BEFORE importing the steps themselves.
// ---------------------------------------------------------------------------

vi.mock('../src/world-model.js', () => ({
  getWorldContext: vi.fn().mockResolvedValue('mocked world context'),
}));

vi.mock('../src/planner-confirm.js', () => ({
  confirmGoalCompletion: vi.fn().mockReturnValue({
    achieved: true,
    remainingWork: undefined,
  }),
}));

// ---------------------------------------------------------------------------
// Import the steps under test (after mocks are installed)
// ---------------------------------------------------------------------------

import { initializeStep } from '../src/mastra/steps/initialize.js';
import { cleanupStep } from '../src/mastra/steps/cleanup.js';
import { executeSingleShotStep } from '../src/mastra/steps/execute-single-shot.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = 'test-integration-session';
const AGENT_ID = 'test-agent';

function makeMockSession(overrides: Record<string, unknown> = {}) {
  return {
    loginDone: Promise.resolve(),
    currentUrl: 'https://example.com',
    connector: {
      getHarness: () => ({
        page: {
          evaluate: vi.fn().mockResolvedValue('https://example.com/page'),
          title: vi.fn().mockResolvedValue('Example Page'),
        },
      }),
    },
    agent: {
      act: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

function makeBroadcast() {
  const messages: Record<string, unknown>[] = [];
  const fn = vi.fn((msg: Record<string, unknown>) => {
    messages.push(msg);
  });
  return { fn, messages };
}

/**
 * Build a minimal `execute` context that Mastra would normally inject.
 * We only include the fields that each step actually uses.
 */
function fakeStepContext<T>(inputData: T, extra: Record<string, unknown> = {}) {
  return {
    inputData,
    runId: 'run-1',
    resourceId: undefined,
    workflowId: 'test-wf',
    mastra: {} as any,
    requestContext: {} as any,
    state: undefined as unknown,
    setState: vi.fn(),
    resumeData: undefined,
    suspendData: undefined,
    retryCount: 0,
    getInitData: vi.fn(),
    getStepResult: vi.fn(),
    suspend: vi.fn(),
    bail: vi.fn(),
    abort: vi.fn(),
    resume: undefined,
    restart: undefined,
    engine: undefined as any,
    abortSignal: new AbortController().signal,
    writer: {} as any,
    outputWriter: undefined,
    validateSchemas: false,
    ...extra,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Mastra steps — integration with mock sessions', () => {
  let budget: BudgetTracker;
  let broadcastCtx: ReturnType<typeof makeBroadcast>;

  beforeEach(() => {
    budget = createBudgetTracker({ maxSteps: 20 });
    broadcastCtx = makeBroadcast();

    const ctx: SessionContext = {
      session: makeMockSession(),
      budget,
      broadcast: broadcastCtx.fn,
    };

    registerSession(SESSION_ID, ctx);
  });

  afterEach(() => {
    removeSession(SESSION_ID);
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // initializeStep
  // -------------------------------------------------------------------------
  describe('initializeStep', () => {
    it('waits for loginDone, broadcasts working, returns InitializedContext shape', async () => {
      const input = {
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        goal: 'test goal',
        taskType: 'task' as const,
        mode: 'multi_step' as const,
      };

      const result = await initializeStep.execute(fakeStepContext(input));

      // Should broadcast 'working'
      expect(broadcastCtx.fn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'status', status: 'working' }),
      );

      // Should return all required InitializedContext fields
      expect(result).toMatchObject({
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        goal: 'test goal',
        taskType: 'task',
        mode: 'multi_step',
        currentUrl: 'https://example.com/page',
        worldContext: 'mocked world context',
      });
    });

    it('falls back to session.currentUrl if page.evaluate throws', async () => {
      const failingPage = {
        evaluate: vi.fn().mockRejectedValue(new Error('page closed')),
        title: vi.fn().mockResolvedValue(''),
      };
      const failingSession = makeMockSession({
        connector: {
          getHarness: () => ({ page: failingPage }),
        },
      });

      removeSession(SESSION_ID);
      registerSession(SESSION_ID, {
        session: failingSession,
        budget,
        broadcast: broadcastCtx.fn,
      });

      const input = {
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        goal: 'test',
        taskType: 'task' as const,
        mode: 'single_shot' as const,
      };

      const result = await initializeStep.execute(fakeStepContext(input));
      expect(result.currentUrl).toBe('https://example.com');
    });

    it('returns empty worldContext when agentId is empty', async () => {
      const input = {
        sessionId: SESSION_ID,
        agentId: '',
        goal: 'test',
        taskType: 'task' as const,
        mode: 'multi_step' as const,
      };

      const result = await initializeStep.execute(fakeStepContext(input));
      expect(result.worldContext).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // cleanupStep
  // -------------------------------------------------------------------------
  describe('cleanupStep', () => {
    it('broadcasts taskComplete and idle status', async () => {
      const input = {
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        goal: 'cleanup test',
        taskType: 'task' as const,
        success: true,
        stepsCompleted: 5,
      };

      const result = await cleanupStep.execute(fakeStepContext(input));

      // Must broadcast taskComplete then idle, in order
      expect(broadcastCtx.messages).toEqual([
        { type: 'taskComplete', success: true },
        { type: 'status', status: 'idle' },
      ]);

      // Pass-through: returns the input unchanged
      expect(result).toEqual(input);
    });

    it('broadcasts success=false when task was unsuccessful', async () => {
      const input = {
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        goal: 'failing task',
        taskType: 'task' as const,
        success: false,
        stepsCompleted: 0,
      };

      await cleanupStep.execute(fakeStepContext(input));

      expect(broadcastCtx.messages[0]).toEqual({
        type: 'taskComplete',
        success: false,
      });
    });
  });

  // -------------------------------------------------------------------------
  // executeSingleShotStep
  // -------------------------------------------------------------------------
  describe('executeSingleShotStep', () => {
    it('calls agent.act(goal) and returns success', async () => {
      const input = {
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        goal: 'click the button',
        taskType: 'task' as const,
        mode: 'single_shot' as const,
        currentUrl: 'https://example.com',
        worldContext: '',
      };

      const result = await executeSingleShotStep.execute(fakeStepContext(input));

      const session = getSessionContext(SESSION_ID).session;
      expect(session.agent.act).toHaveBeenCalledWith('click the button');
      expect(result).toMatchObject({
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        goal: 'click the button',
        taskType: 'task',
        success: true,
        stepsCompleted: 1,
      });
    });

    it('handles agent.act failure gracefully', async () => {
      const failingSession = makeMockSession();
      failingSession.agent.act = vi
        .fn()
        .mockRejectedValue(new Error('browser timeout'));

      removeSession(SESSION_ID);
      registerSession(SESSION_ID, {
        session: failingSession,
        budget,
        broadcast: broadcastCtx.fn,
      });

      const input = {
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        goal: 'impossible task',
        taskType: 'explore' as const,
        mode: 'single_shot' as const,
        currentUrl: 'https://example.com',
        worldContext: '',
      };

      const result = await executeSingleShotStep.execute(fakeStepContext(input));

      expect(result.success).toBe(false);
      expect(result.stepsCompleted).toBe(0);

      // Should broadcast an error
      expect(broadcastCtx.fn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'browser timeout' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Session registry + budget integration
  // -------------------------------------------------------------------------
  describe('session registry with budget tracker', () => {
    it('budget tracker is accessible from session context and works', () => {
      const ctx = getSessionContext(SESSION_ID);
      expect(ctx.budget.exhausted()).toBe(false);
      expect(ctx.budget.snapshot().stepsUsed).toBe(0);

      ctx.budget.recordStep();
      ctx.budget.recordStep();

      expect(ctx.budget.snapshot().stepsUsed).toBe(2);
      expect(ctx.budget.snapshot().stepsRemaining).toBe(18);
    });

    it('budget exhaustion is detectable after max steps', () => {
      const tinyBudget = createBudgetTracker({ maxSteps: 2 });
      removeSession(SESSION_ID);
      registerSession(SESSION_ID, {
        session: makeMockSession(),
        budget: tinyBudget,
        broadcast: broadcastCtx.fn,
      });

      const ctx = getSessionContext(SESSION_ID);
      ctx.budget.recordStep();
      ctx.budget.recordStep();

      expect(ctx.budget.exhausted()).toBe(true);
    });

    it('budget snapshot serializes correctly for schema validation', () => {
      const ctx = getSessionContext(SESSION_ID);
      ctx.budget.recordStep();
      const snap = ctx.budget.snapshot();

      expect(snap).toEqual(
        expect.objectContaining({
          stepsUsed: expect.any(Number),
          stepsRemaining: expect.any(Number),
          replansUsed: expect.any(Number),
          elapsedMs: expect.any(Number),
          exhausted: expect.any(Boolean),
          warning: expect.any(Boolean),
        }),
      );
    });

    it('replan tracking works via budget in registry', () => {
      const ctx = getSessionContext(SESSION_ID);
      expect(ctx.budget.canReplan()).toBe(true);

      ctx.budget.recordReplan();
      ctx.budget.recordReplan();
      ctx.budget.recordReplan();

      expect(ctx.budget.canReplan()).toBe(false);
      expect(ctx.budget.snapshot().replansUsed).toBe(3);
    });
  });
});
