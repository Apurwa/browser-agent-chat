import { WebSocket } from 'ws';
import * as redisStore from './redisStore.js';
import * as browserManager from './browserManager.js';
import { createAgent } from './agent.js';
import { endSession as dbEndSession, getMessagesBySession, getAgent as dbGetAgent } from './db.js';
import type { AgentSession } from './agent.js';
import type { ServerMessage, ChatMessage, RedisSession } from './types.js';

// -- Configuration --

const MAX_CONCURRENT_BROWSERS = parseInt(process.env.MAX_CONCURRENT_BROWSERS || '3', 10);
const DETACHED_TIMEOUT_SECONDS = parseInt(process.env.DETACHED_TIMEOUT_SECONDS || '120', 10);
const ABSOLUTE_TIMEOUT_SECONDS = parseInt(process.env.ABSOLUTE_TIMEOUT_SECONDS || '1800', 10);

// -- Session lifecycle limits --

const MAX_TASKS = () => parseInt(process.env.MAX_TASKS_PER_SESSION || '20', 10);
const MAX_NAVIGATIONS = () => parseInt(process.env.MAX_NAVIGATIONS_PER_SESSION || '50', 10);

// -- Local state (thin cache, NOT source of truth — Redis is) --

const agents = new Map<string, AgentSession>();
const wsClients = new Map<string, Set<WebSocket>>();
const detachedTimers = new Map<string, ReturnType<typeof setTimeout>>();
const absoluteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const warningTimers = new Map<string, ReturnType<typeof setTimeout>>();

// -- Before-evict hook (for activeTasks cleanup) --

let onBeforeEvict: ((agentId: string) => Promise<void>) | null = null;

export function setBeforeEvictHook(hook: (agentId: string) => Promise<void>) {
  onBeforeEvict = hook;
}

export async function callBeforeEvictHook(agentId: string): Promise<void> {
  if (onBeforeEvict) await onBeforeEvict(agentId);
}

/** @internal — test-only: clear in-memory maps without side effects */
export function _resetLocalState(): void {
  agents.clear();
  wsClients.clear();
  onBeforeEvict = null;
  capacityLock = Promise.resolve();
  // Clear all timers
  for (const t of detachedTimers.values()) clearTimeout(t);
  detachedTimers.clear();
  for (const t of absoluteTimers.values()) clearTimeout(t);
  absoluteTimers.clear();
  for (const t of warningTimers.values()) clearTimeout(t);
  warningTimers.clear();
}

// -- Detached & absolute timeout helpers --

function startDetachedTimer(agentId: string): void {
  // Store detachedAt in Redis for crash recovery
  redisStore.setSession(agentId, { detachedAt: Date.now() } as Partial<RedisSession>).catch(() => {});

  const timer = setTimeout(async () => {
    detachedTimers.delete(agentId);
    if (onBeforeEvict) await onBeforeEvict(agentId);
    await reap(agentId);
  }, DETACHED_TIMEOUT_SECONDS * 1000);

  detachedTimers.set(agentId, timer);
}

function startAbsoluteTimeout(agentId: string): void {
  // Warning at 5 minutes before expiry
  const warningMs = (ABSOLUTE_TIMEOUT_SECONDS - 300) * 1000;
  if (warningMs > 0) {
    const warnTimer = setTimeout(() => {
      warningTimers.delete(agentId);
      broadcastToClients(agentId, {
        type: 'session_expiring',
        remainingSeconds: 300,
      });
    }, warningMs);
    warningTimers.set(agentId, warnTimer);
  }

  // Destroy at absolute timeout
  const absTimer = setTimeout(async () => {
    absoluteTimers.delete(agentId);
    warningTimers.delete(agentId);
    if (onBeforeEvict) await onBeforeEvict(agentId);
    await reap(agentId);
  }, ABSOLUTE_TIMEOUT_SECONDS * 1000);

  absoluteTimers.set(agentId, absTimer);
}

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

  // Cancel detached timer if reconnecting
  const timer = detachedTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    detachedTimers.delete(agentId);
    redisStore.setSession(agentId, { detachedAt: 0 } as Partial<RedisSession>).catch(() => {});
  }
}

