# Always-Connected Agent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove manual start/stop flow — agents auto-connect on page visit, stay alive while the user is on the page, and clean up automatically when they leave.

**Architecture:** Client-driven auto-connect with server-side LRU eviction and two-tier timeouts. `startAgent()` becomes the single entry point, handling both new and existing sessions. Server manages concurrent browser capacity with a mutex-protected eviction loop.

**Tech Stack:** TypeScript, React 19, WebSocket (ws), Redis, Vitest

**Spec:** `docs/superpowers/specs/2026-03-15-always-connected-agent-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|---------------|--------|
| `server/src/types.ts` | Shared types | Add new message types, `detachedAt` to RedisSession |
| `client/src/types.ts` | Client types | Mirror server message type changes |
| `server/src/redisStore.ts` | Redis session CRUD | Add `updateLastActivity()`, update TTL strategy, update `pollExpiredSessions` |
| `server/src/sessionManager.ts` | Session orchestration | Add eviction, capacity mutex, beforeEvict hook, local timeouts |
| `server/src/index.ts` | WS server | Merge start/resume, remove stop, add restart, fix activeTasks cleanup |
| `client/src/contexts/WebSocketContext.tsx` | Client WS state | Remove stop/resume, add isReconnect, pendingTasks queue, new message handlers |
| `client/src/components/TestingView.tsx` | Agent page | Simplify to unconditional `startAgent()` |
| `client/src/components/ChatPanel.tsx` | Chat UI | Remove Start/Stop buttons, status-driven input |
| `client/src/components/AgentSettings.tsx` | Agent settings | Add "Restart Agent" button |
| `server/__tests__/sessionManager.test.ts` | Session manager tests | Add eviction, capacity, timeout tests |
| `server/__tests__/redisStore.test.ts` | Redis tests | Add `updateLastActivity` test |

---

## Chunk 1: Server Foundation

### Task 1: Update Server Message Types

**Files:**
- Modify: `server/src/types.ts`

- [ ] **Step 1: Add new message types and `detachedAt` to RedisSession**

In `server/src/types.ts`, update the `ClientMessage` union type:

```ts
// Remove these variants:
//   | { type: 'resume'; agentId: string }
//   | { type: 'stop' }

// Add this variant:
  | { type: 'restart'; agentId: string }
```

Update `ServerMessage` union type — add these variants:

```ts
  | { type: 'session_evicted'; agentId: string; reason: 'capacity' }
  | { type: 'session_expiring'; remainingSeconds: number }
  | { type: 'session_new'; agentId: string }
```

Update `RedisSession` interface — add field:

```ts
  detachedAt: number;  // 0 = not detached, Date.now() = detach timestamp
```

- [ ] **Step 2: Run tests to verify nothing breaks**

Run: `cd browser-agent-chat && npx vitest run`
Expected: All 163 tests pass (type changes alone don't break runtime)

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(types): add always-connected message types and detachedAt field"
```

---

### Task 2: Update Client Message Types

**Files:**
- Modify: `client/src/types.ts`

- [ ] **Step 1: Mirror the server type changes**

In `client/src/types.ts`, make the same changes:

Remove from `ClientMessage`:
```ts
//   | { type: 'resume'; agentId: string }
//   | { type: 'stop' }
```

Add to `ClientMessage`:
```ts
  | { type: 'restart'; agentId: string }
```

Add to `ServerMessage`:
```ts
  | { type: 'session_evicted'; agentId: string; reason: 'capacity' }
  | { type: 'session_expiring'; remainingSeconds: number }
  | { type: 'session_new'; agentId: string }
```

- [ ] **Step 2: Commit**

```bash
git add client/src/types.ts
git commit -m "feat(types): mirror always-connected message types on client"
```

---

### Task 3: Redis Store — `updateLastActivity` and TTL Changes

**Files:**
- Modify: `server/src/redisStore.ts`
- Test: `server/__tests__/redisStore.test.ts`

- [ ] **Step 1: Write failing test for `updateLastActivity`**

Add to `server/__tests__/redisStore.test.ts`. Follow the existing mock pattern — the test file mocks ioredis at module level with an in-memory Map. Verify the `hset` call directly:

```ts
describe('updateLastActivity', () => {
  it('calls hset with only lastActivityAt field', async () => {
    const agentId = 'test-agent';
    const before = Date.now();
    await redisStore.updateLastActivity(agentId);

    // Verify hset was called on the session key with lastActivityAt
    // The mock redis stores calls — check the mock's hset was invoked
    // with `session:test-agent`, `lastActivityAt`, and a timestamp string
    expect(mockRedis.hset).toHaveBeenCalledWith(
      `session:${agentId}`,
      'lastActivityAt',
      expect.stringMatching(/^\d+$/)
    );
    // Verify it did NOT call pipeline (which refreshTTL does)
    // This confirms updateLastActivity doesn't reset TTL
  });
});
```

