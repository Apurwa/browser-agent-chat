import { describe, it, expect } from 'vitest';
import { evaluateProgress } from '../src/evaluate-progress.js';
import { createBudgetTracker } from '../src/budget.js';
import type { TaskMemory, ActionVerification, AgentAction } from '../src/agent-types.js';

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

function makeAction(overrides: Partial<AgentAction> = {}): AgentAction {
  return {
    type: 'click',
    elementId: 'btn-1',
    expectedOutcome: 'Navigate somewhere',
    intentId: 'intent-1',
    ...overrides,
  };
}

function passedVerification(): ActionVerification {
  return { passed: true, confidence: 0.8, findings: [] };
}

function failedVerification(): ActionVerification {
  return {
    passed: false,
    confidence: 1.0,
    findings: [{ title: 'err', description: 'element not found', severity: 'high' }],
  };
}

// ---------------------------------------------------------------------------
// Task 3 TDD: evaluateProgress purity
// ---------------------------------------------------------------------------

describe('evaluateProgress — purity (no mutation)', () => {
  it('does NOT mutate taskMemory.stuckSignals', () => {
    const budget = createBudgetTracker({ maxSteps: 50 });
    const memory = makeMemory({
      stuckSignals: {
        repeatedActionCount: 0,
        samePageCount: 1,
        failedExecutionCount: 0,
        stepsSinceProgress: 2,
      },
    });

    // Deep clone to compare after
    const originalSignals = { ...memory.stuckSignals };

    evaluateProgress(memory, budget, passedVerification(), 'https://a.com', 'https://a.com');

    // The stuckSignals on the original memory object must be unchanged
    expect(memory.stuckSignals).toEqual(originalSignals);
  });

  it('returns updated signals via the return value', () => {
    const budget = createBudgetTracker({ maxSteps: 50 });
    const memory = makeMemory({
      stuckSignals: {
        repeatedActionCount: 0,
        samePageCount: 1,
        failedExecutionCount: 0,
        stepsSinceProgress: 2,
      },
    });

    const result = evaluateProgress(memory, budget, passedVerification(), 'https://a.com', 'https://a.com');

    // Result should include the signals (same page → samePageCount incremented)
    expect(result.signals).toBeDefined();
    expect(result.signals.samePageCount).toBe(2);
    expect(result.signals.stepsSinceProgress).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Task 3 TDD: updateTaskMemory
// ---------------------------------------------------------------------------

describe('updateTaskMemory', () => {
  it('returns a new object without mutating input', async () => {
    const { updateTaskMemory } = await import('../src/evaluate-progress.js');
    const memory = makeMemory({
      actionsAttempted: [makeAction()],
      visitedPages: ['https://a.com'],
    });
    const action = makeAction({ elementId: 'btn-2' });
    const verification = passedVerification();

    const original = structuredClone(memory);
    const updated = updateTaskMemory(memory, action, verification, 'https://a.com', 'https://b.com');

    // Original must be unchanged
    expect(memory).toEqual(original);
    // Updated must be a different reference
    expect(updated).not.toBe(memory);
  });

  it('appends action to actionsAttempted', async () => {
    const { updateTaskMemory } = await import('../src/evaluate-progress.js');
    const action1 = makeAction({ elementId: 'btn-1' });
    const action2 = makeAction({ elementId: 'btn-2' });
    const memory = makeMemory({ actionsAttempted: [action1] });

    const updated = updateTaskMemory(memory, action2, passedVerification(), 'https://a.com', 'https://a.com');

    expect(updated.actionsAttempted).toHaveLength(2);
    expect(updated.actionsAttempted[1]).toEqual(action2);
    // Original not mutated
    expect(memory.actionsAttempted).toHaveLength(1);
  });

  it('adds to visitedPages when URL changes', async () => {
    const { updateTaskMemory } = await import('../src/evaluate-progress.js');
    const memory = makeMemory({ visitedPages: ['https://a.com'] });
    const action = makeAction();

    const updated = updateTaskMemory(memory, action, passedVerification(), 'https://a.com', 'https://b.com');

    expect(updated.visitedPages).toContain('https://b.com');
    expect(updated.visitedPages).toHaveLength(2);
    // Original not mutated
    expect(memory.visitedPages).toHaveLength(1);
  });

  it('does not duplicate visitedPages when URL already visited', async () => {
    const { updateTaskMemory } = await import('../src/evaluate-progress.js');
    const memory = makeMemory({ visitedPages: ['https://a.com', 'https://b.com'] });
    const action = makeAction();

    const updated = updateTaskMemory(memory, action, passedVerification(), 'https://a.com', 'https://b.com');

    expect(updated.visitedPages).toHaveLength(2);
  });

  it('resets stepsSinceProgress when URL changes', async () => {
    const { updateTaskMemory } = await import('../src/evaluate-progress.js');
    const memory = makeMemory({
      stuckSignals: {
        repeatedActionCount: 0,
        samePageCount: 5,
        failedExecutionCount: 0,
        stepsSinceProgress: 10,
      },
    });
    const action = makeAction();

    const updated = updateTaskMemory(memory, action, passedVerification(), 'https://a.com', 'https://b.com');

    expect(updated.stuckSignals.stepsSinceProgress).toBe(0);
    expect(updated.stuckSignals.samePageCount).toBe(0);
  });

  it('appends to failedActions when verification fails', async () => {
    const { updateTaskMemory } = await import('../src/evaluate-progress.js');
    const memory = makeMemory({ failedActions: [] });
    const action = makeAction();

    const updated = updateTaskMemory(memory, action, failedVerification(), 'https://a.com', 'https://a.com');

    expect(updated.failedActions).toHaveLength(1);
    expect(updated.failedActions[0]).toEqual(action);
    // Original not mutated
    expect(memory.failedActions).toHaveLength(0);
  });

  it('does not append to failedActions when verification passes', async () => {
    const { updateTaskMemory } = await import('../src/evaluate-progress.js');
    const memory = makeMemory({ failedActions: [] });
    const action = makeAction();

    const updated = updateTaskMemory(memory, action, passedVerification(), 'https://a.com', 'https://a.com');

    expect(updated.failedActions).toHaveLength(0);
  });
});
