# Langfuse Observability UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-agent Observability tab showing historical Langfuse traces grouped by session, with inline span-tree detail.

**Architecture:** Server-side proxy routes call Langfuse SDK to fetch traces, transform them, and return JSON. Client renders a master-detail panel (trace list + span tree) following the FindingsDashboard pattern. A HealthContext provides feature flag to conditionally show the tab.

**Tech Stack:** Express + Langfuse SDK (server), React 19 + TypeScript + CSS variables (client)

**Spec:** `docs/superpowers/specs/2026-03-15-langfuse-observability-ui-design.md`

---

## Chunk 1: Server-Side (Tasks 1–4)

### Task 1: Add Langfuse Tags to Trace Creation

All three trace creation sites in `agent.ts` must add a `tags` array so the Langfuse API can filter by agent.

**Files:**
- Modify: `browser-agent-chat/server/src/agent.ts:268-273` (login trace)
- Modify: `browser-agent-chat/server/src/agent.ts:384-389` (explore trace)
- Modify: `browser-agent-chat/server/src/agent.ts:530-535` (user-task trace)

- [ ] **Step 1: Add `tags` to login trace**

In `agent.ts`, find the login trace creation (around line 268):

```typescript
const trace = langfuse?.trace({
  name: 'login',
  sessionId: session.sessionId ?? undefined,
  metadata: { agentId: session.agentId },
  input: { username: credentials.username },
}) ?? null;
```

Add `tags`:

```typescript
const trace = langfuse?.trace({
  name: 'login',
  sessionId: session.sessionId ?? undefined,
  metadata: { agentId: session.agentId },
  input: { username: credentials.username },
  tags: [`agent:${session.agentId}`],
}) ?? null;
```

- [ ] **Step 2: Add `tags` to explore trace**

Find the explore trace creation (around line 384):

```typescript
const trace = langfuse?.trace({
  name: 'explore',
  sessionId: session.sessionId ?? undefined,
  metadata: { agentId: session.agentId },
  input: { context },
}) ?? null;
```

Add `tags`:

```typescript
const trace = langfuse?.trace({
  name: 'explore',
  sessionId: session.sessionId ?? undefined,
  metadata: { agentId: session.agentId },
  input: { context },
  tags: [`agent:${session.agentId}`],
}) ?? null;
```

- [ ] **Step 3: Add `tags` to user-task trace**

Find the user-task trace creation (around line 530):

```typescript
const trace = langfuse?.trace({
  name: 'user-task',
  sessionId: session.sessionId ?? undefined,
  metadata: { agentId: session.agentId },
  input: { task },
}) ?? null;
```

Add `tags`:

```typescript
const trace = langfuse?.trace({
  name: 'user-task',
  sessionId: session.sessionId ?? undefined,
  metadata: { agentId: session.agentId },
  input: { task },
  tags: [`agent:${session.agentId}`],
}) ?? null;
```

- [ ] **Step 4: Verify server compiles**

Run: `cd browser-agent-chat && npm run build --workspace=server`
Expected: Compiles without errors

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/agent.ts
git commit -m "feat: add agent tags to Langfuse traces for filtering"
```

---

### Task 2: Add Langfuse Query Helpers

Add `fetchAgentTraces()` and `fetchTraceDetail()` to `langfuse.ts`. These wrap the Langfuse SDK API and transform responses into our response shapes.

**Files:**
- Modify: `browser-agent-chat/server/src/langfuse.ts` (append after line 36)

**Context:** The existing file is 37 lines. It exports `initLangfuse()`, `getLangfuse()`, `isLangfuseEnabled()`, and `shutdownLangfuse()`. The Langfuse SDK v3 API methods are `langfuse.api.traceList(query)` and `langfuse.api.traceGet(traceId)`.

- [ ] **Step 1: Define response types**

Add these types at the top of `langfuse.ts` (after the import on line 1):

```typescript
export interface TraceSummary {
  id: string;
  name: string;
  input: unknown;
  latency: number | null;
  totalCost: number | null;
  status: 'success' | 'error';
  observationCount: number;
  timestamp: string;
  sessionId: string | null;
}

export interface TraceObservation {
  name: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  model: string | null;
  tokenCount: number | null;
  level: string;
}

export interface TraceDetail {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  latency: number | null;
  totalCost: number | null;
  status: 'success' | 'error';
  timestamp: string;
  observations: TraceObservation[];
}

