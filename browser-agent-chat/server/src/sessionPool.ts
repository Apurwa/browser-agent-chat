import { WebSocket } from 'ws';
import type { AgentSession } from './agent.js';
import type { ServerMessage, ChatMessage } from './types.js';
import { endSession } from './db.js';

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface PooledSession {
  agentSession: AgentSession;
  projectId: string;
  dbSessionId: string | null;
  clients: Set<WebSocket>;
  status: 'idle' | 'working' | 'error';
  lastScreenshot: string | null;
  currentUrl: string | null;
  messages: ChatMessage[];
  idleTimeout: ReturnType<typeof setTimeout> | null;
  createdAt: number;
  lastActivityAt: number;
}

// Key: projectId (one active session per project)
const pool = new Map<string, PooledSession>();

export function getSession(projectId: string): PooledSession | undefined {
  return pool.get(projectId);
}

export function hasSession(projectId: string): boolean {
  return pool.has(projectId);
}

export function registerSession(
  projectId: string,
  agentSession: AgentSession,
  dbSessionId: string | null,
): PooledSession {
  const session: PooledSession = {
    agentSession,
    projectId,
    dbSessionId,
    clients: new Set(),
    status: 'idle',
    lastScreenshot: null,
    currentUrl: null,
    messages: [],
    idleTimeout: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  pool.set(projectId, session);
  return session;
}

export function addClient(session: PooledSession, ws: WebSocket): void {
  session.clients.add(ws);
  clearIdleTimeout(session);
  session.lastActivityAt = Date.now();
}

export function removeClient(session: PooledSession, ws: WebSocket): void {
  session.clients.delete(ws);
  session.lastActivityAt = Date.now();

  // If no clients remain, start idle timeout
  if (session.clients.size === 0) {
    startIdleTimeout(session);
  }
}

export function broadcast(session: PooledSession, msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const client of session.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

export function updateStatus(session: PooledSession, status: PooledSession['status']): void {
  session.status = status;
}

export function updateScreenshot(session: PooledSession, base64: string): void {
  session.lastScreenshot = base64;
}

export function updateUrl(session: PooledSession, url: string): void {
  session.currentUrl = url;
}

export function addMessage(session: PooledSession, msg: ChatMessage): void {
  session.messages.push(msg);
  // Keep last 200 messages to prevent unbounded growth
  if (session.messages.length > 200) {
    session.messages = session.messages.slice(-200);
  }
}

/** Send full state snapshot to a single client (on reconnect) */
export function sendSnapshot(session: PooledSession, ws: WebSocket): void {
  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  // Send current status
  send({ type: 'status', status: session.status });

  // Send current URL
  if (session.currentUrl) {
    send({ type: 'nav', url: session.currentUrl });
  }

  // Send latest screenshot
  if (session.lastScreenshot) {
    send({ type: 'screenshot', data: session.lastScreenshot });
  }

  // Send message history
  send({
    type: 'sessionRestore',
    messages: session.messages,
  } as any); // We'll add this type
}

function startIdleTimeout(session: PooledSession): void {
  clearIdleTimeout(session);
  const timeoutMs = parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || '', 10) || DEFAULT_IDLE_TIMEOUT_MS;

  session.idleTimeout = setTimeout(async () => {
    console.log(`Session for project ${session.projectId} timed out after idle period`);
    await destroySession(session.projectId);
  }, timeoutMs);
}

function clearIdleTimeout(session: PooledSession): void {
  if (session.idleTimeout) {
    clearTimeout(session.idleTimeout);
    session.idleTimeout = null;
  }
}

export async function destroySession(projectId: string): Promise<void> {
  const session = pool.get(projectId);
  if (!session) return;

  // Remove from pool FIRST (synchronous) so a racing 'start' won't find it
  pool.delete(projectId);
  clearIdleTimeout(session);

  // Notify remaining clients before cleanup
  broadcast(session, { type: 'status', status: 'disconnected' });
  session.clients.clear();

  // Async cleanup (DB + agent close) — safe to run after pool removal
  if (session.dbSessionId) {
    await endSession(session.dbSessionId);
  }
  try {
    await session.agentSession.close();
  } catch (err) {
    console.error(`Failed to close agent for project ${projectId}:`, err);
  }
}

export function listActiveSessions(): string[] {
  return Array.from(pool.keys());
}
