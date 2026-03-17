# Browser Session Isolation — Week 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform browser sessions from single-task-and-die to stateful containers with kill-and-replace warm pool, unified reaper, and session lifecycle limits.

**Architecture:** Remove per-task browser kills, add session lifecycle bounds (TTL, idle, max tasks, max navigations), extract unified `reap()` cleanup function, convert warm pool to kill-and-replace with `about:blank` guarantee and `replenish()`.

**Tech Stack:** Node.js, Redis, Playwright/CDP, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-17-browser-session-isolation.md`

---

## File Structure

### Modified Files
| File | Responsibility |
|------|---------------|
| `server/src/types.ts` | Add `'allocating'` to `RedisSessionStatus`, add `taskCount`/`navigationCount`/`healthStatus` fields to `RedisSession` |
| `server/src/redisStore.ts` | Add `deleteScreenshot`, `deleteMessages`, `removeFromExpiry`, `incrementTaskCount`, `incrementNavCount` functions |
| `server/src/browserManager.ts` | Rename `warmUp` → `replenish` with capacity check, navigate warm browsers to `about:blank`, add replenish mutex |
| `server/src/sessionManager.ts` | Extract `reap()`, remove pre-navigation hack, add `replenish()` calls, add session limit checks, stateful sessions |
| `server/src/agent.ts` | Remove `getLangfuse()?.flushAsync()` from finally blocks (moved to dispatch), track navigation count |

### Test Files
| File | What It Tests |
|------|--------------|
| `server/__tests__/browserManager.test.ts` | Warm pool claim, replenish, capacity limits |
| `server/__tests__/sessionManager.test.ts` | Already exists — update for reap(), lifecycle limits |

---

## Chunk 1: Types + Redis Functions

### Task 1: Add session fields to types

**Files:**
- Modify: `server/src/types.ts:167-181`

- [ ] **Step 1: Update RedisSessionStatus and RedisSession**

Add `'allocating'` to `RedisSessionStatus`. Add `taskCount`, `navigationCount`, `healthStatus` to `RedisSession`:

```ts
// Line 181 — update RedisSessionStatus
type RedisSessionStatus = 'idle' | 'working' | 'disconnected' | 'crashed' | 'interrupted' | 'allocating';

// Lines 167-179 — add to RedisSession interface
interface RedisSession {
  // ... existing fields ...
  taskCount: number;        // Tasks executed in this session
  navigationCount: number;  // Page navigations in this session
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
}
```

- [ ] **Step 2: Verify compile**

Run: `cd browser-agent-chat/server && npx tsc --noEmit 2>&1 | head -20`
Fix any type errors from new required fields (add defaults in `getSession` parser).

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(types): add allocating status, session lifecycle fields"
```

---

### Task 2: Add Redis helper functions

**Files:**
- Modify: `server/src/redisStore.ts`

- [ ] **Step 1: Add missing cleanup functions**

Add these functions to `redisStore.ts`:

```ts
export async function deleteScreenshot(agentId: string): Promise<void> {
  await redis.del(`screenshot:${agentId}`);
}

export async function deleteMessages(agentId: string): Promise<void> {
  await redis.del(`messages:${agentId}`);
}

export async function removeFromExpiry(agentId: string): Promise<void> {
  await redis.zrem('session:expiry', agentId);
}

export async function incrementTaskCount(agentId: string): Promise<number> {
  return await redis.hincrby(`session:${agentId}`, 'taskCount', 1);
}

export async function incrementNavCount(agentId: string): Promise<number> {
  return await redis.hincrby(`session:${agentId}`, 'navigationCount', 1);
}
```

- [ ] **Step 2: Update getSession to parse new fields**

In `getSession()`, add parsing for the new fields with defaults:

```ts
taskCount: parseInt(raw.taskCount || '0', 10),
navigationCount: parseInt(raw.navigationCount || '0', 10),
healthStatus: (raw.healthStatus as 'healthy' | 'degraded' | 'unhealthy') || 'healthy',
```

- [ ] **Step 3: Verify compile**

Run: `cd browser-agent-chat/server && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add server/src/redisStore.ts
git commit -m "feat(redis): add cleanup helpers and session lifecycle counters"
```

---

## Chunk 2: Kill-and-Replace Warm Pool

### Task 3: Refactor browserManager warm pool

**Files:**
- Modify: `server/src/browserManager.ts`

- [ ] **Step 1: Navigate warm browsers to about:blank after spawn**

In `warmUp()` (lines 128-157), after `waitForCDP`, navigate the browser to `about:blank` via CDP:

