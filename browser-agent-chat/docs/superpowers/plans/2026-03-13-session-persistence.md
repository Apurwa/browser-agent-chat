# Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sessions survive server restarts with full continuity — browser state, chat history, auth cookies, and current page all preserved via Redis hot state + detached Chromium processes.

**Architecture:** Three-layer persistence: Redis for hot session metadata/messages/screenshots, detached OS-level Chromium processes that outlive the Node server, and existing Supabase for durable message history fallback. On restart, the server reads Redis, health-checks browsers via CDP, and reconnects agents to surviving browser contexts.

**Tech Stack:** ioredis, Playwright CDP (`chromium.connectOverCDP`), magnitude-core (`startBrowserAgent` with `{ browser: { cdp } }`), Node `child_process.spawn` (detached), Vitest

**Spec:** `docs/superpowers/specs/2026-03-13-session-persistence-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `server/src/redisStore.ts` | Redis connection, session CRUD, message cache, screenshot storage, port allocation, expiry polling |
| `server/src/browserManager.ts` | Detached Chromium launch/kill, CDP health checks, warm browser pool |
| `server/src/sessionManager.ts` | Session lifecycle orchestration — create, recover, destroy, snapshot, broadcast with Redis write-through |
| `server/__tests__/redisStore.test.ts` | Unit tests for Redis store (mocked ioredis) |
| `server/__tests__/browserManager.test.ts` | Unit tests for browser manager (mocked child_process + redisStore) |
| `server/__tests__/sessionManager.test.ts` | Unit tests for session manager (mocked redisStore + browserManager + agent) |

### Modified files
| File | Changes |
|------|---------|
| `server/package.json` | Add `ioredis` dependency |
| `server/src/types.ts` | Add `RedisSession` interface, extend `AgentStatus`, add `sessionCrashed`/`taskInterrupted` to `ServerMessage` |
| `server/src/agent.ts` | Accept `cdpEndpoint` param, use `{ browser: { cdp } }` instead of `{ browser: { instance } }`, change `close()` to not call `agent.stop()` |
| `server/src/index.ts` | Rewire all handlers to `sessionManager`, add startup/shutdown lifecycle, remove `sessionPool`/`browserPool` imports |
| `server/src/db.ts` | Add `getMessagesBySession()` for Supabase fallback |
| `client/src/contexts/WebSocketContext.tsx` | Handle `sessionCrashed` and `taskInterrupted` message types |

### Removed files
| File | Replaced by |
|------|------------|
| `server/src/sessionPool.ts` | `sessionManager.ts` + `redisStore.ts` |
| `server/src/browserPool.ts` | `browserManager.ts` |

---

## Chunk 1: Foundation — Dependencies, Types, Redis Store

### Task 1: Install ioredis and update types

**Files:**
- Modify: `server/package.json`
- Modify: `server/src/types.ts:100-163`

- [ ] **Step 1: Install ioredis**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npm install ioredis
```

Expected: `ioredis` added to `dependencies` in `package.json`.

- [ ] **Step 2: Add RedisSession interface and new types to types.ts**

In `server/src/types.ts`, make three changes:

**Change 1:** Replace the existing `AgentStatus` type (line 106) — do NOT add a second declaration:
```typescript
// FIND this line:
export type AgentStatus = 'idle' | 'working' | 'error' | 'disconnected';
// REPLACE with:
export type AgentStatus = 'idle' | 'working' | 'error' | 'disconnected' | 'crashed' | 'interrupted';
```

**Change 2:** Add after the updated `AgentStatus` line:
```typescript
// === Redis Session State ===

export interface RedisSession {
  dbSessionId: string;
  status: RedisSessionStatus;
  cdpPort: number;
  cdpEndpoint: string;
  currentUrl: string;
  memoryContext: string;
  browserPid: number;
  lastTask: string;
  createdAt: number;
  lastActivityAt: number;
}

export type RedisSessionStatus = 'idle' | 'working' | 'disconnected' | 'crashed' | 'interrupted';
```

**Change 3:** Add new `ServerMessage` variants to the `ServerMessage` union (after the `metrics` variant):
```typescript
  | { type: 'sessionCrashed' }
  | { type: 'taskInterrupted'; task: string };
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json server/src/types.ts
git commit -m "feat: add ioredis dependency and Redis session types"
```

---

### Task 2: Redis Store — connection and session CRUD

**Files:**
- Create: `server/src/redisStore.ts`
- Create: `server/__tests__/redisStore.test.ts`

- [ ] **Step 1: Create redisStore.ts skeleton**

Create `server/src/redisStore.ts`:

```typescript
import Redis from 'ioredis';
import type { ChatMessage, RedisSession, RedisSessionStatus } from './types.js';

let redis: Redis;

export function getRedis(): Redis {
  return redis;
}

export function connect(url?: string): void {
  redis = new Redis(url || process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  });
}

// -- Session CRUD --

export async function getSession(projectId: string): Promise<RedisSession | null> {
  throw new Error('Not implemented');
}

export async function setSession(projectId: string, data: Partial<RedisSession>): Promise<void> {
  throw new Error('Not implemented');
}

export async function deleteSession(projectId: string): Promise<void> {
  throw new Error('Not implemented');
}

export async function refreshTTL(projectId: string): Promise<void> {
  throw new Error('Not implemented');
}

export async function listSessions(): Promise<string[]> {
  throw new Error('Not implemented');
}

// -- Messages --

export async function pushMessage(projectId: string, msg: ChatMessage): Promise<void> {
  throw new Error('Not implemented');
}

export async function getMessages(projectId: string): Promise<ChatMessage[]> {
  throw new Error('Not implemented');
}

// -- Screenshot --

export async function setScreenshot(projectId: string, base64: string): Promise<void> {
  throw new Error('Not implemented');
}

export async function getScreenshot(projectId: string): Promise<string | null> {
  throw new Error('Not implemented');
}

// -- Port allocation --

export async function allocatePort(projectId: string): Promise<number> {
  throw new Error('Not implemented');
}

export async function freePort(port: number): Promise<void> {
  throw new Error('Not implemented');
}

// -- Expiry --

export function pollExpiredSessions(callback: (projectId: string) => Promise<void>): void {
  throw new Error('Not implemented');
}

export function stopPolling(): void {
  throw new Error('Not implemented');
}

export async function shutdown(): Promise<void> {
  throw new Error('Not implemented');
}
```

- [ ] **Step 2: Write tests for session CRUD**

Create `server/__tests__/redisStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock redis instance
const mockRedis = {
  hset: vi.fn().mockResolvedValue('OK'),
  hgetall: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  zadd: vi.fn().mockResolvedValue(1),
  zrem: vi.fn().mockResolvedValue(1),
  zrange: vi.fn().mockResolvedValue([]),
  zrangebyscore: vi.fn().mockResolvedValue([]),
  rpush: vi.fn().mockResolvedValue(1),
  ltrim: vi.fn().mockResolvedValue('OK'),
  lrange: vi.fn().mockResolvedValue([]),
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  pipeline: vi.fn().mockReturnValue({
    expire: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    hset: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  }),
  quit: vi.fn().mockResolvedValue('OK'),
};

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => mockRedis),
}));

import {
  connect,
  getSession,
  setSession,
  deleteSession,
  listSessions,
} from '../src/redisStore.js';

describe('redisStore — session CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect('redis://localhost:6379');
  });

  it('getSession returns null when no data', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({});
    const result = await getSession('proj-1');
    expect(result).toBeNull();
    expect(mockRedis.hgetall).toHaveBeenCalledWith('session:proj-1');
  });

  it('getSession returns parsed RedisSession when data exists', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({
      dbSessionId: 'db-123',
      status: 'idle',
      cdpPort: '19300',
      cdpEndpoint: 'http://localhost:19300',
      currentUrl: 'https://example.com',
      memoryContext: '',
      browserPid: '12345',
      lastTask: '',
      createdAt: '1710000000000',
      lastActivityAt: '1710000000000',
    });

    const result = await getSession('proj-1');
    expect(result).toEqual({
      dbSessionId: 'db-123',
      status: 'idle',
      cdpPort: 19300,
      cdpEndpoint: 'http://localhost:19300',
      currentUrl: 'https://example.com',
      memoryContext: '',
      browserPid: 12345,
      lastTask: '',
      createdAt: 1710000000000,
      lastActivityAt: 1710000000000,
    });
  });

  it('setSession writes flattened fields to Redis hash', async () => {
    await setSession('proj-1', { status: 'working', currentUrl: 'https://test.com' });
    expect(mockRedis.hset).toHaveBeenCalledWith(
      'session:proj-1',
      expect.objectContaining({ status: 'working', currentUrl: 'https://test.com' })
    );
  });

  it('deleteSession removes session, screenshot, messages keys and expiry entry', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({ dbSessionId: 'db-1', cdpPort: '19300' });
    await deleteSession('proj-1');
    expect(mockRedis.del).toHaveBeenCalledWith('session:proj-1', 'screenshot:proj-1', 'messages:proj-1');
    expect(mockRedis.zrem).toHaveBeenCalledWith('session:expiry', 'proj-1');
  });

  it('listSessions returns all project IDs from expiry set', async () => {
    mockRedis.zrange.mockResolvedValueOnce(['proj-1', 'proj-2']);
    const result = await listSessions();
    expect(result).toEqual(['proj-1', 'proj-2']);
    expect(mockRedis.zrange).toHaveBeenCalledWith('session:expiry', 0, -1);
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/redisStore.test.ts
```

