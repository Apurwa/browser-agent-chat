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

export function getAgent(agentId: string): AgentSession | undefined {
  return agents.get(agentId);
}

export function addClient(agentId: string, ws: WebSocket): void {
  let clients = wsClients.get(agentId);
  if (!clients) {
    clients = new Set();
    wsClients.set(agentId, clients);
  }
  clients.add(ws);
  redisStore.refreshTTL(agentId).catch(() => {});
}

export function removeClient(agentId: string, ws: WebSocket): void {
  const clients = wsClients.get(agentId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) wsClients.delete(agentId);
}

export function broadcastToClients(agentId: string, msg: ServerMessage): void {
  const clients = wsClients.get(agentId);
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

export function makeBroadcast(agentId: string): (msg: ServerMessage) => void {
  return (msg: ServerMessage) => {
    // Write-through to Redis
    if (msg.type === 'screenshot') {
      redisStore.setScreenshot(agentId, msg.data).catch(() => {});
    } else if (msg.type === 'nav') {
      redisStore.setSession(agentId, { currentUrl: msg.url }).catch(() => {});
    } else if (msg.type === 'status') {
      const statusMap: Record<string, RedisSession['status']> = {
        idle: 'idle', working: 'working', error: 'idle', disconnected: 'disconnected',
      };
      redisStore.setSession(agentId, {
        status: statusMap[msg.status] || 'idle',
      }).catch(() => {});
    }

    // Store chat messages
    const chatMsg = serverMsgToChatMessage(msg);
    if (chatMsg) {
      redisStore.pushMessage(agentId, chatMsg).catch(() => {});
    }

    // Forward to WebSocket clients
    broadcastToClients(agentId, msg);
  };
}

// -- Create session --

export async function createSession(
  agentId: string,
  url: string,
  dbSessionId: string | null,
): Promise<AgentSession> {
  // Claim warm browser or launch new
  let browser = await browserManager.claimWarm(agentId);
  if (!browser) {
    browser = await browserManager.launchBrowser(agentId);
  }

  const broadcastFn = makeBroadcast(agentId);

  // Create agent via CDP
  const agentSession = await createAgent(
    broadcastFn, browser.cdpEndpoint, dbSessionId, agentId, url
  );

  // Write session to Redis
  await redisStore.setSession(agentId, {
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

  agents.set(agentId, agentSession);
  return agentSession;
}

// -- Destroy session --

export async function destroySession(agentId: string): Promise<void> {
  const session = await redisStore.getSession(agentId);

  // Remove from local maps
  const agentSession = agents.get(agentId);
  agents.delete(agentId);

  // Notify connected clients
  broadcastToClients(agentId, { type: 'status', status: 'disconnected' });
  wsClients.delete(agentId);

  // Close agent (drops event listeners only, does NOT close browser context)
  if (agentSession) {
    await agentSession.close().catch(err =>
      console.error(`[SessionManager] Error closing agent for ${agentId}:`, err)
    );
  }

  if (session) {
    // Kill browser process
    await browserManager.killBrowser(session.browserPid, session.cdpPort);
    // End DB session
    if (session.dbSessionId) await dbEndSession(session.dbSessionId);
    // Remove from Redis
    await redisStore.deleteSession(agentId);
  }
}

// -- Recover session (on server restart) --

export async function recoverSession(agentId: string): Promise<boolean> {
  const redis = redisStore.getRedis();
  const serverId = String(process.pid);

  // Distributed lock
  const locked = await redis.set(`session:lock:${agentId}`, serverId, 'EX', 30, 'NX');
  if (!locked) return false;

  try {
    const session = await redisStore.getSession(agentId);
    if (!session) return false;

    const alive = await browserManager.isAlive(session.browserPid, session.cdpPort);

    if (alive) {
      try {
        const broadcastFn = makeBroadcast(agentId);

        // Connect agent to existing browser — NO url (keep current page)
        const agentSession = await createAgent(
          broadcastFn, session.cdpEndpoint, session.dbSessionId, agentId, undefined
        );
        agents.set(agentId, agentSession);

        // Update status based on what was happening before crash
        if (session.status === 'working') {
          await redisStore.setSession(agentId, { status: 'interrupted' });
        } else {
          await redisStore.setSession(agentId, { status: 'idle' });
        }

        console.log(`[RECOVERY] Session ${agentId} recovered`);
        return true;
      } catch (err) {
        console.error(`[RECOVERY] Agent creation failed for ${agentId}:`, err);
        await redisStore.setSession(agentId, { status: 'crashed' });
        return false;
      }
    } else {
      // Browser is dead
      await redisStore.setSession(agentId, { status: 'crashed' });
      await redisStore.freePort(session.cdpPort);
      console.log(`[RECOVERY] Session ${agentId} browser crashed`);
      return false;
    }
  } finally {
    await redis.del(`session:lock:${agentId}`);
  }
}

export async function recoverAllSessions(): Promise<void> {
  const agentIds = await redisStore.listSessions();
  if (agentIds.length === 0) return;

  console.log(`[RECOVERY] Recovering ${agentIds.length} session(s)...`);
  const results: PromiseSettledResult<boolean>[] = [];

  for (let i = 0; i < agentIds.length; i += 5) {
    const batch = agentIds.slice(i, i + 5);
    results.push(...await Promise.allSettled(
      batch.map(pid => recoverSession(pid))
    ));
  }

  const recovered = results.filter(r => r.status === 'fulfilled' && r.value).length;
  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)).length;
  console.log(`[RECOVERY] ${recovered} recovered, ${failed} failed of ${agentIds.length} total`);
}

// -- Send snapshot to reconnecting client --

export async function sendSnapshot(agentId: string, ws: WebSocket): Promise<void> {
  const session = await redisStore.getSession(agentId);
  if (!session) return;

  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // Status
  send({ type: 'status', status: session.status });

  // Current URL
  if (session.currentUrl) {
    send({ type: 'nav', url: session.currentUrl });
  }

  // Screenshot (separate Redis key)
  const screenshot = await redisStore.getScreenshot(agentId);
  if (screenshot) {
    send({ type: 'screenshot', data: screenshot });
  }

  // Messages — Redis first, fall back to Supabase
  let messages = await redisStore.getMessages(agentId);
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

export async function hasSession(agentId: string): Promise<boolean> {
  const session = await redisStore.getSession(agentId);
  return session !== null;
}

export async function listActiveSessions(): Promise<string[]> {
  return redisStore.listSessions();
}

// -- Handle expiry (called by polling loop) --

export async function handleExpiry(agentId: string): Promise<void> {
  console.log(`[SessionManager] Session ${agentId} expired, destroying...`);
  await destroySession(agentId);
}

// -- Graceful shutdown --

export async function shutdownAll(): Promise<void> {
  // Mark all sessions as disconnected in Redis (browsers survive)
  const agentIds = Array.from(agents.keys());
  for (const agentId of agentIds) {
    await redisStore.setSession(agentId, { status: 'disconnected' }).catch(() => {});
    broadcastToClients(agentId, { type: 'status', status: 'disconnected' });
  }
  agents.clear();
  wsClients.clear();
}