Also update the existing `getSession` test expectations to include `detachedAt: 0` in the expected output (since we're adding this field to `getSession` parsing). In the existing test's mock data object, add `detachedAt: '0'` to the hgetall mock return value, and add `detachedAt: 0` to the expected result assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/redisStore.test.ts`
Expected: FAIL — `updateLastActivity` is not a function

- [ ] **Step 3: Implement `updateLastActivity` and TTL changes**

In `server/src/redisStore.ts`:

1. Replace `SESSION_TTL_SECONDS` default:
```ts
const ABSOLUTE_TIMEOUT = () => parseInt(process.env.ABSOLUTE_TIMEOUT_SECONDS || '1800', 10);
const SAFETY_TTL = () => ABSOLUTE_TIMEOUT() + 300; // 35 min safety net
```

2. Update `refreshTTL` to use `SAFETY_TTL()` instead of `DEFAULT_TTL()`:
```ts
// In refreshTTL(), replace all instances of DEFAULT_TTL() with SAFETY_TTL()
```

3. Add `updateLastActivity`:
```ts
export async function updateLastActivity(agentId: string): Promise<void> {
  await redis.hset(`session:${agentId}`, 'lastActivityAt', String(Date.now()));
}
```

4. Update `getSession()` — add `detachedAt` parsing after the existing field mappings:
```ts
detachedAt: parseInt(data.detachedAt, 10) || 0,
```

5. `pollExpiredSessions` — no code changes needed here. It uses `zrangebyscore` against the sorted set, where scores are set by `refreshTTL`. Since `refreshTTL` now uses `SAFETY_TTL()` for the expiry score, `pollExpiredSessions` will automatically pick up the new timeout. Just verify it still works after the `refreshTTL` constant change.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/redisStore.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/redisStore.ts server/__tests__/redisStore.test.ts
git commit -m "feat(redis): add updateLastActivity, update TTL to safety-net strategy"
```

---

### Task 4: Session Manager — LRU Eviction and Capacity

**Files:**
- Modify: `server/src/sessionManager.ts`
- Test: `server/__tests__/sessionManager.test.ts`

- [ ] **Step 1: Write failing tests for eviction and capacity**

Add to `server/__tests__/sessionManager.test.ts`:

Follow the existing mock patterns in `sessionManager.test.ts` (which mocks `redisStore`, `browserManager`, and `agent` via `vi.mock()`). Read the test file first and use the same setup. The test bodies below use the pattern where `agents` and `wsClients` Maps are accessed via module-internal state — you'll need to set up sessions via `createSession()` mock flow or directly populate internal state depending on what the existing tests do.

```ts
describe('LRU eviction', () => {
  it('evictLRUSession evicts the oldest detached session first', async () => {
    // Create 3 sessions with different lastActivityAt values
    // Session A: lastActivityAt=1000, no WS clients (detached)
    // Session B: lastActivityAt=2000, has WS client
    // Session C: lastActivityAt=3000, has WS client
    // Mock redisStore.getSession to return these values

    const evicted = await sessionManager.evictLRUSession();

    expect(evicted).toBe('agent-a'); // oldest detached
    // Verify destroySession was called for agent-a
    expect(redisStore.deleteSession).toHaveBeenCalledWith('agent-a');
  });

  it('evictLRUSession evicts oldest active session and notifies client when no detached', async () => {
    // Create 2 sessions, both with WS clients
    // Session A: lastActivityAt=1000, has WS client (mockWsA)
    // Session B: lastActivityAt=2000, has WS client

    const evicted = await sessionManager.evictLRUSession();

    expect(evicted).toBe('agent-a');
    // Verify session_evicted was sent to mockWsA before destroy
    expect(mockWsA.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"session_evicted"')
    );
  });

  it('ensureCapacity evicts until below MAX_CONCURRENT_BROWSERS', async () => {
    // Set MAX_CONCURRENT_BROWSERS=2 via env
    // Create 3 sessions
    await sessionManager.ensureCapacity();

    // At least one session should have been evicted
    // Verify agents map size is < 2
  });

  it('ensureCapacity is a no-op when under capacity', async () => {
    // Create 1 session, MAX_CONCURRENT_BROWSERS=3
    const destroySpy = vi.spyOn(sessionManager, 'destroySession');

    await sessionManager.ensureCapacity();

    expect(destroySpy).not.toHaveBeenCalled();
  });

  it('beforeEvict hook is called before destroySession', async () => {
    const hook = vi.fn().mockResolvedValue(undefined);
    sessionManager.setBeforeEvictHook(hook);

    // Create 1 session
    await sessionManager.evictLRUSession();

    expect(hook).toHaveBeenCalledWith(expect.any(String));
    // Verify hook was called BEFORE destroySession
  });
});
```

Adapt these to match the exact mock setup in the existing test file. The key behaviors to verify are: (1) detached-first preference, (2) client notification on active eviction, (3) hook invocation order, (4) capacity enforcement.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/sessionManager.test.ts`
Expected: FAIL — `evictLRUSession`, `ensureCapacity`, `setBeforeEvictHook` not found

- [ ] **Step 3: Implement eviction functions**

In `server/src/sessionManager.ts`:

1. Add env var constant at top:
```ts
const MAX_CONCURRENT_BROWSERS = parseInt(process.env.MAX_CONCURRENT_BROWSERS || '3', 10);
```

2. Add beforeEvict hook:
```ts
let onBeforeEvict: ((agentId: string) => Promise<void>) | null = null;

export function setBeforeEvictHook(hook: (agentId: string) => Promise<void>) {
  onBeforeEvict = hook;
}
```

3. Add `evictLRUSession`:
```ts
export async function evictLRUSession(): Promise<string | null> {
  const sessions = Array.from(agents.entries());
  if (sessions.length === 0) return null;

  // Sort by lastActivityAt ascending (oldest first)
  // Need to fetch from Redis for each session
  const sessionData = await Promise.all(
    sessions.map(async ([agentId]) => {
      const data = await redisStore.getSession(agentId);
      const clientCount = wsClients.get(agentId)?.size ?? 0;
      return { agentId, lastActivityAt: data?.lastActivityAt ?? 0, clientCount };
    })
  );

  // Prefer detached sessions (no WS clients)
  const detached = sessionData.filter(s => s.clientCount === 0).sort((a, b) => a.lastActivityAt - b.lastActivityAt);
  const target = detached.length > 0
    ? detached[0]
    : sessionData.sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];

  if (!target) return null;

  // Notify active client before eviction
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

  await destroySession(target.agentId);
  return target.agentId;
}
```

4. Add `ensureCapacity` with mutex:
```ts
let capacityLock: Promise<void> = Promise.resolve();

