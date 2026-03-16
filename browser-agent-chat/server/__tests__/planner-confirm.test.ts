import { describe, it, expect } from 'vitest';
import { confirmGoalCompletion } from '../src/planner-confirm.js';
import type { Intent } from '../src/agent-types.js';

function makeIntent(id: string, status: Intent['status'], confidence: number = 0.8): Intent {
  return {
    id,
    description: `Intent ${id}`,
    successCriteria: `${id} done`,
    status,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// All completed
// ---------------------------------------------------------------------------

describe('confirmGoalCompletion — all completed', () => {
  it('returns achieved=true when all intents are completed with confidence >= 0.6', () => {
    const intents = [
      makeIntent('i-1', 'completed', 0.9),
      makeIntent('i-2', 'completed', 0.7),
    ];
    const result = confirmGoalCompletion('Log into dashboard and view reports', intents);
    expect(result.achieved).toBe(true);
    expect(result.remainingWork).toBeUndefined();
  });

  it('returns achieved=false when all intents are completed but one has low confidence', () => {
    const intents = [
      makeIntent('i-1', 'completed', 0.9),
      makeIntent('i-2', 'completed', 0.5), // below 0.6 threshold
    ];
    const result = confirmGoalCompletion('goal', intents);
    expect(result.achieved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Some failed
// ---------------------------------------------------------------------------

describe('confirmGoalCompletion — some failed', () => {
  it('returns achieved=false with remainingWork mentioning the failed intent', () => {
    const intents = [
      makeIntent('i-1', 'completed', 0.8),
      makeIntent('i-2', 'failed', 0.0),
    ];
    const result = confirmGoalCompletion('goal', intents);
    expect(result.achieved).toBe(false);
    expect(result.remainingWork).toContain('i-2');
  });
});

// ---------------------------------------------------------------------------
// Some pending
// ---------------------------------------------------------------------------

describe('confirmGoalCompletion — some pending', () => {
  it('returns achieved=false with remainingWork mentioning the pending intent', () => {
    const intents = [
      makeIntent('i-1', 'completed', 0.9),
      makeIntent('i-2', 'pending', 0.0),
    ];
    const result = confirmGoalCompletion('goal', intents);
    expect(result.achieved).toBe(false);
    expect(result.remainingWork).toContain('i-2');
  });
});

// ---------------------------------------------------------------------------
// Empty intents
// ---------------------------------------------------------------------------

describe('confirmGoalCompletion — edge cases', () => {
  it('returns achieved=true for empty intents array', () => {
    const result = confirmGoalCompletion('some goal', []);
    expect(result.achieved).toBe(true);
  });

  it('prioritizes failed over pending in remainingWork message', () => {
    const intents = [
      makeIntent('i-1', 'failed', 0.0),
      makeIntent('i-2', 'pending', 0.0),
    ];
    const result = confirmGoalCompletion('goal', intents);
    expect(result.achieved).toBe(false);
    // Failed should appear in message
    expect(result.remainingWork).toContain('i-1');
  });
});