export interface TracePaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}
```

- [ ] **Step 2: Add `deriveStatus` helper**

Add after the types, before `initLangfuse()`:

```typescript
function deriveStatus(output: unknown): 'success' | 'error' {
  if (output && typeof output === 'object' && 'success' in output) {
    return (output as { success: boolean }).success ? 'success' : 'error';
  }
  return 'success';
}
```

- [ ] **Step 3: Add `fetchAgentTraces` function**

Add after `shutdownLangfuse()`:

```typescript
export async function fetchAgentTraces(
  agentId: string,
  page = 1,
  limit = 50
): Promise<{ traces: TraceSummary[]; meta: TracePaginationMeta }> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  const result = await langfuse.api.traceList({
    tags: [`agent:${agentId}`],
    page,
    limit,
    orderBy: 'timestamp.desc',
  });

  const traces: TraceSummary[] = result.data.map(t => ({
    id: t.id,
    name: t.name ?? 'unnamed',
    input: t.input,
    latency: t.latency ?? null,
    totalCost: t.totalCost ?? null,
    status: deriveStatus(t.output),
    observationCount: t.observations?.length ?? 0,
    timestamp: t.timestamp,
    sessionId: t.sessionId ?? null,
  }));

  return {
    traces,
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      totalItems: result.meta.totalItems,
      totalPages: result.meta.totalPages,
    },
  };
}
```

- [ ] **Step 4: Add `fetchTraceDetail` function**

Add after `fetchAgentTraces()`:

```typescript
export async function fetchTraceDetail(traceId: string): Promise<TraceDetail> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  const t = await langfuse.api.traceGet(traceId);

  const observations: TraceObservation[] = (t.observations ?? []).map(obs => {
    const startMs = new Date(obs.startTime).getTime();
    const endMs = obs.endTime ? new Date(obs.endTime).getTime() : null;
    const duration = endMs !== null ? (endMs - startMs) / 1000 : null;

    let tokenCount: number | null = null;
    if (obs.usage) {
      const u = obs.usage as { total?: number; input?: number; output?: number };
      tokenCount = u.total ?? ((u.input ?? 0) + (u.output ?? 0)) || null;
    }

    return {
      name: obs.name ?? null,
      startTime: obs.startTime,
      endTime: obs.endTime ?? null,
      duration,
      model: obs.model ?? null,
      tokenCount,
      level: obs.level ?? 'DEFAULT',
    };
  });

  // Sort observations by startTime
  observations.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return {
    id: t.id,
    name: t.name ?? 'unnamed',
    input: t.input,
    output: t.output,
    latency: t.latency ?? null,
    totalCost: t.totalCost ?? null,
    status: deriveStatus(t.output),
    timestamp: t.timestamp,
    observations,
  };
}
```

- [ ] **Step 5: Verify server compiles**

Run: `cd browser-agent-chat && npm run build --workspace=server`
Expected: Compiles without errors

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/server/src/langfuse.ts
git commit -m "feat: add Langfuse query helpers for trace list and detail"
```

---

### Task 3: Create Traces API Route

Create `routes/traces.ts` following the same pattern as `routes/findings.ts`: `Router({ mergeParams: true })`, `requireAuth` middleware, `req.params.id` for agentId.

**Files:**
- Create: `browser-agent-chat/server/src/routes/traces.ts`

**Context:** Route files use `Router({ mergeParams: true })` because they're mounted at `/api/agents/:id/traces` in `index.ts`. The `:id` param is accessed via `req.params.id`. Auth uses `requireAuth` middleware from `../auth.js`. The Supabase client for session lookups is available from `../supabase.js`.

- [ ] **Step 1: Create the route file**

Create `browser-agent-chat/server/src/routes/traces.ts`:

```typescript
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { fetchAgentTraces, fetchTraceDetail, isLangfuseEnabled } from '../langfuse.js';
import { supabase } from '../supabase.js';

const router = Router({ mergeParams: true });

// List traces grouped by session
router.get('/', requireAuth, async (req, res) => {
  if (!isLangfuseEnabled()) {
    res.status(503).json({ error: 'Langfuse is not configured' });
    return;
  }

  const agentId = req.params.id as string;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;

  try {
    const { traces, meta } = await fetchAgentTraces(agentId, page, limit);

    // Group traces by sessionId
    const sessionMap = new Map<string, typeof traces>();
    for (const trace of traces) {
      const sid = trace.sessionId ?? '__no_session__';
      if (!sessionMap.has(sid)) sessionMap.set(sid, []);
      sessionMap.get(sid)!.push(trace);
    }

    // Fetch session metadata from Supabase for startedAt timestamps
    const sessionIds = [...sessionMap.keys()].filter(s => s !== '__no_session__');
    let sessionMeta: Record<string, string> = {};
    if (sessionIds.length > 0 && supabase) {
      const { data } = await supabase
        .from('sessions')
        .select('id, created_at')
        .in('id', sessionIds);
      if (data) {
        sessionMeta = Object.fromEntries(data.map(s => [s.id, s.created_at]));
      }
    }

    // Build response
    const sessions = [...sessionMap.entries()].map(([sessionId, sessionTraces]) => ({
      sessionId: sessionId === '__no_session__' ? null : sessionId,
      startedAt: sessionMeta[sessionId] ?? sessionTraces[0]?.timestamp ?? null,
      traces: sessionTraces,
    }));

    // Sort sessions by startedAt descending
    sessions.sort((a, b) => {
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return tb - ta;
    });

    res.json({ sessions, meta });
  } catch (err) {
    console.error('[TRACES] Error fetching traces:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch traces';
    res.status(500).json({ error: message });
  }
});

// Get trace detail with observations
router.get('/:traceId', requireAuth, async (req, res) => {
  if (!isLangfuseEnabled()) {
    res.status(503).json({ error: 'Langfuse is not configured' });
    return;
  }

  const traceId = req.params.traceId as string;

  try {
    const detail = await fetchTraceDetail(traceId);
    res.json(detail);
  } catch (err) {
    console.error('[TRACES] Error fetching trace detail:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch trace';
    res.status(500).json({ error: message });
  }
});

export default router;
```

- [ ] **Step 2: Verify server compiles**

Run: `cd browser-agent-chat && npm run build --workspace=server`
Expected: Compiles without errors

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/server/src/routes/traces.ts
git commit -m "feat: add traces API route with session grouping"
```

---

### Task 4: Register Route and Add Health Flag

Wire up the traces route in `index.ts` and add `langfuseEnabled` to the health endpoint.

**Files:**
- Modify: `browser-agent-chat/server/src/index.ts:7-14` (imports)
- Modify: `browser-agent-chat/server/src/index.ts:31-41` (health endpoint)
- Modify: `browser-agent-chat/server/src/index.ts:58-64` (route registration)

- [ ] **Step 1: Add traces route import**

In `index.ts`, find the route imports (around lines 7-11):

```typescript
import agentsRouter from './routes/agents.js';
import findingsRouter from './routes/findings.js';
import memoryRouter from './routes/memory.js';
import suggestionsRouter from './routes/suggestions.js';
import evalsRouter from './routes/evals.js';
import mapRouter from './routes/map.js';
```

Add after `mapRouter`:

```typescript
import tracesRouter from './routes/traces.js';
```

- [ ] **Step 2: Add `isLangfuseEnabled` import**

Find the langfuse import (around line 21):

```typescript
import { initLangfuse, shutdownLangfuse } from './langfuse.js';
```

Change to:

```typescript
import { initLangfuse, shutdownLangfuse, isLangfuseEnabled } from './langfuse.js';
```

- [ ] **Step 3: Add `langfuseEnabled` to health endpoint**

Find the health endpoint (around lines 31-41):

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

Add `langfuseEnabled`:

```typescript
app.get('/health', async (_req, res) => {
  const sessions = await sessionManager.listActiveSessions();
  const redisOk = redisStore.getRedis()?.status === 'ready';
  res.json({
    status: 'ok',
    supabase: isSupabaseEnabled(),
    heygenEnabled: isHeyGenEnabled(),
    langfuseEnabled: isLangfuseEnabled(),
    redis: redisOk,
    activeSessions: sessions.length,
  });
});
```

- [ ] **Step 4: Register the traces route**

Find the route registrations (around lines 59-64):

```typescript
app.use('/api/agents', agentsRouter);
app.use('/api/agents/:id/findings', findingsRouter);
app.use('/api/agents/:id/memory', memoryRouter);
app.use('/api/agents/:id/suggestions', suggestionsRouter);
app.use('/api/agents/:id/evals', evalsRouter);
app.use('/api/agents/:id/map', mapRouter);
```

Add after `mapRouter`:

```typescript
app.use('/api/agents/:id/traces', tracesRouter);
```

- [ ] **Step 5: Verify server compiles**

Run: `cd browser-agent-chat && npm run build --workspace=server`
Expected: Compiles without errors

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/server/src/index.ts
git commit -m "feat: register traces route and add langfuseEnabled to health"
```

