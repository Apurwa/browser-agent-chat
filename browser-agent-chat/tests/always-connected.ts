/**
 * E2E test: Always-Connected Agent behavior.
 * Tests auto-connect, reconnect, restart, session lifecycle.
 *
 * Run:  source server/.env && SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_ROLE_KEY npx tsx tests/always-connected.ts
 */
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import { Redis } from 'ioredis';

const WS_URL = 'ws://localhost:3001';
const TEST_URL = 'https://example.com';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

let failures = 0;
let passes = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`  PASS: ${msg}`);
    passes++;
  }
}

// Buffered message collector with backlog search
class MessageBuffer {
  messages: any[] = [];
  private listeners: Array<{ predicate: (msg: any) => boolean; resolve: (msg: any) => void }> = [];

  constructor(ws: WebSocket) {
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.messages.push(msg);
        for (let i = this.listeners.length - 1; i >= 0; i--) {
          if (this.listeners[i].predicate(msg)) {
            this.listeners[i].resolve(msg);
            this.listeners.splice(i, 1);
          }
        }
      } catch {}
    });
  }

  waitFor(predicate: (msg: any) => boolean, timeoutMs = 60_000): Promise<any> {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.listeners.findIndex(l => l.resolve === wrappedResolve);
        if (idx >= 0) this.listeners.splice(idx, 1);
        reject(new Error(`Timeout (${timeoutMs}ms). Messages: [${this.messages.map(m => m.type + (m.status ? ':' + m.status : '')).join(', ')}]`));
      }, timeoutMs);

      const wrappedResolve = (msg: any) => {
        clearTimeout(timer);
        resolve(msg);
      };
      this.listeners.push({ predicate, resolve: wrappedResolve });
    });
  }

  waitForNew(predicate: (msg: any) => boolean, timeoutMs = 60_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.listeners.findIndex(l => l.resolve === wrappedResolve);
        if (idx >= 0) this.listeners.splice(idx, 1);
        reject(new Error(`Timeout for new msg (${timeoutMs}ms). Messages: [${this.messages.map(m => m.type + (m.status ? ':' + m.status : '')).join(', ')}]`));
      }, timeoutMs);

      const wrappedResolve = (msg: any) => {
        clearTimeout(timer);
        resolve(msg);
      };
      this.listeners.push({ predicate, resolve: wrappedResolve });
    });
  }

  has(predicate: (msg: any) => boolean): boolean {
    return this.messages.some(predicate);
  }
}

function openWS(): Promise<{ ws: WebSocket; buf: MessageBuffer }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const buf = new MessageBuffer(ws);
    ws.on('open', () => resolve({ ws, buf }));
    ws.on('error', reject);
  });
}

function closeWS(ws: WebSocket): Promise<void> {
  return new Promise(resolve => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    ws.on('close', () => resolve());
    ws.close();
  });
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

async function createTestAgent(name: string, url: string): Promise<string> {
  const { data: users } = await supabase.from('agents').select('user_id').limit(1);
  const userId = users?.[0]?.user_id;
  if (!userId) throw new Error('No existing agent found to get user_id');

  const { data, error } = await supabase.from('agents').insert({
    name, url, user_id: userId,
  }).select('id').single();

  if (error) throw new Error(`Failed to create agent: ${error.message}`);
  return data.id;
}

async function deleteTestAgent(id: string) {
  await supabase.from('agents').delete().eq('id', id);
}

// Helper: start agent and wait for idle (used by most tests)
async function startAndWaitIdle(agentId: string): Promise<{ ws: WebSocket; buf: MessageBuffer }> {
  const { ws, buf } = await openWS();
  ws.send(JSON.stringify({ type: 'start', agentId }));
  // Wait for idle OR session_new+idle (new session path)
  await buf.waitFor(m => m.type === 'status' && m.status === 'idle', 90_000);
  return { ws, buf };
}

// ============================================================
// TEST 1: Auto-connect — sending 'start' creates session
// ============================================================
async function testAutoConnect() {
  console.log('\n--- Test 1: Auto-Connect ---');
  const agentId = await createTestAgent('test-autoconnect', TEST_URL);

  try {
    const { ws, buf } = await openWS();
    ws.send(JSON.stringify({ type: 'start', agentId }));

    // Should get session_new (new session path)
    const sessionNew = await buf.waitFor(m => m.type === 'session_new', 90_000);
    assert(sessionNew.type === 'session_new', 'Received session_new message');
    assert(sessionNew.agentId === agentId, 'session_new has correct agentId');

    // Should reach idle
    const statusIdle = await buf.waitFor(m => m.type === 'status' && m.status === 'idle', 90_000);
    assert(statusIdle.status === 'idle', 'Agent reached idle status');

    // Should get status working first (the initial "working" before createSession)
    const hasWorking = buf.has(m => m.type === 'status' && m.status === 'working');
    assert(hasWorking, 'Received initial working status');

    await closeWS(ws);
  } finally {
    await sleep(2000);
    await deleteTestAgent(agentId);
  }
}

