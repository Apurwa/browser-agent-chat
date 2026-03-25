import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSession,
  getSessionContext,
  removeSession,
  type SessionContext,
} from '../src/session-registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    session: { agent: {}, connector: {} },
    budget: {
      recordStep: () => {},
      recordReplan: () => {},
      remaining: () => ({ steps: 10, timeMs: 60000 }),
      exhausted: () => false,
      warning: () => false,
      canReplan: () => true,
      snapshot: () => ({
        stepsUsed: 0,
        stepsRemaining: 10,
        replansUsed: 0,
        elapsedMs: 0,
        exhausted: false,
        warning: false,
      }),
    },
    broadcast: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session-registry', () => {
  beforeEach(() => {
    // Clean up any leftover sessions between tests
    try { removeSession('test-1'); } catch { /* ignore */ }
    try { removeSession('test-2'); } catch { /* ignore */ }
  });

  it('registers and retrieves a session context', () => {
    const ctx = makeMockContext();
    registerSession('test-1', ctx);

    const retrieved = getSessionContext('test-1');
    expect(retrieved).toBe(ctx);

    // Clean up
    removeSession('test-1');
  });

  it('throws when getting a non-existent session', () => {
    expect(() => getSessionContext('does-not-exist')).toThrow(
      'Session does-not-exist not found in registry',
    );
  });

  it('removes a session and subsequent get throws', () => {
    const ctx = makeMockContext();
    registerSession('test-1', ctx);

    removeSession('test-1');

    expect(() => getSessionContext('test-1')).toThrow(
      'Session test-1 not found in registry',
    );
  });

  it('removing a non-existent session does not throw', () => {
    expect(() => removeSession('non-existent')).not.toThrow();
  });

  it('overwrites an existing session on re-register', () => {
    const ctx1 = makeMockContext({ session: { id: 'first' } });
    const ctx2 = makeMockContext({ session: { id: 'second' } });

    registerSession('test-1', ctx1);
    registerSession('test-1', ctx2);

    const retrieved = getSessionContext('test-1');
    expect(retrieved).toBe(ctx2);
    expect(retrieved.session).toEqual({ id: 'second' });

    removeSession('test-1');
  });

  it('supports multiple concurrent sessions', () => {
    const ctx1 = makeMockContext({ session: { id: 'a' } });
    const ctx2 = makeMockContext({ session: { id: 'b' } });

    registerSession('test-1', ctx1);
    registerSession('test-2', ctx2);

    expect(getSessionContext('test-1').session).toEqual({ id: 'a' });
    expect(getSessionContext('test-2').session).toEqual({ id: 'b' });

    removeSession('test-1');
    removeSession('test-2');
  });

  it('provides access to budget methods from the context', () => {
    const ctx = makeMockContext();
    registerSession('test-1', ctx);

    const retrieved = getSessionContext('test-1');
    expect(retrieved.budget.exhausted()).toBe(false);
    expect(retrieved.budget.canReplan()).toBe(true);
    expect(retrieved.budget.snapshot().stepsUsed).toBe(0);

    removeSession('test-1');
  });

  it('provides access to broadcast from the context', () => {
    const messages: Record<string, unknown>[] = [];
    const ctx = makeMockContext({
      broadcast: (msg) => { messages.push(msg); },
    });
    registerSession('test-1', ctx);

    const retrieved = getSessionContext('test-1');
    retrieved.broadcast({ type: 'status', status: 'working' });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'status', status: 'working' });

    removeSession('test-1');
  });
});