export async function ensureCapacity(): Promise<void> {
  // Simple promise-chain mutex
  const prev = capacityLock;
  let release: () => void;
  capacityLock = new Promise(resolve => { release = resolve; });

  await prev; // Wait for any previous ensureCapacity to finish
  try {
    while (agents.size >= MAX_CONCURRENT_BROWSERS) {
      await evictLRUSession();
    }
  } finally {
    release!();
  }
}
```

5. Export new functions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/sessionManager.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/sessionManager.ts server/__tests__/sessionManager.test.ts
git commit -m "feat(session): add LRU eviction with mutex-protected ensureCapacity"
```

---

### Task 5: Session Manager — Detached and Absolute Timeouts

**Files:**
- Modify: `server/src/sessionManager.ts`
- Test: `server/__tests__/sessionManager.test.ts`

- [ ] **Step 1: Write failing tests for timeout behavior**

Add to `server/__tests__/sessionManager.test.ts`:

```ts
describe('detached timeout', () => {
  it('starts detached timer when last client disconnects', async () => {
    // Create session, add client, remove client
    // Verify: detachedAt set in Redis, setTimeout called
  });

  it('cancels detached timer when client reconnects', async () => {
    // Create session, add client, remove client, add new client
    // Verify: clearTimeout called, detachedAt reset to 0
  });

  it('destroys session when detached timer fires', async () => {
    // Use vi.useFakeTimers()
    // Create session, remove all clients
    // Advance time by DETACHED_TIMEOUT
    // Verify: session destroyed
  });
});

describe('absolute timeout', () => {
  it('sets absolute timeout on session creation', async () => {
    // Create session
    // Verify: setTimeout called with ABSOLUTE_TIMEOUT_SECONDS * 1000
  });

  it('sends session_expiring warning at 5 minutes before expiry', async () => {
    // Use vi.useFakeTimers()
    // Create session
    // Advance to ABSOLUTE - 300s
    // Verify: session_expiring message broadcast
  });

  it('destroys session when absolute timeout fires', async () => {
    // Use vi.useFakeTimers()
    // Create session
    // Advance to ABSOLUTE timeout
    // Verify: session destroyed
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/sessionManager.test.ts`
Expected: FAIL — timeout behavior not implemented

- [ ] **Step 3: Implement detached and absolute timeouts**

In `server/src/sessionManager.ts`:

1. Add env var constants:
```ts
const DETACHED_TIMEOUT_SECONDS = parseInt(process.env.DETACHED_TIMEOUT_SECONDS || '120', 10);
const ABSOLUTE_TIMEOUT_SECONDS = parseInt(process.env.ABSOLUTE_TIMEOUT_SECONDS || '1800', 10);
```