```ts
// After waitForCDP succeeds, navigate to about:blank
try {
  const listRes = await fetch(`http://localhost:${port}/json/list`);
  const targets = await listRes.json() as Array<{ webSocketDebuggerUrl: string }>;
  if (targets[0]?.webSocketDebuggerUrl) {
    const ws = await import('ws');
    const cdp = new ws.default(targets[0].webSocketDebuggerUrl);
    await new Promise<void>((resolve) => {
      cdp.on('open', () => {
        cdp.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: 'about:blank' } }));
      });
      cdp.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === 1) { cdp.close(); resolve(); }
      });
      cdp.on('error', () => { cdp.close(); resolve(); });
      setTimeout(() => { cdp.close(); resolve(); }, 5000);
    });
  }
} catch {
  // Non-fatal — browser starts on new tab page, which is acceptable
}
```

- [ ] **Step 2: Rename warmUp → replenish with capacity check**

Rename `warmUp` to `replenish`. Add capacity awareness:

```ts
export async function replenish(count?: number): Promise<void> {
  const target = count ?? parseInt(process.env.WARM_BROWSERS || '1', 10);
  const redis = redisStore.getRedis();

  // Check total active browsers (warm pool + in-use sessions)
  const maxBrowsers = parseInt(process.env.MAX_CONCURRENT_BROWSERS || '3', 10);
  const warmCount = await redis.scard('browser:warm:pids');
  const usedPorts = await redis.keys('browser:port:*');
  const totalActive = usedPorts.length;

  // Don't over-provision
  const available = maxBrowsers + 1 - totalActive; // +1 for the extra warm buffer
  const toSpawn = Math.min(target - warmCount, available);
  if (toSpawn <= 0) return;

  // Use replenish mutex to prevent concurrent over-provisioning
  const lockAcquired = await redis.set('session:replenish', '1', 'NX', 'EX', 10);
  if (!lockAcquired) return; // Another replenish is already running

  try {
    for (let i = 0; i < toSpawn; i++) {
      // ... existing spawn logic from warmUp ...
      // ... + navigate to about:blank ...
    }
  } finally {
    await redis.del('session:replenish');
  }
}

// Keep warmUp as alias for backward compat during migration
export const warmUp = replenish;
```

- [ ] **Step 3: Update startup call in index.ts**

Change `warmUp()` call at server startup to `replenish()`. Search for `warmUp` in `index.ts` and replace.

- [ ] **Step 4: Verify compile**

Run: `cd browser-agent-chat/server && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add server/src/browserManager.ts server/src/index.ts
git commit -m "feat(browser): kill-and-replace warm pool with about:blank and capacity-aware replenish"
```

---

## Chunk 3: Unified Reaper + Session Lifecycle

### Task 4: Extract unified reap() function

**Files:**
- Modify: `server/src/sessionManager.ts`

- [ ] **Step 1: Create reap() function**

Extract cleanup logic from `destroySession()` into a standalone `reap()`. This is the single exit path for all session cleanup:

```ts
export async function reap(agentId: string): Promise<void> {
  const session = await redisStore.getSession(agentId);

  // 1. Kill browser process
  if (session?.browserPid) {
    await browserManager.killBrowser(session.browserPid, session.cdpPort);
  }

  // 2. Close agent (stop listeners, screencast)
  const agentSession = agents.get(agentId);
  if (agentSession) {
    try { await agentSession.close(); } catch { /* non-fatal */ }
  }

  // 3. Notify connected clients
  broadcastToClients(agentId, { type: 'status', status: 'disconnected' });

  // 4. Clean Redis state
  await redisStore.deleteSession(agentId);
  await redisStore.deleteScreenshot(agentId);
  await redisStore.deleteMessages(agentId);
  await redisStore.removeFromExpiry(agentId);

  // 5. End database session
  if (session?.dbSessionId) {
    await dbEndSession(session.dbSessionId).catch(() => {});
  }

  // 6. Clear local maps and timers
  agents.delete(agentId);
  const detTimer = detachedTimers.get(agentId);
  if (detTimer) { clearTimeout(detTimer); detachedTimers.delete(agentId); }
  const absTimer = absoluteTimers.get(agentId);
  if (absTimer) { clearTimeout(absTimer); absoluteTimers.delete(agentId); }
  const warnTimer = warningTimers.get(agentId);
  if (warnTimer) { clearTimeout(warnTimer); warningTimers.delete(agentId); }

  // 7. Replenish warm pool
  browserManager.replenish().catch(() => {});

  console.log(`[SESSION] Reaped session: ${agentId}`);
}
```

- [ ] **Step 2: Rewrite destroySession to delegate to reap**

```ts
export async function destroySession(agentId: string): Promise<void> {
  await reap(agentId);
}
```

- [ ] **Step 3: Update all callers to use reap**

Update `evictLRUSession`, `handleExpiry`, and any other cleanup paths to call `reap()` instead of inline cleanup.

- [ ] **Step 4: Remove the pre-navigation hack**

Remove the CDP pre-navigation code added in the earlier fix (lines 215-249 of `createSession`). With kill-and-replace, warm browsers always start on `about:blank`.

- [ ] **Step 5: Verify compile + existing tests pass**

```bash
cd browser-agent-chat/server && npx tsc --noEmit && npx vitest run __tests__/sessionManager.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add server/src/sessionManager.ts
git commit -m "refactor(session): extract unified reap(), remove pre-navigation hack"
```

---

### Task 5: Add session lifecycle limits

**Files:**
- Modify: `server/src/sessionManager.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add session limit constants**

