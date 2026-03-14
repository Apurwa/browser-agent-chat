# Session Persistence: Redis + Persistent Browser Pool

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sessions survive server restarts with full continuity — browser state, chat history, auth cookies, and current page all preserved.

**Problem:** The server uses `tsx watch` in dev, which restarts on file changes. All sessions live in an in-memory `Map` and are lost. Browsers are child processes that die with the parent. Users see "Start Agent" and lose all context.

**Prerequisites:** Supabase must be enabled (`isSupabaseEnabled() === true`). Session persistence requires durable message storage. When Supabase is disabled, the system falls back to the existing in-memory behavior — sessions are not recoverable.

---

## Architecture Overview

Three storage layers, each optimized for its access pattern:

| Layer | Technology | Contents | Access time |
|-------|-----------|----------|-------------|
| Hot state | Redis (Upstash prod / local dev) | Session metadata, CDP endpoints, recent messages | <1ms |
| Browser pool | Detached Chromium processes | Live browser contexts with auth, cookies, DOM, pages | N/A (process) |
| Durable state | Supabase (existing) | Full message history, findings, memory features/flows | ~30-50ms |

---

## 0. CDP Context Recovery — Critical Verification

magnitude-core's `startBrowserAgent({ browser: { cdp: endpoint } })` calls `chromium.connectOverCDP(endpoint)` internally. The magnitude-core source (`browserProvider.js`) then checks:
```javascript
if (browser.contexts().length > 0) {
  return browser.contexts()[0]; // REUSES existing context
} else {
  return browser.newContext(options.contextOptions);
}
```

This means: if the browser already has a context (from a previous agent session), CDP reconnection **reuses it** — preserving cookies, pages, and DOM state. If `url` is omitted, no navigation occurs — the agent attaches to whatever page the browser is on.

**However, `agent.stop()` calls `BrowserConnector.onStop()` which closes the browser context.** This means:
- For **destroy** flow: call `browserManager.killBrowser()` directly — do NOT call `agent.stop()` first (it would destroy the context before the browser is killed, wasting time).
- For **recovery** flow: the old agent was never stopped (server crashed), so the context is still alive. The new agent connects to it via CDP.
- For **explicit stop** by user: kill the browser process directly. No need to close the context separately.

---

## 1. Redis Session Store

### Replaces
- `sessionPool.ts` in-memory `Map<string, PooledSession>`
- Manual `setTimeout`/`clearTimeout` idle management

### New module: `server/src/redisStore.ts`

**Connection:** Uses `ioredis` client. Connects to `REDIS_URL` env var (defaults to `redis://localhost:6379`). Production Upstash URLs use `rediss://` (TLS) with authentication embedded in the URL — `ioredis` handles this natively.

**Session hash — `session:{projectId}`:**

| Field | Type | Description |
|-------|------|-------------|
| `dbSessionId` | string | UUID of the Supabase session row |
| `status` | enum | `idle`, `working`, `disconnected`, `crashed`, `interrupted` |
| `cdpPort` | number | Chrome's `--remote-debugging-port` |
| `cdpEndpoint` | string | `http://localhost:{cdpPort}` |
| `currentUrl` | string | Last known page URL |
| `memoryContext` | string | Serialized product knowledge prompt |
| `browserPid` | number | Chrome OS process ID |
| `lastTask` | string | Last task content (for interrupted task recovery) |
| `createdAt` | number | Epoch ms |
| `lastActivityAt` | number | Epoch ms |

**Screenshot stored separately — `screenshot:{projectId}`:**
- Separate key, NOT in the session hash (screenshots are 100-500KB base64, would bloat every `HGETALL`)
- `SET screenshot:{projectId} {base64}` with same TTL as session
- Read only when sending snapshot to client, never bulk-fetched
- Consider JPEG compression or resolution cap to keep under 50KB

**TTL-based lifecycle via expiry sorted set:**
- Upstash serverless does NOT support keyspace notifications (`SUBSCRIBE`). Instead:
- Sorted set `session:expiry` with scores = `lastActivityAt + TTL_MS`
- Every activity: `ZADD session:expiry {newExpiry} {projectId}` + `EXPIRE session:{projectId} {ttl}`
- Polling loop (every 30s): `ZRANGEBYSCORE session:expiry -inf {now}` → returns expired projectIds
- For each expired: trigger cleanup, `ZREM session:expiry {projectId}`
- Default TTL: 600s (10 min), configurable via `SESSION_TTL_SECONDS` env var