Expected: Tests FAIL with "Not implemented" errors.

- [ ] **Step 4: Implement session CRUD in redisStore.ts**

Replace the session CRUD functions in `server/src/redisStore.ts`:

```typescript
const DEFAULT_TTL = () => parseInt(process.env.SESSION_TTL_SECONDS || '600', 10);

export async function getSession(projectId: string): Promise<RedisSession | null> {
  const data = await redis.hgetall(`session:${projectId}`);
  if (!data || !data.dbSessionId) return null;
  return {
    dbSessionId: data.dbSessionId,
    status: data.status as RedisSessionStatus,
    cdpPort: parseInt(data.cdpPort, 10),
    cdpEndpoint: data.cdpEndpoint,
    currentUrl: data.currentUrl || '',
    memoryContext: data.memoryContext || '',
    browserPid: parseInt(data.browserPid, 10),
    lastTask: data.lastTask || '',
    createdAt: parseInt(data.createdAt, 10),
    lastActivityAt: parseInt(data.lastActivityAt, 10),
  };
}

export async function setSession(projectId: string, data: Partial<RedisSession>): Promise<void> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) flat[k] = String(v);
  }
  await redis.hset(`session:${projectId}`, flat);
  await refreshTTL(projectId);
}

export async function deleteSession(projectId: string): Promise<void> {
  const session = await getSession(projectId);
  await redis.del(`session:${projectId}`, `screenshot:${projectId}`, `messages:${projectId}`);
  if (session && !isNaN(session.cdpPort)) await freePort(session.cdpPort);
  await redis.zrem('session:expiry', projectId);
}

// freePort implemented here (not in Task 3) because deleteSession depends on it
export async function freePort(port: number): Promise<void> {
  await redis.del(`browser:port:${port}`);
}

export async function refreshTTL(projectId: string): Promise<void> {
  const ttl = DEFAULT_TTL();
  const expiryScore = Date.now() + ttl * 1000;
  await redis.pipeline()
    .expire(`session:${projectId}`, ttl)
    .expire(`screenshot:${projectId}`, ttl)
    .expire(`messages:${projectId}`, ttl)
    .zadd('session:expiry', expiryScore, projectId)
    .hset(`session:${projectId}`, 'lastActivityAt', String(Date.now()))
    .exec();
}

export async function listSessions(): Promise<string[]> {
  return redis.zrange('session:expiry', 0, -1);
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/redisStore.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/redisStore.ts server/__tests__/redisStore.test.ts
git commit -m "feat: implement Redis session store — connection and session CRUD"
```

---

### Task 3: Redis Store — messages, screenshots, port allocation

**Files:**
- Modify: `server/src/redisStore.ts`
- Modify: `server/__tests__/redisStore.test.ts`

- [ ] **Step 1: Add message/screenshot/port tests to redisStore.test.ts**

Add `pushMessage, getMessages, setScreenshot, getScreenshot, allocatePort` to the existing import from `'../src/redisStore.js'` (the `freePort` function was already implemented and tested in Task 2). Then append these test suites:

```typescript
describe('redisStore — messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect('redis://localhost:6379');
  });

  it('pushMessage appends JSON to list and trims to 200', async () => {
    const msg = { id: '1', type: 'user' as const, content: 'hello', timestamp: 1000 };
    await pushMessage('proj-1', msg);
    expect(mockRedis.rpush).toHaveBeenCalledWith('messages:proj-1', JSON.stringify(msg));
    expect(mockRedis.ltrim).toHaveBeenCalledWith('messages:proj-1', -200, -1);
  });

  it('getMessages returns parsed ChatMessage array', async () => {
    const msg1 = { id: '1', type: 'user', content: 'hi', timestamp: 1000 };
    const msg2 = { id: '2', type: 'agent', content: 'hello', timestamp: 2000 };
    mockRedis.lrange.mockResolvedValueOnce([JSON.stringify(msg1), JSON.stringify(msg2)]);

    const result = await getMessages('proj-1');
    expect(result).toEqual([msg1, msg2]);
    expect(mockRedis.lrange).toHaveBeenCalledWith('messages:proj-1', 0, -1);
  });
});

describe('redisStore — screenshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect('redis://localhost:6379');
  });

  it('setScreenshot stores base64 string', async () => {
    await setScreenshot('proj-1', 'base64data');
    expect(mockRedis.set).toHaveBeenCalledWith('screenshot:proj-1', 'base64data');
  });

  it('getScreenshot returns stored value or null', async () => {
    mockRedis.get.mockResolvedValueOnce('base64data');
    const result = await getScreenshot('proj-1');
    expect(result).toBe('base64data');
  });
});

describe('redisStore — port allocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect('redis://localhost:6379');
  });

  it('allocatePort returns first available port via SET NX', async () => {
    mockRedis.set.mockResolvedValueOnce('OK');
    const port = await allocatePort('proj-1');
    expect(port).toBe(19300);
    expect(mockRedis.set).toHaveBeenCalledWith('browser:port:19300', 'proj-1', 'NX');
  });

  it('allocatePort skips occupied ports', async () => {
    mockRedis.set
      .mockResolvedValueOnce(null)  // port 19300 taken
      .mockResolvedValueOnce(null)  // port 19301 taken
      .mockResolvedValueOnce('OK'); // port 19302 free
    const port = await allocatePort('proj-1');
    expect(port).toBe(19302);
  });

  it('allocatePort throws when all ports exhausted', async () => {
    mockRedis.set.mockResolvedValue(null); // all ports taken
    await expect(allocatePort('proj-1')).rejects.toThrow('No available CDP ports');
  });

  it('freePort deletes the port key', async () => {
    await freePort(19300);
    expect(mockRedis.del).toHaveBeenCalledWith('browser:port:19300');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/redisStore.test.ts
```

Expected: New tests FAIL with "Not implemented".

- [ ] **Step 3: Implement messages, screenshots, port allocation**

Replace the remaining stub functions in `server/src/redisStore.ts` (`freePort` was already implemented in Task 2):

```typescript
// -- Messages --

export async function pushMessage(projectId: string, msg: ChatMessage): Promise<void> {
  await redis.rpush(`messages:${projectId}`, JSON.stringify(msg));
  await redis.ltrim(`messages:${projectId}`, -200, -1);
}

export async function getMessages(projectId: string): Promise<ChatMessage[]> {
  const raw = await redis.lrange(`messages:${projectId}`, 0, -1);
  return raw.map(r => JSON.parse(r));
}

// -- Screenshot --

export async function setScreenshot(projectId: string, base64: string): Promise<void> {
  await redis.set(`screenshot:${projectId}`, base64);
}

export async function getScreenshot(projectId: string): Promise<string | null> {
  return redis.get(`screenshot:${projectId}`);
}

// -- Port allocation --

const PORT_START = () => parseInt(process.env.CDP_PORT_START || '19300', 10);
const PORT_RANGE = () => parseInt(process.env.CDP_PORT_RANGE || '100', 10);

export async function allocatePort(projectId: string): Promise<number> {
  const start = PORT_START();
  const range = PORT_RANGE();
  for (let offset = 0; offset < range; offset++) {
    const port = start + offset;
    const result = await redis.set(`browser:port:${port}`, projectId, 'NX');
    if (result === 'OK') return port;
  }
  throw new Error('No available CDP ports — max concurrent browsers reached');
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/redisStore.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/redisStore.ts server/__tests__/redisStore.test.ts
git commit -m "feat: implement Redis message cache, screenshot storage, and port allocation"
```

---

### Task 4: Redis Store — expiry polling and shutdown

**Files:**
- Modify: `server/src/redisStore.ts`
- Modify: `server/__tests__/redisStore.test.ts`

- [ ] **Step 1: Add expiry polling and shutdown tests**

Add `pollExpiredSessions, shutdown, refreshTTL` to the existing import from `'../src/redisStore.js'`. Then append these test suites:

```typescript
describe('redisStore — expiry polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    connect('redis://localhost:6379');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pollExpiredSessions calls callback for expired sessions every 30s', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    mockRedis.zrangebyscore.mockResolvedValueOnce(['proj-expired']);
    mockRedis.zrem.mockResolvedValueOnce(1);

    pollExpiredSessions(callback);

    // Advance 30 seconds
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockRedis.zrangebyscore).toHaveBeenCalledWith(
      'session:expiry', '-inf', expect.any(Number)
    );
    expect(callback).toHaveBeenCalledWith('proj-expired');
    expect(mockRedis.zrem).toHaveBeenCalledWith('session:expiry', 'proj-expired');
  });

  it('refreshTTL uses pipeline for atomic TTL refresh', async () => {
    const pipeline = mockRedis.pipeline();
    await refreshTTL('proj-1');
    expect(mockRedis.pipeline).toHaveBeenCalled();
  });
});

describe('redisStore — shutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect('redis://localhost:6379');
  });

  it('shutdown calls redis.quit()', async () => {
    await shutdown();
    expect(mockRedis.quit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/redisStore.test.ts
```

