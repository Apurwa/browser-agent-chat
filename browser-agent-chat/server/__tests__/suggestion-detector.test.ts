import { describe, it, expect } from 'vitest';
import { parseMemoryUpdates, transformFlowData } from '../src/suggestion-detector.js';

describe('parseMemoryUpdates', () => {
  it('parses create_feature action', () => {
    const text = 'MEMORY_JSON:{"action":"create_feature","data":{"name":"Login","description":"Auth","criticality":"high","expected_behaviors":["validates email"]}}';
    const updates = parseMemoryUpdates(text);
    expect(updates).toHaveLength(1);
    expect(updates[0].type).toBe('feature');
    expect(updates[0].data.name).toBe('Login');
  });

  it('parses create_flow and transforms string steps/checkpoints', () => {
    const text = 'MEMORY_JSON:{"action":"create_flow","data":{"feature_name":"Login","name":"Happy Path","steps":["Go to login","Enter email","Click submit"],"checkpoints":["Dashboard loads"],"criticality":"high"}}';
    const updates = parseMemoryUpdates(text);
    expect(updates).toHaveLength(1);
    expect(updates[0].type).toBe('flow');
    expect(updates[0].data.steps).toEqual([
      { order: 1, description: 'Go to login' },
      { order: 2, description: 'Enter email' },
      { order: 3, description: 'Click submit' },
    ]);
    expect(updates[0].data.checkpoints).toEqual([
      { description: 'Dashboard loads', expected: 'Dashboard loads' },
    ]);
  });

  it('parses add_behavior action', () => {
    const text = 'MEMORY_JSON:{"action":"add_behavior","data":{"feature_name":"Login","behavior":"Shows forgot password link"}}';
    const updates = parseMemoryUpdates(text);
    expect(updates).toHaveLength(1);
    expect(updates[0].type).toBe('behavior');
  });

  it('skips unknown actions', () => {
    expect(parseMemoryUpdates('MEMORY_JSON:{"action":"unknown","data":{}}')).toHaveLength(0);
  });

  it('skips malformed JSON', () => {
    expect(parseMemoryUpdates('MEMORY_JSON:{broken')).toHaveLength(0);
  });

  it('handles multiple actions', () => {
    const text = `MEMORY_JSON:{"action":"create_feature","data":{"name":"A","description":"","criticality":"medium","expected_behaviors":[]}} then MEMORY_JSON:{"action":"add_behavior","data":{"feature_name":"A","behavior":"b"}}`;
    expect(parseMemoryUpdates(text)).toHaveLength(2);
  });
});

describe('transformFlowData', () => {
  it('transforms string arrays to structured objects', () => {
    const result = transformFlowData(['Step 1', 'Step 2'], ['Check 1']);
    expect(result.steps).toEqual([{ order: 1, description: 'Step 1' }, { order: 2, description: 'Step 2' }]);
    expect(result.checkpoints).toEqual([{ description: 'Check 1', expected: 'Check 1' }]);
  });

  it('passes through already-structured objects', () => {
    const steps = [{ order: 1, description: 'Step 1' }];
    const checkpoints = [{ description: 'Check', expected: 'Pass' }];
    const result = transformFlowData(steps as any, checkpoints as any);
    expect(result.steps).toEqual(steps);
    expect(result.checkpoints).toEqual(checkpoints);
  });
});
