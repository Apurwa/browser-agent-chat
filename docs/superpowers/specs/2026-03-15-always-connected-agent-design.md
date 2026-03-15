# Always-Connected Agent Design

## Problem

Users must manually start and stop the browser agent. Clicking an agent, waiting for it to start, then clicking stop when done adds unnecessary friction. There is no real use case for stopping — if the user clicked the agent, they want to use it.

## Goal

When a user clicks on an agent, the agent is immediately ready (or becomes ready within seconds). No start/stop buttons. The browser stays alive as long as the user is on the page.

## Decisions

- **Concurrent browser cap:** Max 3 (configurable via `MAX_CONCURRENT_BROWSERS` env var). Oldest idle evicted when limit hit.
- **Idle timeout:** No timeout while WS client is connected. 2-min detached timeout when user navigates away. 30-min absolute cap.
- **Approach:** Client-driven auto-connect. Minimal server changes.

---

## Design

### 1. Client-Side Auto-Connect

#### TestingView.tsx

On mount, always call `ws.startAgent(id)` unconditionally. Remove:
- `isAutoStart` flag and `location.state` check
- Conditional logic choosing between `startAgent` and `resumeSession`
- The `navigate(location.pathname, { replace: true, state: {} })` state clearing

The single `startAgent` call handles both new and existing sessions — the server checks Redis for an existing session first (fast path ~100ms), falls back to creating new (slow path ~5s).

#### ChatPanel.tsx

Remove:
- "Stop" button (the red button shown when `isActive`)
- "Start Agent" button (the blue button shown when disconnected)
- The `onStopAgent` and `onStartAgent` props

Chat input behavior by status:
- `idle` — Ready for input. Show cursor in chat box.
- `working` — Agent is executing. Input still enabled (task queued server-side).
- `disconnected` (WS drop) — Input enabled, tasks queued locally. Show inline "Reconnecting..." indicator below the chat input (small text, not a toast or banner). Auto-clears on reconnect; queued tasks sent automatically.
- `crashed` / `error` — Input disabled. Show inline error with "Restart Agent" link that sends `{ type: 'restart' }`.
- `session_evicted` — Input disabled. Show toast with "Click to reconnect" (see WebSocketContext section).

Add a "Restart Agent" option in the agent's Settings page (`AgentSettings.tsx`) for edge cases (frozen browser). Not in the main chat UI.

#### WebSocketContext.tsx

Remove:
- `stopAgent()` function
- `resumeSession()` function — merge into `startAgent()`
- `'disconnected'` status handling that shows start button

`startAgent(agentId)` becomes the single entry point:
1. Clear state if switching agents (messages, screenshot, currentUrl)
2. If this is a fresh start (not a reconnect): set `status: 'working'` (optimistic — shows loading state)
   If this is a reconnect (WS just re-established): do NOT change status — keep current status to avoid UI flicker. The server response (`snapshot` or `status: 'idle'`) will set the correct status.
   Implementation: add `isReconnect` boolean parameter to `startAgent()`, default `false`. The auto-reconnect handler passes `true`.
3. Send `{ type: 'start', agentId }` to server (no `resumeUrl` — server has the current URL in session)
4. Server responds with `snapshot` (reattach) or `session_new` + `status: 'idle'` (new session)

On WS reconnect (existing 3s backoff auto-reconnect):
- If `activeAgentRef.current` is set, auto-send `{ type: 'start', agentId }` to re-establish session (do NOT send `resumeUrl` — the server has the current URL in the session; sending a stale client-side URL would be wrong)
- This makes reconnection seamless — user sees brief "Reconnecting..." then back to normal
- **Race condition handling:** If the detached timer fires during reconnect (session destroyed between disconnect and reconnect), the server treats the `start` as a new session creation. The client sees a brief "Starting agent..." then normal operation. No silent state loss — the server always responds with either `snapshot` (reattach) or `status: 'idle'` (new session), so the client knows which path was taken

Remove the `'stop'` client message type. Add `'restart'` message type for the settings page restart button.

Handle new server messages:
- `session_evicted` — Show toast "Session ended — another agent needed the slot. Click to reconnect." Set status to `'disconnected'`. On click, call `startAgent(agentId)`.
- `session_expiring` — Show non-blocking banner with countdown. Clear banner if session is restarted.
- `session_new` — Server signals it created a new session (not reattached). Client resets messages/screenshot/currentUrl to avoid showing stale data from a previous session.

### 2. Server-Side Session Lifecycle

#### Unified `start` Handler (index.ts)