Expected: New tests FAIL.

- [ ] **Step 3: Implement expiry polling and shutdown**

Replace stubs in `server/src/redisStore.ts`:

```typescript
// -- Expiry polling --

let expiryInterval: ReturnType<typeof setInterval> | null = null;

export function pollExpiredSessions(callback: (projectId: string) => Promise<void>): void {
  expiryInterval = setInterval(async () => {
    try {
      const now = Date.now();
      const expired = await redis.zrangebyscore('session:expiry', '-inf', now);
      for (const projectId of expired) {
        await redis.zrem('session:expiry', projectId);
        await callback(projectId).catch(err =>
          console.error(`[EXPIRY] Failed to clean up ${projectId}:`, err)
        );
      }
    } catch (err) {
      console.error('[EXPIRY] Polling error:', err);
    }
  }, 30_000);
}

export function stopPolling(): void {
  if (expiryInterval) {
    clearInterval(expiryInterval);
    expiryInterval = null;
  }
}

export async function shutdown(): Promise<void> {
  stopPolling();
  await redis.quit();
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/redisStore.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Verify full redisStore type-checks**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx tsc --noEmit
```

Expected: No type errors (ignore existing unrelated errors if any).

- [ ] **Step 6: Commit**

```bash
git add server/src/redisStore.ts server/__tests__/redisStore.test.ts
git commit -m "feat: implement Redis expiry polling and graceful shutdown"
```

---

## Chunk 2: Browser Manager

### Task 5: Browser Manager — launch, kill, health check

**Files:**
- Create: `server/src/browserManager.ts`
- Create: `server/__tests__/browserManager.test.ts`

**Context:** This module manages detached Chromium processes that survive Node restarts. It uses `child_process.spawn` with `{ detached: true, stdio: 'ignore' }` and `child.unref()` so the child process is not tied to the Node parent. CDP ports come from `redisStore.allocatePort()`. Health checks hit `http://localhost:{port}/json/version`.

- [ ] **Step 1: Create browserManager.ts skeleton**

Create `server/src/browserManager.ts`:

```typescript
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import * as redisStore from './redisStore.js';

const HEADLESS = () => process.env.HEADLESS !== 'false';

function getChromiumPath(): string {
  return chromium.executablePath();
}

function buildArgs(port: number): string[] {
  return [
    `--remote-debugging-port=${port}`,
    ...(HEADLESS() ? ['--headless'] : []),
    '--no-sandbox',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
  ];
}

export async function waitForCDP(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`CDP not ready on port ${port} after ${timeoutMs}ms`);
}

export async function launchBrowser(projectId: string): Promise<{ pid: number; port: number; cdpEndpoint: string }> {
  throw new Error('Not implemented');
}

export async function killBrowser(pid: number, port: number): Promise<void> {
  throw new Error('Not implemented');
}

export async function isAlive(pid: number, port: number): Promise<boolean> {
  throw new Error('Not implemented');
}

export async function claimWarm(projectId: string): Promise<{ pid: number; port: number; cdpEndpoint: string } | null> {
  throw new Error('Not implemented');
}

export async function warmUp(count?: number): Promise<void> {
  throw new Error('Not implemented');
}

export async function cleanupOrphanedWarm(): Promise<void> {
  throw new Error('Not implemented');
}
```

- [ ] **Step 2: Write tests for launch, kill, health check**

Create `server/__tests__/browserManager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process
const mockChild = { pid: 99999, unref: vi.fn() };
vi.mock('node:child_process', () => ({
  spawn: vi.fn().mockReturnValue(mockChild),
}));

// Mock playwright
vi.mock('playwright', () => ({
  chromium: {
    executablePath: vi.fn().mockReturnValue('/usr/bin/chromium'),
  },
}));

// Mock redisStore
vi.mock('../src/redisStore.js', () => ({
  allocatePort: vi.fn().mockResolvedValue(19300),
  freePort: vi.fn().mockResolvedValue(undefined),
  getRedis: vi.fn().mockReturnValue({
    spop: vi.fn().mockResolvedValue(null),
    sadd: vi.fn().mockResolvedValue(1),
    scard: vi.fn().mockResolvedValue(0),
    smembers: vi.fn().mockResolvedValue([]),
    srem: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
  }),
}));

// Mock fetch for CDP health checks
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { spawn } from 'node:child_process';
import * as redisStore from '../src/redisStore.js';
import { launchBrowser, killBrowser, isAlive } from '../src/browserManager.js';

describe('browserManager — launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make waitForCDP succeed immediately
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('launchBrowser spawns detached process and returns pid/port/endpoint', async () => {
    const result = await launchBrowser('proj-1');

    expect(redisStore.allocatePort).toHaveBeenCalledWith('proj-1');
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/chromium',
      expect.arrayContaining(['--remote-debugging-port=19300']),
      { detached: true, stdio: 'ignore' }
    );
    expect(mockChild.unref).toHaveBeenCalled();
    expect(result).toEqual({
      pid: 99999,
      port: 19300,
      cdpEndpoint: 'http://localhost:19300',
    });
  });
});

describe('browserManager — kill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('killBrowser sends SIGTERM then frees port when process exits quickly', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0) throw new Error('ESRCH'); // process is dead after SIGTERM
      return true;
    });

    await killBrowser(12345, 19300);

    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(redisStore.freePort).toHaveBeenCalledWith(19300);
    killSpy.mockRestore();
  });

  it('killBrowser sends SIGKILL after 3s if process survives SIGTERM', async () => {
    let killCount = 0;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 'SIGTERM') return true;
      if (signal === 0) {
        killCount++;
        if (killCount > 15) throw new Error('ESRCH'); // dies after SIGKILL
        return true; // process still alive
      }
      if (signal === 'SIGKILL') return true;
      return true;
    });

    await killBrowser(12345, 19300);

    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL');
    expect(redisStore.freePort).toHaveBeenCalledWith(19300);
    killSpy.mockRestore();
  });

  it('launchBrowser throws if spawn fails (no pid)', async () => {
    const { spawn: mockSpawn } = await import('node:child_process');
    (mockSpawn as any).mockReturnValueOnce({ pid: undefined, unref: vi.fn() });

    await expect(launchBrowser('proj-1')).rejects.toThrow('Failed to spawn');
  });
});

describe('browserManager — isAlive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when process exists and CDP responds', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true); // process exists
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await isAlive(12345, 19300);
    expect(result).toBe(true);

    vi.restoreAllMocks();
  });

  it('returns false when process does not exist', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });

    const result = await isAlive(12345, 19300);
    expect(result).toBe(false);

    vi.restoreAllMocks();
  });

  it('returns false when CDP does not respond', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await isAlive(12345, 19300);
    expect(result).toBe(false);

    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/browserManager.test.ts
```

Expected: Tests FAIL with "Not implemented".

- [ ] **Step 4: Implement launch, kill, isAlive**

Replace stub functions in `server/src/browserManager.ts`:

```typescript
export async function launchBrowser(projectId: string): Promise<{ pid: number; port: number; cdpEndpoint: string }> {
  const port = await redisStore.allocatePort(projectId);
  const chromePath = getChromiumPath();

  const child = spawn(chromePath, buildArgs(port), {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  if (!child.pid) {
    await redisStore.freePort(port);
    throw new Error('Failed to spawn Chromium process — no PID returned');
  }

  const pid = child.pid;
  const cdpEndpoint = `http://localhost:${port}`;

  await waitForCDP(port, 10_000);

  return { pid, port, cdpEndpoint };
}

export async function killBrowser(pid: number, port: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already dead
    await redisStore.freePort(port);
    return;
  }

  // Wait up to 3s for graceful exit, then SIGKILL
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      // Process exited
      await redisStore.freePort(port);
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // Force kill
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
  await redisStore.freePort(port);
}