**Message cache — `messages:{projectId}`:**
- Redis list, capped at 200 entries
- Each entry is a JSON-serialized `ChatMessage`
- `RPUSH` on new message, `LTRIM messages:{projectId} -200 -1` (chronological order)
- `LRANGE messages:{projectId} 0 -1` returns messages in correct order
- Same TTL as the session hash (refreshed together)
- If list is missing (evicted), fall back to Supabase query

**Port allocation — `browser:port:{port}`:**
- Simple key with projectId as value
- Port range: `CDP_PORT_START` (default 19300) to `CDP_PORT_START + CDP_PORT_RANGE` (default 100)
- `SET browser:port:19300 {projectId} NX` — atomic allocation (NX = only if not exists)
- Freed on session cleanup
- Default port 19300 chosen to avoid conflicts with common services (Elasticsearch 9200-9300, etc.)

**Exposed functions:**
```typescript
// Session CRUD
getSession(projectId: string): Promise<RedisSession | null>
setSession(projectId: string, data: Partial<RedisSession>): Promise<void>
deleteSession(projectId: string): Promise<void>
refreshTTL(projectId: string): Promise<void>
listSessions(): Promise<string[]>  // all active projectIds

// Messages
pushMessage(projectId: string, msg: ChatMessage): Promise<void>
getMessages(projectId: string): Promise<ChatMessage[]>

// Screenshot (separate from session hash)
setScreenshot(projectId: string, base64: string): Promise<void>
getScreenshot(projectId: string): Promise<string | null>

// Port allocation
allocatePort(projectId: string): Promise<number>
freePort(port: number): Promise<void>

// Lifecycle
pollExpiredSessions(callback: (projectId: string) => Promise<void>): void  // starts 30s polling loop
shutdown(): Promise<void>
```

---

## 2. Persistent Browser Pool

### Replaces
- `browserPool.ts` (warm single browser pattern)

### New module: `server/src/browserManager.ts`

**Core concept:** Chromium processes are launched as **detached OS processes** that survive Node restarts. Each gets a unique CDP port. PIDs and ports are stored in Redis.

**Launch:**
```
chromium --remote-debugging-port={port} --headless --no-sandbox \
         --disable-gpu --disable-blink-features=AutomationControlled
```
- `child_process.spawn()` with `{ detached: true, stdio: 'ignore' }`
- `child.unref()` — Node won't wait for this process to exit
- Store PID in Redis: `session:{projectId}.browserPid = child.pid`

**Chromium binary resolution:**
- Use Playwright's bundled Chromium: `playwright.chromium.executablePath()`
- No separate Chrome install needed

**Health check:**
```typescript
async function isAlive(pid: number, cdpPort: number): Promise<boolean> {
  // 1. Process alive?
  try { process.kill(pid, 0); } catch { return false; }
  // 2. CDP responding?
  try {
    const res = await fetch(`http://localhost:${cdpPort}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}
