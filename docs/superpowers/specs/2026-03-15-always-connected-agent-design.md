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
- If `activeAgentRef.current` is set, auto-send `{ type: 'start', agentId }` to re-establish session
- This makes reconnection seamless — user sees brief "Reconnecting..." then back to normal

Remove the `'stop'` client message type. Add `'restart'` message type for the settings page restart button.

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
     - Find oldest detached session → destroy it → return
  4. If all sessions have clients, evict the oldest overall
     - destroy it → return
```

New function `ensureCapacity()`:
```
ensureCapacity():
  count = sessions.size
  while count >= MAX_CONCURRENT_BROWSERS:
    evictLRUSession()
    count--
```

Called before `createSession()` in the unified start handler.

Track attached WS clients per session — add a `Set<WebSocket>` to the session data, updated when clients attach/detach.

#### Two-Tier Idle Timeout (redisStore.ts)

Replace the current flat `SESSION_TTL_SECONDS` (10 min) with:

**Tier 1 — Detached timeout (2 min):**
- When the last WS client disconnects from a session (tracked via `ws.on('close')`), start a 2-minute timer.
- If a client reconnects within 2 min, cancel the timer.
- If timer fires, destroy the session.
- Implementation: Store `detachedAt` timestamp in Redis. Expiry polling (already runs every 30s) checks `detachedAt + 120s < now`.

**Tier 2 — Absolute timeout (30 min):**
- No session lives longer than 30 minutes from creation, regardless of activity.
- Implementation: Store `createdAt` in Redis (already stored). Expiry polling checks `createdAt + 1800s < now`.

**While WS client is connected:**
- No idle timeout. Heartbeat pings (every 30s) update `lastActivityAt` for LRU ordering but do NOT affect timeouts.
- The absolute 30-min cap still applies.

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
| `client/src/contexts/WebSocketContext.tsx` | Remove stopAgent/resumeSession, auto-reconnect startAgent |
| `client/src/components/AgentSettings.tsx` | Add "Restart Agent" button |
| `server/src/index.ts` | Merge start/resume handlers, remove stop, add restart |
| `server/src/sessionManager.ts` | Add evictLRUSession, ensureCapacity, track attached clients |
| `server/src/redisStore.ts` | Two-tier timeout (detached + absolute), new env vars |
| `client/src/types.ts` | Remove 'stop' message, add 'restart' message |
| `server/src/types.ts` | Same message type changes |

### 5. What We're NOT Changing

- Browser warm pool (already works well)
- Session recovery on server restart (already handles this)
- Redis session storage (just adding fields)
- Magnitude agent lifecycle (unchanged)
- Login detection flow (unchanged)
- WebSocket heartbeat/reconnect (leveraging existing)