export async function isAlive(pid: number, port: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const res = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/browserManager.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/browserManager.ts server/__tests__/browserManager.test.ts
git commit -m "feat: implement browser manager — launch, kill, CDP health check"
```

---

### Task 6: Browser Manager — warm pool

**Files:**
- Modify: `server/src/browserManager.ts`
- Modify: `server/__tests__/browserManager.test.ts`

**Context:** Warm pool pre-launches browsers so new sessions start faster (~0.5s vs ~3s). Warm browsers are tracked in Redis set `browser:warm:pids` with members `pid:port`. `claimWarm()` atomically pops one from the set and reassigns the port to the project. On startup, `cleanupOrphanedWarm()` health-checks and kills dead warm browsers.

- [ ] **Step 1: Add warm pool tests**

Append to `server/__tests__/browserManager.test.ts`:

```typescript
import { claimWarm, warmUp, cleanupOrphanedWarm } from '../src/browserManager.js';

describe('browserManager — warm pool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('claimWarm returns null when no warm browsers available', async () => {
    const redis = redisStore.getRedis();
    (redis.spop as any).mockResolvedValueOnce(null);

    const result = await claimWarm('proj-1');
    expect(result).toBeNull();
  });

  it('claimWarm returns browser info and reassigns port when warm browser alive', async () => {
    const redis = redisStore.getRedis();
    (redis.spop as any).mockResolvedValueOnce('88888:19305');

    // isAlive check: process exists + CDP responds
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await claimWarm('proj-1');
    expect(result).toEqual({
      pid: 88888,
      port: 19305,
      cdpEndpoint: 'http://localhost:19305',
    });
    // Port reassigned to project
    expect(redis.set).toHaveBeenCalledWith('browser:port:19305', 'proj-1');

    vi.restoreAllMocks();
  });

  it('claimWarm skips dead warm browser and returns null', async () => {
    const redis = redisStore.getRedis();
    (redis.spop as any).mockResolvedValueOnce('77777:19310');

    // isAlive: process dead
    vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });

    const result = await claimWarm('proj-1');
    expect(result).toBeNull();
    expect(redisStore.freePort).toHaveBeenCalledWith(19310);

    vi.restoreAllMocks();
  });

  it('cleanupOrphanedWarm kills dead warm browsers and leaves alive ones', async () => {
    const redis = redisStore.getRedis();
    (redis.smembers as any).mockResolvedValueOnce(['11111:19300', '22222:19301']);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === 11111 && signal === 0) return true; // alive
      if (pid === 22222 && signal === 0) throw new Error('ESRCH'); // dead
      if (pid === 22222 && signal === 'SIGKILL') return true;
      return true;
    });

    // First is alive (CDP responds), second is dead
    mockFetch
      .mockResolvedValueOnce({ ok: true })  // 11111 CDP check
      // 22222 skipped — process.kill(0) throws

    await cleanupOrphanedWarm();

    // Dead one should be removed from set and port freed
    expect(redis.srem).toHaveBeenCalledWith('browser:warm:pids', '22222:19301');
    expect(redisStore.freePort).toHaveBeenCalledWith(19301);

    // Alive one should NOT be removed
    expect(redis.srem).not.toHaveBeenCalledWith('browser:warm:pids', '11111:19300');

    killSpy.mockRestore();
  });

  it('warmUp launches browsers and registers in warm set', async () => {
    const redis = redisStore.getRedis();
    (redis.scard as any).mockResolvedValueOnce(0); // no warm browsers yet

    await warmUp(1);

    expect(redisStore.allocatePort).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalled();
    expect(redis.sadd).toHaveBeenCalledWith(
      'browser:warm:pids',
      expect.stringMatching(/^\d+:\d+$/)
    );
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/browserManager.test.ts
```

Expected: New tests FAIL with "Not implemented".

- [ ] **Step 3: Implement warm pool functions**

Replace stubs in `server/src/browserManager.ts`:

```typescript
export async function claimWarm(projectId: string): Promise<{ pid: number; port: number; cdpEndpoint: string } | null> {
  const redis = redisStore.getRedis();
  const member = await redis.spop('browser:warm:pids');
  if (!member) return null;

  const [pidStr, portStr] = (member as string).split(':');
  const pid = parseInt(pidStr, 10);
  const port = parseInt(portStr, 10);

  if (await isAlive(pid, port)) {
    // Reassign port from warm to this project.
    // Uses bare SET (not NX) to overwrite the __warm_* allocation from warmUp().
    // This is intentionally different from allocatePort() which uses SET NX.
    await redis.set(`browser:port:${port}`, projectId);
    return { pid, port, cdpEndpoint: `http://localhost:${port}` };
  }

  // Dead warm browser
  await redisStore.freePort(port);
  return null;
}

export async function warmUp(count?: number): Promise<void> {
  const target = count ?? parseInt(process.env.WARM_BROWSERS || '1', 10);
  const redis = redisStore.getRedis();
  const currentWarm = await redis.scard('browser:warm:pids');

  for (let i = currentWarm; i < target; i++) {
    try {
      const warmId = `__warm_${Date.now()}_${i}`;
      const port = await redisStore.allocatePort(warmId);
      const chromePath = getChromiumPath();

      const child = spawn(chromePath, buildArgs(port), {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      if (!child.pid) {
        await redisStore.freePort(port);
        throw new Error('Failed to spawn warm Chromium — no PID');
      }

      await waitForCDP(port, 10_000);
      await redis.sadd('browser:warm:pids', `${child.pid}:${port}`);
      console.log(`[BrowserManager] Warm browser ready pid=${child.pid} port=${port}`);
    } catch (err) {
      console.error('[BrowserManager] Failed to warm browser:', err);
    }
  }
}

export async function cleanupOrphanedWarm(): Promise<void> {
  const redis = redisStore.getRedis();
  const members = await redis.smembers('browser:warm:pids');

  for (const member of members) {
    const [pidStr, portStr] = member.split(':');
    const pid = parseInt(pidStr, 10);
    const port = parseInt(portStr, 10);

    if (!await isAlive(pid, port)) {
      await redis.srem('browser:warm:pids', member);
      await redisStore.freePort(port);
      try { process.kill(pid, 'SIGKILL'); } catch {}
      console.log(`[BrowserManager] Cleaned orphaned warm browser pid=${pid} port=${port}`);
    }
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/browserManager.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/browserManager.ts server/__tests__/browserManager.test.ts
git commit -m "feat: implement browser manager warm pool — claim, warmup, orphan cleanup"
```

---

## Chunk 3: Agent CDP Support + Session Manager

### Task 7: Modify agent.ts for CDP support

**Files:**
- Modify: `server/src/agent.ts:1-177`

**Context:** Currently `createAgent()` acquires a Playwright Browser instance from `browserPool` and passes it as `{ browser: { instance: browser } }`. We change it to accept a CDP endpoint and pass `{ browser: { cdp: cdpEndpoint } }`. The `close()` method no longer calls `agent.stop()` (which closes the browser context), since browser lifecycle is managed by `browserManager.killBrowser()`. For recovery, `url` is optional — when omitted, the agent attaches to whatever page the browser is currently on.

- [ ] **Step 1: Update createAgent signature and implementation**

In `server/src/agent.ts`, make these changes:

**Remove the browserPool import** (line 8):
```typescript
// DELETE this line:
import * as browserPool from './browserPool.js';
```

**Update the createAgent function signature** (line 37):
```typescript
// OLD:
export async function createAgent(
  url: string,
  broadcast: (msg: ServerMessage) => void,
  sessionId: string | null = null,
  projectId: string | null = null,
): Promise<AgentSession> {

// NEW:
export async function createAgent(
  broadcast: (msg: ServerMessage) => void,
  cdpEndpoint: string,
  sessionId: string | null = null,
  projectId: string | null = null,
  url?: string,
): Promise<AgentSession> {
```

**Replace the browser acquisition and agent start** (lines 50-67):
```typescript
// OLD:
  // Acquire a pre-warmed browser for fast startup
  const browser = await browserPool.acquire();
  timer.step('acquire_browser');
  broadcast({ type: 'thought', content: 'Browser ready, loading page...' });

  const agent = await startBrowserAgent({
    url,
    narrate: false,
    llm: {
      provider: 'claude-code',
      options: {
        model: 'claude-sonnet-4-20250514'
      }
    },
    browser: {
      instance: browser,
    },
  });

// NEW:
  timer.step('acquire_browser');
  broadcast({ type: 'thought', content: 'Connecting to browser via CDP...' });

  const agent = await startBrowserAgent({
    ...(url ? { url } : {}),
    narrate: false,
    llm: {
      provider: 'claude-code',
      options: {
        model: 'claude-sonnet-4-20250514'
      }
    },
    browser: {
      cdp: cdpEndpoint,
    },
  });
```

**Change the close() method** (lines 173-176):
```typescript
// OLD:
    close: async () => {
      await agent.stop();
    }

// NEW:
    close: async () => {
      // Do NOT call agent.stop() — it closes the browser context.
      // Browser lifecycle is managed by browserManager.killBrowser().
      // Just drop event listeners to prevent memory leaks.
      agent.events.removeAllListeners();
      agent.browserAgentEvents.removeAllListeners();
    }
```

- [ ] **Step 2: Verify build compiles**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx tsc --noEmit 2>&1 | head -20
```

Expected: Compilation errors in `index.ts` where `createAgent` is called with the old signature. This is expected — we'll fix `index.ts` in Task 10.

- [ ] **Step 3: Run existing tests (should still pass)**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run
```

Expected: Existing `json-parser` and `suggestion-detector` tests still pass. New tests from Tasks 2-6 pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/agent.ts
git commit -m "feat: switch agent to CDP-based browser connection, remove browserPool dependency"
```

---

### Task 8: Session Manager — create, destroy, broadcast

**Files:**
- Create: `server/src/sessionManager.ts`
- Create: `server/__tests__/sessionManager.test.ts`

**Context:** `sessionManager` orchestrates the full session lifecycle. It coordinates between `redisStore` (state), `browserManager` (Chrome processes), and `agent.ts` (LLM agent). It holds two local maps: `agents` (live AgentSession refs) and `wsClients` (WebSocket connections per project). The broadcast function writes through to Redis before forwarding to connected clients.

- [ ] **Step 1: Create sessionManager.ts**

Create `server/src/sessionManager.ts`:

```typescript
import { WebSocket } from 'ws';
import * as redisStore from './redisStore.js';
import * as browserManager from './browserManager.js';
import { createAgent } from './agent.js';
import { endSession as dbEndSession } from './db.js';
import type { AgentSession } from './agent.js';
import type { ServerMessage, ChatMessage, RedisSession } from './types.js';

// -- Local state (thin cache, NOT source of truth — Redis is) --

const agents = new Map<string, AgentSession>();
const wsClients = new Map<string, Set<WebSocket>>();

// -- WebSocket client management --

export function getAgent(projectId: string): AgentSession | undefined {
  return agents.get(projectId);
}

export function addClient(projectId: string, ws: WebSocket): void {
  let clients = wsClients.get(projectId);
  if (!clients) {
    clients = new Set();
    wsClients.set(projectId, clients);
  }
  clients.add(ws);
  redisStore.refreshTTL(projectId).catch(() => {});
}

export function removeClient(projectId: string, ws: WebSocket): void {
  const clients = wsClients.get(projectId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) wsClients.delete(projectId);
}

export function broadcastToClients(projectId: string, msg: ServerMessage): void {
  const clients = wsClients.get(projectId);
  if (!clients) return;
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// -- ServerMessage → ChatMessage conversion --

function serverMsgToChatMessage(msg: ServerMessage): ChatMessage | null {
  const id = crypto.randomUUID();
  const ts = Date.now();
  switch (msg.type) {
    case 'thought':
      return { id, type: 'agent', content: msg.content, timestamp: ts };
    case 'action': {
      const text = `Action: ${msg.action}${msg.target ? ` → ${msg.target}` : ''}`;
      return { id, type: 'agent', content: text, timestamp: ts };
    }
    case 'error':
      return { id, type: 'system', content: `Error: ${msg.message}`, timestamp: ts };
    case 'taskComplete':
      return { id, type: 'system', content: msg.success ? 'Task completed.' : 'Task failed.', timestamp: ts };
    case 'finding':
      return { id, type: 'finding', content: msg.finding.title, timestamp: ts };
    case 'suggestion': {
      const s = msg.suggestion;
      const label = s.type === 'feature' ? 'feature' : s.type === 'flow' ? 'flow' : 'behavior';
      const name = 'name' in s.data ? (s.data as any).name : (s.data as any).feature_name;
      return { id, type: 'system', content: `Learned: "${name}" ${label}`, timestamp: ts };
    }
    default:
      return null;
  }
}

// -- Broadcast with Redis write-through --

export function makeBroadcast(projectId: string): (msg: ServerMessage) => void {
  return (msg: ServerMessage) => {
    // Write-through to Redis
    if (msg.type === 'screenshot') {
      redisStore.setScreenshot(projectId, msg.data).catch(() => {});
    } else if (msg.type === 'nav') {
      redisStore.setSession(projectId, { currentUrl: msg.url }).catch(() => {});
    } else if (msg.type === 'status') {
      const statusMap: Record<string, RedisSession['status']> = {
        idle: 'idle', working: 'working', error: 'idle', disconnected: 'disconnected',
      };
      redisStore.setSession(projectId, {
        status: statusMap[msg.status] || 'idle',
      }).catch(() => {});
    }

    // Store chat messages
    const chatMsg = serverMsgToChatMessage(msg);
    if (chatMsg) {
      redisStore.pushMessage(projectId, chatMsg).catch(() => {});
    }

    // Forward to WebSocket clients
    broadcastToClients(projectId, msg);
  };
}

// -- Create session --

export async function createSession(
  projectId: string,
  url: string,
  dbSessionId: string | null,
): Promise<AgentSession> {
  // Claim warm browser or launch new
  let browser = await browserManager.claimWarm(projectId);
  if (!browser) {
    browser = await browserManager.launchBrowser(projectId);
  }

  const broadcastFn = makeBroadcast(projectId);

  // Create agent via CDP
  const agentSession = await createAgent(
    broadcastFn, browser.cdpEndpoint, dbSessionId, projectId, url
  );

  // Write session to Redis
  await redisStore.setSession(projectId, {
    dbSessionId: dbSessionId || '',
    status: 'idle',
    cdpPort: browser.port,
    cdpEndpoint: browser.cdpEndpoint,
    currentUrl: url,
    memoryContext: agentSession.memoryContext,
    browserPid: browser.pid,
    lastTask: '',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });

  agents.set(projectId, agentSession);
  return agentSession;
}

// -- Destroy session --

export async function destroySession(projectId: string): Promise<void> {
  const session = await redisStore.getSession(projectId);

  // Remove from local maps
  const agentSession = agents.get(projectId);
  agents.delete(projectId);

  // Notify connected clients
  broadcastToClients(projectId, { type: 'status', status: 'disconnected' });
  wsClients.delete(projectId);

  // Close agent (drops event listeners only, does NOT close browser context)
  if (agentSession) {
    await agentSession.close().catch(err =>
      console.error(`[SessionManager] Error closing agent for ${projectId}:`, err)
    );
  }

  if (session) {
    // Kill browser process
    await browserManager.killBrowser(session.browserPid, session.cdpPort);
    // End DB session
    if (session.dbSessionId) await dbEndSession(session.dbSessionId);
    // Remove from Redis
    await redisStore.deleteSession(projectId);
  }
}

// -- Recover session (on server restart) --

export async function recoverSession(projectId: string): Promise<boolean> {
  throw new Error('Not implemented — Task 9');
}

export async function recoverAllSessions(): Promise<void> {
  throw new Error('Not implemented — Task 9');
}

// -- Send snapshot to reconnecting client --

export async function sendSnapshot(projectId: string, ws: WebSocket): Promise<void> {
  throw new Error('Not implemented — Task 9');
}

// -- Check session exists --

export async function hasSession(projectId: string): Promise<boolean> {
  const session = await redisStore.getSession(projectId);
  return session !== null;
}

export async function listActiveSessions(): Promise<string[]> {
  return redisStore.listSessions();
}

// -- Handle expiry (called by polling loop) --

export async function handleExpiry(projectId: string): Promise<void> {
  console.log(`[SessionManager] Session ${projectId} expired, destroying...`);
  await destroySession(projectId);
}

// -- Graceful shutdown --

export async function shutdownAll(): Promise<void> {
  // Mark all sessions as disconnected in Redis (browsers survive)
  const projectIds = Array.from(agents.keys());
  for (const projectId of projectIds) {
    await redisStore.setSession(projectId, { status: 'disconnected' }).catch(() => {});
    broadcastToClients(projectId, { type: 'status', status: 'disconnected' });
  }
  agents.clear();
  wsClients.clear();
}
```

- [ ] **Step 2: Write tests for create, destroy, broadcast**

Create `server/__tests__/sessionManager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock redisStore
vi.mock('../src/redisStore.js', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  setSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  refreshTTL: vi.fn().mockResolvedValue(undefined),
  freePort: vi.fn().mockResolvedValue(undefined),
  setScreenshot: vi.fn().mockResolvedValue(undefined),
  getScreenshot: vi.fn().mockResolvedValue(null),
  pushMessage: vi.fn().mockResolvedValue(undefined),
  getMessages: vi.fn().mockResolvedValue([]),
  listSessions: vi.fn().mockResolvedValue([]),
  getRedis: vi.fn().mockReturnValue({
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  }),
}));

// Mock browserManager
vi.mock('../src/browserManager.js', () => ({
  claimWarm: vi.fn().mockResolvedValue(null),
  launchBrowser: vi.fn().mockResolvedValue({ pid: 12345, port: 19300, cdpEndpoint: 'http://localhost:19300' }),
  killBrowser: vi.fn().mockResolvedValue(undefined),
  isAlive: vi.fn().mockResolvedValue(true),
}));

// Mock agent
const mockAgentSession = {
  agent: {},
  connector: {},
  sessionId: 'db-1',
  projectId: 'proj-1',
  memoryContext: 'test context',
  stepsHistory: [],
  loginDone: Promise.resolve(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../src/agent.js', () => ({
  createAgent: vi.fn().mockResolvedValue(mockAgentSession),
}));

// Mock db
vi.mock('../src/db.js', () => ({
  endSession: vi.fn().mockResolvedValue(undefined),
  getMessagesBySession: vi.fn().mockResolvedValue([]),
}));

import * as redisStore from '../src/redisStore.js';
import * as browserManager from '../src/browserManager.js';
import { createAgent } from '../src/agent.js';
import {
  createSession,
  destroySession,
  getAgent,
  addClient,
  removeClient,
  makeBroadcast,
} from '../src/sessionManager.js';

describe('sessionManager — create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createSession claims warm browser first, falls back to launch', async () => {
    (browserManager.claimWarm as any).mockResolvedValueOnce(null);
    (browserManager.launchBrowser as any).mockResolvedValueOnce({
      pid: 12345, port: 19300, cdpEndpoint: 'http://localhost:19300',
    });

    await createSession('proj-1', 'https://example.com', 'db-1');

    expect(browserManager.claimWarm).toHaveBeenCalledWith('proj-1');
    expect(browserManager.launchBrowser).toHaveBeenCalledWith('proj-1');
    expect(createAgent).toHaveBeenCalledWith(
      expect.any(Function), 'http://localhost:19300', 'db-1', 'proj-1', 'https://example.com'
    );
    expect(redisStore.setSession).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      dbSessionId: 'db-1',
      status: 'idle',
      cdpPort: 19300,
      browserPid: 12345,
    }));
  });

  it('createSession uses warm browser when available', async () => {
    (browserManager.claimWarm as any).mockResolvedValueOnce({
      pid: 99999, port: 19305, cdpEndpoint: 'http://localhost:19305',
    });

    await createSession('proj-1', 'https://example.com', 'db-1');

    expect(browserManager.launchBrowser).not.toHaveBeenCalled();
    expect(createAgent).toHaveBeenCalledWith(
      expect.any(Function), 'http://localhost:19305', 'db-1', 'proj-1', 'https://example.com'
    );
  });

  it('createSession stores agent in local map', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    expect(getAgent('proj-1')).toBe(mockAgentSession);
  });
});

describe('sessionManager — destroy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('destroySession kills browser, ends DB session, deletes Redis', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce({
      dbSessionId: 'db-1',
      browserPid: 12345,
      cdpPort: 19300,
    });

    // First create a session so there's an agent to clean up
    await createSession('proj-1', 'https://example.com', 'db-1');
    vi.clearAllMocks();
    (redisStore.getSession as any).mockResolvedValueOnce({
      dbSessionId: 'db-1',
      browserPid: 12345,
      cdpPort: 19300,
    });

    await destroySession('proj-1');

    expect(browserManager.killBrowser).toHaveBeenCalledWith(12345, 19300);
    expect(redisStore.deleteSession).toHaveBeenCalledWith('proj-1');
    expect(getAgent('proj-1')).toBeUndefined();
  });
});

describe('sessionManager — broadcast', () => {
  it('makeBroadcast writes screenshot to Redis', () => {
    const broadcast = makeBroadcast('proj-1');
    broadcast({ type: 'screenshot', data: 'base64img' });

    expect(redisStore.setScreenshot).toHaveBeenCalledWith('proj-1', 'base64img');
  });

  it('makeBroadcast writes nav URL to Redis', () => {
    const broadcast = makeBroadcast('proj-1');
    broadcast({ type: 'nav', url: 'https://test.com/page' });

    expect(redisStore.setSession).toHaveBeenCalledWith('proj-1', { currentUrl: 'https://test.com/page' });
  });

  it('makeBroadcast stores chat messages in Redis', () => {
    const broadcast = makeBroadcast('proj-1');
    broadcast({ type: 'thought', content: 'Analyzing the page...' });

    expect(redisStore.pushMessage).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      type: 'agent',
      content: 'Analyzing the page...',
    }));
  });
});
```

- [ ] **Step 3: Run tests — expect pass**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/sessionManager.test.ts
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/sessionManager.ts server/__tests__/sessionManager.test.ts
git commit -m "feat: implement session manager — create, destroy, broadcast with Redis write-through"
```

---

### Task 9: Session Manager — recovery and snapshot

**Files:**
- Modify: `server/src/sessionManager.ts`
- Modify: `server/__tests__/sessionManager.test.ts`
- Modify: `server/src/db.ts` (add `getMessagesBySession`)

**Context:** On server restart, `recoverAllSessions()` reads all sessions from Redis, health-checks their browsers via CDP, and reconnects agents to surviving contexts. Uses distributed locks (`SET NX EX 30`) to prevent concurrent recovery. `sendSnapshot()` replays state to reconnecting clients — reads Redis for status/URL/screenshot/messages, falls back to Supabase for messages if Redis cache was evicted.

- [ ] **Step 1: Add getMessagesBySession to db.ts**

Read `server/src/db.ts` to find where message functions are, then add this function after `saveMessage`:

```typescript
export async function getMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
  if (!isSupabaseEnabled()) return [];
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error || !data) return [];

    return data.map(m => ({
      id: m.id,
      type: (m.role === 'thought' || m.role === 'action') ? 'agent' as const : m.role as ChatMessage['type'],
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Add recovery and snapshot tests**

Append to `server/__tests__/sessionManager.test.ts`:

```typescript
import {
  // ... existing imports ...
  recoverSession,
  recoverAllSessions,
  sendSnapshot,
} from '../src/sessionManager.js';
import { WebSocket } from 'ws';

const mockRedisSession = {
  dbSessionId: 'db-1',
  status: 'idle' as const,
  cdpPort: 19300,
  cdpEndpoint: 'http://localhost:19300',
  currentUrl: 'https://example.com/dashboard',
  memoryContext: '',
  browserPid: 12345,
  lastTask: '',
  createdAt: 1710000000000,
  lastActivityAt: 1710000000000,
};

describe('sessionManager — recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recoverSession reconnects agent when browser is alive', async () => {
    const redis = redisStore.getRedis();
    (redis.set as any).mockResolvedValueOnce('OK'); // lock acquired
    (redisStore.getSession as any).mockResolvedValueOnce(mockRedisSession);
    (browserManager.isAlive as any).mockResolvedValueOnce(true);

    const result = await recoverSession('proj-1');

    expect(result).toBe(true);
    expect(createAgent).toHaveBeenCalledWith(
      expect.any(Function), 'http://localhost:19300', 'db-1', 'proj-1', undefined
    );
    expect(redisStore.setSession).toHaveBeenCalledWith('proj-1', { status: 'idle' });
    expect(redis.del).toHaveBeenCalledWith('session:lock:proj-1');
  });

  it('recoverSession marks crashed when browser is dead', async () => {
    const redis = redisStore.getRedis();
    (redis.set as any).mockResolvedValueOnce('OK');
    (redisStore.getSession as any).mockResolvedValueOnce(mockRedisSession);
    (browserManager.isAlive as any).mockResolvedValueOnce(false);

    const result = await recoverSession('proj-1');

    expect(result).toBe(false);
    expect(redisStore.setSession).toHaveBeenCalledWith('proj-1', { status: 'crashed' });
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('recoverSession skips when lock is held by another server', async () => {
    const redis = redisStore.getRedis();
    (redis.set as any).mockResolvedValueOnce(null); // lock NOT acquired

    const result = await recoverSession('proj-1');
    expect(result).toBe(false);
    expect(redisStore.getSession).not.toHaveBeenCalled();
  });

  it('recoverSession sets status to interrupted when previous status was working', async () => {
    const redis = redisStore.getRedis();
    (redis.set as any).mockResolvedValueOnce('OK');
    (redisStore.getSession as any).mockResolvedValueOnce({
      ...mockRedisSession,
      status: 'working',
      lastTask: 'Click the submit button',
    });
    (browserManager.isAlive as any).mockResolvedValueOnce(true);

    await recoverSession('proj-1');

    expect(redisStore.setSession).toHaveBeenCalledWith('proj-1', { status: 'interrupted' });
  });
});

describe('sessionManager — recoverAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recoverAllSessions processes sessions in batches of 5', async () => {
    (redisStore.listSessions as any).mockResolvedValueOnce([
      'proj-1', 'proj-2', 'proj-3', 'proj-4', 'proj-5', 'proj-6',
    ]);

    const redis = redisStore.getRedis();
    (redis.set as any).mockResolvedValue('OK');
    (redisStore.getSession as any).mockResolvedValue(mockRedisSession);
    (browserManager.isAlive as any).mockResolvedValue(true);

    await recoverAllSessions();

    // All 6 sessions attempted
    expect(createAgent).toHaveBeenCalledTimes(6);
  });
});

describe('sessionManager — sendSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sendSnapshot sends status, nav, screenshot, and messages', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce(mockRedisSession);
    (redisStore.getScreenshot as any).mockResolvedValueOnce('screenshot-data');
    (redisStore.getMessages as any).mockResolvedValueOnce([
      { id: '1', type: 'user', content: 'hello', timestamp: 1000 },
    ]);

    const mockWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as any;

    await sendSnapshot('proj-1', mockWs);

    const calls = mockWs.send.mock.calls.map((c: any) => JSON.parse(c[0]));
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'status', status: 'idle' }),
      expect.objectContaining({ type: 'nav', url: 'https://example.com/dashboard' }),
      expect.objectContaining({ type: 'screenshot', data: 'screenshot-data' }),
      expect.objectContaining({ type: 'sessionRestore' }),
    ]));
  });

  it('sendSnapshot sends taskInterrupted for interrupted sessions', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce({
      ...mockRedisSession,
      status: 'interrupted',
      lastTask: 'Fill out the form',
    });
    (redisStore.getScreenshot as any).mockResolvedValueOnce(null);
    (redisStore.getMessages as any).mockResolvedValueOnce([]);

    const mockWs = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
    await sendSnapshot('proj-1', mockWs);

    const calls = mockWs.send.mock.calls.map((c: any) => JSON.parse(c[0]));
    expect(calls).toContainEqual(
      expect.objectContaining({ type: 'taskInterrupted', task: 'Fill out the form' })
    );
  });

  it('sendSnapshot sends sessionCrashed for crashed sessions', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce({
      ...mockRedisSession,
      status: 'crashed',
    });
    (redisStore.getScreenshot as any).mockResolvedValueOnce(null);
    (redisStore.getMessages as any).mockResolvedValueOnce([]);

    const mockWs = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
    await sendSnapshot('proj-1', mockWs);

    const calls = mockWs.send.mock.calls.map((c: any) => JSON.parse(c[0]));
    expect(calls).toContainEqual(
      expect.objectContaining({ type: 'sessionCrashed' })
    );
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/sessionManager.test.ts
```

Expected: Recovery and snapshot tests FAIL with "Not implemented — Task 9".

- [ ] **Step 4: Implement recoverSession, recoverAllSessions, sendSnapshot**

Replace the stubs in `server/src/sessionManager.ts`:

```typescript
// Add import at top of file:
import { getMessagesBySession } from './db.js';

// -- Recover session (on server restart) --

export async function recoverSession(projectId: string): Promise<boolean> {
  const redis = redisStore.getRedis();
  const serverId = String(process.pid);

  // Distributed lock
  const locked = await redis.set(`session:lock:${projectId}`, serverId, 'NX', 'EX', 30);
  if (!locked) return false;

  try {
    const session = await redisStore.getSession(projectId);
    if (!session) return false;

    const alive = await browserManager.isAlive(session.browserPid, session.cdpPort);

    if (alive) {
      const broadcastFn = makeBroadcast(projectId);

      // Connect agent to existing browser — NO url (keep current page)
      const agentSession = await createAgent(
        broadcastFn, session.cdpEndpoint, session.dbSessionId, projectId, undefined
      );
      agents.set(projectId, agentSession);

      // Update status based on what was happening before crash
      if (session.status === 'working') {
        await redisStore.setSession(projectId, { status: 'interrupted' });
      } else {
        await redisStore.setSession(projectId, { status: 'idle' });
      }

      console.log(`[RECOVERY] Session ${projectId} recovered`);
      return true;
    } else {
      // Browser is dead
      await redisStore.setSession(projectId, { status: 'crashed' });
      await redisStore.freePort(session.cdpPort);
      console.log(`[RECOVERY] Session ${projectId} browser crashed`);
      return false;
    }
  } finally {
    await redis.del(`session:lock:${projectId}`);
  }
}

// -- Recover all sessions on startup --

export async function recoverAllSessions(): Promise<void> {
  const projectIds = await redisStore.listSessions();
  if (projectIds.length === 0) return;

  console.log(`[RECOVERY] Recovering ${projectIds.length} session(s)...`);
  const results: PromiseSettledResult<boolean>[] = [];

  for (let i = 0; i < projectIds.length; i += 5) {
    const batch = projectIds.slice(i, i + 5);
    results.push(...await Promise.allSettled(
      batch.map(pid => recoverSession(pid))
    ));
  }

  const recovered = results.filter(r => r.status === 'fulfilled' && r.value).length;
  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)).length;
  console.log(`[RECOVERY] ${recovered} recovered, ${failed} failed of ${projectIds.length} total`);
}

// -- Send snapshot to reconnecting client --

export async function sendSnapshot(projectId: string, ws: WebSocket): Promise<void> {
  const session = await redisStore.getSession(projectId);
  if (!session) return;

  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // Status
  send({ type: 'status', status: session.status as any });

  // Current URL
  if (session.currentUrl) {
    send({ type: 'nav', url: session.currentUrl });
  }

  // Screenshot (separate Redis key)
  const screenshot = await redisStore.getScreenshot(projectId);
  if (screenshot) {
    send({ type: 'screenshot', data: screenshot });
  }

  // Messages — Redis first, fall back to Supabase
  let messages = await redisStore.getMessages(projectId);
  if (messages.length === 0 && session.dbSessionId) {
    messages = await getMessagesBySession(session.dbSessionId);
  }
  if (messages.length > 0) {
    send({ type: 'sessionRestore', messages });
  }

  // Interrupted task notification
  if (session.status === 'interrupted' && session.lastTask) {
    send({ type: 'taskInterrupted', task: session.lastTask });
  }

  // Crashed notification
  if (session.status === 'crashed') {
    send({ type: 'sessionCrashed' });
  }
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run __tests__/sessionManager.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/sessionManager.ts server/__tests__/sessionManager.test.ts server/src/db.ts
git commit -m "feat: implement session recovery, snapshot replay, and DB message fallback"
```

---

## Chunk 4: Server Integration + Client + Cleanup

### Task 10: Rewire index.ts to use sessionManager

**Files:**
- Modify: `server/src/index.ts`

**Context:** Replace all `sessionPool` and `browserPool` usage in `index.ts` with `sessionManager`. The `startingProjects` Set is replaced by Redis distributed locks (handled inside `sessionManager`). The broadcast function with message tracking is replaced by `sessionManager.makeBroadcast()`. The WebSocket client tracking (`clientProjects` Map) stays in `index.ts` since it maps raw WebSocket refs to project IDs.

- [ ] **Step 1: Rewrite index.ts imports**

Replace the import block at the top of `server/src/index.ts`:

```typescript
// OLD imports to REMOVE:
import * as sessionPool from './sessionPool.js';
import * as browserPool from './browserPool.js';

// NEW imports to ADD:
import * as sessionManager from './sessionManager.js';
import * as redisStore from './redisStore.js';
import * as browserManager from './browserManager.js';
```

Keep all other imports unchanged (`createAgent`, `executeTask`, `executeExplore`, `executeLogin`, `getProject`, `createSession`, `decryptCredentials`, `isSupabaseEnabled`, `createHeyGenToken`, `isHeyGenEnabled`, types).

Also update the `createAgent` import — it's still needed for login but the direct call moves to sessionManager. Actually, remove the `createAgent` import since `sessionManager.createSession()` calls it internally. Keep `executeTask`, `executeExplore`, `executeLogin`:

```typescript
import { executeTask, executeExplore, executeLogin } from './agent.js';
```

**Keep the existing `makeChatMessage` helper function in `index.ts`** — it is still used directly by the `task` and `explore` handlers to create user-initiated messages (before the agent runs). The `sessionManager.makeBroadcast()` handles agent output messages separately via its own `serverMsgToChatMessage` converter.

- [ ] **Step 2: Remove startingProjects and update health endpoint**

Remove:
```typescript
const startingProjects = new Set<string>();
```

Update the health endpoint:
```typescript
app.get('/health', async (_req, res) => {
  const sessions = await sessionManager.listActiveSessions();
  const redisOk = redisStore.getRedis()?.status === 'ready';
  res.json({
    status: 'ok',
    supabase: isSupabaseEnabled(),
    heygenEnabled: isHeyGenEnabled(),
    redis: redisOk,
    activeSessions: sessions.length,
  });
});
```

- [ ] **Step 3: Rewrite the `start` handler**

Replace the entire `start` handler in the WebSocket message handler with:

```typescript
    if (msg.type === 'start') {
      console.log('[START] Starting agent for project:', msg.projectId);

      // Detach from previous session if needed
      const prevProjectId = clientProjects.get(ws);
      if (prevProjectId) {
        sessionManager.removeClient(prevProjectId, ws);
        clientProjects.delete(ws);
      }

      // Check if session already exists in Redis
      const hasExisting = await sessionManager.hasSession(msg.projectId);
      if (hasExisting && sessionManager.getAgent(msg.projectId)) {
        console.log('[START] Reattaching to existing session');
        sessionManager.addClient(msg.projectId, ws);
        clientProjects.set(ws, msg.projectId);
        await sessionManager.sendSnapshot(msg.projectId, ws);
        return;
      }

      // Send immediate feedback
      ws.send(JSON.stringify({ type: 'status', status: 'working' } as ServerMessage));

      try {
        const project = await getProject(msg.projectId);
        if (!project) {
          ws.send(JSON.stringify({ type: 'error', message: 'Project not found' } as ServerMessage));
          ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
          return;
        }

        let credentials: { username: string; password: string } | null = null;
        if (project.credentials) {
          try { credentials = decryptCredentials(project.credentials); } catch {}
        }

        const dbSessionId = await createSession(project.id);

        const agentSession = await sessionManager.createSession(
          msg.projectId, msg.resumeUrl || project.url, dbSessionId
        );

        sessionManager.addClient(msg.projectId, ws);
        clientProjects.set(ws, msg.projectId);

        // Kick off login (non-blocking)
        if (credentials) {
          const loginBroadcast = sessionManager.makeBroadcast(msg.projectId);
          agentSession.loginDone = executeLogin(agentSession, credentials, loginBroadcast).catch(err => {
            console.error('[LOGIN] Background login error:', err);
          });
        }
      } catch (err) {
        console.error('[START] Error creating agent:', err);
        const message = err instanceof Error ? err.message : 'Failed to start agent';
        ws.send(JSON.stringify({ type: 'error', message } as ServerMessage));
        ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
      }

// NOTE: Steps 3-7 produce code that must be assembled into one continuous
// if/else if chain inside the ws.on('message') handler. Each step shows
// one branch of the chain.
```

- [ ] **Step 4: Rewrite the `resume` handler**

```typescript
    } else if (msg.type === 'resume') {
      const prevProjectId = clientProjects.get(ws);
      if (prevProjectId && prevProjectId !== msg.projectId) {
        sessionManager.removeClient(prevProjectId, ws);
      }

      const exists = await sessionManager.hasSession(msg.projectId);
      if (exists) {
        sessionManager.addClient(msg.projectId, ws);
        clientProjects.set(ws, msg.projectId);
        await sessionManager.sendSnapshot(msg.projectId, ws);
      } else {
        ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
      }
```

- [ ] **Step 5: Rewrite the `task` handler**

```typescript
    } else if (msg.type === 'task') {
      const projectId = clientProjects.get(ws);
      if (!projectId) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active session. Start an agent first.' } as ServerMessage));
        return;
      }

      const agentSession = sessionManager.getAgent(projectId);
      if (!agentSession) {
        ws.send(JSON.stringify({ type: 'error', message: 'Session expired. Please restart the agent.' } as ServerMessage));
        return;
      }

      // Store user message
      const userMsg = makeChatMessage('user', msg.content);
      redisStore.pushMessage(projectId, userMsg).catch(() => {});

      // Store lastTask for interrupted task recovery
      redisStore.setSession(projectId, { lastTask: msg.content }).catch(() => {});

      const taskBroadcast = sessionManager.makeBroadcast(projectId);
      executeTask(agentSession, msg.content, taskBroadcast);
```

- [ ] **Step 6: Rewrite the `stop` handler**

```typescript
    } else if (msg.type === 'stop') {
      const projectId = clientProjects.get(ws);
      if (projectId) {
        await sessionManager.destroySession(projectId);
        for (const [client, pid] of clientProjects) {
          if (pid === projectId) clientProjects.delete(client);
        }
      }
```

- [ ] **Step 7: Rewrite the `explore` handler**

```typescript
    } else if (msg.type === 'explore') {
      const projectId = clientProjects.get(ws);
      if (!projectId) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active session. Send start first.' } as ServerMessage));
        return;
      }
      if (projectId !== msg.projectId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Project ID mismatch with active session.' } as ServerMessage));
        return;
      }

      const agentSession = sessionManager.getAgent(projectId);
      if (!agentSession) {
        ws.send(JSON.stringify({ type: 'error', message: 'Session expired.' } as ServerMessage));
        return;
      }

      const project = await getProject(msg.projectId);
      if (!project) {
        ws.send(JSON.stringify({ type: 'error', message: 'Project not found.' } as ServerMessage));
        return;
      }

      // Log explore start
      const exploreMsg = makeChatMessage('system', 'Explore & Learn started...');
      redisStore.pushMessage(projectId, exploreMsg).catch(() => {});

      const exploreBroadcast = sessionManager.makeBroadcast(projectId);
      executeExplore(agentSession, project?.context || null, exploreBroadcast);
    }
```

- [ ] **Step 8: Rewrite the WebSocket close handler**

```typescript
  ws.on('close', () => {
    console.log('Client disconnected');
    const projectId = clientProjects.get(ws);
    if (projectId) {
      sessionManager.removeClient(projectId, ws);
      clientProjects.delete(ws);
    }
  });
```

- [ ] **Step 9: Verify build**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 10: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: rewire server to use sessionManager with Redis-backed persistence"
```

---

### Task 11: Add server lifecycle — startup and shutdown sequences

**Files:**
- Modify: `server/src/index.ts`

**Context:** The server startup must: (1) connect Redis, (2) clean up orphaned warm browsers, (3) recover all sessions, (4) start expiry polling, (5) warm up browsers, (6) start HTTP/WS server. Shutdown must: (1) stop accepting connections, (2) stop polling, (3) mark sessions disconnected (don't kill browsers), (4) close Redis.

- [ ] **Step 1: Add startup sequence**

Replace the server listen block at the bottom of `server/src/index.ts`:

```typescript
const PORT = parseInt(process.env.PORT || '3001');

async function startup(): Promise<void> {
  console.log('[STARTUP] Connecting to Redis...');
  redisStore.connect();

  console.log('[STARTUP] Cleaning up orphaned warm browsers...');
  await browserManager.cleanupOrphanedWarm();

  console.log('[STARTUP] Recovering sessions...');
  await sessionManager.recoverAllSessions();

  console.log('[STARTUP] Starting expiry polling...');
  redisStore.pollExpiredSessions(sessionManager.handleExpiry);

  console.log('[STARTUP] Warming browser pool...');
  browserManager.warmUp().catch(err =>
    console.error('[STARTUP] Warm-up error:', err)
  );

  server.listen(PORT, () => {
    console.log(`[STARTUP] Server running on http://localhost:${PORT}`);
    console.log('[STARTUP] WebSocket server ready');
  });
}

startup().catch(err => {
  console.error('[STARTUP] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add shutdown handler**

Add before the `startup()` call:

```typescript
async function shutdown(signal: string): Promise<void> {
  console.log(`[SHUTDOWN] Received ${signal}, shutting down gracefully...`);

  // Stop accepting new connections
  wss.close();

  // Mark sessions disconnected (browsers survive)
  await sessionManager.shutdownAll();

  // Close Redis
  await redisStore.shutdown();

  console.log('[SHUTDOWN] Complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: add server startup sequence (Redis + recovery + warmup) and graceful shutdown"
```

---

### Task 12: Update client WebSocket handling

**Files:**
- Modify: `client/src/contexts/WebSocketContext.tsx`

**Context:** The client needs to handle two new message types from the server: `sessionCrashed` (browser died — show error, suggest restart) and `taskInterrupted` (task was in progress when server restarted — show retry prompt). The client's message handler uses `msg.type` string comparison (no typed union on the client side), so no separate types file update is needed — the server types were already updated in Task 1.

- [ ] **Step 1: Add handlers for new message types**

In the `handleMessage` callback inside `WebSocketContext.tsx`, add cases for the new message types. Find the if-else chain that processes `msg.type` and add these two branches:

```typescript
      } else if (msg.type === 'sessionCrashed') {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          type: 'system',
          content: 'Browser session crashed. Please restart the agent to continue.',
          timestamp: Date.now(),
        }]);
        setStatus('disconnected');
        activeProjectRef.current = null;
        setActiveProjectId(null);

      } else if (msg.type === 'taskInterrupted') {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          type: 'system',
          content: `Server restarted while running a task. Your browser session was preserved. Previous task: "${(msg as any).task}"`,
          timestamp: Date.now(),
        }]);
        // Status stays as-is (likely 'idle' from the recovered session snapshot)
```

Note: The client does not import server types — it parses raw JSON messages. The `(msg as any).task` cast handles the untyped field access. This is consistent with how the existing client code handles other message fields.

- [ ] **Step 2: Verify client build**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/client
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to these changes.

- [ ] **Step 3: Commit**

```bash
git add client/src/contexts/WebSocketContext.tsx
git commit -m "feat: handle sessionCrashed and taskInterrupted messages in client"
```

---

### Task 13: Remove old modules and verify full build

**Files:**
- Delete: `server/src/sessionPool.ts`
- Delete: `server/src/browserPool.ts`

- [ ] **Step 1: Search for remaining references to old modules**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
grep -r "sessionPool\|browserPool" src/ --include="*.ts" -l
```

Expected: No files reference `sessionPool` or `browserPool` (all references were updated in Tasks 7 and 10). If any remain, update those imports first.

- [ ] **Step 2: Delete old modules**

```bash
rm server/src/sessionPool.ts server/src/browserPool.ts
```

- [ ] **Step 3: Verify full server build**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx tsc --noEmit
```

Expected: Clean build with no errors.

- [ ] **Step 4: Run all tests**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat/server
npx vitest run
```

Expected: All tests pass (json-parser, suggestion-detector, redisStore, browserManager, sessionManager).

- [ ] **Step 5: Verify full workspace build**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat
npm run build
```

Expected: Both client and server build successfully.

- [ ] **Step 6: Commit**

```bash
git rm server/src/sessionPool.ts server/src/browserPool.ts
git commit -m "refactor: remove sessionPool and browserPool, replaced by Redis-backed persistence"
```

---

## Post-Implementation Checklist

After all tasks are complete:

- [ ] All tests pass: `npx vitest run` in server/
- [ ] Full build succeeds: `npm run build` in root
- [ ] Add `REDIS_URL=redis://localhost:6379` to `server/.env` and `server/.env.example`
- [ ] Redis is required for dev: add `REDIS_URL` to `.env.example` and `server/.env`
- [ ] Update `CLAUDE.md` architecture section to reflect new modules
- [ ] Manual smoke test: start server → start agent → kill server (Ctrl+C) → restart → verify session recovers