```

**Warm pool (optimization):**
- On server start, pre-launch `WARM_BROWSERS` (default 1) browsers with no session
- Tracked in Redis set `browser:warm:pids` with members `{pid}:{port}` — ensures orphaned warm browsers can be cleaned up on restart
- `claimWarm()` — atomically moves a warm browser to a session (`SPOP` from set)
- Background loop replenishes warm pool when below threshold
- Reduces cold-start from ~3s to ~0.5s (page load only)
- On startup: check `browser:warm:pids` for orphans — health-check each, kill dead ones

**Cleanup:**
- `killBrowser(pid)` — `process.kill(pid, 'SIGTERM')`, wait 3s, then `SIGKILL` if still alive
- Called on: session TTL expiry, explicit stop, crashed session cleanup
- `freePort(port)` in Redis after kill confirmed

**Exposed functions:**
```typescript
launchBrowser(projectId: string): Promise<{ pid: number; port: number; cdpEndpoint: string }>
killBrowser(pid: number, port: number): Promise<void>
isAlive(pid: number, port: number): Promise<boolean>
claimWarm(projectId: string): Promise<{ pid: number; port: number; cdpEndpoint: string } | null>
warmUp(count?: number): Promise<void>
cleanupOrphanedWarm(): Promise<void>
```

---

## 3. Session Manager

### Replaces
- `sessionPool.ts` (most logic)
- Session-related code in `index.ts` `start`/`resume`/`stop` handlers

### New module: `server/src/sessionManager.ts`

**Local state:** `Map<string, AgentSession>` — thin cache of live agent references. NOT the source of truth. Redis is.

**WebSocket clients:** `Map<string, Set<WebSocket>>` keyed by projectId — in-memory only (can't serialize socket refs).

**Create session:**
1. Claim warm browser (or launch new) via `browserManager`
2. Create DB session via `db.createSession()`
3. Connect agent via CDP: `startBrowserAgent({ browser: { cdp: endpoint }, url })`
   - This switches from the current `{ instance: browser }` variant to the `{ cdp: endpoint }` variant
   - magnitude-core handles both — `cdp` calls `chromium.connectOverCDP()` internally
4. Attach event listeners (thought, action, nav — same as current `agent.ts`)
5. Write session hash to Redis
6. Store `AgentSession` in local map

**Recover session (on server restart):**
1. Acquire distributed lock: `SET session:lock:{projectId} {serverId} NX EX 30`
   - Prevents two server instances from recovering the same session
   - Lock auto-expires after 30s if server dies during recovery
2. Read session from Redis
3. Health-check browser via `browserManager.isAlive()`
4. If alive:
   - Connect agent to existing browser: `startBrowserAgent({ browser: { cdp: endpoint } })`
   - NO `url` param — browser already on the right page, agent attaches to current context
   - Re-attach event listeners
   - Store in local map
   - If previous status was `working`: set status → `interrupted`, store `lastTask`
   - Otherwise: status → `idle`
5. If dead:
   - Update Redis: status → `crashed`
   - Clean up port allocation
   - Don't delete session — let client know it crashed
6. Release lock: `DEL session:lock:{projectId}`

**Recover all sessions (parallelized):**
```typescript
async function recoverAllSessions(): Promise<void> {
  const projectIds = await redisStore.listSessions();
  // Recover up to 5 sessions concurrently
  const results = [];
  for (let i = 0; i < projectIds.length; i += 5) {
    const batch = projectIds.slice(i, i + 5);
    results.push(...await Promise.allSettled(
      batch.map(pid => recoverSession(pid))
    ));
  }
  const recovered = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  console.log(`[RECOVERY] ${recovered} recovered, ${failed} failed of ${projectIds.length} total`);
}
```

**Destroy session:**
1. `browserManager.killBrowser(pid, port)` — kills the entire Chrome process (do NOT call `agent.stop()` first — it would close the browser context unnecessarily before the process is killed)
2. `db.endSession(dbSessionId)`
3. `redisStore.deleteSession(projectId)`
4. Remove from local map

**AgentSession.close() behavior change:** Disconnects the agent from the browser but does NOT terminate the browser process. Browser lifecycle is managed exclusively by `browserManager`. The `close()` method on `AgentSession` becomes a no-op or calls a lightweight disconnect (drop event listeners, clear references) without calling `agent.stop()`.

**Send snapshot (to a reconnecting client):**
1. Read from Redis: status, currentUrl (via `HMGET` — selective, no screenshot blob)
2. Read screenshot: `GET screenshot:{projectId}` (separate key)
3. Read messages: try Redis list first, fall back to Supabase
4. If status was `interrupted`: send `{ type: 'taskInterrupted', task: lastTask }` so client can offer retry
5. Send: `status`, `nav`, `screenshot`, `sessionRestore` messages

**Broadcast (to all connected clients):**
- On broadcast: also write-through to Redis (screenshot as separate key, url, status, messages)
- `refreshTTL()` on every write-through

---

## 4. Changes to Existing Modules

### `agent.ts`
- `createAgent()` accepts `cdpEndpoint: string` instead of `browser: Browser`
- Passes `{ browser: { cdp: cdpEndpoint } }` to `startBrowserAgent()` (switching from the `instance` variant to the `cdp` variant)
- `createAgent()` for recovery: called WITHOUT `url` param (browser already on right page — no navigation occurs, agent attaches to current page)
- `AgentSession.close()`: no longer calls `agent.stop()` (which would close the browser context). Instead, drops event listeners and clears references. Browser teardown is handled by `browserManager.killBrowser()`.
- Event listeners unchanged
- `executeTask()`, `executeExplore()`, `executeLogin()` unchanged

### `index.ts` (WebSocket handlers)
- `start` handler → delegates to `sessionManager.createSession()` or `sessionManager.recoverSession()`
- `resume` handler → checks Redis via `sessionManager`, sends snapshot
- `task`/`explore` handlers → get agent from `sessionManager` local cache
- `stop` handler → `sessionManager.destroySession()`
- New message type: `sessionCrashed` — tells client the browser died
- New message type: `taskInterrupted` — tells client a task was in progress when server restarted
- Remove `startingProjects` Set (Redis `SET NX` on `session:lock:{projectId}` provides atomic locking)
- Update `/health` endpoint: read from `redisStore.listSessions()` instead of `sessionPool.listActiveSessions()`, report Redis connectivity status

### `client/src/contexts/WebSocketContext.tsx`
- Handle new `sessionCrashed` message type — show recovery UI
- Handle new `taskInterrupted` message type — show "Task was interrupted. Retry?" prompt
- Add `crashed` and `interrupted` to status handling

### `client/src/types.ts` + `server/src/types.ts`
- Add `sessionCrashed` and `taskInterrupted` to `ServerMessage` union
- Add `crashed` and `interrupted` to `AgentStatus` type

---

## 5. Server Lifecycle

### Startup sequence
```
1. Connect to Redis (ioredis)
2. Clean up orphaned warm browsers (browser:warm:pids health check)
3. Recover all sessions (parallelized, 5 at a time)
4. Start expiry polling loop (30s interval)
5. Warm up browser pool (WARM_BROWSERS count)
6. Start Express + WebSocket server
7. Ready for connections
```

### Shutdown sequence (SIGTERM/SIGINT handler)
```
1. Stop accepting new WebSocket connections
2. Stop expiry polling loop
3. For each active session:
   - Set status='disconnected' in Redis
   - Broadcast disconnect to connected clients
   - Do NOT kill browsers (they are meant to outlive the server)
