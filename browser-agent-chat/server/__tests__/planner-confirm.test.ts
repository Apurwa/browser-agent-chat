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
// task type — all completed
// ---------------------------------------------------------------------------

describe('confirmGoalCompletion — task, all completed', () => {
  it('returns achieved=true when all intents are completed', () => {
    const intents = [
      makeIntent('i-1', 'completed', 0.9),
      makeIntent('i-2', 'completed', 0.7),
    ];
    const result = confirmGoalCompletion('Log into dashboard and view reports', intents);
    expect(result.achieved).toBe(true);
    expect(result.remainingWork).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// task type — some failed
// ---------------------------------------------------------------------------

describe('confirmGoalCompletion — task, some failed', () => {
  it('returns achieved=false with remainingWork mentioning failed intents', () => {
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
// task type — some pending
// ---------------------------------------------------------------------------

describe('confirmGoalCompletion — task, some pending', () => {
  it('returns achieved=false with remainingWork mentioning pending intents', () => {
    const intents = [
      makeIntent('i-1', 'completed', 0.9),
      makeIntent('i-2', 'pending', 0.0),
    ];
    const result = confirmGoalCompletion('goal', intents);
    expect(result.achieved).toBe(false);
    expect(result.remainingWork).toContain('i-2');
  });

  it('returns achieved=false when an intent is active', () => {
    const intents = [
      makeIntent('i-1', 'completed', 0.9),
      makeIntent('i-2', 'active', 0.0),
    ];
    const result = confirmGoalCompletion('goal', intents);
    expect(result.achieved).toBe(false);
    expect(result.remainingWork).toContain('i-2');
  });

  it('prioritizes failed over pending in remainingWork message', () => {
    const intents = [
      makeIntent('i-1', 'failed', 0.0),
      makeIntent('i-2', 'pending', 0.0),
    ];
    const result = confirmGoalCompletion('goal', intents);
    expect(result.achieved).toBe(false);
    expect(result.remainingWork).toContain('i-1');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('confirmGoalCompletion — edge cases', () => {
  it('returns achieved=true for empty intents array', () => {
    const result = confirmGoalCompletion('some goal', []);
    expect(result.achieved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// explore type — partial completion allowed
// ---------------------------------------------------------------------------

describe('confirmGoalCompletion — explore type', () => {
  it('returns achieved=true with 1 completed intent and 3 pages visited', () => {
    const intents = [
      makeIntent('i-1', 'completed', 0.8),
      makeIntent('i-2', 'pending', 0.0),
      makeIntent('i-3', 'pending', 0.0),
    ];
    const result = confirmGoalCompletion('explore the app', intents, 'explore', 3);
    expect(result.achieved).toBe(true);
  });

  it('returns achieved=true with 1 completed intent even with 0 pages visited', () => {
    const intents = [
      makeIntent('i-1', 'completed', 0.8),
      makeIntent('i-2', 'pending', 0.0),
    ];
    const result = confirmGoalCompletion('explore the app', intents, 'explore', 0);
    expect(result.achieved).toBe(true);
  });

  it('returns achieved=false when 0 intents completed (explore)', () => {
    const intents = [
      makeIntent('i-1', 'pending', 0.0),
      makeIntent('i-2', 'pending', 0.0),
    ];
    const result = confirmGoalCompletion('explore the app', intents, 'explore', 5);
    expect(result.achieved).toBe(false);
    expect(result.remainingWork).toContain('Explored');
  });

  it('returns achieved=false when only active intents and 0 completed (explore)', () => {
    const intents = [
      makeIntent('i-1', 'active', 0.3),
    ];
    const result = confirmGoalCompletion('explore the app', intents, 'explore', 2);
    expect(result.achieved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// task type with explicit taskType param
// ---------------------------------------------------------------------------

describe('confirmGoalCompletion — explicit task type', () => {
  it('task with all completed → success', () => {
    const intents = [
      makeIntent('i-1', 'completed', 0.9),
      makeIntent('i-2', 'completed', 0.8),
    ];
    const result = confirmGoalCompletion('do task', intents, 'task', 5);
    expect(result.achieved).toBe(true);
  });

  it('task with 1 pending → failure', () => {
    const intents = [
      makeIntent('i-1', 'completed', 0.9),
      makeIntent('i-2', 'pending', 0.0),
    ];
    const result = confirmGoalCompletion('do task', intents, 'task', 3);
    expect(result.achieved).toBe(false);
    expect(result.remainingWork).toContain('Intent i-2');
  });
});