---

## Chunk 2: Client-Side (Tasks 5–7)

### Task 5: Create HealthContext

A React context that fetches `/health` once on mount and exposes `langfuseEnabled` to the component tree.

**Files:**
- Create: `browser-agent-chat/client/src/contexts/HealthContext.tsx`
- Modify: `browser-agent-chat/client/src/App.tsx:1-32` (wrap with provider)

**Context:** Existing contexts are `ThemeContext`, `AssistantContext`, `WebSocketContext`. Each follows the pattern: create context, provider component with state, export `useX()` hook. App.tsx currently has no layout wrapper — each route renders its own `<Sidebar />`.

- [ ] **Step 1: Add `/health` to Vite dev proxy**

In `browser-agent-chat/client/vite.config.ts`, add the `/health` proxy entry alongside the existing `/api` proxy. Find:

```typescript
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
```

Add after it:

```typescript
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
```

This is needed because the health endpoint lives at the server root (not under `/api/`), and Vite only proxies configured paths.

- [ ] **Step 2: Create HealthContext**

Create `browser-agent-chat/client/src/contexts/HealthContext.tsx`:

```typescript
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface HealthState {
  langfuseEnabled: boolean;
  loading: boolean;
}

const HealthContext = createContext<HealthState>({ langfuseEnabled: false, loading: true });

export function useHealth(): HealthState {
  return useContext(HealthContext);
}

export function HealthProvider({ children }: { children: ReactNode }) {
  const [langfuseEnabled, setLangfuseEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/health')
      .then(res => res.json())
      .then(data => {
        setLangfuseEnabled(data.langfuseEnabled ?? false);
      })
      .catch(() => {
        // Health check failed — assume features disabled
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <HealthContext.Provider value={{ langfuseEnabled, loading }}>
      {children}
    </HealthContext.Provider>
  );
}
```

- [ ] **Step 3: Wrap App with HealthProvider**

In `App.tsx`, add the import (after line 1):

```typescript
import { HealthProvider } from './contexts/HealthContext';
```

Wrap the `<Routes>` block with `<HealthProvider>`. Change:

```typescript
  return (
    <Routes>
```

To:

```typescript
  return (
    <HealthProvider>
    <Routes>
```

And change the closing:

```typescript
    </Routes>
  );
```

To:

```typescript
    </Routes>
    </HealthProvider>
  );
```

- [ ] **Step 4: Verify client compiles**