export function removeClient(agentId: string, ws: WebSocket): void {
  const clients = wsClients.get(agentId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) {
    wsClients.delete(agentId);
    // Only start detached timer if the agent still exists (not already destroyed)
    if (agents.has(agentId)) {
      startDetachedTimer(agentId);
    }
  }
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

// Optional broadcast listener — called for every broadcast event
let broadcastListener: ((agentId: string, msg: ServerMessage) => void) | null = null;
export function onBroadcast(listener: (agentId: string, msg: ServerMessage) => void): void {
  broadcastListener = listener;
}

export function makeBroadcast(agentId: string): (msg: ServerMessage) => void {
  return (msg: ServerMessage) => {
    broadcastListener?.(agentId, msg);
    // Write-through to Redis
    if (msg.type === 'screenshot') {
      redisStore.setScreenshot(agentId, msg.data).catch(() => {});
    } else if (msg.type === 'nav') {
      redisStore.setSession(agentId, { currentUrl: msg.url }).catch(() => {});
      redisStore.incrementNavCount(agentId).catch(() => {});
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
  userId: string | null = null,
): Promise<AgentSession> {
  // Claim warm browser or launch new.
  // With kill-and-replace, warm browsers always start on about:blank,
  // so no pre-navigation CDP hack is needed.
  let browser = await browserManager.claimWarm(agentId);
  if (!browser) {
    browser = await browserManager.launchBrowser(agentId);
  }

  const broadcastFn = makeBroadcast(agentId);

  // Create agent via CDP
  const agentSession = await createAgent(
    broadcastFn, browser.cdpEndpoint, dbSessionId, agentId, url, userId
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
    detachedAt: 0,
    taskCount: 0,
    navigationCount: 0,
    healthStatus: 'healthy',
  });

  agents.set(agentId, agentSession);
  startAbsoluteTimeout(agentId);
  return agentSession;
}

// -- Unified cleanup (single exit path for all teardown) --

export async function reap(agentId: string): Promise<void> {
  // 1. Clear all local timers
  const detTimer = detachedTimers.get(agentId);
  if (detTimer) { clearTimeout(detTimer); detachedTimers.delete(agentId); }
  const absTimer = absoluteTimers.get(agentId);
  if (absTimer) { clearTimeout(absTimer); absoluteTimers.delete(agentId); }
  const warnTimer = warningTimers.get(agentId);
  if (warnTimer) { clearTimeout(warnTimer); warningTimers.delete(agentId); }

  // 2. Read session from Redis (before we delete it)
  const session = await redisStore.getSession(agentId);

  // 3. Close agent session (drops event listeners, does NOT close browser context)
  const agentSession = agents.get(agentId);
  if (agentSession) {
    await agentSession.close().catch(err =>
      console.error(`[REAP] Error closing agent for ${agentId}:`, err)
    );
  }

  // 4. Kill browser process
  if (session) {
    await browserManager.killBrowser(session.browserPid, session.cdpPort);
  }

  // 5. Notify connected WS clients
  broadcastToClients(agentId, { type: 'status', status: 'disconnected' });

  // 6. End DB session
  if (session?.dbSessionId) {
    await dbEndSession(session.dbSessionId);
  }

  // 7. Delete all Redis keys (session, screenshot, messages, expiry)
  //    deleteSession handles all of these in one call
  await redisStore.deleteSession(agentId);

  // 8. Clear local maps
  agents.delete(agentId);
  wsClients.delete(agentId);

  // 9. Replenish warm pool (fire-and-forget)
  browserManager.replenish().catch(err =>
    console.error(`[REAP] Replenish after reap failed:`, err)
  );
}

// -- Session lifecycle checks --

export async function checkSessionLimits(agentId: string): Promise<{ exceeded: boolean; reason?: string }> {
  const session = await redisStore.getSession(agentId);
  if (!session) return { exceeded: false };

  const maxTasks = MAX_TASKS();
  const maxNavs = MAX_NAVIGATIONS();

  if (session.taskCount >= maxTasks) {
    return { exceeded: true, reason: `Session task limit reached (${session.taskCount}/${maxTasks})` };
  }
  if (session.navigationCount >= maxNavs) {
    return { exceeded: true, reason: `Session navigation limit reached (${session.navigationCount}/${maxNavs})` };
  }
  return { exceeded: false };
}

// -- Destroy session (delegates to reap) --

export async function destroySession(agentId: string): Promise<void> {
  await reap(agentId);
}

// -- LRU Eviction --

export async function evictLRUSession(): Promise<string | null> {
  const sessions = Array.from(agents.entries());
  if (sessions.length === 0) return null;

  const sessionData = await Promise.all(
    sessions.map(async ([agentId]) => {
      const data = await redisStore.getSession(agentId);
      const clientCount = wsClients.get(agentId)?.size ?? 0;
      return { agentId, lastActivityAt: data?.lastActivityAt ?? 0, clientCount };
    })
  );

  // Prefer detached sessions (no WS clients), then oldest by lastActivityAt
  const detached = sessionData
    .filter(s => s.clientCount === 0)
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt);
  const target = detached.length > 0
    ? detached[0]
    : sessionData.sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];

  if (!target) return null;

  // Notify active clients before eviction
  if (target.clientCount > 0) {
    broadcastToClients(target.agentId, {
      type: 'session_evicted',
      agentId: target.agentId,
      reason: 'capacity',
    });
  }

  // Call beforeEvict hook (for activeTasks cleanup)
  if (onBeforeEvict) {
    await onBeforeEvict(target.agentId);
  }

  await reap(target.agentId);
  return target.agentId;
}

