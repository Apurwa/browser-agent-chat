import { describe, it, expect } from 'vitest';
import { verifyAction } from '../src/verify-action.js';
import type { AgentAction, ExecutionResult } from '../src/agent-types.js';

const baseAction: AgentAction = {
  type: 'click',
  elementId: 'btn-submit',
  expectedOutcome: 'form submitted',
  intentId: 'intent-1',
};

const baseResult: ExecutionResult = {
  success: true,
};

// ---------------------------------------------------------------------------
// Heuristic: result.success === false
// ---------------------------------------------------------------------------

describe('verifyAction — failure heuristics', () => {
  it('returns passed=false with confidence=1.0 when result.success is false', () => {
    const result: ExecutionResult = { success: false, error: 'Element not found' };
    const verification = verifyAction(baseAction, result, 'https://ex.com/page', 'https://ex.com/page');
    expect(verification.passed).toBe(false);
    expect(verification.confidence).toBe(1.0);
    expect(verification.findings).toHaveLength(1);
    expect(verification.findings[0].severity).toBeTruthy();
  });

  it('returns passed=false when result.error is set (even if success=true)', () => {
    const result: ExecutionResult = { success: true, error: 'Something went wrong' };
    const verification = verifyAction(baseAction, result, 'https://ex.com', 'https://ex.com');
    expect(verification.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Heuristic: URL change
// ---------------------------------------------------------------------------

describe('verifyAction — URL change detection', () => {
  it('boosts confidence to 0.8 when URL changed', () => {
    const result: ExecutionResult = { success: true };
    const verification = verifyAction(
      baseAction,
      result,
      'https://ex.com/login',
      'https://ex.com/dashboard',
    );
    expect(verification.passed).toBe(true);
    expect(verification.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('returns baseline confidence 0.6 when no positive signals', () => {
    const result: ExecutionResult = { success: true };
    const verification = verifyAction(
      baseAction,
      result,
      'https://ex.com/page',
      'https://ex.com/page',
    );
    expect(verification.passed).toBe(true);
    expect(verification.confidence).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------
// Heuristic: data extracted
// ---------------------------------------------------------------------------

describe('verifyAction — data extraction detection', () => {
  it('boosts confidence to 0.8 when result.data is non-empty string', () => {
    const result: ExecutionResult = { success: true, data: 'some page title' };
    const verification = verifyAction(
      baseAction,
      result,
      'https://ex.com/page',
      'https://ex.com/page',
    );
    expect(verification.passed).toBe(true);
    expect(verification.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('boosts confidence when result.data is a non-empty object', () => {
    const result: ExecutionResult = { success: true, data: { name: 'Alice' } };
    const verification = verifyAction(
      baseAction,
      result,
      'https://ex.com/page',
      'https://ex.com/page',
    );
    expect(verification.passed).toBe(true);
    expect(verification.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('does NOT boost confidence when data is null', () => {
    const result: ExecutionResult = { success: true, data: null };
    const verification = verifyAction(
      baseAction,
      result,
      'https://ex.com/page',
      'https://ex.com/page',
    );
    expect(verification.confidence).toBe(0.6);
  });

  it('does NOT boost confidence when data is empty string', () => {
    const result: ExecutionResult = { success: true, data: '' };
    const verification = verifyAction(
      baseAction,
      result,
      'https://ex.com/page',
      'https://ex.com/page',
    );
    expect(verification.confidence).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------
// Both URL change AND data extracted
// ---------------------------------------------------------------------------

describe('verifyAction — combined positive signals', () => {
  it('caps confidence at 0.8 when both URL changed and data extracted', () => {
    const result: ExecutionResult = { success: true, data: 'extracted text' };
    const verification = verifyAction(
      baseAction,
      result,
      'https://ex.com/login',
      'https://ex.com/home',
    );
    expect(verification.passed).toBe(true);
    // Should be exactly 0.8 (not exceed it from the pure heuristic path)
    expect(verification.confidence).toBe(0.8);
  });
});
