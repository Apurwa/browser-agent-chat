# Browser Session Isolation

**Date:** 2026-03-17
**Status:** Draft

## Problem

The browser execution layer lacks deterministic isolation. Warm browsers retain state from previous agent sessions, port allocation leaks on failure, concurrent tasks corrupt execution, and browser crashes go undetected. Every higher layer (policy, learning, exploration) assumes deterministic execution — and doesn't have it.

## Core Invariant

**One agent session = one browser process = one stateful execution timeline.**

No cross-agent sharing. No reuse of post-session browsers. Sessions persist across tasks.

## Execution Model

```
Session (stateful)
  → Task A (login, explore)
  → Task B (test feature)
  → Task C (verify fix)
  → ...
  → Terminate (TTL | health | max_tasks | idle | user)
```

The browser is a **stateful execution context** across tasks — login state, navigation history, cookies, and UI context persist. This enables multi-step agent workflows without re-authentication or re-navigation.

Kill-and-replace applies at **session boundaries**, not task boundaries. Within a session, the browser stays alive.

## Design Principles

1. **Isolation is a system property, not a discipline** — kill-and-replace at session boundary, not clean-and-reuse
2. **No partial state survives failure** — every failure path converges to full cleanup
3. **Serializability** — one session executes exactly one task at a time
4. **Recoverability** — failures reset cleanly, pool self-heals
5. **Bounded statefulness** — sessions accumulate state but are bounded by TTL, max tasks, idle timeout, and health checks

## Architecture Overview

Five components, each with one clear purpose:

```
┌─────────────────────────────────────────┐
│           Session Allocator             │
│  (atomic create/destroy with rollback)  │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───▼────────┐   ┌───────▼──────────┐
│ Warm Pool  │   │   Execution      │
│ Manager    │   │   Controller     │
│ (spawn,    │   │   (task mutex,   │
│  claim,    │   │    serialized    │
│  replace)  │   │    execution)    │
└───┬────────┘   └───────┬──────────┘
    │                    │
┌───▼────────────────────▼──────────┐
│         Health Monitor            │
│  (liveness checks, crash detect)  │
└───────────────┬───────────────────┘
                │
┌───────────────▼───────────────────┐
│            Reaper                 │
│  (cleanup + pool replenishment)   │
└───────────────────────────────────┘
```

## 1. Kill-and-Replace Warm Pool

### Current Problem

Warm browsers retain pages, cookies, localStorage, and event listeners from previous sessions. Pre-navigation is a race condition, not a guarantee.

### Design

**Lifecycle: a browser process is used exactly once.**

```
POOL (steady state):
  [Browser A: about:blank, pid=1234, port=19300]
  [Browser B: about:blank, pid=1235, port=19301]

ON SESSION CREATE:
  1. Pop Browser A from pool
  2. Navigate to agent's target URL
  3. Attach magnitude-core
  4. Session active

DURING SESSION (tasks execute sequentially):
  Task A → Task B → Task C → ...
  Browser stays alive, state persists

ON SESSION END (TTL | health | max_tasks | idle | user):
  1. Kill Browser A (SIGTERM → 3s → SIGKILL)
  2. Free port 19300
  3. Spawn Browser C → navigate to about:blank → add to pool
  4. Pool returns to target size
```

### Pool Sizing

```
WARM_POOL_SIZE = MAX_CONCURRENT_BROWSERS + 1
```

One extra browser ensures a pre-warmed instance is always available. The extra ~200MB RAM is worth eliminating cold-start latency.

### Pool Manager Interface

```ts
interface WarmPoolManager {
  /** Claim a browser from the pool. Returns null if pool empty (caller must cold-launch). */
  claim(agentId: string): Promise<BrowserHandle | null>;

  /** Return current pool size. */
  size(): Promise<number>;

  /** Replenish pool to target size. Called after session destruction. */
  replenish(): Promise<void>;

  /** Kill all pool browsers. Called on server shutdown. */
  drainAll(): Promise<void>;
}

interface BrowserHandle {
  pid: number;
  port: number;
  cdpEndpoint: string;
}
```

### Key Rules

- Warm browsers navigate to `about:blank` immediately after spawn — no stale pages
- A claimed browser is never returned to the pool — it is killed after session ends
- Pool replenishment is background but serialized — use a Redis-based replenish mutex (`SET session:replenish NX EX 10`) to prevent concurrent replenish calls from over-provisioning
- `replenish()` checks total active browsers (pool + in-use) against `MAX_CONCURRENT_BROWSERS` before spawning
- If pool is empty on claim, fall back to cold launch (current `launchBrowser`) — cold launch also checks capacity
- `replenish()` is a rename of current `warmUp()` with capacity-awareness added