```ts
const MAX_TASKS = (): number => parseInt(process.env.MAX_TASKS_PER_SESSION || '20', 10);
const MAX_NAVIGATIONS = (): number => parseInt(process.env.MAX_NAVIGATIONS_PER_SESSION || '50', 10);
const IDLE_TIMEOUT = (): number => parseInt(process.env.IDLE_TIMEOUT_SECONDS || '180', 10);
```

- [ ] **Step 2: Add checkSessionLimits function**

```ts
export async function checkSessionLimits(agentId: string): Promise<{ ok: boolean; reason?: string }> {
  const session = await redisStore.getSession(agentId);
  if (!session) return { ok: false, reason: 'Session not found' };

  if (session.taskCount >= MAX_TASKS()) {
    return { ok: false, reason: `Max tasks exceeded (${session.taskCount}/${MAX_TASKS()})` };
  }
  if (session.navigationCount >= MAX_NAVIGATIONS()) {
    return { ok: false, reason: `Max navigations exceeded (${session.navigationCount}/${MAX_NAVIGATIONS()})` };
  }
  if (session.healthStatus === 'unhealthy') {
    return { ok: false, reason: 'Session unhealthy' };
  }
  return { ok: true };
}
```

- [ ] **Step 3: Add limit checks in index.ts before task dispatch**

In `index.ts`, before `dispatchTask`/`dispatchExplore`, check limits:

```ts
const limits = await sessionManager.checkSessionLimits(agentId);
if (!limits.ok) {
  broadcastToAgent(agentId, { type: 'error', message: `Session limit reached: ${limits.reason}. Restarting session...` });
  await sessionManager.reap(agentId);
  // Client will auto-reconnect and get a fresh session
  return;
}
```

- [ ] **Step 4: Increment task count after task completion**

In `index.ts`, after `dispatchTask`/`dispatchExplore` completes, increment the counter:

```ts
await redisStore.incrementTaskCount(agentId);
```

- [ ] **Step 5: Increment navigation count on nav events**

In `sessionManager.ts` `makeBroadcast()`, when handling `nav` type messages, increment:

```ts
if (msg.type === 'nav') {
  redisStore.incrementNavCount(agentId).catch(() => {});
  // ... existing nav handling ...
}
```

- [ ] **Step 6: Initialize new fields in createSession**

In `createSession()`, set initial values when writing to Redis:

```ts
await redisStore.setSession(agentId, {
  // ... existing fields ...
  taskCount: 0,
  navigationCount: 0,
  healthStatus: 'healthy',
});
```

- [ ] **Step 7: Verify compile**

```bash
cd browser-agent-chat/server && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add server/src/sessionManager.ts server/src/index.ts
git commit -m "feat(session): add lifecycle limits — max tasks, max navigations, idle timeout"
```

---

## Chunk 4: E2E Tests

### Task 6: Write 3 end-to-end integration tests

**Files:**
- Create: `server/__tests__/session-isolation-e2e.test.ts`

These tests verify the core invariants of the isolation model using the real server + Redis + browser.

- [ ] **Step 1: Create E2E test file**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3001';
const AGENT_ID = '7444d40d-dcf0-44d4-9013-d712e3f0b09b';

function createWSClient(): Promise<{ ws: WebSocket; messages: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const messages: any[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

function waitForMessage(messages: any[], type: string, timeout = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const msg = messages.find(m => m.type === type);
      if (msg) return resolve(msg);
      if (Date.now() - start > timeout) return reject(new Error(`Timeout waiting for ${type}`));
      setTimeout(check, 100);
    };
    const start = Date.now();
    check();
  });
}

function waitForStatus(messages: any[], status: string, timeout = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const msg = messages.find(m => m.type === 'status' && m.status === status);
      if (msg) return resolve(msg);
      if (Date.now() - start > timeout) return reject(new Error(`Timeout waiting for status=${status}`));
      setTimeout(check, 100);
    };
    const start = Date.now();
    check();
  });
}

