import { WebSocket } from 'ws';
import * as redisStore from './redisStore.js';
import * as browserManager from './browserManager.js';
import { createAgent } from './agent.js';
import { endSession as dbEndSession, getMessagesBySession } from './db.js';
import type { AgentSession } from './agent.js';
import type { ServerMessage, ChatMessage, RedisSession } from './types.js';

// -- Local state (thin cache, NOT source of truth — Redis is) --

const agents = new Map<string, AgentSession>();
const wsClients = new Map<string, Set<WebSocket>>();

// -- WebSocket client management --

export function getAgent(projectId: string): AgentSession | undefined {
  return agents.get(projectId);
}

export function addClient(projectId: string, ws: WebSocket): void {
  let clients = wsClients.get(projectId);
  if (!clients) {
    clients = new Set();
    wsClients.set(projectId, clients);
  }
  clients.add(ws);
  redisStore.refreshTTL(projectId).catch(() => {});
}

export function removeClient(projectId: string, ws: WebSocket): void {
  const clients = wsClients.get(projectId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) wsClients.delete(projectId);
}

export function broadcastToClients(projectId: string, msg: ServerMessage): void {
  const clients = wsClients.get(projectId);
  if (!clients) return;
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// -- ServerMessage → ChatMessage conversion --

function serverMsgToChatMessage(msg: ServerMessage): ChatMessage | null {
  const id = crypto.randomUUID();
  const ts = Date.now();
  switch (msg.type) {
    case 'thought':
      return { id, type: 'agent', content: msg.content, timestamp: ts };
    case 'action': {
      const text = `Action: ${msg.action}${msg.target ? ` → ${msg.target}` : ''}`;
      return { id, type: 'agent', content: text, timestamp: ts };
    }
    case 'error':
      return { id, type: 'system', content: `Error: ${msg.message}`, timestamp: ts };
    case 'taskComplete':
      return { id, type: 'system', content: msg.success ? 'Task completed.' : 'Task failed.', timestamp: ts };
    case 'finding':
      return { id, type: 'finding', content: msg.finding.title, timestamp: ts };
    case 'suggestion': {
      const s = msg.suggestion;
      const label = s.type === 'feature' ? 'feature' : s.type === 'flow' ? 'flow' : 'behavior';
      const name = 'name' in s.data ? (s.data as any).name : (s.data as any).feature_name;
      return { id, type: 'system', content: `Learned: "${name}" ${label}`, timestamp: ts };
    }
    default:
      return null;
  }
}

// -- Broadcast with Redis write-through --

export function makeBroadcast(projectId: string): (msg: ServerMessage) => void {
  return (msg: ServerMessage) => {
    // Write-through to Redis
    if (msg.type === 'screenshot') {
      redisStore.setScreenshot(projectId, msg.data).catch(() => {});
    } else if (msg.type === 'nav') {
      redisStore.setSession(projectId, { currentUrl: msg.url }).catch(() => {});
    } else if (msg.type === 'status') {
      const statusMap: Record<string, RedisSession['status']> = {
        idle: 'idle', working: 'working', error: 'idle', disconnected: 'disconnected',
      };
      redisStore.setSession(projectId, {
        status: statusMap[msg.status] || 'idle',
      }).catch(() => {});
    }

    // Store chat messages
    const chatMsg = serverMsgToChatMessage(msg);
    if (chatMsg) {
      redisStore.pushMessage(projectId, chatMsg).catch(() => {});
    }

    // Forward to WebSocket clients
    broadcastToClients(projectId, msg);
  };
}

// -- Create session --

export async function createSession(
  projectId: string,
  url: string,
  dbSessionId: string | null,
): Promise<AgentSession> {
  // Claim warm browser or launch new
  let browser = await browserManager.claimWarm(projectId);
  if (!browser) {
    browser = await browserManager.launchBrowser(projectId);
  }

  const broadcastFn = makeBroadcast(projectId);

  // Create agent via CDP
  const agentSession = await createAgent(
    broadcastFn, browser.cdpEndpoint, dbSessionId, projectId, url
  );

  // Write session to Redis
  await redisStore.setSession(projectId, {
    dbSessionId: dbSessionId || '',
    status: 'idle',
    cdpPort: browser.port,
    cdpEndpoint: browser.cdpEndpoint,
    currentUrl: url,
    memoryContext: agentSession.memoryContext,
    browserPid: browser.pid,
    lastTask: '',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });

  agents.set(projectId, agentSession);
  return agentSession;
}

// -- Destroy session --

export async function destroySession(projectId: string): Promise<void> {
  const session = await redisStore.getSession(projectId);

  // Remove from local maps
  const agentSession = agents.get(projectId);
  agents.delete(projectId);

  // Notify connected clients
  broadcastToClients(projectId, { type: 'status', status: 'disconnected' });
  wsClients.delete(projectId);

  // Close agent (drops event listeners only, does NOT close browser context)
  if (agentSession) {
    await agentSession.close().catch(err =>
      console.error(`[SessionManager] Error closing agent for ${projectId}:`, err)
    );
  }

  if (session) {
    // Kill browser process
    await browserManager.killBrowser(session.browserPid, session.cdpPort);
    // End DB session
    if (session.dbSessionId) await dbEndSession(session.dbSessionId);
    // Remove from Redis
    await redisStore.deleteSession(projectId);
  }
}

// -- Recover session (on server restart) --

export async function recoverSession(projectId: string): Promise<boolean> {
  const redis = redisStore.getRedis();
  const serverId = String(process.pid);

  // Distributed lock
  const locked = await redis.set(`session:lock:${projectId}`, serverId, 'EX', 30, 'NX');
  if (!locked) return false;

  try {
    const session = await redisStore.getSession(projectId);
    if (!session) return false;

    const alive = await browserManager.isAlive(session.browserPid, session.cdpPort);

    if (alive) {
      const broadcastFn = makeBroadcast(projectId);

      // Connect agent to existing browser — NO url (keep current page)
      const agentSession = await createAgent(
        broadcastFn, session.cdpEndpoint, session.dbSessionId, projectId, undefined
      );
      agents.set(projectId, agentSession);

      // Update status based on what was happening before crash
      if (session.status === 'working') {
        await redisStore.setSession(projectId, { status: 'interrupted' });
      } else {
        await redisStore.setSession(projectId, { status: 'idle' });
      }

      console.log(`[RECOVERY] Session ${projectId} recovered`);
      return true;
    } else {
      // Browser is dead
      await redisStore.setSession(projectId, { status: 'crashed' });
      await redisStore.freePort(session.cdpPort);
      console.log(`[RECOVERY] Session ${projectId} browser crashed`);
      return false;
    }
  } finally {
    await redis.del(`session:lock:${projectId}`);
  }
}

export async function recoverAllSessions(): Promise<void> {
  const projectIds = await redisStore.listSessions();
  if (projectIds.length === 0) return;

  console.log(`[RECOVERY] Recovering ${projectIds.length} session(s)...`);
  const results: PromiseSettledResult<boolean>[] = [];

  for (let i = 0; i < projectIds.length; i += 5) {
    const batch = projectIds.slice(i, i + 5);
    results.push(...await Promise.allSettled(
      batch.map(pid => recoverSession(pid))
    ));
  }

  const recovered = results.filter(r => r.status === 'fulfilled' && r.value).length;
  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)).length;
  console.log(`[RECOVERY] ${recovered} recovered, ${failed} failed of ${projectIds.length} total`);
}