### What Changes

| Current | New |
|---------|-----|
| `claimWarm()` pops from Redis set, reassigns port | `claim()` pops from Redis set, marks as in-use (no port reassignment needed — port already allocated) |
| Warm browsers sit on whatever page they had | Warm browsers always on `about:blank` |
| Session end: browser killed, port freed, no replacement | Session end: browser killed, port freed, replacement spawned |
| Pre-navigation hack in `sessionManager.createSession` | Removed — not needed when browsers start clean |

## 2. Atomic Session Allocation

### Current Problem

`createSession()` allocates port, then creates agent. If agent creation fails, the port and browser are leaked.

### Design: Two-Phase Allocation with Rollback

```
Phase 1: Reserve
  ├─ Pop browser from warm pool (or cold-launch)
  ├─ Navigate to target URL
  ├─ Record reservation in Redis (status: 'allocating')
  └─ If any step fails → immediate cleanup

Phase 2: Commit
  ├─ Create magnitude agent via CDP
  ├─ Attach event listeners
  ├─ Start screencast
  ├─ Update Redis (status: 'idle')
  └─ If any step fails → full rollback
```

### Rollback Behavior

Every failure path executes the same cleanup:

```ts
async function rollback(browser: BrowserHandle, agentId: string): Promise<void> {
  // Kill browser process
  await killBrowser(browser.pid, browser.port);
  // Delete partial Redis session
  await redisStore.deleteSession(agentId);
  // Replenish pool
  warmPool.replenish();
}
```

### Session States

```
allocating → idle → working → idle → ... → (reap) → (deleted)
                  ↗              ↘
            interrupted      disconnected → (reap) → (deleted)
                                    ↘
                                 crashed → (reap) → (deleted)
```

New state `allocating` prevents the session from accepting tasks before it's fully created. Existing `interrupted` state (used during recovery when a task was mid-flight) is preserved. All terminal paths converge to `reap()`.

The recovery path in `recoverSession()` should treat `allocating` sessions older than 60 seconds as failed and call `reap()` on them — they represent server crashes mid-creation.

### What Changes

| Current | New |
|---------|-----|
| `createSession` has no error handling around agent creation | `createSession` wraps everything in try/catch with `rollback()` |
| Port leaked on agent creation failure | Port freed in rollback |
| No `allocating` state — session goes straight to `idle` | `allocating` → `idle` transition after successful commit |

## 3. Execution Controller (Task Mutex)

### Current Problem

Multiple WebSocket clients can send `task` or `explore` messages simultaneously. No lock prevents concurrent execution. `session.currentTrace` and `stepsHistory` get corrupted.

### Design: Redis-Based Mutex Per Session

```ts
interface ExecutionLock {
  /** Acquire lock. Returns false if already locked. */
  acquire(agentId: string, taskId: string, ttlMs: number): Promise<boolean>;

  /** Release lock. Only succeeds if caller owns it (owner token = taskId). */
  release(agentId: string, taskId: string): Promise<boolean>;

  /** Check if locked. */
  isLocked(agentId: string): Promise<boolean>;
}
```

### Implementation

Redis key: `session:lock:exec:{agentId}`
Value: `taskId` (owner token)
Initial TTL: 5 minutes for tasks, 10 minutes for explore

```
SET session:lock:exec:{agentId} {taskId} NX EX {ttlSeconds}
```

- `NX` ensures only one task runs at a time
- `EX` prevents deadlocks if server crashes mid-task
- Release checks value matches `taskId` before deleting (prevents wrong-owner unlock)

### Lock Renewal

Tasks can exceed the initial TTL (complex explorations may take 15+ minutes). A background interval renews the lock every `TTL/3` seconds while the task is active:

```ts
const renewInterval = setInterval(async () => {
  await redis.expire(`session:lock:exec:${agentId}`, ttlSeconds);
}, (ttlSeconds / 3) * 1000);

// Clear on task completion
clearInterval(renewInterval);
```

This prevents lock expiry during long-running tasks while still providing deadlock recovery if the server crashes (interval stops, lock expires naturally).

### Task Rejection

When a task arrives and the lock is held:

```ts
if (!await execLock.acquire(agentId, taskId, TTL)) {
  broadcast({ type: 'error', message: 'Agent is busy. Wait for current task to complete.' });
  return;
}
```

### What Changes

| Current | New |
|---------|-----|
| Task handler immediately calls `executeTask` | Task handler acquires lock first, rejects if busy |
| No protection against concurrent tasks | Redis mutex with owner token and TTL |
| `session.stepsHistory` mutated by concurrent tasks | Single writer guaranteed |

## 4. Health Monitor

### Current Problem

No liveness checks between task executions. Browser can crash silently. User sees frozen UI until next task fails with a cryptic CDP error.

### Design: Passive + Active Health Checks

**Passive (continuous):**
- WebSocket connection to CDP is monitored — disconnect = browser dead
- Screencast frame timeout: if no frame received for 30s (while session is active), flag as unhealthy

**Active (before each task):**
```ts
async function healthCheck(page: PlaywrightPage): Promise<boolean> {
  try {
    const result = await Promise.race([
      page.evaluate(() => true),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return result === true;
  } catch {
    return false;
  }
}
```

The 3-second timeout prevents blocking on a hung renderer (alive but unresponsive).

Run before `executeTask`/`executeExplore`. If unhealthy:

1. Broadcast `{ type: 'thought', content: 'Browser crashed. Restarting...' }` to clients
2. Broadcast `{ type: 'status', status: 'crashed' }` to clients
3. Call `reap(agentId)` — kills browser, cleans Redis, replenishes pool
4. Claim new browser from pool, navigate to agent URL
5. Recreate agent session (new magnitude instance, new listeners)
6. Broadcast `{ type: 'status', status: 'idle' }` — ready for task

Note: this is a **restart**, not a recovery. Browser state (cookies, DOM, scroll position) is lost. The user sees a fresh browser on the agent's target URL.

**Periodic (background):**
- Every 60 seconds, check `isAlive(pid, port)` for all active sessions
- Mark crashed sessions for recovery or destruction

### What Changes

| Current | New |
|---------|-----|
| No health checks between tasks | `healthCheck()` before every task |
| Browser crash detected only when next CDP call fails | Periodic + passive detection |
| No automatic recovery from crashed browser | Auto-recovery: kill → claim → recreate |

## 5. Session Lifecycle Limits

### Problem

Stateful sessions accumulate entropy: memory leaks, event listener buildup, SPA routing state drift, stale auth tokens. Without bounds, sessions degrade silently.

### Kill Conditions

A session MUST be terminated when any of these fire:

| Condition | Default | Rationale |
|-----------|---------|-----------|
| `ABSOLUTE_TIMEOUT_SECONDS` | 1800 (30 min) | Prevents unbounded resource usage |
| `IDLE_TIMEOUT_SECONDS` | 180 (3 min) | Reclaims idle browsers |
| `MAX_TASKS_PER_SESSION` | 20 | Limits state accumulation |
| `MAX_NAVIGATIONS_PER_SESSION` | 50 | Prevents SPA memory bloat |
| Health check failure | — | Browser crashed or hung |
| Explicit user termination | — | User clicks restart/end |

All configurable via environment variables.

### Session State Tracking

```ts
interface SessionLimits {
  taskCount: number;
  navigationCount: number;
  lastActivityAt: number;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
}
```

Tracked in Redis session hash. Updated after each task and navigation event. Checked before each task execution.

### What Changes

| Current | New |
|---------|-----|
| Only `ABSOLUTE_TIMEOUT_SECONDS` and `DETACHED_TIMEOUT_SECONDS` | Add `IDLE_TIMEOUT_SECONDS`, `MAX_TASKS_PER_SESSION`, `MAX_NAVIGATIONS_PER_SESSION` |
| No task/navigation counters | Track in Redis session hash |
| No health status field | Add `healthStatus` to session |

## 6. Pre-Task Sanity Check

### Problem

Between tasks, the browser can be in any state: mid-navigation, modal dialog blocking UI, document still loading, unknown URL. Without validation, the next task executes against ambiguous state and fails unpredictably.

### Design: `ensureSessionIsSane`

Run **before every task execution**, after acquiring the mutex:

```ts
async function ensureSessionIsSane(page: PlaywrightPage): Promise<void> {
  // 1. Page is alive (with timeout — catches hung renderers)
  await Promise.race([
    page.evaluate(() => true),
    new Promise((_, reject) => setTimeout(() => reject(new Error('page hung')), 3000)),
  ]);

  // 2. Wait for any in-flight navigation to settle
  await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});

  // 3. Dismiss blocking overlays (common flake source)
  await page.evaluate(() => {
    // Close cookie banners, modals, toast notifications
    const selectors = [
      '[role="dialog"] button[aria-label="Close"]',
      '[role="dialog"] button[aria-label="Dismiss"]',
      '.modal-close', '.toast-close', '.cookie-banner button',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el && el.offsetParent !== null) el.click();
    }
  }).catch(() => {});

  // 4. Document fully loaded
  const readyState = await page.evaluate(() => document.readyState);
  if (readyState !== 'complete') {
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
  }
}
```

### Failure Handling

If `ensureSessionIsSane` throws (page hung, browser dead):

1. Attempt **soft reset**: `page.goto(agentBaseUrl)` — navigate back to the agent's target URL
2. Re-run sanity check
3. If still failing → mark session unhealthy → `reap()` → auto-recovery (new browser from pool)

### Soft Reset Primitive

```ts
async function softReset(page: PlaywrightPage, baseUrl: string): Promise<boolean> {
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}
```

Used when:
- Task fails with unexpected state
- Page is on an unknown URL after a failed action
- `ensureSessionIsSane` detects degraded state

Does NOT kill the session — preserves cookies and auth. Only resets the page to a known URL.

### Task Execution Flow (Updated)

```
Task arrives
  → Acquire mutex
  → Check session limits (max tasks, navigations, TTL)
  → Run ensureSessionIsSane(page)
     → If fails → softReset(page, baseUrl)
        → If fails → reap + auto-recover
  → Execute task
  → Increment task count
  → Release mutex
```

### What Changes

| Current | New |
|---------|-----|
| Task handler calls `dispatchTask` directly | Insert `ensureSessionIsSane` + limit checks before dispatch |
| No inter-task state validation | Sanity check before every task |
| No recovery without full session kill | Soft reset preserves session, only kills on hard failure |

## 7. Reaper (Cleanup + Replacement)

### Current Problem

`destroySession` kills the browser but doesn't replace it in the warm pool. Orphaned resources from failed creations accumulate.

### Design

The Reaper is a single cleanup function called from every exit path:

```ts
async function reap(agentId: string): Promise<void> {
  const session = await redisStore.getSession(agentId);
  if (!session) return;

  // 1. Kill browser
  if (session.browserPid) {
    await killBrowser(session.browserPid, session.cdpPort);
  }

  // 2. Clean Redis state
  await redisStore.deleteSession(agentId);
  await redisStore.deleteScreenshot(agentId);
  await redisStore.deleteMessages(agentId);
  await redisStore.removeFromExpiry(agentId);

  // 3. Release execution lock (if held)
  await execLock.forceRelease(agentId);

  // 4. End database session
  if (session.dbSessionId) {
    await dbEndSession(session.dbSessionId);
  }

  // 5. Remove from local maps
  agents.delete(agentId);
  wsClients.delete(agentId);
  clearTimers(agentId);

  // 6. Replenish pool
  warmPool.replenish();
}
```

**Called from:**
- `destroySession` (normal end)
- `rollback` (failed creation)
- Health monitor (crashed browser)
- Detached timeout (client gone)
- Absolute timeout (session expired)
- LRU eviction (capacity exceeded)

### What Changes

| Current | New |
|---------|-----|
| `destroySession` has cleanup inline | Cleanup extracted to `reap()`, called from all exit paths |
| No pool replenishment after session end | `warmPool.replenish()` called after every reap |
| Cleanup steps vary by exit path | Single `reap()` function — every exit path converges |

## 8. Event Listener Hygiene

### Current Problem

`recoverSession()` calls `createAgent()` which registers new event listeners. Old listeners from the crashed server are never removed. Multiple recoveries accumulate duplicate listeners.

### Design

Before creating an agent on an existing browser (recovery path), clear all listeners:

```ts
// In createAgent, before registering listeners:
agent.events.removeAllListeners();
agent.browserAgentEvents.removeAllListeners();
```

This is already done in `close()` but not in the recovery path where the agent object is new but the browser context isn't.

Additionally, the `loginInProgress` and `loginDone` flags must be reset on recovery:

```ts
session.loginInProgress = false;
session.loginDone = Promise.resolve();
```

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `server/src/browserManager.ts` | Rename `warmUp` → `replenish` with capacity-awareness, warm browsers navigate to `about:blank`, add replenish mutex |
| `server/src/sessionManager.ts` | Stateful sessions (no per-task kill), session lifecycle limits, `ensureSessionIsSane()`, `softReset()`, atomic allocation with rollback, extract `reap()` from `destroySession`, remove pre-navigation hack, `healthCheck()` before task, stale `allocating` cleanup on recovery |
| `server/src/index.ts` | Acquire execution lock before `dispatchTask`/`dispatchExplore`, reject if busy, release on completion with lock renewal, check session limits before task, run sanity check |
| `server/src/agent.ts` | Clear listeners before registering in `createAgent` (safe for both fresh and recovery paths), reset login state |
| `server/src/redisStore.ts` | Add `acquireExecLock`, `releaseExecLock`, `forceReleaseExecLock`, `deleteScreenshot`, `deleteMessages`, `removeFromExpiry` functions. Add `allocating` to `RedisSessionStatus` type |
| `server/src/types.ts` | Add `'allocating'` to `RedisSessionStatus` union type |

### New Files

None. All changes are modifications to existing files.

### Dispatch Layer Note

Task execution enters through `agent-dispatch.ts` (`dispatchTask`/`dispatchExplore`) which routes to either the old `executeTask`/`executeExplore` or the new `executeAgentLoop` based on `USE_NEW_AGENT`. The execution mutex is acquired in `index.ts` before calling the dispatch layer, so both paths are protected.

## Testing Strategy

### Unit Tests

| Test | What It Verifies |
|------|-----------------|
| `warmPool.claim` returns browser + pool size decreases | Pool claiming works |
| `warmPool.replenish` restores pool to target size | Auto-replacement works |
| `createSession` rolls back on agent creation failure | No leaked ports/processes |
| `execLock.acquire` returns false when locked | Mutex prevents concurrent tasks |
| `execLock.release` only works with correct owner | Wrong-owner unlock prevented |
| `healthCheck` returns false when page is dead | Crash detection works |
| `reap` cleans all state (Redis, local maps, port, process) | No leaked resources |

### Integration Tests

| Test | What It Verifies |
|------|-----------------|
| Session create → task → destroy → pool replenished | Full lifecycle |
| Session create fails mid-way → port freed, browser killed | Rollback works |
| Two concurrent tasks → second rejected with error | Mutex enforced |
| Browser killed externally → health check detects → auto-recovery | Crash recovery works |
| Server restart → sessions recovered from Redis | Recovery path works |

## Phased Implementation

### Week 1: Stateful Sessions + Kill-and-Replace Pool
- Remove per-task browser kills — session stays alive across tasks
- Add session lifecycle limits: `MAX_TASKS_PER_SESSION`, `MAX_NAVIGATIONS_PER_SESSION`, `IDLE_TIMEOUT_SECONDS`
- Track `taskCount`, `navigationCount`, `healthStatus` in Redis session hash
- Modify `browserManager.ts`: warm browsers always `about:blank`, rename `warmUp` → `replenish()` with capacity check
- Modify `sessionManager.ts`: call `replenish()` after every session destruction, remove pre-navigation hack
- Extract unified `reap()` function from `destroySession`, called from all exit paths
- Pool sizing: `WARM_POOL_SIZE = MAX_CONCURRENT_BROWSERS + 1`

### Week 2: Sanity Check + Soft Reset + Atomic Allocation
- Add `ensureSessionIsSane()` — run before every task
- Add `softReset()` — navigate to base URL without killing session
- Add try/catch with `rollback()` in `createSession`
- Add `allocating` session state, clean stale allocations on recovery
- Clear event listeners before registering in `createAgent` (both fresh and recovery paths)

### Week 3: Execution Mutex + Health Monitor + Observability
- Add `acquireExecLock` / `releaseExecLock` / `forceReleaseExecLock` to `redisStore.ts`
- Wrap task/explore handlers in `index.ts` with lock acquire/release + renewal interval
- Reject concurrent tasks with user-facing error
- Add `healthCheck()` with 3s timeout before every task
- Add periodic background liveness check (every 60s)
- Auto-recovery: reap → claim → recreate on health failure
- Add task execution logging (task count, duration, success/failure per session)

## Migration

- No database changes required
- No client changes required
- Redis keys: new `session:lock:exec:{agentId}` key added (auto-expires)
- Backward compatible: existing sessions continue working, new sessions get isolation guarantees
- Warm pool behavior change is transparent to callers