Run: `cd browser-agent-chat && npm run build --workspace=client`
Expected: Compiles without errors

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/client/src/contexts/HealthContext.tsx browser-agent-chat/client/src/App.tsx browser-agent-chat/client/vite.config.ts
git commit -m "feat: add HealthContext for feature flag delivery"
```

---

### Task 6: Create ObservabilityPanel Component

The main observability UI — master-detail layout matching FindingsDashboard pattern.

**Files:**
- Create: `browser-agent-chat/client/src/components/ObservabilityPanel.tsx`
- Create: `browser-agent-chat/client/src/components/ObservabilityPanel.css`

**Context:** Follow `FindingsDashboard.tsx` as a reference:
- Uses `useParams()` for agent id, `useAuth()` for `getAccessToken()`
- Layout: `<div className="app-layout">` → `<Sidebar />` + content div
- Fetches data with `useEffect` on mount
- State: list data, selected item, loading/error states

- [ ] **Step 1: Create ObservabilityPanel.css**

Create `browser-agent-chat/client/src/components/ObservabilityPanel.css`:

```css
/* Observability Panel — master-detail layout */
.observability-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* Left panel — trace list */
.traces-list {
  width: 380px;
  min-width: 300px;
  border-right: 1px solid var(--border-primary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.traces-list-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-primary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.traces-list-header h2 {
  margin: 0;
  font-size: 16px;
}

.traces-list-header .count {
  color: var(--text-secondary);
  font-weight: 400;
  font-size: 14px;
}

.traces-items {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

/* Session group */
.session-group {
  border-bottom: 1px solid var(--border-primary);
}

.session-header {
  padding: 8px 16px;
  background: var(--bg-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
}

.session-header:hover {
  background: var(--bg-hover);
}

.session-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--text-primary);
}

.session-header-left .chevron {
  color: var(--text-secondary);
  font-size: 10px;
  width: 12px;
}

.session-header-count {
  font-size: 11px;
  color: var(--text-secondary);
}

/* Trace row */
.trace-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin: 2px 8px;
  border-radius: 6px;
  cursor: pointer;
  border-left: 3px solid transparent;
}

.trace-item:hover {
  background: var(--bg-hover);
}

.trace-item.active {
  background: var(--accent-bg);
  outline: 2px solid var(--accent-color);
}

.trace-item.status-success {
  border-left-color: var(--color-success);
}

.trace-item.status-error {
  border-left-color: var(--color-error);
}

.trace-item-left {
  min-width: 0;
  flex: 1;
}

.trace-item-name {
  font-weight: 500;
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trace-item-meta {
  display: flex;
  gap: 6px;
  margin-top: 3px;
  align-items: center;
}

.trace-type-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
}

.trace-type-badge.type-user-task {
  background: var(--badge-blue-bg);
  color: var(--badge-blue-text);
}

.trace-type-badge.type-login {
  background: var(--badge-pink-bg);
  color: var(--badge-pink-text);
}

.trace-type-badge.type-explore {
  background: var(--badge-indigo-bg);
  color: var(--badge-indigo-text);
}

.trace-item-steps {
  font-size: 10px;
  color: var(--text-secondary);
}

.trace-item-right {
  text-align: right;
  margin-left: 12px;
  flex-shrink: 0;
}

.trace-item-latency {
  font-weight: 600;
  font-size: 12px;
}

.trace-item-latency.status-success {
  color: var(--color-success);
}

.trace-item-latency.status-error {
  color: var(--color-error);
}

.trace-item-cost {
  font-size: 10px;
  color: var(--text-secondary);
}

/* Right panel — trace detail */
.trace-detail {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.trace-detail-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 14px;
}

.trace-detail-header {
  margin-bottom: 16px;
}

.trace-detail-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.trace-detail-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.trace-status-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;
}

.trace-status-badge.status-success {
  background: var(--badge-green-bg);
  color: var(--badge-green-text);
}

.trace-status-badge.status-error {
  background: var(--badge-red-bg);
  color: var(--badge-red-text);
}

.trace-detail-timestamp {
  font-size: 12px;
  color: var(--text-secondary);
}

/* Summary stats */
.trace-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 20px;
}

.trace-stat {
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 12px;
  text-align: center;
}

.trace-stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.trace-stat-value.status-error {
  color: var(--color-error);
}

.trace-stat-label {
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* Span tree */
.span-tree-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.span-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.span-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--bg-secondary);
  border-radius: 6px;
}

.span-item.level-error {
  background: var(--badge-red-bg);
  border: 1px solid var(--color-error);
}

.span-number {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.span-number.level-default {
  background: var(--badge-blue-bg);
  color: var(--badge-blue-text);
}

.span-number.level-error {
  background: var(--badge-red-bg);
  color: var(--badge-red-text);
}

.span-info {
  flex: 1;
  min-width: 0;
}

.span-name {
  font-weight: 500;
  font-size: 12px;
  color: var(--text-primary);
}

.span-item.level-error .span-name {
  color: var(--color-error);
}

.span-meta {
  font-size: 10px;
  color: var(--text-secondary);
}

.span-duration-bar {
  width: 100px;
  height: 6px;
  background: var(--bg-primary);
  border-radius: 3px;
  overflow: hidden;
  flex-shrink: 0;
}

.span-duration-fill {
  height: 100%;
  border-radius: 3px;
}

.span-duration-fill.level-default {
  background: var(--color-success);
}

.span-duration-fill.level-error {
  background: var(--color-error);
}

.span-duration-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  min-width: 40px;
  text-align: right;
  flex-shrink: 0;
}