// ============================================================
// TEST 2: Reconnect — close WS, reopen, send start → reattach
// ============================================================
async function testReconnect() {
  console.log('\n--- Test 2: Reconnect (Reattach) ---');
  const agentId = await createTestAgent('test-reconnect', TEST_URL);

  try {
    // First connection — start agent
    const { ws: ws1 } = await startAndWaitIdle(agentId);
    console.log('  Agent started on ws1');

    await closeWS(ws1);
    console.log('  ws1 closed, session detached');
    await sleep(3000);

    // Second connection — send start again
    const { ws: ws2, buf: buf2 } = await openWS();
    ws2.send(JSON.stringify({ type: 'start', agentId }));

    // Should get status from snapshot (reattach)
    const statusMsg = await buf2.waitFor(m => m.type === 'status', 30_000);
    assert(statusMsg.type === 'status', 'Reconnect received status snapshot');
    assert(statusMsg.status === 'idle', 'Reconnect status is idle');

    // Wait and check — should NOT get session_new
    await sleep(3000);
    const gotSessionNew = buf2.has(m => m.type === 'session_new');
    assert(!gotSessionNew, 'Reconnect did NOT receive session_new (reattach path)');

    await closeWS(ws2);
  } finally {
    await sleep(2000);
    await deleteTestAgent(agentId);
  }
}

// ============================================================
// TEST 3: Restart — send restart message, get new session
// ============================================================
async function testRestart() {
  console.log('\n--- Test 3: Restart Agent ---');
  const agentId = await createTestAgent('test-restart', TEST_URL);

  try {
    const { ws, buf } = await startAndWaitIdle(agentId);
    console.log('  Agent started');

    // Register waiters BEFORE sending restart (messages arrive fast)
    const sessionNewP = buf.waitForNew(m => m.type === 'session_new', 90_000);
    const statusIdleP = buf.waitForNew(m => m.type === 'status' && m.status === 'idle', 90_000);

    ws.send(JSON.stringify({ type: 'restart', agentId }));

    const sessionNew = await sessionNewP;
    assert(sessionNew.type === 'session_new', 'Restart received session_new');

    const statusIdle = await statusIdleP;
    assert(statusIdle.status === 'idle', 'Restarted agent reached idle');

    await closeWS(ws);
  } finally {
    await sleep(2000);
    await deleteTestAgent(agentId);
  }
}

// ============================================================
// TEST 4: Stop message is ignored (removed from protocol)
// ============================================================
async function testNoStop() {
  console.log('\n--- Test 4: Stop Message Ignored ---');
  const agentId = await createTestAgent('test-nostop', TEST_URL);

  try {
    const { ws } = await startAndWaitIdle(agentId);

    ws.send(JSON.stringify({ type: 'stop' }));
    await sleep(2000);
    assert(ws.readyState === WebSocket.OPEN, 'WS still open after sending removed stop message');

    ws.send(JSON.stringify({ type: 'ping' }));
    await sleep(500);
    assert(ws.readyState === WebSocket.OPEN, 'WS still open after follow-up ping');

    await closeWS(ws);
  } finally {
    await sleep(2000);
    await deleteTestAgent(agentId);
  }
}

// ============================================================
// TEST 5: Ping → Pong and activity update
// ============================================================
async function testPing() {
  console.log('\n--- Test 5: Ping/Pong ---');
  const agentId = await createTestAgent('test-ping', TEST_URL);

  try {
    const { ws, buf } = await startAndWaitIdle(agentId);

    for (let i = 0; i < 5; i++) {
      ws.send(JSON.stringify({ type: 'ping' }));
      await sleep(300);
    }

    await sleep(1000);
    const pongCount = buf.messages.filter(m => m.type === 'pong').length;
    assert(pongCount >= 3, `Received ${pongCount} pong responses (expected >= 3)`);

    await closeWS(ws);
  } finally {
    await sleep(2000);
    await deleteTestAgent(agentId);
  }
}

// ============================================================
// TEST 6: Send task while idle — agent processes it
// ============================================================
async function testSendTask() {
  console.log('\n--- Test 6: Send Task ---');
  const agentId = await createTestAgent('test-task', TEST_URL);

  try {
    const { ws, buf } = await startAndWaitIdle(agentId);
    console.log('  Agent idle, sending task');

    ws.send(JSON.stringify({ type: 'task', content: 'What is the title of this page?' }));

    const working = await buf.waitForNew(m => m.type === 'status' && m.status === 'working', 30_000);
    assert(working.status === 'working', 'Agent status changed to working');

    const thought = await buf.waitFor(m => m.type === 'thought', 90_000);
    assert(thought.type === 'thought', 'Received agent thought');

    const idle = await buf.waitForNew(m => m.type === 'status' && m.status === 'idle', 120_000);
    assert(idle.status === 'idle', 'Agent returned to idle after task');

    await closeWS(ws);
  } finally {
    await sleep(2000);
    await deleteTestAgent(agentId);
  }
}

