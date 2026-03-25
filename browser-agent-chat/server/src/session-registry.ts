import type { BudgetTracker } from './budget.js';

// ---------------------------------------------------------------------------
// Session Registry
//
// Stores live objects (AgentSession, BudgetTracker, broadcast function) keyed
// by sessionId. Mastra workflow steps look up live objects from here since they
// cannot be serialized into Zod schemas.
// ---------------------------------------------------------------------------

export interface SessionContext {
  session: any; // AgentSession — typed loosely to avoid circular imports
  budget: BudgetTracker;
  broadcast: (msg: Record<string, unknown>) => void;
}

const sessions = new Map<string, SessionContext>();

export function registerSession(sessionId: string, ctx: SessionContext): void {
  sessions.set(sessionId, ctx);
}

export function getSessionContext(sessionId: string): SessionContext {
  const ctx = sessions.get(sessionId);
  if (!ctx) throw new Error(`Session ${sessionId} not found in registry`);
  return ctx;
}

export function removeSession(sessionId: string): void {
  sessions.delete(sessionId);
}