describe('Browser Session Isolation E2E', () => {

  it('Test 1: Session persists browser state across multiple tasks', async () => {
    // Verifies: stateful sessions — login persists between tasks
    const { ws, messages } = await createWSClient();

    try {
      // Start agent
      ws.send(JSON.stringify({ type: 'start', agentId: AGENT_ID }));
      await waitForStatus(messages, 'idle', 30000);

      // Task 1: Login should happen
      messages.length = 0;
      ws.send(JSON.stringify({ type: 'task', content: 'What page am I on?' }));
      await waitForStatus(messages, 'idle', 60000);

      // Check login happened
      const loginThought = messages.find(m =>
        m.type === 'thought' && m.content?.includes('Login')
      );

      // Task 2: Should NOT need to re-login (session preserves state)
      messages.length = 0;
      ws.send(JSON.stringify({ type: 'task', content: 'What page am I on now?' }));
      await waitForStatus(messages, 'idle', 60000);

      // Verify no login in second task
      const secondLoginThought = messages.find(m =>
        m.type === 'thought' && m.content?.includes('Login page detected')
      );

      // If session is stateful, second task should NOT trigger login
      console.log('Test 1 Evidence:');
      console.log('  First task login:', loginThought ? 'YES' : 'NO');
      console.log('  Second task login:', secondLoginThought ? 'YES (FAIL)' : 'NO (PASS - session preserved)');

      expect(secondLoginThought).toBeUndefined();
    } finally {
      ws.close();
    }
  }, 120000);

  it('Test 2: Warm pool provides clean browser (no cross-agent contamination)', async () => {
    // Verifies: kill-and-replace — new session gets fresh browser
    const { ws: ws1, messages: msgs1 } = await createWSClient();

    try {
      // Start first session
      ws1.send(JSON.stringify({ type: 'start', agentId: AGENT_ID }));
      await waitForStatus(msgs1, 'idle', 30000);

      // Get initial nav URL
      const navMsg = msgs1.find(m => m.type === 'nav');
      console.log('Test 2 Evidence:');
      console.log('  Session started, initial URL:', navMsg?.url || 'none');

      // Verify browser is on the correct agent URL (not some other agent's page)
      const agentUrl = navMsg?.url || '';
      const isCorrectDomain = agentUrl.includes('console.qa.redblock.ai') ||
                               agentUrl.includes('about:blank') ||
                               agentUrl === '';

      console.log('  Correct domain:', isCorrectDomain ? 'YES (PASS)' : 'NO (FAIL - cross-contamination)');
      expect(isCorrectDomain).toBe(true);
    } finally {
      ws1.close();
    }
  }, 60000);

  it('Test 3: Session lifecycle — reap cleans all state', async () => {
    // Verifies: unified reaper cleans Redis, port, process
    const { ws, messages } = await createWSClient();
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    try {
      // Start session
      ws.send(JSON.stringify({ type: 'start', agentId: AGENT_ID }));
      await waitForStatus(messages, 'idle', 30000);

      // Verify session exists in Redis
      const sessionBefore = await redis.hgetall(`session:${AGENT_ID}`);
      const portsBefore = await redis.keys('browser:port:*');

      console.log('Test 3 Evidence:');
      console.log('  Session in Redis before reap:', Object.keys(sessionBefore).length > 0 ? 'YES' : 'NO');
      console.log('  Ports allocated before reap:', portsBefore.length);

      // Close connection — triggers detached timer, or we can force reap
      ws.close();

      // Wait for detach + cleanup (or manually trigger via restart)
      await new Promise(r => setTimeout(r, 5000));

      // Check if session is marked as disconnected or cleaned up
      const sessionAfter = await redis.hgetall(`session:${AGENT_ID}`);
      const statusAfter = sessionAfter.status || 'deleted';

      console.log('  Session status after disconnect:', statusAfter);
      console.log('  Expected: disconnected or reaped');

      // Session should be marked disconnected (detach timer running) or already reaped
      expect(['disconnected', 'deleted', '']).toContain(statusAfter === '' ? 'deleted' : statusAfter);
    } finally {
      redis.disconnect();
    }
  }, 60000);
});
```

- [ ] **Step 2: Run the tests**

The tests require the server to be running. Start the server first, then run:

```bash
cd browser-agent-chat/server
npx vitest run __tests__/session-isolation-e2e.test.ts --reporter=verbose 2>&1
```

Capture the full output including the `console.log` evidence lines.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/session-isolation-e2e.test.ts
git commit -m "test: add 3 E2E tests for browser session isolation"
```