2. Add timer storage Maps:
```ts
const detachedTimers = new Map<string, ReturnType<typeof setTimeout>>();
const absoluteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const warningTimers = new Map<string, ReturnType<typeof setTimeout>>();
```

3. Modify `removeClient()` — after removing the WS from the set, if the set is empty, start the detached timer:
```ts
export function removeClient(agentId: string, ws: WebSocket) {
  const clients = wsClients.get(agentId);
  if (clients) {
    clients.delete(ws);
    if (clients.size === 0) {
      wsClients.delete(agentId);
      startDetachedTimer(agentId);
    }
  }
}

function startDetachedTimer(agentId: string) {
  // Store detachedAt in Redis for crash recovery
  redisStore.setSession(agentId, { detachedAt: Date.now() } as Partial<RedisSession>);

  const timer = setTimeout(async () => {
    detachedTimers.delete(agentId);
    if (onBeforeEvict) await onBeforeEvict(agentId);
    await destroySession(agentId);
  }, DETACHED_TIMEOUT_SECONDS * 1000);

  detachedTimers.set(agentId, timer);
}
```

4. Modify `addClient()` — cancel detached timer if reconnecting:
```ts
export function addClient(agentId: string, ws: WebSocket) {
  if (!wsClients.has(agentId)) {
    wsClients.set(agentId, new Set());
  }
  wsClients.get(agentId)!.add(ws);
  redisStore.refreshTTL(agentId);

  // Cancel detached timer if reconnecting
  const timer = detachedTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    detachedTimers.delete(agentId);
    redisStore.setSession(agentId, { detachedAt: 0 } as Partial<RedisSession>);
  }
}
```

5. Modify `createSession()` — at the end, start absolute timeout:
```ts
// After storing in agents map:
startAbsoluteTimeout(agentId);
```

```ts
function startAbsoluteTimeout(agentId: string) {
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
    await destroySession(agentId);
  }, ABSOLUTE_TIMEOUT_SECONDS * 1000);

  absoluteTimers.set(agentId, absTimer);
}
```

6. Modify `recoverSession()` — after successful recovery (agent reconnected), start the absolute timeout so recovered sessions respect the 30-min cap:
```ts
// At the end of recoverSession(), after agents.set(agentId, agentSession):
startAbsoluteTimeout(agentId);
```

7. Modify `destroySession()` — clean up timers:
```ts
// At the top of destroySession(), before any other cleanup:
const detTimer = detachedTimers.get(agentId);
if (detTimer) { clearTimeout(detTimer); detachedTimers.delete(agentId); }
const absTimer = absoluteTimers.get(agentId);
if (absTimer) { clearTimeout(absTimer); absoluteTimers.delete(agentId); }
const warnTimer = warningTimers.get(agentId);
if (warnTimer) { clearTimeout(warnTimer); warningTimers.delete(agentId); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/sessionManager.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/sessionManager.ts server/__tests__/sessionManager.test.ts
git commit -m "feat(session): add detached and absolute timeouts with local setTimeout"
```

---

### Task 6: Server Index — Unified Start Handler and Restart

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Register the beforeEvict hook**

Near the top of `index.ts` (after imports, before WS handler), add:

```ts
import { setBeforeEvictHook, ensureCapacity } from './sessionManager.js';

// Register beforeEvict hook for active task cleanup
setBeforeEvictHook(async (agentId: string) => {
  const taskEntry = activeTasks.get(agentId);
  if (taskEntry) {
    const agent = sessionManager.getAgent(agentId);
    if (agent) {
      try { await agent.close(); } catch (e) { /* agent already closed */ }
    }
    // Update task DB record to 'cancelled' if we have a task ID
    if (taskEntry.taskId) {
      try {
        await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', taskEntry.taskId);
      } catch (e) { /* best effort */ }
    }
    activeTasks.delete(agentId);
  }
});
```

- [ ] **Step 2: Merge start and resume handlers**

Replace the existing `msg.type === 'start'` handler (lines ~123-182) and remove the `msg.type === 'resume'` handler (lines ~184-197). The unified handler:

```ts
if (msg.type === 'start') {
  const { agentId, resumeUrl } = msg;
  clientAgents.set(ws, agentId);
  clientUserIds.set(ws, userId);

  // Check for existing session (fast path: reattach)
  const existing = await sessionManager.hasSession(agentId);
  if (existing) {
    const agent = sessionManager.getAgent(agentId);
    if (agent) {
      // Reattach — session alive
      sessionManager.addClient(agentId, ws);
      await sessionManager.sendSnapshot(agentId, ws);
      return;
    }
    // Session in Redis but agent dead — clean up stale
    await sessionManager.destroySession(agentId);
  }

  // New session path
  await ensureCapacity();

  // Create DB session record
  const { data: dbSession } = await supabase.from('sessions').insert({
    agent_id: agentId,
    user_id: userId,
    status: 'active',
  }).select('id').single();

  // Get agent URL from DB — look at the current start handler for the exact pattern
  const { data: agentRecord } = await supabase.from('agents').select('url').eq('id', agentId).single();
  const url = resumeUrl || agentRecord?.url || 'about:blank';
  const agent = await sessionManager.createSession(agentId, url, dbSession?.id);

  sessionManager.addClient(agentId, ws);

  // Signal new session to client
  ws.send(JSON.stringify({ type: 'session_new', agentId }));
  ws.send(JSON.stringify({ type: 'status', status: 'idle' }));

  // Login detection (async, non-blocking)
  handleLoginDetection(agentId, url, agent).catch(() => {});
}
```

