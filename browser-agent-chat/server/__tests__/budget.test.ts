import { describe, it, expect } from 'vitest';
import { createBudgetTracker } from '../src/budget.js';

describe('Budget tracker', () => {
  it('starts with full budget', () => {
    const budget = createBudgetTracker({ maxSteps: 50 });
    expect(budget.remaining().steps).toBe(50);
    expect(budget.exhausted()).toBe(false);
  });

  it('decrements steps', () => {
    const budget = createBudgetTracker({ maxSteps: 3 });
    budget.recordStep();
    budget.recordStep();
    expect(budget.remaining().steps).toBe(1);
    expect(budget.exhausted()).toBe(false);
  });

  it('reports exhausted when steps reach 0', () => {
    const budget = createBudgetTracker({ maxSteps: 1 });
    budget.recordStep();
    expect(budget.exhausted()).toBe(true);
  });

  it('reports warning at 80% usage', () => {
    const budget = createBudgetTracker({ maxSteps: 10 });
    for (let i = 0; i < 8; i++) budget.recordStep();
    expect(budget.warning()).toBe(true);
  });

  it('does not warn before 80%', () => {
    const budget = createBudgetTracker({ maxSteps: 10 });
    for (let i = 0; i < 7; i++) budget.recordStep();
    expect(budget.warning()).toBe(false);
  });

  it('tracks replan attempts', () => {
    const budget = createBudgetTracker({ maxReplanAttempts: 3 });
    budget.recordReplan();
    budget.recordReplan();
    expect(budget.canReplan()).toBe(true);
    budget.recordReplan();
    expect(budget.canReplan()).toBe(false);
  });

  it('snapshot returns current state', () => {
    const budget = createBudgetTracker({ maxSteps: 10 });
    budget.recordStep();
    budget.recordStep();
    const snap = budget.snapshot();
    expect(snap.stepsUsed).toBe(2);
    expect(snap.stepsRemaining).toBe(8);
    expect(snap.exhausted).toBe(false);
    expect(snap.warning).toBe(false);
  });

  it('uses defaults when no overrides provided', () => {
    const budget = createBudgetTracker();
    expect(budget.remaining().steps).toBe(50);
    expect(budget.canReplan()).toBe(true);
  });
});