4. Close Redis connection cleanly
5. Process exit
```

---

## 6. Environment Variables

```env
# Redis
REDIS_URL=redis://localhost:6379          # Local dev (no auth)
# REDIS_URL=rediss://default:pw@...       # Production (Upstash, TLS + auth)

# Browser pool
CDP_PORT_START=19300                       # First port in range (avoids Elasticsearch 9200-9300)
CDP_PORT_RANGE=100                         # Max concurrent browsers
WARM_BROWSERS=1                            # Pre-launched browsers
HEADLESS=true                              # Headless mode

# Session lifecycle
SESSION_TTL_SECONDS=600                    # Idle timeout (10 min)
```

---

## 7. New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `ioredis` | Redis client for Node.js | ~180KB, zero native deps, well-maintained |

No other new dependencies. Playwright is already bundled via magnitude-core.

---

## 8. Migration Path

**Phase 1 (this implementation):**
- Add Redis + browserManager + sessionManager
- Existing `sessionPool.ts` and `browserPool.ts` become dead code, then removed
- Supabase schema unchanged (messages table already has everything needed)

**Phase 2 (future):**
- Horizontal scaling: multiple server instances behind a load balancer
- Sticky sessions via Redis (any server can handle any session)
- Browser process orchestration (run browsers on separate machines)

---

## 9. What Survives What

| Event | Browser state | Chat history | Auth/cookies | Agent LLM context | In-flight task |
|-------|:---:|:---:|:---:|:---:|:---:|
| Server restart | Yes | Yes | Yes | No (recreated) | No (user notified, can retry) |
| Browser crash | No | Yes (Supabase) | No | No | No |
| Redis eviction | Recoverable | Yes (Supabase) | Yes (browser alive) | Recoverable | Continues |
| Full system reboot | No | Yes (Supabase) | No | No | No |

---

## 10. Error Handling

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Redis down | ioredis auto-reconnect, operations throw | Fall back to local Map (degrade gracefully) |
| Chrome process crash | Health check on resume/startup | Mark crashed, notify client, offer restart |
| CDP connection refused | `fetch /json/version` timeout | Same as crash |
| Port exhaustion | `allocatePort()` returns null | Return error "max sessions reached" |
| Server OOM | Process exits | Browsers survive, Redis state intact, new server recovers |
| Concurrent recovery | `SET NX` lock per session | Only one server recovers a given session |

---

## 11. Testing Strategy

- **Unit tests:** redisStore (mock ioredis), browserManager (mock child_process), sessionManager (mock both)
- **Integration test:** Launch real Redis (Docker), create session, kill server process, restart, verify recovery
- **E2E test:** Full flow with Playwright — start agent, kill server, restart, verify client sees same page and messages