Note: The exact implementation of `getAgentUrl(agentId)` depends on the existing code — look at how the current `start` handler resolves the agent's URL (likely from Supabase `agents` table).

- [ ] **Step 3: Remove `stop` handler, add `restart` handler**

Remove the `msg.type === 'stop'` block (lines ~256-271).

Add `restart` handler. **Use the beforeEvict hook** (not inline cleanup) per spec:

```ts
if (msg.type === 'restart') {
  const { agentId } = msg;

  // Reuse the same beforeEvict hook registered at startup — same cleanup for eviction and restart
  await sessionManager.destroySession(agentId);
  // Note: destroySession already calls beforeEvict hook internally (added in Task 4)
  // which handles activeTasks cleanup, agent.close(), and DB task cancellation

  await ensureCapacity();

  const { data: dbSession } = await supabase.from('sessions').insert({
    agent_id: agentId,
    user_id: userId,
    status: 'active',
  }).select('id').single();

  // Get agent URL from DB — use the existing getAgent() from db.ts
  // (look at the current start handler to see how it resolves the URL)
  const { data: agentRecord } = await supabase.from('agents').select('url').eq('id', agentId).single();
  const url = agentRecord?.url || 'about:blank';
  const agent = await sessionManager.createSession(agentId, url, dbSession?.id);

  sessionManager.addClient(agentId, ws);

  ws.send(JSON.stringify({ type: 'session_new', agentId }));
  ws.send(JSON.stringify({ type: 'status', status: 'idle' }));

  handleLoginDetection(agentId, url, agent).catch(() => {});
}
```

**Important:** Make `evictLRUSession` call `onBeforeEvict` BEFORE `destroySession` (already done in Task 4). For `restart`, since `destroySession` is called from `index.ts` directly, also call the beforeEvict hook before destroySession:
```ts
// Before destroySession in restart handler:
// The beforeEvict hook is a module-level function in sessionManager.ts.
// Export a helper that calls it:
await sessionManager.callBeforeEvictHook(agentId);
await sessionManager.destroySession(agentId);
```

Add `export async function callBeforeEvictHook(agentId: string)` to sessionManager that calls `onBeforeEvict`.

- [ ] **Step 4: Fix `activeTasks.delete` on `ws.close`**

In the `ws.on('close')` handler (lines ~365-375), **remove** the `activeTasks.delete(agentId)` line. This fixes the pre-existing bug where a WS blip silently drops task tracking. Tasks should only be cleaned up on completion, eviction, or explicit cancellation.

```ts
ws.on('close', () => {
  const agentId = clientAgents.get(ws);
  if (agentId) {
    sessionManager.removeClient(agentId, ws);
    clientAgents.delete(ws);
    clientUserIds.delete(ws);
    // DO NOT delete activeTasks here — task continues running server-side
  }
});
```

- [ ] **Step 5: Add `updateLastActivity` to ping handler**

In the ping/pong handler (lines ~116-121):

```ts
if (msg.type === 'ping') {
  ws.send(JSON.stringify({ type: 'pong' }));
  const agentId = clientAgents.get(ws);
  if (agentId) {
    redisStore.updateLastActivity(agentId);
  }
  return;
}
```

- [ ] **Step 6: Run tests**

Run: `cd browser-agent-chat && npx vitest run`
Expected: All tests pass. Some existing tests for `stop` handler may need updating.