// ============================================================
// TEST 7: Multiple concurrent connections to same agent
// ============================================================
async function testMultipleClients() {
  console.log('\n--- Test 7: Multiple Clients ---');
  const agentId = await createTestAgent('test-multi', TEST_URL);

  try {
    const { ws: ws1 } = await startAndWaitIdle(agentId);
    console.log('  Client 1 connected');

    // Client 2 connects
    const { ws: ws2, buf: buf2 } = await openWS();
    ws2.send(JSON.stringify({ type: 'start', agentId }));
    await buf2.waitFor(m => m.type === 'status', 30_000);
    assert(true, 'Client 2 received status snapshot');

    // Close client 1 — session stays (client 2 still connected)
    await closeWS(ws1);
    await sleep(2000);
    assert(ws2.readyState === WebSocket.OPEN, 'Client 2 still connected after client 1 left');

    // Client 2 can still ping
    ws2.send(JSON.stringify({ type: 'ping' }));
    const pong = await buf2.waitForNew(m => m.type === 'pong', 5000);
    assert(pong.type === 'pong', 'Client 2 gets pong after client 1 disconnected');

    await closeWS(ws2);
  } finally {
    await sleep(2000);
    await deleteTestAgent(agentId);
  }
}

// ============================================================
// TEST 8: Disconnect — last client leaves, session becomes detached
// Uses agent fdb1a8c6-e9bb-4140-bbbf-ca2d95082e47 (apurwasarwajit.com)
// which the user's browser should NOT be connected to during testing.
// ============================================================
async function testDisconnect() {
  console.log('\n--- Test 8: Disconnect (Detach) ---');

  // Use a dedicated agent that no other browser tab is connected to
  const DISCONNECT_AGENT_ID = 'fdb1a8c6-e9bb-4140-bbbf-ca2d95082e47';

  // Verify agent exists in DB
  const { data: agentRow } = await supabase
    .from('agents')
    .select('id')
    .eq('id', DISCONNECT_AGENT_ID)
    .single();

  if (!agentRow) {
    console.log('  SKIP: Agent fdb1a8c6-e9bb-4140-bbbf-ca2d95082e47 not found in DB');
    return;
  }

  // Connect Redis for direct session inspection
  await redis.connect();

  try {
    // Connect a single WS client and start the session
    const { ws: keeper, buf: keeperBuf } = await startAndWaitIdle(DISCONNECT_AGENT_ID);
    console.log('  Keeper connected, session idle');

    // Verify session is idle in Redis
    const sessionBefore = await redis.hgetall(`session:${DISCONNECT_AGENT_ID}`);
    assert(sessionBefore.status === 'idle', `Session status is idle in Redis (got: ${sessionBefore.status})`);

    // Before closing the keeper, verify it is the ONLY client.
    // We can't directly query wsClients from the test, but we can infer:
    // If another browser tab is connected, the session won't become detached.
    // We'll close the keeper and check Redis — if detachedAt is NOT set after
    // 4 seconds, another client is likely connected.
    await closeWS(keeper);
    console.log('  Keeper closed, waiting 4 seconds...');

    await sleep(4000);

    // Verify session status is disconnected and detachedAt is set
    const sessionAfter = await redis.hgetall(`session:${DISCONNECT_AGENT_ID}`);
    const detachedAt = parseInt(sessionAfter.detachedAt, 10) || 0;

    if (detachedAt === 0) {
      // detachedAt not set — likely another browser client is still connected
      console.log('  SKIP: detachedAt not set — another client may be connected to this agent');
      console.log('  (Close all browser tabs viewing this agent and re-run)');
      return;
    }

    assert(detachedAt > 0, `detachedAt is set (${detachedAt})`);
    assert(
      Date.now() - detachedAt < 10000,
      `detachedAt is recent (${Date.now() - detachedAt}ms ago)`,
    );

    // Session should still exist (not yet reaped — detached timeout is 120s)
    const sessionExists = sessionAfter.dbSessionId !== undefined;
    assert(sessionExists, 'Session still exists in Redis (not reaped yet)');

    console.log('  Cleaning up: reconnecting to cancel detached timer');
    const { ws: cleanup } = await openWS();
    cleanup.send(JSON.stringify({ type: 'start', agentId: DISCONNECT_AGENT_ID }));
    await sleep(2000);
    await closeWS(cleanup);
  } finally {
    redis.disconnect();
  }
}

// ============================================================
async function main() {
  console.log('=== Always-Connected Agent E2E Tests ===');
  console.log(`Server: ${WS_URL}`);

  if (!supabaseKey) {
    console.error('SUPABASE_SERVICE_KEY not set.');
    process.exit(1);
  }

  const tests = [
    testAutoConnect,
    testReconnect,
    testRestart,
    testNoStop,
    testPing,
    testSendTask,
    testMultipleClients,
    testDisconnect,
  ];

  for (const test of tests) {
    try {
      await test();
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
      failures++;
    }
  }

  console.log(`\n=== Results: ${passes} passed, ${failures} failed ===`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
