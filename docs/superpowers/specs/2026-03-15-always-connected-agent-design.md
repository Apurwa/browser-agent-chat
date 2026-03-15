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

Chat input is **always enabled** when on the testing page. The only states the user sees:
- `idle` — Ready for input. Show cursor in chat box.
- `working` — Agent is executing. Input still enabled (task queued).
- Transient "Reconnecting..." indicator if WS drops (auto-resolves via reconnect).

Add a "Restart Agent" option in the agent's Settings page (`AgentSettings.tsx`) for edge cases (frozen browser). Not in the main chat UI.

#### WebSocketContext.tsx

Remove:
- `stopAgent()` function
- `resumeSession()` function — merge into `startAgent()`
- `'disconnected'` status handling that shows start button

`startAgent(agentId)` becomes the single entry point:
1. Clear state if switching agents (messages, screenshot, currentUrl)
2. Set `status: 'working'` (optimistic — shows loading state)
3. Send `{ type: 'start', agentId, resumeUrl }` to server
4. Server responds with snapshot or creates new session

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
On { type: 'start', agentId, resumeUrl? }:
  1. Check Redis for existing session for this agentId
     → If found AND browser alive: reattach WS client, send snapshot, done
     → If found but browser dead: clean up stale session, fall through to create
  2. Check concurrent browser count
     → If at MAX_CONCURRENT_BROWSERS cap: evict LRU session (see below)
  3. Create new session (browser + agent)
  4. Send status: 'idle' to client
  5. Run login detection (async, non-blocking)
```

Remove the separate `msg.type === 'resume'` handler entirely.

Remove the `msg.type === 'stop'` handler. Add `msg.type === 'restart'`:
```
On { type: 'restart', agentId }:
  1. destroySession(agentId)
  2. Create new session (same as start flow step 2-5)
```

#### LRU Eviction (sessionManager.ts)

New function `evictLRUSession()`:

```
evictLRUSession():
  1. Get all active sessions from local sessions Map
  2. Sort by lastActivityAt ascending (oldest first)
  3. Prefer evicting sessions with NO attached WS client
     - Find oldest detached session → notify evicted client (see below) → destroy it → return
  4. If all sessions have clients, evict the oldest overall
     - Notify evicted client → destroy it → return
```

**Eviction notification:** Before destroying a session that has an attached WS client, send `{ type: 'session_evicted', agentId, reason: 'capacity' }` to the client. The client displays a toast: "Session ended — another agent needed the slot. Click to reconnect." Clicking re-triggers `startAgent(agentId)`.

New function `ensureCapacity()`:
```
async ensureCapacity():
  // Use a module-level mutex (e.g., simple promise chain or async-mutex)
  // to prevent concurrent startAgent calls from both evicting
  await acquireLock('capacity')
  try:
    count = sessions.size
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

**Redis `detachedAt` field:** Add `detachedAt: number | null` to the `RedisSession` type in `redisStore.ts`. Set to `Date.now()` when last client detaches, cleared to `null` when a client reattaches.

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
- `explore()` flow — currently creates its own agent/browser internally. This is compatible with always-connected because `explore()` manages its own lifecycle independent of user sessions. No changes needed.