/* Error output */
.trace-error-output {
  margin-top: 16px;
  padding: 10px;
  background: var(--badge-red-bg);
  border: 1px solid var(--color-error);
  border-radius: 6px;
}

.trace-error-output-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-error);
  margin-bottom: 4px;
}

.trace-error-output-content {
  font-size: 11px;
  color: var(--text-primary);
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Loading and empty states */
.traces-loading,
.traces-error,
.traces-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
}

.traces-error {
  color: var(--color-error);
}
```

- [ ] **Step 2: Create ObservabilityPanel.tsx**

Create `browser-agent-chat/client/src/components/ObservabilityPanel.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../hooks/useAuth';
import './ObservabilityPanel.css';

interface TraceSummary {
  id: string;
  name: string;
  input: unknown;
  latency: number | null;
  totalCost: number | null;
  status: 'success' | 'error';
  observationCount: number;
  timestamp: string;
  sessionId: string | null;
}

interface TraceObservation {
  name: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  model: string | null;
  tokenCount: number | null;
  level: string;
}

interface TraceDetail {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  latency: number | null;
  totalCost: number | null;
  status: 'success' | 'error';
  timestamp: string;
  observations: TraceObservation[];
}

interface SessionGroup {
  sessionId: string | null;
  startedAt: string | null;
  traces: TraceSummary[];
}

function formatLatency(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(1)}s`;
}

function formatCost(cost: number | null): string {
  if (cost === null) return '—';
  return `$${cost.toFixed(2)}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getInputText(input: unknown): string {
  if (!input) return 'unnamed';
  if (typeof input === 'string') return input;
  if (typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>;
    return (obj.task ?? obj.username ?? obj.context ?? obj.prompt ?? JSON.stringify(input)) as string;
  }
  return String(input);
}

function getOutputText(output: unknown): string {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>;
    if (obj.error) return String(obj.error);
    return JSON.stringify(output, null, 2);
  }
  return String(output);
}