Merge the current separate `start` and `resume` message handlers into one:

```
On { type: 'start', agentId }:
  1. Check Redis for existing session for this agentId
     → If found AND browser alive: reattach WS client, send snapshot, done
     → If found but browser dead: clean up stale session, fall through to create
  2. await ensureCapacity() — uses agents Map size (local, in-process) for the count
     (agents Map tracks all sessions with live agent objects; this is accurate because
     we always clean up the Map entry in destroySession. Redis is the crash-recovery
     fallback, not the primary count source.)
  3. Create new session (browser + agent)
  4. Send { type: 'session_new', agentId } to client (signals fresh session, not reattach)
  5. Send status: 'idle' to client
  6. Run login detection (async, non-blocking)
```

Remove the separate `msg.type === 'resume'` handler entirely.

Remove the `msg.type === 'stop'` handler. Add `msg.type === 'restart'`:
```
On { type: 'restart', agentId }:
  1. Cancel active task if running (check activeTasks Map, call agent.stop(),
     update task DB record to 'cancelled', remove from activeTasks Map)
  2. destroySession(agentId)
  3. await ensureCapacity() — restart freed a slot, but check anyway for safety
  4. Create new session (browser + agent)
  5. Send { type: 'session_new', agentId } + status: 'idle' to client
  6. Run login detection (async, non-blocking)
```

#### LRU Eviction (sessionManager.ts)

New function `evictLRUSession()`:

```
evictLRUSession():
  1. Get all active sessions from local `agents` Map (keyed by agentId → AgentSession)
  2. Sort by lastActivityAt ascending (oldest first)
  3. Prefer evicting sessions with NO attached WS client (wsClients.get(agentId)?.size === 0)
     - Find oldest detached session → destroy it → return
     - (No notification needed — user already navigated away. Store eviction in Redis so
       on reconnect, the start handler can inform the client: "Previous session was reclaimed.")
  4. If all sessions have clients, evict the oldest overall
     - Send { type: 'session_evicted', agentId, reason: 'capacity' } to attached client FIRST
     - Then destroy it → return
```

**Eviction of active sessions:** Before destroying a session that has an attached WS client, send `{ type: 'session_evicted', agentId, reason: 'capacity' }` to the client. The client displays a toast: "Session ended — another agent needed the slot. Click to reconnect." Clicking re-triggers `startAgent(agentId)`.

**Eviction of detached sessions:** No WS client to notify. Optionally store `evictedAt` + `evictionReason` in Redis (short TTL, e.g. 5 min) so that if the user returns and triggers a new `start`, the server can include the eviction context in the response.

New function `ensureCapacity()`:
```
async ensureCapacity():
  // Use a module-level mutex (e.g., simple promise chain or async-mutex)
  // to prevent concurrent startAgent calls from both evicting
  await acquireLock('capacity')
  try:
    count = agents.size
    while count >= MAX_CONCURRENT_BROWSERS:
      evictLRUSession()
      count--
  finally:
    releaseLock('capacity')
```

Called before `createSession()` in the unified start handler. The mutex prevents two concurrent `startAgent` calls from both reading `sessions.size`, both deciding to evict, and double-evicting.

Track attached WS clients per session — add a `Set<WebSocket>` to the session data, updated when clients attach/detach.

**Active task cleanup on eviction:** When evicting a session, check if the session has an active task running. If so, cancel the task (via `agent.stop()`) before destroying the session. This prevents orphaned Magnitude agent processes.

#### Two-Tier Idle Timeout (sessionManager.ts)

Replace the current flat `SESSION_TTL_SECONDS` (10 min) with:

**Tier 1 — Detached timeout (2 min):**
- When the last WS client disconnects from a session (tracked via `ws.on('close')`), start a **local `setTimeout`** (not Redis polling).
- Store the timer handle in the session's in-memory data.
- If a client reconnects within 2 min, `clearTimeout` the handle.
- If timer fires, destroy the session.
- Also store `detachedAt` timestamp in Redis for crash recovery (on server restart, check `detachedAt + 120s < now` during recovery sweep).

**Tier 2 — Absolute timeout (30 min):**
- No session lives longer than 30 minutes from creation, regardless of activity.
- Implementation: Store `createdAt` in Redis (already stored). **Local `setTimeout`** set at session creation fires after 30 min.
- **5-minute warning:** At 25 minutes, send `{ type: 'session_expiring', remainingSeconds: 300 }` to attached clients. Client shows a non-blocking banner: "Session expires in 5 minutes. Your work will be saved."