- [ ] **Step 7: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): unified start handler, restart, fix activeTasks on ws.close"
```

---

## Chunk 2: Client Changes

### Task 7: WebSocketContext — Remove Stop/Resume, Add Reconnect Logic

**Files:**
- Modify: `client/src/contexts/WebSocketContext.tsx`

- [ ] **Step 1: Update `startAgent` function**

Replace the current `startAgent` (lines ~307-323):

```tsx
const startAgent = useCallback((agentId: string, isReconnect = false) => {
  // Clear stale state if switching agents
  if (activeAgentRef.current && activeAgentRef.current !== agentId) {
    setMessages([]);
    setScreenshot(null);
    setCurrentUrl(null);
    setFindings([]);
    setPendingSuggestionCount(0);
    setActiveTaskId(null);
    setLastCompletedTask(null);
    setFeedbackAck(null);
    lastUrlRef.current = null; // Clear URL from previous agent
  }

  activeAgentRef.current = agentId;
  setActiveAgentId(agentId);

  if (!isReconnect) {
    setStatus('working'); // Optimistic — shows loading state
  }

  send({ type: 'start', agentId, resumeUrl: lastUrlRef.current || undefined });
}, [send]);
```

- [ ] **Step 2: Remove `stopAgent` and `resumeSession` functions**

Delete the `stopAgent` function (lines ~345-353) and `resumeSession` function (lines ~325-338). Remove them from the context value object and the `WebSocketContextType` interface.

- [ ] **Step 3: Add `pendingTasksRef` for disconnected task queue**

```tsx
const pendingTasksRef = useRef<string[]>([]);
```

Update `sendTask` to queue when disconnected:

```tsx
const sendTask = useCallback((content: string) => {
  addMessage('user', content);
  if (wsRef.current?.readyState === WebSocket.OPEN) {
    send({ type: 'task', content });
  } else {
    pendingTasksRef.current.push(content);
  }
}, [send, addMessage]);
```

- [ ] **Step 4: Update `ws.onopen` reconnect handler**

Replace the existing reconnect logic (lines ~248-263):

```tsx
ws.onopen = () => {
  setConnected(true);
  startHeartbeat();

  // Auto-reconnect: re-establish session
  if (activeAgentRef.current) {
    startAgent(activeAgentRef.current, /* isReconnect */ true);
  }
  // NOTE: Do NOT drain pending tasks here. They are drained in handleMessage
  // when we receive 'status' (idle) or 'sessionRestore' — this ensures the
  // session is actually ready before sending queued tasks.
};
```

Then in the `handleMessage` function, add pending task drain logic. In the `case 'status'` handler, after setting the status, add:

```tsx
case 'status':
  setStatus(parsed.status);
  // ... existing handling ...

  // Drain pending tasks when session is ready (idle after reconnect)
  if (parsed.status === 'idle' && pendingTasksRef.current.length > 0) {
    const pending = pendingTasksRef.current;
    pendingTasksRef.current = [];
    for (const content of pending) {
      send({ type: 'task', content });
    }
  }

  // IMPORTANT: Do NOT clear activeAgentId/activeAgentRef on server-sent 'disconnected'
  // status. The existing handler clears them, which breaks auto-reconnect. Modify:
  // - Remove: if (parsed.status === 'disconnected') { setActiveAgentId(null); activeAgentRef.current = null; }
  // - The always-connected model keeps activeAgentRef set so reconnect can re-establish
  break;
```

- [ ] **Step 5: Handle new server messages**

In the `handleMessage` function (lines ~84-241), add handlers:

First, add new state variables for banners/toasts:

```tsx
const [sessionWarning, setSessionWarning] = useState<string | null>(null); // expiring banner
const [sessionEvicted, setSessionEvicted] = useState<boolean>(false); // eviction toast
```

Export `sessionWarning` and `sessionEvicted` from context so ChatPanel can render them.

Then add the message handlers:

```tsx
case 'session_evicted':
  setStatus('disconnected');
  setSessionEvicted(true); // ChatPanel renders a toast with "Click to reconnect" button
  activeAgentRef.current = null; // Clear — user must explicitly reconnect
  break;

case 'session_expiring':
  setSessionWarning(`Session expires in ${Math.floor(parsed.remainingSeconds / 60)} minutes.`);
  // Banner is clearable — cleared on session_new or restart
  break;

case 'session_new':
  // Reset all session-bound state for fresh session
  setMessages([]);
  setScreenshot(null);
  setCurrentUrl(null);
  setFindings([]);
  setPendingSuggestionCount(0);
  setActiveTaskId(null);
  setLastCompletedTask(null);
  setFeedbackAck(null);
  setPendingCredentialRequest(null);
  setSessionWarning(null); // Clear expiring banner
  setSessionEvicted(false); // Clear eviction toast
  break;
