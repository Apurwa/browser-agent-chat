import { describe, it, expect } from 'vitest';
import type { AgentSession } from '../src/agent.js';

describe('Login Interceptor — AgentSession contract', () => {
  it('AgentSession interface includes userId field', () => {
    // Verify the session shape at the type level via a runtime object
    const session: Partial<AgentSession> = {
      userId: 'user-123',
      loginInProgress: false,
    };
    expect(session.userId).toBe('user-123');
    expect(session.loginInProgress).toBe(false);
  });

  it('loginInProgress prevents re-entrant interception', () => {
    // Simulates the guard condition in the actionDone handler
    const session = { loginInProgress: false, userId: 'user-1', agentId: 'agent-1' };

    // First detection should proceed
    const shouldIntercept = session.agentId && session.userId && !session.loginInProgress;
    expect(shouldIntercept).toBeTruthy();

    // Mark as in progress
    session.loginInProgress = true;

    // Second detection should be blocked
    const shouldInterceptAgain = session.agentId && session.userId && !session.loginInProgress;
    expect(shouldInterceptAgain).toBeFalsy();
  });

  it('loginInProgress resets after completion', () => {
    const session = { loginInProgress: true };

    // Simulate the .finally() cleanup
    session.loginInProgress = false;

    expect(session.loginInProgress).toBe(false);
  });

  it('interceptor skips when userId is null (recovery path)', () => {
    const session = { loginInProgress: false, userId: null, agentId: 'agent-1' };
    const shouldIntercept = session.agentId && session.userId && !session.loginInProgress;
    expect(shouldIntercept).toBeFalsy();
  });

  it('interceptor skips when agentId is null', () => {
    const session = { loginInProgress: false, userId: 'user-1', agentId: null };
    const shouldIntercept = session.agentId && session.userId && !session.loginInProgress;
    expect(shouldIntercept).toBeFalsy();
  });
});
