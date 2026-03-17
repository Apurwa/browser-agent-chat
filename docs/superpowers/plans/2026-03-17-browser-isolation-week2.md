# Browser Session Isolation — Week 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan.

**Goal:** Add execution mutex, pre-task health check, and session sanity check to complete the deterministic execution substrate.

**Architecture:** Redis-based task mutex with lock renewal prevents concurrent execution. Health check with 3s timeout detects dead browsers before task dispatch. Sanity check validates page state between tasks.

**Spec:** `docs/superpowers/specs/2026-03-17-browser-session-isolation.md`

---

## Task 1: Execution Mutex (Redis-based)

**Files:**
- Modify: `server/src/redisStore.ts` — add lock functions
- Modify: `server/src/index.ts` — wrap task/explore handlers with lock

### Redis Functions

```ts
const EXEC_LOCK_TTL_MS = 20000; // 20s initial TTL

export async function acquireExecLock(agentId: string, taskId: string): Promise<boolean> {
  const result = await redis.set(`session:lock:exec:${agentId}`, taskId, 'PX', EXEC_LOCK_TTL_MS, 'NX');
  return result === 'OK';
}

export async function releaseExecLock(agentId: string, taskId: string): Promise<boolean> {
  const owner = await redis.get(`session:lock:exec:${agentId}`);
  if (owner === taskId) {
    await redis.del(`session:lock:exec:${agentId}`);
    return true;
  }
  return false;
}

export async function extendExecLock(agentId: string, taskId: string): Promise<boolean> {
  const owner = await redis.get(`session:lock:exec:${agentId}`);
  if (owner !== taskId) return false;
  await redis.pexpire(`session:lock:exec:${agentId}`, EXEC_LOCK_TTL_MS);
  return true;
}

export async function forceReleaseExecLock(agentId: string): Promise<void> {
  await redis.del(`session:lock:exec:${agentId}`);
}
```

### index.ts Changes

Before `dispatchTask`/`dispatchExplore`:
```ts
const taskId = crypto.randomUUID();
if (!await redisStore.acquireExecLock(agentId, taskId)) {
  ws.send(JSON.stringify({ type: 'error', message: 'Agent is busy. Wait for current task to complete.' }));
  return;
}

// Renew lock during execution
const lockRenew = setInterval(() => {
  redisStore.extendExecLock(agentId, taskId).catch(() => {});
}, 7000);

try {
  await dispatchTask(session, msg.content, broadcast);
} finally {
  clearInterval(lockRenew);
  await redisStore.releaseExecLock(agentId, taskId);
}
```

Also add `forceReleaseExecLock` to `reap()` in sessionManager.

---

## Task 2: Pre-Task Health Check

**Files:**
- Modify: `server/src/sessionManager.ts` — add `healthCheck()` function
- Modify: `server/src/index.ts` — call before task dispatch

```ts
export async function healthCheck(agentId: string): Promise<boolean> {
  const session = agents.get(agentId);
  if (!session) return false;

  try {
    const page = session.connector.getHarness().page;
    const result = await Promise.race([
      page.evaluate(() => true),
      new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 3000)),
    ]);
    return result === true;
  } catch {
    console.error(`[HEALTH] Browser unhealthy for ${agentId}`);
    await redisStore.setSession(agentId, { healthStatus: 'unhealthy' });
    return false;
  }
}
```

In index.ts, before acquiring exec lock:
```ts
const healthy = await sessionManager.healthCheck(agentId);
if (!healthy) {
  broadcast({ type: 'thought', content: 'Browser crashed. Restarting...' });
  await sessionManager.reap(agentId, 'terminated');
  ws.send(JSON.stringify({ type: 'error', message: 'Browser crashed. Please reconnect.' }));
  return;
}
```

---

## Task 3: Pre-Task Sanity Check (`ensureSessionIsSane`)

**Files:**
- Modify: `server/src/sessionManager.ts` — add `ensureSessionIsSane()` and `softReset()`

```ts
export async function ensureSessionIsSane(agentId: string): Promise<boolean> {
  const session = agents.get(agentId);
  if (!session) return false;

  const page = session.connector.getHarness().page;

  try {
    // 1. Page alive (3s timeout)
    await Promise.race([
      page.evaluate(() => true),
      new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 3000)),
    ]);

    // 2. Wait for in-flight navigation
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});

    // 3. Dismiss blocking overlays
    await page.evaluate(() => {
      const selectors = [
        '[role="dialog"] button[aria-label="Close"]',
        '[role="dialog"] button[aria-label="Dismiss"]',
        '.modal-close', '.toast-close',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el && el.offsetParent !== null) el.click();
      }
    }).catch(() => {});

    // 4. Document ready
    const readyState = await page.evaluate(() => document.readyState);
    if (readyState !== 'complete') {
      await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    }

    return true;
  } catch {
    // Try soft reset
    return await softReset(agentId);
  }
}

export async function softReset(agentId: string): Promise<boolean> {
  const session = agents.get(agentId);
  if (!session) return false;

  const redisSession = await redisStore.getSession(agentId);
  const baseUrl = redisSession?.currentUrl || '';
  if (!baseUrl) return false;

  try {
    const page = session.connector.getHarness().page;
    const url = new URL(baseUrl);
    await page.goto(url.origin, { waitUntil: 'domcontentloaded', timeout: 15000 });
    console.log(`[SESSION] Soft reset to ${url.origin} for ${agentId}`);
    return true;
  } catch {
    return false;
  }
}
```

In index.ts, after health check passes and before exec lock:
```ts
const sane = await sessionManager.ensureSessionIsSane(agentId);
if (!sane) {
  broadcast({ type: 'thought', content: 'Browser state corrupted. Restarting...' });
  await sessionManager.reap(agentId, 'terminated');
  ws.send(JSON.stringify({ type: 'error', message: 'Browser unrecoverable. Please reconnect.' }));
  return;
}
```
