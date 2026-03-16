import { describe, it, expect } from 'vitest';
import { evaluateProgress } from '../src/evaluate-progress.js';
import { createBudgetTracker } from '../src/budget.js';
import type { TaskMemory, ActionVerification } from '../src/agent-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemory(overrides: Partial<TaskMemory> = {}): TaskMemory {
  return {
    taskId: 'task-1',
    goal: 'Do something',
    intents: [],
    visitedPages: [],
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
  };
}

function passedVerification(): ActionVerification {
  return { passed: true, confidence: 0.8, findings: [] };
}

function failedVerification(): ActionVerification {
  return { passed: false, confidence: 1.0, findings: [{ title: 'err', description: 'x', severity: 'high' }] };
}

// ---------------------------------------------------------------------------
// continue
// ---------------------------------------------------------------------------

describe('evaluateProgress — continue', () => {
  it('returns continue when no stuck signals and verification passed', () => {
    const budget = createBudgetTracker({ maxSteps: 50 });
    const memory = makeMemory();
    const { decision } = evaluateProgress(memory, budget, passedVerification(), 'https://a.com', 'https://b.com');
    expect(decision).toBe('continue');
  });
});

// ---------------------------------------------------------------------------
// retry_action
// ---------------------------------------------------------------------------

describe('evaluateProgress — retry_action', () => {
  it('returns retry_action when last verification failed but not stuck', () => {
    const budget = createBudgetTracker({ maxSteps: 50 });
    const memory = makeMemory({
      stuckSignals: { repeatedActionCount: 0, samePageCount: 0, failedExecutionCount: 1, stepsSinceProgress: 1 },
    });
    const { decision } = evaluateProgress(memory, budget, failedVerification(), 'https://a.com', 'https://a.com');
    expect(decision).toBe('retry_action');
  });
});

// ---------------------------------------------------------------------------
// replan
// ---------------------------------------------------------------------------

describe('evaluateProgress — replan', () => {
  it('returns replan when stuck and replans available', () => {
    const budget = createBudgetTracker({ maxSteps: 50, maxReplanAttempts: 3 });
    const memory = makeMemory({
      stuckSignals: {
        repeatedActionCount: 3,   // >= 3 triggers stuck
        samePageCount: 0,
        failedExecutionCount: 0,
        stepsSinceProgress: 5,    // >= 5 required
      },
    });
    const { decision } = evaluateProgress(memory, budget, passedVerification(), 'https://a.com', 'https://a.com');
    expect(decision).toBe('replan');
  });

  it('returns replan when samePage count >= 4 and steps since progress >= 5', () => {
    const budget = createBudgetTracker({ maxSteps: 50, maxReplanAttempts: 3 });
    const memory = makeMemory({
      stuckSignals: {
        repeatedActionCount: 0,
        samePageCount: 4,
        failedExecutionCount: 0,
        stepsSinceProgress: 5,
      },
    });
    const { decision } = evaluateProgress(memory, budget, passedVerification(), 'https://a.com', 'https://a.com');
    expect(decision).toBe('replan');
  });
});

// ---------------------------------------------------------------------------
// escalate_to_user
// ---------------------------------------------------------------------------

describe('evaluateProgress — escalate_to_user', () => {
  it('returns escalate_to_user when stuck but no replans remaining', () => {
    const budget = createBudgetTracker({ maxSteps: 50, maxReplanAttempts: 0 });
    const memory = makeMemory({
      stuckSignals: {
        repeatedActionCount: 0,
        samePageCount: 0,
        failedExecutionCount: 2,  // >= 2 triggers stuck
        stepsSinceProgress: 5,
      },
    });
    const { decision } = evaluateProgress(memory, budget, passedVerification(), 'https://a.com', 'https://a.com');
    expect(decision).toBe('escalate_to_user');
  });
});

// ---------------------------------------------------------------------------
// done
// ---------------------------------------------------------------------------

describe('evaluateProgress — done', () => {
  it('returns done when budget is exhausted', () => {
    const budget = createBudgetTracker({ maxSteps: 1 });
    budget.recordStep(); // exhaust budget
    const memory = makeMemory();
    const { decision } = evaluateProgress(memory, budget, passedVerification(), 'https://a.com', 'https://b.com');
    expect(decision).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// stuck signal updates
// ---------------------------------------------------------------------------

describe('evaluateProgress — stuck signal updates', () => {
  it('increments samePageCount when URL has not changed', () => {
    const budget = createBudgetTracker({ maxSteps: 50 });
    const memory = makeMemory({
      stuckSignals: { repeatedActionCount: 0, samePageCount: 1, failedExecutionCount: 0, stepsSinceProgress: 2 },
    });
    evaluateProgress(memory, budget, passedVerification(), 'https://a.com', 'https://a.com');
    // samePageCount should increase, but we need a getter — test indirectly via decision
    // With samePageCount becoming 2, stepsSinceProgress becoming 3: not stuck yet (need >= 4 same page, >= 5 steps)
    const { decision } = evaluateProgress(memory, budget, passedVerification(), 'https://a.com', 'https://a.com');
    expect(decision).toBe('continue'); // not yet stuck
  });

  it('resets stepsSinceProgress when URL changes (progress detected)', () => {
    const budget = createBudgetTracker({ maxSteps: 50 });
    const memory = makeMemory({
      stuckSignals: { repeatedActionCount: 0, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 10 },
    });
    const { decision } = evaluateProgress(memory, budget, passedVerification(), 'https://a.com', 'https://b.com');
    // URL changed → stepsSinceProgress reset → not stuck
    expect(decision).toBe('continue');
  });
});
