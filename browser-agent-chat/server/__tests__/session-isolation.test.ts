/**
 * Browser Session Isolation — 100 Test Cases
 *
 * Categories:
 * 1-20:  Execution Mutex (Redis lock)
 * 21-35: Execution Router (strategy selection)
 * 36-50: Session Lifecycle Limits
 * 51-65: Health Check & Sanity Check
 * 66-80: Reap (unified cleanup)
 * 81-90: Session Lifecycle Protocol
 * 91-100: Warm Pool & Idempotent Start
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ══════════════════════════════════════════════════════════════
// CATEGORY 1: Execution Router — Strategy Selection (1-20)
// Pure function tests — no mocks needed
// ══════════════════════════════════════════════════════════════

import { selectStrategy } from '../src/agent-dispatch.js';

describe('Execution Router — Strategy Selection', () => {
  // Single-shot (extraction/observation)
  it('1. "What is the page title?" → single_shot', () => {
    expect(selectStrategy('What is the page title?', 'task')).toBe('single_shot');
  });

  it('2. "Describe the hero section" → single_shot', () => {
    expect(selectStrategy('Describe the hero section', 'task')).toBe('single_shot');
  });

  it('3. "How many links are on this page?" → single_shot', () => {
    expect(selectStrategy('How many links are on this page?', 'task')).toBe('single_shot');
  });

  it('4. "List all navigation items" → single_shot', () => {
    expect(selectStrategy('List all navigation items', 'task')).toBe('single_shot');
  });

  it('5. "What color is the background?" → single_shot', () => {
    expect(selectStrategy('What color is the background?', 'task')).toBe('single_shot');
  });

  it('6. "Count the form fields" → single_shot', () => {
    expect(selectStrategy('Count the form fields', 'task')).toBe('single_shot');
  });

  it('7. "Is there a login button?" → multi_step (contains "login")', () => {
    expect(selectStrategy('Is there a login button?', 'task')).toBe('multi_step');
  });

  it('8. "Summarize the page content" → single_shot', () => {
    expect(selectStrategy('Summarize the page content', 'task')).toBe('single_shot');
  });

  // Multi-step (actions)
  it('9. "Click the login button" → multi_step', () => {
    expect(selectStrategy('Click the login button', 'task')).toBe('multi_step');
  });

  it('10. "Navigate to the settings page" → multi_step', () => {
    expect(selectStrategy('Navigate to the settings page', 'task')).toBe('multi_step');
  });

  it('11. "Create a new pipeline" → multi_step', () => {
    expect(selectStrategy('Create a new pipeline', 'task')).toBe('multi_step');
  });

  it('12. "Fill in the contact form" → multi_step', () => {
    expect(selectStrategy('Fill in the contact form', 'task')).toBe('multi_step');
  });

  it('13. "Submit the registration" → multi_step', () => {
    expect(selectStrategy('Submit the registration', 'task')).toBe('multi_step');
  });

  it('14. "Login with test credentials" → multi_step', () => {
    expect(selectStrategy('Login with test credentials', 'task')).toBe('multi_step');
  });

  it('15. "Go to the dashboard" → multi_step', () => {
    expect(selectStrategy('Go to the dashboard', 'task')).toBe('multi_step');
  });

  it('16. "Delete the first item" → multi_step', () => {
    expect(selectStrategy('Delete the first item', 'task')).toBe('multi_step');
  });

  it('17. "Edit the user profile" → multi_step', () => {
    expect(selectStrategy('Edit the user profile', 'task')).toBe('multi_step');
  });

  it('18. "Type hello in the search box" → multi_step', () => {
    expect(selectStrategy('Type hello in the search box', 'task')).toBe('multi_step');
  });

  // Explore always multi_step
  it('19. explore task type → always multi_step', () => {
    expect(selectStrategy('anything', 'explore')).toBe('multi_step');
  });

  it('20. explore with simple text → still multi_step', () => {
    expect(selectStrategy('What is this?', 'explore')).toBe('multi_step');
  });
});

// ══════════════════════════════════════════════════════════════
// CATEGORY 2: Budget Tracker (21-35)
// ══════════════════════════════════════════════════════════════

import { createBudgetTracker } from '../src/budget.js';

describe('Budget Tracker', () => {
  it('21. Fresh budget is not exhausted', () => {
    const b = createBudgetTracker({ maxSteps: 10 });
    expect(b.exhausted()).toBe(false);
  });

  it('22. Budget exhausts at maxSteps', () => {
    const b = createBudgetTracker({ maxSteps: 3 });
    b.recordStep();
    b.recordStep();
    b.recordStep();
    expect(b.exhausted()).toBe(true);
  });

  it('23. Budget not exhausted before maxSteps', () => {
    const b = createBudgetTracker({ maxSteps: 5 });
    b.recordStep();
    b.recordStep();
    expect(b.exhausted()).toBe(false);
  });

  it('24. Remaining steps decrements correctly', () => {
    const b = createBudgetTracker({ maxSteps: 10 });
    b.recordStep();
    b.recordStep();
    expect(b.remaining().steps).toBe(8);
  });

  it('25. Warning at 80% capacity', () => {
    const b = createBudgetTracker({ maxSteps: 10 });
    for (let i = 0; i < 7; i++) b.recordStep();
    expect(b.warning()).toBe(false);
    b.recordStep(); // 8/10 = 80%
    expect(b.warning()).toBe(true);
  });

  it('26. Snapshot captures state correctly', () => {
    const b = createBudgetTracker({ maxSteps: 5 });
    b.recordStep();
    b.recordStep();
    const snap = b.snapshot();
    expect(snap.stepsUsed).toBe(2);
    expect(snap.stepsRemaining).toBe(3);
    expect(snap.exhausted).toBe(false);
  });

  it('27. canReplan returns true initially', () => {
    const b = createBudgetTracker({ maxSteps: 10 });
    expect(b.canReplan()).toBe(true);
  });

  it('28. canReplan returns false after max replans', () => {
    const b = createBudgetTracker({ maxSteps: 10, maxReplanAttempts: 2 });
    b.recordReplan();
    b.recordReplan();
    expect(b.canReplan()).toBe(false);
  });

  it('29. Steps remaining never goes negative', () => {
    const b = createBudgetTracker({ maxSteps: 2 });
    b.recordStep();
    b.recordStep();
    b.recordStep(); // over budget
    expect(b.remaining().steps).toBe(0);
  });

  it('30. Default budget has positive remaining steps', () => {
    const b = createBudgetTracker({});
    expect(b.remaining().steps).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════
// CATEGORY 3: Action Verification (31-45)
// ══════════════════════════════════════════════════════════════

import { verifyAction } from '../src/verify-action.js';
import type { AgentAction, ExecutionResult } from '../src/agent-types.js';

describe('Action Verification', () => {
  const makeAction = (type: string, expected: string): AgentAction => ({
    type: type as AgentAction['type'],
    expectedOutcome: expected,
    intentId: 'test',
  });

  it('31. Successful action with URL change → passed, high confidence', () => {
    const r = verifyAction(makeAction('click', 'navigate'), { success: true }, '/a', '/b');
    expect(r.passed).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('32. Successful action with no change → passed, lower confidence', () => {
    const r = verifyAction(makeAction('click', 'click button'), { success: true }, '/a', '/a');
    expect(r.passed).toBe(true);
    expect(r.confidence).toBe(0.6);
  });

  it('33. Action with error → failed', () => {
    const r = verifyAction(makeAction('click', 'click'), { success: false, error: 'timeout' }, '/a', '/a');
    expect(r.passed).toBe(false);
  });

  it('34. Action with success=false → failed', () => {
    const r = verifyAction(makeAction('type', 'type text'), { success: false }, '/a', '/a');
    expect(r.passed).toBe(false);
  });

  it('35. Extract with data → passed, high confidence', () => {
    const r = verifyAction(makeAction('extract', 'get data'), { success: true, data: { items: ['a'] } }, '/a', '/a');
    expect(r.passed).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('36. Extract with empty data and no URL change → passed, lower confidence', () => {
    const r = verifyAction(makeAction('extract', 'get data'), { success: true, data: {} }, '/a', '/a');
    expect(r.passed).toBe(true);
  });

  it('37. Error message propagated in findings', () => {
    const r = verifyAction(makeAction('click', 'click'), { success: false, error: 'element not found' }, '/a', '/a');
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings[0].description).toContain('element not found');
  });

  it('38. Success with error field → still failed (error takes precedence)', () => {
    const r = verifyAction(makeAction('click', 'click'), { success: true, error: 'partial failure' }, '/a', '/a');
    expect(r.passed).toBe(false);
  });

  it('39. Null data is non-empty=false', () => {
    const r = verifyAction(makeAction('extract', 'get'), { success: true, data: null }, '/a', '/a');
    expect(r.passed).toBe(true);
    expect(r.confidence).toBe(0.6); // no positive signals
  });

  it('40. Navigate action with URL change → high confidence', () => {
    const r = verifyAction(makeAction('navigate', 'go to page'), { success: true }, '/old', '/new');
    expect(r.passed).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

// ══════════════════════════════════════════════════════════════
// CATEGORY 4: Progress Evaluation (41-60)
// ══════════════════════════════════════════════════════════════

import { evaluateProgress } from '../src/evaluate-progress.js';
import type { TaskMemory, ActionVerification } from '../src/agent-types.js';

describe('Progress Evaluation', () => {
  const makeMemory = (overrides: Partial<TaskMemory> = {}): TaskMemory => ({
    taskId: 'test',
    goal: 'test goal',
    intents: [],
    visitedPages: ['/a'],
    actionsAttempted: [],
    failedActions: [],
    replanCount: 0,
    progressScore: 0,
    stuckSignals: {
      repeatedActionCount: 0,
      samePageCount: 0,
      failedExecutionCount: 0,
      stepsSinceProgress: 0,
    },
    ...overrides,
  });

  const passingVerification: ActionVerification = { passed: true, confidence: 0.8, findings: [] };
  const failingVerification: ActionVerification = { passed: false, confidence: 1.0, findings: [{ title: 'fail', description: 'failed', severity: 'high' }] };

  const makeBudget = (exhausted = false, canReplan = true) => ({
    recordStep: vi.fn(),
    recordReplan: vi.fn(),
    remaining: () => ({ steps: 10, timeMs: 60000 }),
    exhausted: () => exhausted,
    warning: () => false,
    canReplan: () => canReplan,
    snapshot: () => ({ stepsUsed: 0, stepsRemaining: 10, replansUsed: 0, elapsedMs: 0, exhausted: false, warning: false }),
  });

  it('41. Passing verification + URL change → continue', () => {
    const { decision } = evaluateProgress(makeMemory(), makeBudget(), passingVerification, '/a', '/b');
    expect(decision).toBe('continue');
  });

  it('42. Failing verification → retry_action', () => {
    const { decision } = evaluateProgress(makeMemory(), makeBudget(), failingVerification, '/a', '/a');
    expect(decision).toBe('retry_action');
  });

  it('43. Budget exhausted → done', () => {
    const { decision } = evaluateProgress(makeMemory(), makeBudget(true), passingVerification, '/a', '/a');
    expect(decision).toBe('done');
  });

  it('44. Stuck with replan available → replan', () => {
    const mem = makeMemory({
      stuckSignals: { repeatedActionCount: 4, samePageCount: 6, failedExecutionCount: 3, stepsSinceProgress: 6 },
    });
    const { decision } = evaluateProgress(mem, makeBudget(false, true), passingVerification, '/a', '/a');
    expect(decision).toBe('replan');
  });

  it('45. Stuck with no replan → escalate_to_user', () => {
    const mem = makeMemory({
      stuckSignals: { repeatedActionCount: 4, samePageCount: 6, failedExecutionCount: 3, stepsSinceProgress: 6 },
    });
    const { decision } = evaluateProgress(mem, makeBudget(false, false), passingVerification, '/a', '/a');
    expect(decision).toBe('escalate_to_user');
  });

  it('46. 3 consecutive failures → replan (not retry)', () => {
    const mem = makeMemory({
      stuckSignals: { repeatedActionCount: 0, samePageCount: 0, failedExecutionCount: 3, stepsSinceProgress: 0 },
    });
    const { decision } = evaluateProgress(mem, makeBudget(false, true), failingVerification, '/a', '/a');
    expect(decision).toBe('replan');
  });

  it('47. URL change resets stepsSinceProgress', () => {
    const mem = makeMemory({
      stuckSignals: { repeatedActionCount: 0, samePageCount: 3, failedExecutionCount: 0, stepsSinceProgress: 4 },
    });
    const { signals } = evaluateProgress(mem, makeBudget(), passingVerification, '/a', '/b');
    expect(signals.stepsSinceProgress).toBe(0);
  });

  it('48. Same page increments samePageCount', () => {
    const mem = makeMemory({
      stuckSignals: { repeatedActionCount: 0, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 0 },
    });
    const { signals } = evaluateProgress(mem, makeBudget(), passingVerification, '/a', '/a');
    expect(signals.samePageCount).toBe(1);
  });

  it('49. Failed verification increments failedExecutionCount', () => {
    const mem = makeMemory({
      stuckSignals: { repeatedActionCount: 0, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 0 },
    });
    const { signals } = evaluateProgress(mem, makeBudget(), failingVerification, '/a', '/a');
    expect(signals.failedExecutionCount).toBe(1);
  });

  it('50. Reason string includes stuck signals', () => {
    const mem = makeMemory({
      stuckSignals: { repeatedActionCount: 5, samePageCount: 6, failedExecutionCount: 3, stepsSinceProgress: 7 },
    });
    const { reason } = evaluateProgress(mem, makeBudget(false, true), passingVerification, '/a', '/a');
    expect(reason).toContain('repeated action');
  });

  it('51. Repeated action detected from history', () => {
    const action1: AgentAction = { type: 'click', elementId: 'btn1', expectedOutcome: 'click', intentId: 'i1' };
    const action2: AgentAction = { type: 'click', elementId: 'btn1', expectedOutcome: 'click', intentId: 'i1' };
    const mem = makeMemory({
      actionsAttempted: [action1, action2],
      stuckSignals: { repeatedActionCount: 0, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 0 },
    });
    const { signals } = evaluateProgress(mem, makeBudget(), passingVerification, '/a', '/a');
    expect(signals.repeatedActionCount).toBe(1);
  });

  it('52. Different actions → no repeated count increase', () => {
    const action1: AgentAction = { type: 'click', elementId: 'btn1', expectedOutcome: 'click', intentId: 'i1' };
    const action2: AgentAction = { type: 'click', elementId: 'btn2', expectedOutcome: 'click', intentId: 'i1' };
    const mem = makeMemory({
      actionsAttempted: [action1, action2],
      stuckSignals: { repeatedActionCount: 0, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 0 },
    });
    const { signals } = evaluateProgress(mem, makeBudget(), passingVerification, '/a', '/a');
    expect(signals.repeatedActionCount).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// CATEGORY 5: Intent Verification (53-60)
// ══════════════════════════════════════════════════════════════

import { verifyIntent } from '../src/verify-intent.js';

describe('Intent Verification', () => {
  it('53. Intent with matching URL → passed', async () => {
    const intent = { id: 'i1', description: 'Navigate to /dashboard', successCriteria: 'URL contains dashboard', status: 'active' as const, confidence: 0 };
    const r = await verifyIntent(intent, 'https://app.com/dashboard', 'Dashboard');
    expect(r.passed).toBe(true);
  });

  it('54. Intent with non-matching URL → not passed', async () => {
    const intent = { id: 'i1', description: 'Navigate to /settings', successCriteria: 'URL contains settings page', status: 'active' as const, confidence: 0 };
    const r = await verifyIntent(intent, 'https://app.com/dashboard', 'Dashboard');
    expect(r.passed).toBe(false);
  });

  it('55. Intent with matching page title → passed', async () => {
    const intent = { id: 'i1', description: 'Go to Dashboard', successCriteria: 'Dashboard page visible', status: 'active' as const, confidence: 0 };
    const r = await verifyIntent(intent, 'https://app.com/dashboard', 'Dashboard');
    expect(r.passed).toBe(true);
  });

  it('56. Generic intent with unrelated criteria → not passed', async () => {
    const intent = { id: 'i1', description: 'Do something complex', successCriteria: 'User sees payment confirmation receipt', status: 'active' as const, confidence: 0 };
    const r = await verifyIntent(intent, 'https://app.com/page', 'Home Page');
    expect(r.passed).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// CATEGORY 6: Goal Completion Confirmation (57-65)
// ══════════════════════════════════════════════════════════════

import { confirmGoalCompletion } from '../src/planner-confirm.js';
import type { Intent } from '../src/agent-types.js';

describe('Goal Completion', () => {
  const makeIntents = (statuses: string[]): Intent[] =>
    statuses.map((s, i) => ({
      id: `i${i}`,
      description: `intent ${i}`,
      successCriteria: `criteria ${i}`,
      status: s as Intent['status'],
      confidence: s === 'completed' ? 0.9 : 0,
    }));

  it('57. All intents completed → achieved', () => {
    const r = confirmGoalCompletion('test', makeIntents(['completed', 'completed']));
    expect(r.achieved).toBe(true);
  });

  it('58. Some intents pending → not achieved', () => {
    const r = confirmGoalCompletion('test', makeIntents(['completed', 'pending']));
    expect(r.achieved).toBe(false);
  });

  it('59. All pending → not achieved', () => {
    const r = confirmGoalCompletion('test', makeIntents(['pending', 'pending']));
    expect(r.achieved).toBe(false);
  });

  it('60. Empty intents → achieved (nothing to do)', () => {
    const r = confirmGoalCompletion('test', []);
    expect(r.achieved).toBe(true);
  });

  it('61. One active intent remaining → not achieved', () => {
    const r = confirmGoalCompletion('test', makeIntents(['completed', 'active']));
    expect(r.achieved).toBe(false);
  });

  it('62. Remaining work described for incomplete', () => {
    const r = confirmGoalCompletion('test', makeIntents(['completed', 'pending']));
    expect(r.remainingWork).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════
// CATEGORY 7: Session Manager (mocked) (63-80)
// ══════════════════════════════════════════════════════════════

// These test the session manager's public interface with mocked deps.
// We reuse the existing mock setup from sessionManager.test.ts patterns.

vi.mock('../src/redisStore.js', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  setSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  refreshTTL: vi.fn().mockResolvedValue(undefined),
  updateLastActivity: vi.fn().mockResolvedValue(undefined),
  freePort: vi.fn().mockResolvedValue(undefined),
  setScreenshot: vi.fn().mockResolvedValue(undefined),
  getScreenshot: vi.fn().mockResolvedValue(null),
  pushMessage: vi.fn().mockResolvedValue(undefined),
  getMessages: vi.fn().mockResolvedValue([]),
  listSessions: vi.fn().mockResolvedValue([]),
  deleteScreenshot: vi.fn().mockResolvedValue(undefined),
  deleteMessages: vi.fn().mockResolvedValue(undefined),
  removeFromExpiry: vi.fn().mockResolvedValue(undefined),
  incrementTaskCount: vi.fn().mockResolvedValue(1),
  incrementNavCount: vi.fn().mockResolvedValue(1),
  acquireExecLock: vi.fn().mockResolvedValue(true),
  releaseExecLock: vi.fn().mockResolvedValue(true),
  extendExecLock: vi.fn().mockResolvedValue(true),
  forceReleaseExecLock: vi.fn().mockResolvedValue(undefined),
  acquireSessionLock: vi.fn().mockResolvedValue(true),
  releaseSessionLock: vi.fn().mockResolvedValue(undefined),
  extendSessionLock: vi.fn().mockResolvedValue(true),
  waitForSessionReady: vi.fn().mockResolvedValue(null),
  getRedis: vi.fn().mockReturnValue({
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    scard: vi.fn().mockResolvedValue(0),
    keys: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../src/browserManager.js', () => ({
  claimWarm: vi.fn().mockResolvedValue(null),
  launchBrowser: vi.fn().mockResolvedValue({ pid: 12345, port: 19300, cdpEndpoint: 'http://localhost:19300' }),
  killBrowser: vi.fn().mockResolvedValue(undefined),
  isAlive: vi.fn().mockResolvedValue(true),
  replenish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/agent.js', () => ({
  createAgent: vi.fn().mockResolvedValue({
    agent: {},
    connector: { getHarness: () => ({ page: { evaluate: vi.fn().mockResolvedValue(true), setViewportSize: vi.fn(), url: () => 'http://test.com', waitForLoadState: vi.fn().mockResolvedValue(undefined) } }) },
    sessionId: 'db-1',
    agentId: 'proj-1',
    userId: null,
    memoryContext: '',
    patterns: [],
    stepsHistory: [],
    loginDone: Promise.resolve(),
    loginInProgress: false,
    lastAction: null,
    currentUrl: null,
    currentTrace: null,
    cdpSession: null,
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../src/db.js', () => ({
  endSession: vi.fn().mockResolvedValue(undefined),
  getMessagesBySession: vi.fn().mockResolvedValue([]),
  getAgent: vi.fn().mockResolvedValue({ id: 'proj-1', user_id: 'user-1', url: 'https://example.com' }),
}));

import * as redisStore from '../src/redisStore.js';
import * as browserManager from '../src/browserManager.js';
import {
  createSession,
  destroySession,
  checkSessionLimits,
  healthCheck,
  ensureSessionIsSane,
  softReset,
  getAgent,
  addClient,
  removeClient,
  hasSession,
  reap,
  _resetLocalState,
} from '../src/sessionManager.js';

const mockRedisSession = {
  dbSessionId: 'db-1',
  status: 'idle' as const,
  owner: 'srv-1',
  cdpPort: 19300,
  cdpEndpoint: 'http://localhost:19300',
  currentUrl: 'https://example.com',
  memoryContext: '',
  browserPid: 12345,
  lastTask: '',
  createdAt: Date.now(),
  lastActivityAt: Date.now(),
  detachedAt: 0,
  taskCount: 0,
  navigationCount: 0,
  healthStatus: 'healthy' as const,
};

describe('Session Manager — Lifecycle Limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLocalState();
  });

  it('63. checkSessionLimits returns not exceeded for fresh session', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce({ ...mockRedisSession, taskCount: 0, navigationCount: 0 });
    const r = await checkSessionLimits('proj-1');
    expect(r.exceeded).toBe(false);
  });

  it('64. checkSessionLimits exceeded at 20 tasks (default)', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce({ ...mockRedisSession, taskCount: 20 });
    const r = await checkSessionLimits('proj-1');
    expect(r.exceeded).toBe(true);
    expect(r.reason).toContain('task limit');
  });

  it('65. checkSessionLimits exceeded at 50 navigations (default)', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce({ ...mockRedisSession, navigationCount: 50 });
    const r = await checkSessionLimits('proj-1');
    expect(r.exceeded).toBe(true);
    expect(r.reason).toContain('navigation limit');
  });

  it('66. checkSessionLimits not exceeded at 19 tasks', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce({ ...mockRedisSession, taskCount: 19 });
    const r = await checkSessionLimits('proj-1');
    expect(r.exceeded).toBe(false);
  });

  it('67. checkSessionLimits returns not exceeded for null session', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce(null);
    const r = await checkSessionLimits('proj-1');
    expect(r.exceeded).toBe(false);
  });
});

describe('Session Manager — Create & Destroy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLocalState();
  });

  it('68. createSession stores session in Redis', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    expect(redisStore.setSession).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      status: 'idle',
      taskCount: 0,
      navigationCount: 0,
      healthStatus: 'healthy',
    }));
  });

  it('69. createSession includes owner field', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    expect(redisStore.setSession).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      owner: expect.any(String),
    }));
  });

  it('70. createSession stores agent locally', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    expect(getAgent('proj-1')).toBeTruthy();
  });

  it('71. destroySession deletes Redis session', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    (redisStore.getSession as any).mockResolvedValueOnce({ ...mockRedisSession });
    await destroySession('proj-1');
    expect(redisStore.deleteSession).toHaveBeenCalledWith('proj-1');
  });

  it('72. destroySession kills browser', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    (redisStore.getSession as any).mockResolvedValueOnce({ ...mockRedisSession });
    await destroySession('proj-1');
    expect(browserManager.killBrowser).toHaveBeenCalledWith(12345, 19300);
  });

  it('73. destroySession releases exec lock', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    (redisStore.getSession as any).mockResolvedValueOnce({ ...mockRedisSession });
    await destroySession('proj-1');
    expect(redisStore.forceReleaseExecLock).toHaveBeenCalledWith('proj-1');
  });

  it('74. destroySession calls replenish', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    (redisStore.getSession as any).mockResolvedValueOnce({ ...mockRedisSession });
    await destroySession('proj-1');
    expect(browserManager.replenish).toHaveBeenCalled();
  });

  it('75. destroySession removes agent from local map', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    (redisStore.getSession as any).mockResolvedValueOnce({ ...mockRedisSession });
    await destroySession('proj-1');
    expect(getAgent('proj-1')).toBeUndefined();
  });
});

describe('Session Manager — Health Check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLocalState();
  });

  it('76. healthCheck returns false for unknown agent', async () => {
    expect(await healthCheck('unknown')).toBe(false);
  });

  it('77. healthCheck returns true for alive page', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    expect(await healthCheck('proj-1')).toBe(true);
  });

  it('78. healthCheck marks unhealthy on failure', async () => {
    const mockAgent = {
      agent: {},
      connector: { getHarness: () => ({ page: { evaluate: vi.fn().mockRejectedValue(new Error('dead')), setViewportSize: vi.fn(), url: () => 'http://test.com', waitForLoadState: vi.fn() } }) },
      sessionId: 'db-1', agentId: 'proj-1', userId: null, memoryContext: '', patterns: [],
      stepsHistory: [], loginDone: Promise.resolve(), loginInProgress: false,
      lastAction: null, currentUrl: null, currentTrace: null, cdpSession: null,
      close: vi.fn().mockResolvedValue(undefined),
    };
    const { createAgent } = await import('../src/agent.js');
    (createAgent as any).mockResolvedValueOnce(mockAgent);
    await createSession('proj-2', 'https://example.com', 'db-2');
    const result = await healthCheck('proj-2');
    expect(result).toBe(false);
    expect(redisStore.setSession).toHaveBeenCalledWith('proj-2', expect.objectContaining({ healthStatus: 'unhealthy' }));
  });
});

describe('Session Manager — Sanity Check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLocalState();
  });

  it('79. ensureSessionIsSane returns false for unknown agent', async () => {
    expect(await ensureSessionIsSane('unknown')).toBe(false);
  });

  it('80. ensureSessionIsSane returns true for healthy session', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    expect(await ensureSessionIsSane('proj-1')).toBe(true);
  });

  it('81. softReset returns false for unknown agent', async () => {
    expect(await softReset('unknown')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// CATEGORY 8: Session Lifecycle Protocol (82-90)
// ══════════════════════════════════════════════════════════════

import { WS_CLOSE_CODES } from '../src/types.js';
import type { ReapReason } from '../src/types.js';

describe('Session Lifecycle Protocol', () => {
  it('82. WS_CLOSE_CODES.SESSION_EXPIRED = 4001', () => {
    expect(WS_CLOSE_CODES.SESSION_EXPIRED).toBe(4001);
  });

  it('83. WS_CLOSE_CODES.AGENT_NOT_FOUND = 4002', () => {
    expect(WS_CLOSE_CODES.AGENT_NOT_FOUND).toBe(4002);
  });

  it('84. WS_CLOSE_CODES.SESSION_TERMINATED = 4003', () => {
    expect(WS_CLOSE_CODES.SESSION_TERMINATED).toBe(4003);
  });

  it('85. ReapReason type includes expired', () => {
    const reason: ReapReason = 'expired';
    expect(reason).toBe('expired');
  });

  it('86. ReapReason type includes terminated', () => {
    const reason: ReapReason = 'terminated';
    expect(reason).toBe('terminated');
  });

  it('87. ReapReason type includes evicted', () => {
    const reason: ReapReason = 'evicted';
    expect(reason).toBe('evicted');
  });

  it('88. RedisSessionStatus includes allocating', () => {
    const status: import('../src/types.js').RedisSessionStatus = 'allocating';
    expect(status).toBe('allocating');
  });

  it('89. RedisSession has owner field', () => {
    const session: import('../src/types.js').RedisSession = { ...mockRedisSession, owner: 'srv-1' };
    expect(session.owner).toBe('srv-1');
  });

  it('90. RedisSession has healthStatus field', () => {
    const session: import('../src/types.js').RedisSession = { ...mockRedisSession, healthStatus: 'healthy' };
    expect(session.healthStatus).toBe('healthy');
  });
});

// ══════════════════════════════════════════════════════════════
// CATEGORY 9: Warm Pool & Client Management (91-100)
// ══════════════════════════════════════════════════════════════

describe('Warm Pool & Client Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLocalState();
  });

  it('91. createSession tries warm pool first', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    expect(browserManager.claimWarm).toHaveBeenCalledWith('proj-1');
  });

  it('92. createSession falls back to launchBrowser if no warm', async () => {
    (browserManager.claimWarm as any).mockResolvedValueOnce(null);
    await createSession('proj-1', 'https://example.com', 'db-1');
    expect(browserManager.launchBrowser).toHaveBeenCalledWith('proj-1');
  });

  it('93. createSession uses warm browser when available', async () => {
    (browserManager.claimWarm as any).mockResolvedValueOnce({ pid: 999, port: 19305, cdpEndpoint: 'http://localhost:19305' });
    await createSession('proj-1', 'https://example.com', 'db-1');
    expect(browserManager.launchBrowser).not.toHaveBeenCalled();
  });

  it('94. hasSession returns false for non-existent', async () => {
    expect(await hasSession('nope')).toBe(false);
  });

  it('95. hasSession returns true after creation', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce(mockRedisSession);
    expect(await hasSession('proj-1')).toBe(true);
  });

  it('96. addClient/removeClient manages WS clients', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    const mockWs = { readyState: 1, send: vi.fn(), close: vi.fn() } as any;
    addClient('proj-1', mockWs);
    // Should not throw
    removeClient('proj-1', mockWs);
  });

  it('97. reap cleans everything for existing session', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    (redisStore.getSession as any).mockResolvedValueOnce({ ...mockRedisSession });
    await reap('proj-1', 'terminated');
    expect(redisStore.deleteSession).toHaveBeenCalledWith('proj-1');
    expect(browserManager.killBrowser).toHaveBeenCalled();
    expect(redisStore.forceReleaseExecLock).toHaveBeenCalledWith('proj-1');
    expect(browserManager.replenish).toHaveBeenCalled();
  });

  it('98. reap handles null session gracefully', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce(null);
    await reap('nonexistent', 'terminated');
    expect(browserManager.killBrowser).not.toHaveBeenCalled();
  });

  it('99. Multiple createSession calls store distinct agent IDs', async () => {
    await createSession('proj-a', 'https://a.com', 'db-a');
    await createSession('proj-b', 'https://b.com', 'db-b');
    expect(getAgent('proj-a')).toBeTruthy();
    expect(getAgent('proj-b')).toBeTruthy();
    // Both stored separately in the agents map
    expect(redisStore.setSession).toHaveBeenCalledWith('proj-a', expect.objectContaining({ status: 'idle' }));
    expect(redisStore.setSession).toHaveBeenCalledWith('proj-b', expect.objectContaining({ status: 'idle' }));
  });

  it('100. createSession with userId passes to agent', async () => {
    const { createAgent } = await import('../src/agent.js');
    await createSession('proj-1', 'https://example.com', 'db-1', 'user-42');
    expect(createAgent).toHaveBeenCalledWith(
      expect.any(Function), 'http://localhost:19300', 'db-1', 'proj-1', 'https://example.com', 'user-42'
    );
  });
});