// -- Capacity management with mutex --

let capacityLock: Promise<void> = Promise.resolve();

export async function ensureCapacity(): Promise<void> {
  const prev = capacityLock;
  let release: () => void;
  capacityLock = new Promise(resolve => { release = resolve; });

  await prev;
  try {
    while (agents.size >= MAX_CONCURRENT_BROWSERS) {
      const evicted = await evictLRUSession();
      if (!evicted) break; // Safety: nothing left to evict
    }
  } finally {
    release!();
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

        // Fetch agent record for userId (needed for vault-based login interception)
        const agentRecord = await dbGetAgent(agentId);
        const userId = agentRecord?.user_id ?? null;

        // Connect agent to existing browser — NO url (keep current page)
        const agentSession = await createAgent(
          broadcastFn, session.cdpEndpoint, session.dbSessionId, agentId, undefined, userId
        );
        agents.set(agentId, agentSession);
        startAbsoluteTimeout(agentId);

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

  // Status — map Redis-only statuses to client-facing AgentStatus
  const clientStatus = session.status === 'allocating' ? 'working' : session.status;
  send({ type: 'status', status: clientStatus });

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
  console.log(`[SessionManager] Session ${agentId} expired, reaping...`);
  await reap(agentId);
}

// -- Graceful shutdown --

export async function shutdownAll(): Promise<void> {
  // Clear all timers to prevent post-shutdown fires
  for (const t of detachedTimers.values()) clearTimeout(t);
  detachedTimers.clear();
  for (const t of absoluteTimers.values()) clearTimeout(t);
  absoluteTimers.clear();
  for (const t of warningTimers.values()) clearTimeout(t);
  warningTimers.clear();

  // Mark all sessions as disconnected in Redis (browsers survive)
  const agentIds = Array.from(agents.keys());
  for (const agentId of agentIds) {
    await redisStore.setSession(agentId, { status: 'disconnected' }).catch(() => {});
    broadcastToClients(agentId, { type: 'status', status: 'disconnected' });
  }
  agents.clear();
  wsClients.clear();
}
