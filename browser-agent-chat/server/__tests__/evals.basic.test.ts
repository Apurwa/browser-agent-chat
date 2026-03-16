import { describe, it, expect } from 'vitest';
import { evalTaskCompletion } from '../src/mastra/evals/task-completion.js';
import { evalBudgetEfficiency } from '../src/mastra/evals/budget-efficiency.js';
import type { Intent } from '../src/agent-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntent(
  id: string,
  status: Intent['status'],
  confidence = 0.8,
): Intent {
  return {
    id,
    description: `Intent ${id}`,
    successCriteria: `Criteria for ${id}`,
    status,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// evalTaskCompletion
// ---------------------------------------------------------------------------

describe('evalTaskCompletion', () => {
  it('returns score=0 when no intents are completed', () => {
    const intents = [makeIntent('i1', 'pending'), makeIntent('i2', 'active')];
    const { score, details } = evalTaskCompletion(intents);
    expect(score).toBe(0);
    expect(details).toBe('0/2 intents completed');
  });

  it('returns score=1 when all intents are completed', () => {
    const intents = [makeIntent('i1', 'completed'), makeIntent('i2', 'completed')];
    const { score, details } = evalTaskCompletion(intents);
    expect(score).toBe(1);
    expect(details).toBe('2/2 intents completed');
  });

  it('returns correct partial score', () => {
    const intents = [
      makeIntent('i1', 'completed'),
      makeIntent('i2', 'pending'),
      makeIntent('i3', 'completed'),
      makeIntent('i4', 'failed'),
    ];
    const { score, details } = evalTaskCompletion(intents);
    expect(score).toBeCloseTo(2 / 4);
    expect(details).toBe('2/4 intents completed');
  });

  it('returns score=0 for empty intents array', () => {
    const { score, details } = evalTaskCompletion([]);
    expect(score).toBe(0);
    expect(details).toBe('0/0 intents completed');
  });

  it('returns score=1 for single completed intent', () => {
    const { score } = evalTaskCompletion([makeIntent('i1', 'completed')]);
    expect(score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// evalBudgetEfficiency
// ---------------------------------------------------------------------------

describe('evalBudgetEfficiency', () => {
  it('returns score=0 when zero steps used', () => {
    const { score, details } = evalBudgetEfficiency(0, 3);
    expect(score).toBe(0);
    expect(details).toBe('3 intents in 0 steps');
  });

  it('returns correct ratio for standard case', () => {
    const { score, details } = evalBudgetEfficiency(10, 5);
    expect(score).toBeCloseTo(0.5);
    expect(details).toBe('5 intents in 10 steps');
  });

  it('returns ratio > 1 when intents exceed steps', () => {
    // Unusual but valid: batch operations could complete multiple intents per step
    const { score } = evalBudgetEfficiency(2, 5);
    expect(score).toBeCloseTo(2.5);
  });

  it('returns score=0 when no intents completed', () => {
    const { score, details } = evalBudgetEfficiency(15, 0);
    expect(score).toBe(0);
    expect(details).toBe('0 intents in 15 steps');
  });

  it('returns score=1 for 1 intent in 1 step', () => {
    const { score } = evalBudgetEfficiency(1, 1);
    expect(score).toBe(1);
  });
});