// -- Send snapshot to reconnecting client --

export async function sendSnapshot(projectId: string, ws: WebSocket): Promise<void> {
  const session = await redisStore.getSession(projectId);
  if (!session) return;

  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // Status
  send({ type: 'status', status: session.status as any });

  // Current URL
  if (session.currentUrl) {
    send({ type: 'nav', url: session.currentUrl });
  }

  // Screenshot (separate Redis key)
  const screenshot = await redisStore.getScreenshot(projectId);
  if (screenshot) {
    send({ type: 'screenshot', data: screenshot });
  }

  // Messages — Redis first, fall back to Supabase
  let messages = await redisStore.getMessages(projectId);
  if (messages.length === 0 && session.dbSessionId) {
    messages = await getMessagesBySession(session.dbSessionId);
  }
  if (messages.length > 0) {
    send({ type: 'sessionRestore', messages });
  }

  // Interrupted task notification
  if (session.status === 'interrupted' && session.lastTask) {
    send({ type: 'taskInterrupted', task: session.lastTask });
  }

  // Crashed notification
  if (session.status === 'crashed') {
    send({ type: 'sessionCrashed' });
  }
}

// -- Check session exists --

export async function hasSession(projectId: string): Promise<boolean> {
  const session = await redisStore.getSession(projectId);
  return session !== null;
}

export async function listActiveSessions(): Promise<string[]> {
  return redisStore.listSessions();
}

// -- Handle expiry (called by polling loop) --

export async function handleExpiry(projectId: string): Promise<void> {
  console.log(`[SessionManager] Session ${projectId} expired, destroying...`);
  await destroySession(projectId);
}

// -- Graceful shutdown --

export async function shutdownAll(): Promise<void> {
  // Mark all sessions as disconnected in Redis (browsers survive)
  const projectIds = Array.from(agents.keys());
  for (const projectId of projectIds) {
    await redisStore.setSession(projectId, { status: 'disconnected' }).catch(() => {});
    broadcastToClients(projectId, { type: 'status', status: 'disconnected' });
  }
  agents.clear();
  wsClients.clear();
}
