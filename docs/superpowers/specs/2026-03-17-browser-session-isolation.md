# Browser Session Isolation

**Date:** 2026-03-17
**Status:** Draft

## Problem

The browser execution layer lacks deterministic isolation. Warm browsers retain state from previous agent sessions, port allocation leaks on failure, concurrent tasks corrupt execution, and browser crashes go undetected. Every higher layer (policy, learning, exploration) assumes deterministic execution — and doesn't have it.

## Core Invariant

**One agent session = one browser process = one execution timeline.**

No exceptions. No sharing. No reuse of post-session browsers.

## Design Principles

1. **Isolation is a system property, not a discipline** — kill-and-replace, not clean-and-reuse
2. **No partial state survives failure** — every failure path converges to full cleanup
3. **Serializability** — one session executes exactly one task at a time
4. **Recoverability** — failures reset cleanly, pool self-heals

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

ON SESSION END (any reason):
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

## 5. Reaper (Cleanup + Replacement)

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

## 6. Event Listener Hygiene

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
| `server/src/sessionManager.ts` | Atomic allocation with rollback, extract `reap()` from `destroySession`, remove pre-navigation hack, add `healthCheck()` before task, clean up stale `allocating` sessions on recovery |
| `server/src/index.ts` | Acquire execution lock before `dispatchTask`/`dispatchExplore` (via `agent-dispatch.ts`), reject if busy, release on completion with lock renewal interval |
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

### Phase 1: Kill-and-Replace Pool
- Modify `browserManager.ts`: warm browsers always `about:blank`, add `replenish()`
- Modify `sessionManager.ts`: call `replenish()` after every `destroySession`
- Remove pre-navigation hack from `createSession`
- Update pool sizing: `WARM_POOL_SIZE = MAX_CONCURRENT_BROWSERS + 1`

### Phase 2: Atomic Allocation
- Add try/catch with `rollback()` in `createSession`
- Add `allocating` session state
- Ensure every failure path calls `reap()`

### Phase 3: Execution Mutex
- Add `acquireExecLock` / `releaseExecLock` to `redisStore.ts`
- Wrap task/explore handlers in `index.ts` with lock acquire/release
- Reject concurrent tasks with user-facing error message

### Phase 4: Health Monitor
- Add `healthCheck()` function (page.evaluate ping)
- Call before every task execution
- Add periodic background check (every 60s)
- Auto-recovery: kill → claim → recreate on failure

### Phase 5: Listener Hygiene
- Clear event listeners before registering in recovery path
- Reset `loginInProgress` / `loginDone` on recovery

## Migration

- No database changes required
- No client changes required
- Redis keys: new `session:lock:exec:{agentId}` key added (auto-expires)
- Backward compatible: existing sessions continue working, new sessions get isolation guarantees
- Warm pool behavior change is transparent to callers