```

The `explore()` function currently calls `addMessage('system', 'Explore & Learn started...')` before calling `startAgent()`. Move this message to AFTER receiving `session_new`/`idle` — use the existing `pendingExploreRef` pattern: when `explore()` triggers a start, set `pendingExploreRef` but do NOT add the system message. The message is added when the `useEffect` for `pendingExploreRef` fires on `status === 'idle'` (after the server response).

- [ ] **Step 6: Add `sendRestart` function**

```tsx
const sendRestart = useCallback((agentId: string) => {
  send({ type: 'restart', agentId });
  setStatus('working'); // Optimistic while restart happens
}, [send]);
```

Add `sendRestart` to the context value and `WebSocketContextType` interface.

- [ ] **Step 7: Clean up — remove `stopAgent`/`resumeSession` from context value and type**

In the context value object and `WebSocketContextType` interface, remove `stopAgent` and `resumeSession`. Add `sendRestart`.

- [ ] **Step 8: Commit**

```bash
git add client/src/contexts/WebSocketContext.tsx
git commit -m "feat(ws): unified startAgent with reconnect, remove stop/resume, add pending task queue"
```

---

### Task 8: TestingView — Unconditional Auto-Connect

**Files:**
- Modify: `client/src/components/TestingView.tsx`

- [ ] **Step 1: Simplify to unconditional `startAgent`**

Remove:
- `isAutoStart` flag and `location.state` check (line ~19)
- The conditional `useEffect` choosing between `resumeSession` and `startAgent` (lines ~23-38)
- The `navigate(location.pathname, { replace: true, state: {} })` state clearing

Replace with a single unconditional mount effect:

```tsx
const { id } = useParams();

// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
  if (id) {
    ws.startAgent(id);
  }
}, [id]); // Only re-run if agent ID changes — startAgent is stable
```

Remove unused imports: `useLocation` (no longer needed since we removed `location.state` check). Keep `useNavigate` only if still used elsewhere in the component; remove if not.

Remove `onStartAgent` and `onStopAgent` callbacks (lines ~85, 87). Keep `onExplore`.

Update the JSX — remove `onStartAgent={...}` and `onStopAgent={...}` props from `<ChatPanel>`.

- [ ] **Step 2: Commit**

```bash
git add client/src/components/TestingView.tsx
git commit -m "feat(testing): unconditional auto-connect on mount, remove start/stop callbacks"
```

---

### Task 9: ChatPanel — Remove Start/Stop Buttons, Status-Driven Input

**Files:**
- Modify: `client/src/components/ChatPanel.tsx`

- [ ] **Step 1: Remove Start/Stop buttons and their props**

Remove `onStartAgent` and `onStopAgent` from the component's props interface/destructuring.

Find and remove the Start/Stop button JSX block (around lines 109-113):
```tsx
{/* Remove this entire block: */}
{isActive ? (
  <button className="btn-stop" onClick={onStopAgent}>Stop</button>
) : (
  <button className="btn-primary btn-sm" onClick={onStartAgent}>Start Agent</button>
)}
```

- [ ] **Step 2: Update input disabled logic and handleSubmit guard**

Replace the current `disabled={!isActive}` with status-driven behavior:

```tsx
const inputDisabled = status === 'crashed' || status === 'error';
// Input stays enabled for idle, working (task queued), and disconnected (pending queue)
```

**Also update `handleSubmit`** (line ~97) — the current guard `if (!input.trim() || !isActive) return;` rejects submissions during `disconnected` state, which breaks the spec's "tasks queued locally" behavior. Fix:

```tsx
const handleSubmit = () => {
  if (!input.trim() || inputDisabled) return; // Use inputDisabled instead of !isActive
  onSendTask(input);
  setInput('');
};
```

- [ ] **Step 3: Add status-specific inline indicators and eviction/expiry banners**

Import `sessionWarning`, `sessionEvicted`, `sendRestart`, and `activeAgentId` from WS context (or receive `agentId` as prop — ChatPanel already receives it as `_agentId`).

Below the chat input, add contextual indicators:

```tsx
{status === 'disconnected' && !sessionEvicted && (
  <div className="chat-status-indicator reconnecting">Reconnecting...</div>
)}
{sessionEvicted && (
  <div className="chat-status-indicator evicted">
    Session ended — another agent needed the slot.
    <button onClick={() => { ws.startAgent(_agentId); }}>Reconnect</button>
  </div>
)}
{(status === 'crashed' || status === 'error') && (
  <div className="chat-status-indicator error">
    Session error. <button onClick={() => ws.sendRestart(_agentId)}>Restart Agent</button>
  </div>
)}
{sessionWarning && (
  <div className="chat-status-banner warning">{sessionWarning}</div>
)}
```

Note: `_agentId` is already available as a prop in ChatPanel (line 25 of the current code). Use it instead of `activeAgentId` from context.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ChatPanel.tsx
git commit -m "feat(chat): remove start/stop buttons, add status-driven input and indicators"
```

---

### Task 10: AgentSettings — Add Restart Button

**Files:**
- Modify: `client/src/components/AgentSettings.tsx`

- [ ] **Step 1: Add Restart Agent section**

First, add the import and hook:
```tsx
import { useWS } from '../contexts/WebSocketContext';
// ... inside the component:
const ws = useWS();
```

Above the existing "Danger Zone" section, add a "Session" section:

```tsx
<div className="settings-section">
  <h3>Session</h3>
  <p className="settings-description">
    If the browser appears frozen or unresponsive, restart the agent session.
  </p>
  <button
    className="settings-btn restart"
    onClick={() => {
      if (confirm('Restart the agent? This will end the current browser session.')) {
        // Send restart, then navigate to testing page.
        // TestingView will call startAgent on mount, but the server will see
        // the session is already being created by the restart flow and reattach.
        // This is safe because startAgent checks for existing session first (fast path).
        ws.sendRestart(agentId);
        navigate(`/testing/${agentId}`);
      }
    }}
  >
    Restart Agent
  </button>
</div>
```

**Race condition note:** When navigating to `/testing/${agentId}`, TestingView calls `ws.startAgent(agentId)`. The server's unified start handler checks Redis for an existing session — the restart's newly created session will be found, and `startAgent` will reattach (fast path). No double-creation.

Style the button with the existing button patterns (use `var(--warning-color)` or similar).

- [ ] **Step 2: Commit**

```bash
git add client/src/components/AgentSettings.tsx
git commit -m "feat(settings): add Restart Agent button for frozen browser recovery"
```

---

## Chunk 3: Integration and Verification

### Task 11: Fix Compilation Errors

**Files:**
- Various — any files that reference removed functions (`stopAgent`, `resumeSession`, `'stop'` message type)

- [ ] **Step 1: Find all references to removed functions**

Search the codebase for:
- `stopAgent` — remove all call sites
- `resumeSession` — remove all call sites
- `type: 'stop'` — remove all references
- `type: 'resume'` — remove all references
- `onStopAgent` — remove prop drilling
- `onStartAgent` — remove prop drilling

- [ ] **Step 2: Fix each reference**

Update any remaining files that use the old API. Common locations:
- Other components that pass `onStopAgent`/`onStartAgent` as props
- Any component that imports `stopAgent`/`resumeSession` from context

- [ ] **Step 3: Run TypeScript compilation**

Run: `cd browser-agent-chat && npx tsc --noEmit -p client/tsconfig.json && npx tsc --noEmit -p server/tsconfig.json`
Expected: No compilation errors

- [ ] **Step 4: Commit (stage only the specific files you changed)**

```bash
git add <list each changed file explicitly>
git commit -m "fix: resolve all compilation errors from removed stop/resume API"
```

---

### Task 12: Update Existing Tests

**Files:**
- Modify: `server/__tests__/sessionManager.test.ts` — update any tests referencing `stop`/`resume` message types
- Modify: `server/__tests__/redisStore.test.ts` — add `detachedAt` to existing `getSession` test expectations, update `SESSION_TTL_SECONDS` env var references
- Modify: any other test files found by searching for `type: 'stop'`, `type: 'resume'`, `stopAgent`, `SESSION_TTL_SECONDS`

- [ ] **Step 1: Search and enumerate all test references**

```bash
grep -rn "type.*stop\|type.*resume\|stopAgent\|resumeSession\|SESSION_TTL" server/__tests__/
```

- [ ] **Step 2: Update each reference**

For each match:
- `type: 'stop'` tests → remove entirely (stop is no longer a valid message)
- `type: 'resume'` tests → rewrite to use `type: 'start'` with `resumeUrl`
- `SESSION_TTL_SECONDS` → replace with `ABSOLUTE_TIMEOUT_SECONDS` or `DETACHED_TIMEOUT_SECONDS` as appropriate
- `stopAgent` / `resumeSession` → remove references

For `redisStore.test.ts`:
- In the existing `getSession` test, add `detachedAt: '0'` to the mock hgetall return value
- Add `detachedAt: 0` to the expected result object in the assertion

- [ ] **Step 3: Run full test suite**

Run: `cd browser-agent-chat && npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 4: Commit (stage only the specific test files changed)**

```bash
git add <list each changed test file explicitly>
git commit -m "test: update existing tests for always-connected API changes"
```

---

### Task 13: End-to-End Smoke Test

- [ ] **Step 1: Start the dev server**

```bash
cd browser-agent-chat && npm run dev
```

- [ ] **Step 2: Manual verification checklist**

Test each scenario from the spec's State Transitions section:

1. **Auto-connect:** Click an agent → should immediately start connecting (no Start button)
2. **Send task:** Type a task → should execute (no manual start needed)
3. **Navigate away and back:** Go to Home → return to agent within 2 min → should reattach (no restart)
4. **WS reconnect:** Toggle network off/on → should show "Reconnecting..." then auto-recover
5. **Restart agent:** Go to agent Settings → click "Restart Agent" → should destroy and recreate
6. **No Stop button:** Verify no Stop button anywhere in the chat UI
7. **Chat input states:** Verify input is enabled in idle/working, disabled in crashed/error

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Final commit (stage only the specific files fixed)**

```bash
git add <list each fixed file explicitly>
git commit -m "fix: address issues found during smoke testing"
```