**While WS client is connected:**
- No idle timeout. Heartbeat pings (every 30s) update `lastActivityAt` for LRU ordering but do NOT affect timeouts.
- The absolute 30-min cap still applies.

**Redis `detachedAt` field:** Add `detachedAt: number` to the `RedisSession` type in `redisStore.ts`. Use `0` as the sentinel for "not detached" (avoids `null` → `"null"` serialization issue with `String(null)` in `setSession()`). Set to `Date.now()` when last client detaches, reset to `0` when a client reattaches. In `getSession()`, parse with `parseInt(val, 10) || 0`.

**Redis key TTL strategy:** Replace `SESSION_TTL_SECONDS` with a safety-net TTL of `ABSOLUTE_TIMEOUT_SECONDS + 300` (35 min). This ensures Redis keys are cleaned up even if the server crashes between session creation and absolute timeout. The local `setTimeout` is the primary timeout mechanism; Redis TTL is the crash-recovery fallback.

**Split `refreshTTL()`:** Rename the current `refreshTTL()` to `resetSessionTTL()` (only called on session creation). Add a new `updateLastActivity(agentId)` that ONLY updates `lastActivityAt` in Redis (for LRU ordering) without resetting the key TTL or expiry sorted set. Heartbeat pings call `updateLastActivity()`, not `resetSessionTTL()`.

Remove `SESSION_TTL_SECONDS` env var. Add:
- `DETACHED_TIMEOUT_SECONDS` (default 120)
- `ABSOLUTE_TIMEOUT_SECONDS` (default 1800)
- `MAX_CONCURRENT_BROWSERS` (default 3)

### 3. State Transitions

```
User clicks agent
  → TestingView mounts
  → ws.startAgent(agentId)
  → Server: session exists? reattach : create new
  → Client: status 'idle', chat input ready

User sends task
  → status 'working'
  → Agent executes
  → status 'idle'

User navigates away (Home, different agent)
  → WS client detaches
  → Server starts 2-min detached timer
  → If user returns within 2 min: reattach, cancel timer
  → If 2 min passes: destroy session

User opens different agent (at cap)
  → Server evicts LRU session (prefer detached)
  → Creates new session for requested agent

User's browser closes / WS disconnects
  → Auto-reconnect (3s backoff, existing logic)
  → On reconnect: auto-send startAgent
  → Server reattaches to existing session

Frozen browser (edge case)
  → User goes to Settings → clicks "Restart Agent"
  → Client sends { type: 'restart', agentId }
  → Server destroys + recreates session
```

### 4. Files Changed

| File | Change |
|------|--------|
| `client/src/components/TestingView.tsx` | Remove conditional start/resume, always call startAgent |
| `client/src/components/ChatPanel.tsx` | Remove Stop/Start buttons, always-enabled input |
| `client/src/contexts/WebSocketContext.tsx` | Remove stopAgent/resumeSession, auto-reconnect startAgent, handle session_evicted/session_expiring/session_new messages |
| `client/src/components/AgentSettings.tsx` | Add "Restart Agent" button |
| `server/src/index.ts` | Merge start/resume handlers, remove stop, add restart, send session_evicted/session_expiring/session_new messages |
| `server/src/sessionManager.ts` | Add evictLRUSession (with mutex), ensureCapacity, track attached clients, active task cleanup on eviction, local setTimeout for detached/absolute timeouts |
| `server/src/redisStore.ts` | Add `detachedAt` field to RedisSession type, new env vars (DETACHED_TIMEOUT_SECONDS, ABSOLUTE_TIMEOUT_SECONDS, MAX_CONCURRENT_BROWSERS) |
| `client/src/types.ts` | Remove 'stop' message, add 'restart'/'session_evicted'/'session_expiring'/'session_new' messages |
| `server/src/types.ts` | Same message type changes |

### 5. What We're NOT Changing

- Browser warm pool (already works well)
- Session recovery on server restart (already handles this — detachedAt crash recovery added for timeout consistency)
- Redis session storage (just adding `detachedAt` field)
- Magnitude agent lifecycle (unchanged)
- Login detection flow (unchanged)
- WebSocket heartbeat/reconnect (leveraging existing)
- `explore()` flow — requires an active session (`sessionManager.getAgent(agentId)` must exist) and uses `sessionManager.makeBroadcast()`. Since always-connected ensures the session is already active when the user sends an explore command, no changes needed. The `explore()` function's start-then-explore two-step flow (in WebSocketContext) works because `startAgent()` is called on mount before any explore is possible.