export default function ObservabilityPanel() {
  const { id } = useParams();
  const { getAccessToken } = useAuth();

  const [sessions, setSessions] = useState<SessionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [collapsedSessions, setCollapsedSessions] = useState<Set<string>>(new Set());

  // Fetch trace list
  useEffect(() => {
    loadTraces();
  }, [id]);

  const loadTraces = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/agents/${id}/traces?page=1&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load traces');
    } finally {
      setLoading(false);
    }
  };

  // Fetch trace detail
  const selectTrace = async (traceId: string) => {
    setSelectedTraceId(traceId);
    setDetailLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/agents/${id}/traces/${traceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTraceDetail(data);
    } catch {
      setTraceDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleSession = (sessionId: string) => {
    setCollapsedSessions(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const totalTraces = sessions.reduce((sum, s) => sum + s.traces.length, 0);

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="observability-content">
        {/* Left panel — trace list */}
        <div className="traces-list">
          <div className="traces-list-header">
            <h2>Traces <span className="count">({totalTraces})</span></h2>
          </div>

          <div className="traces-items">
            {loading && <div className="traces-loading">Loading traces...</div>}
            {error && <div className="traces-error">{error}</div>}
            {!loading && !error && sessions.length === 0 && (
              <div className="traces-empty">
                No traces yet. Run a task to see observability data here.
              </div>
            )}

            {sessions.map(session => {
              const key = session.sessionId ?? '__no_session__';
              const collapsed = collapsedSessions.has(key);
              return (
                <div key={key} className="session-group">
                  <div
                    className="session-header"
                    onClick={() => toggleSession(key)}
                  >
                    <div className="session-header-left">
                      <span className="chevron">{collapsed ? '\u25B6' : '\u25BC'}</span>
                      <span>
                        {session.startedAt
                          ? `Session — ${formatTime(session.startedAt)}`
                          : 'No Session'}
                      </span>
                    </div>
                    <span className="session-header-count">
                      {session.traces.length} trace{session.traces.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {!collapsed && session.traces.map(trace => (
                    <div
                      key={trace.id}
                      className={`trace-item status-${trace.status} ${selectedTraceId === trace.id ? 'active' : ''}`}
                      onClick={() => selectTrace(trace.id)}
                    >
                      <div className="trace-item-left">
                        <div className="trace-item-name">{getInputText(trace.input)}</div>
                        <div className="trace-item-meta">
                          <span className={`trace-type-badge type-${trace.name}`}>
                            {trace.name}
                          </span>
                          <span className="trace-item-steps">
                            {trace.observationCount} step{trace.observationCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      <div className="trace-item-right">
                        <div className={`trace-item-latency status-${trace.status}`}>
                          {formatLatency(trace.latency)}
                        </div>
                        <div className="trace-item-cost">
                          {formatCost(trace.totalCost)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel — trace detail */}
        {!selectedTraceId && (
          <div className="trace-detail-empty">Select a trace to view details</div>
        )}

        {selectedTraceId && detailLoading && (
          <div className="trace-detail-empty">Loading...</div>
        )}

        {selectedTraceId && !detailLoading && traceDetail && (
          <div className="trace-detail">
            {/* Header */}
            <div className="trace-detail-header">
              <div className="trace-detail-title-row">
                <span className="trace-detail-title">{getInputText(traceDetail.input)}</span>
                <span className={`trace-status-badge status-${traceDetail.status}`}>
                  {traceDetail.status === 'success' ? 'SUCCESS' : 'FAILED'}
                </span>
              </div>
              <div className="trace-detail-timestamp">{formatTime(traceDetail.timestamp)}</div>
            </div>

            {/* Summary stats */}
            <div className="trace-stats">
              <div className="trace-stat">
                <div className={`trace-stat-value ${traceDetail.status === 'error' ? 'status-error' : ''}`}>
                  {formatLatency(traceDetail.latency)}
                </div>
                <div className="trace-stat-label">Total Latency</div>
              </div>
              <div className="trace-stat">
                <div className="trace-stat-value">{formatCost(traceDetail.totalCost)}</div>
                <div className="trace-stat-label">Total Cost</div>
              </div>
              <div className="trace-stat">
                <div className="trace-stat-value">{traceDetail.observations.length}</div>
                <div className="trace-stat-label">Steps</div>
              </div>
            </div>

            {/* Span tree */}
            {traceDetail.observations.length > 0 && (
              <>
                <div className="span-tree-title">Span Tree</div>
                <div className="span-list">
                  {(() => {
                    const maxDuration = Math.max(
                      ...traceDetail.observations.map(o => o.duration ?? 0),
                      0.001
                    );
                    return traceDetail.observations.map((obs, i) => {
                      const level = obs.level === 'ERROR' ? 'error' : 'default';
                      const pct = obs.duration ? (obs.duration / maxDuration) * 100 : 0;
                      const metaParts = [obs.model, obs.tokenCount ? `${obs.tokenCount.toLocaleString()} tokens` : null]
                        .filter(Boolean).join(' \u00B7 ');

                      return (
                        <div key={i} className={`span-item level-${level}`}>
                          <div className={`span-number level-${level}`}>{i + 1}</div>
                          <div className="span-info">
                            <div className="span-name">{obs.name ?? 'unnamed'}</div>
                            {(metaParts || level === 'error') && <div className="span-meta">
                              {metaParts}
                              {level === 'error' && <>{metaParts ? ' \u00B7 ' : ''}<span style={{ color: 'var(--color-error)' }}>ERROR</span></>}
                            </div>}
                          </div>
                          <div className="span-duration-bar">
                            <div
                              className={`span-duration-fill level-${level}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="span-duration-text">{formatLatency(obs.duration)}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </>
            )}

            {/* Error output */}
            {traceDetail.status === 'error' && traceDetail.output && (
              <div className="trace-error-output">
                <div className="trace-error-output-title">Error Output</div>
                <div className="trace-error-output-content">
                  {getOutputText(traceDetail.output)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add badge CSS variables to App.css if missing**

Check `browser-agent-chat/client/src/App.css` for the CSS variables used above. These should be defined in the `:root` / `[data-theme="dark"]` blocks. If any are missing (e.g., `--badge-blue-bg`, `--badge-pink-bg`, `--badge-indigo-bg`, `--badge-green-bg`, `--badge-red-bg`, `--color-success`, `--color-error`, `--accent-bg`, `--accent-color`, `--bg-hover`), add them:

```css
/* In :root (light theme) */
--color-success: #22c55e;
--color-error: #ef4444;
--accent-color: #3b82f6;
--accent-bg: rgba(59, 130, 246, 0.08);
--bg-hover: rgba(0, 0, 0, 0.04);
--badge-blue-bg: #dbeafe;
--badge-blue-text: #1d4ed8;
--badge-pink-bg: #fce7f3;
--badge-pink-text: #be185d;
--badge-indigo-bg: #e0e7ff;
--badge-indigo-text: #4338ca;
--badge-green-bg: #dcfce7;
--badge-green-text: #16a34a;
--badge-red-bg: #fee2e2;
--badge-red-text: #dc2626;
```

```css
/* In [data-theme="dark"] */
--color-success: #4ade80;
--color-error: #f87171;
--accent-color: #60a5fa;
--accent-bg: rgba(96, 165, 250, 0.1);
--bg-hover: rgba(255, 255, 255, 0.06);
--badge-blue-bg: rgba(59, 130, 246, 0.2);
--badge-blue-text: #93c5fd;
--badge-pink-bg: rgba(236, 72, 153, 0.2);
--badge-pink-text: #f9a8d4;
--badge-indigo-bg: rgba(99, 102, 241, 0.2);
--badge-indigo-text: #a5b4fc;
--badge-green-bg: rgba(34, 197, 94, 0.2);
--badge-green-text: #86efac;
--badge-red-bg: rgba(239, 68, 68, 0.15);
--badge-red-text: #fca5a5;
```

Only add variables that don't already exist — check first to avoid duplicates.

- [ ] **Step 4: Verify client compiles**

Run: `cd browser-agent-chat && npm run build --workspace=client`
Expected: Compiles without errors

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/client/src/components/ObservabilityPanel.tsx browser-agent-chat/client/src/components/ObservabilityPanel.css browser-agent-chat/client/src/App.css
git commit -m "feat: add ObservabilityPanel with trace list and span tree detail"
```

---

### Task 7: Add Traces Tab to Sidebar and Route to App

Wire up the sidebar tab (conditional on Langfuse) and add the route.

**Files:**
- Modify: `browser-agent-chat/client/src/components/Sidebar.tsx:1-110`
- Modify: `browser-agent-chat/client/src/App.tsx:1-32`

- [ ] **Step 1: Add Traces tab to Sidebar**

In `Sidebar.tsx`, add `Activity` to the lucide-react import (line 5):

```typescript
import {
  FlaskConical,
  Bug,
  BrainCircuit,
  ClipboardCheck,
  Settings,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
} from 'lucide-react';
```

Add the `useHealth` import:

```typescript
import { useHealth } from '../contexts/HealthContext';
```

Inside the component, add `useHealth`:

After line 27 (`const { pendingSuggestionCount } = useWS();`), add:

```typescript
const { langfuseEnabled } = useHealth();
```

Add the Traces button after the Evals button (after line 86, before the `<div className="sidebar-spacer" />`):

```typescript
      {langfuseEnabled && (
        <button
          className={`sidebar-item${isActive('traces') ? ' active' : ''}${disabled ? ' disabled' : ''}`}
          onClick={() => navTo('traces')}
        >
          <Activity size={18} />
          {expanded && <span className="sidebar-label">Traces</span>}
        </button>
      )}
```

- [ ] **Step 2: Add route to App.tsx with Langfuse guard**

In `App.tsx`, add imports (after line 10):

```typescript
import ObservabilityPanel from './components/ObservabilityPanel';
import { useHealth } from './contexts/HealthContext';
```

Create a guard component inside `App.tsx` (before the `App` function):

```typescript
function TracesGuard() {
  const { langfuseEnabled, loading } = useHealth();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!langfuseEnabled) return <Navigate to="testing" replace />;
  return <ObservabilityPanel />;
}
```

Add the route (after the evals route on line 27):

```typescript
<Route path="/agents/:id/traces" element={<ProtectedRoute><TracesGuard /></ProtectedRoute>} />
```

This ensures direct URL access to `/agents/:id/traces` redirects to testing when Langfuse is disabled.

- [ ] **Step 3: Verify client compiles**

Run: `cd browser-agent-chat && npm run build --workspace=client`
Expected: Compiles without errors

- [ ] **Step 4: Full build**

Run: `cd browser-agent-chat && npm run build`
Expected: Both server and client compile without errors

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/client/src/components/Sidebar.tsx browser-agent-chat/client/src/App.tsx
git commit -m "feat: add Traces tab to sidebar and route (conditional on Langfuse)"
```
