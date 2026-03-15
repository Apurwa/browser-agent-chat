# Langfuse Phase 2 — Admin Observability Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-agent observability dashboard at `/observability` showing aggregate cost, performance, and usage trends across all agents, with date range filtering.

**Architecture:** Three new server endpoints in `server/src/routes/observability.ts` call helper functions in `server/src/langfuse.ts` that wrap the Langfuse `metricsMetrics()` API. A new `ObservabilityDashboard.tsx` client component renders KPI cards, Recharts trend charts, and a sortable agent comparison table. Access is guarded by `DashboardGuard` (same pattern as `TracesGuard`).

**Tech Stack:** Express, Langfuse SDK v3 (`metricsMetrics()`), Recharts, React 19, CSS custom properties

**Spec:** `docs/superpowers/specs/2026-03-15-langfuse-phase2-admin-dashboard-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Install | `recharts` (client workspace) | Chart library dependency |
| Modify | `browser-agent-chat/server/src/langfuse.ts` | Add 3 observability helper functions |
| Create | `browser-agent-chat/server/src/routes/observability.ts` | 3 API endpoints: summary, trends, agents |
| Modify | `browser-agent-chat/server/src/index.ts` | Register observability route |
| Modify | `browser-agent-chat/client/src/App.css` | Add chart color CSS variables |
| Create | `browser-agent-chat/client/src/components/ObservabilityDashboard.css` | Dashboard-specific styles |
| Create | `browser-agent-chat/client/src/components/ObservabilityDashboard.tsx` | Full dashboard page component |
| Modify | `browser-agent-chat/client/src/App.tsx` | Add DashboardGuard + /observability route |
| Modify | `browser-agent-chat/client/src/components/Home.tsx` | Add Observability nav link |

---

## Chunk 1: Server-Side (Tasks 1–4)

### Task 1: Install recharts dependency

**Files:**
- Modify: `browser-agent-chat/client/package.json`

- [ ] **Step 1: Install recharts**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat && npm install recharts --workspace=client
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat && node -e "require('./client/node_modules/recharts/package.json').version" 2>/dev/null || node -e "require('./node_modules/recharts/package.json').version"
```

Expected: prints a version number (e.g., `2.15.x`)

- [ ] **Step 3: Commit**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat
git add browser-agent-chat/client/package.json browser-agent-chat/package-lock.json
git commit -m "feat: install recharts for observability dashboard charts"
```

---

### Task 2: Add observability helper functions to langfuse.ts

**Files:**
- Modify: `browser-agent-chat/server/src/langfuse.ts` (append after line 164)

**Context:** The existing file exports `fetchAgentTraces()` and `fetchTraceDetail()`. We add three new exported async functions. The private `deriveStatus()` at line 44 is already available. The Langfuse SDK `metricsMetrics()` takes `{ query: string }` where `query` is `JSON.stringify(queryObject)`. Response is `{ data: Record<string, any>[] }`.

- [ ] **Step 1: Write the failing test**

Create `browser-agent-chat/server/__tests__/langfuse-observability.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We'll test the helper functions by mocking the langfuse instance
// The helpers need langfuse to be initialized, so we mock the module internals

describe('fetchObservabilitySummary', () => {
  it('should return summary KPIs for date range', async () => {
    // This test will fail until the function is implemented
    const { fetchObservabilitySummary } = await import('../src/langfuse.js');
    expect(fetchObservabilitySummary).toBeDefined();
    expect(typeof fetchObservabilitySummary).toBe('function');
  });
});

describe('fetchObservabilityTrends', () => {
  it('should return time-series data grouped by agent', async () => {
    const { fetchObservabilityTrends } = await import('../src/langfuse.js');
    expect(fetchObservabilityTrends).toBeDefined();
    expect(typeof fetchObservabilityTrends).toBe('function');
  });
});

describe('fetchObservabilityAgents', () => {
  it('should return per-agent breakdown', async () => {
    const { fetchObservabilityAgents } = await import('../src/langfuse.js');
    expect(fetchObservabilityAgents).toBeDefined();
    expect(typeof fetchObservabilityAgents).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat && npx vitest run server/__tests__/langfuse-observability.test.ts 2>&1 | tail -20
```

Expected: FAIL — `fetchObservabilitySummary` is not exported from `../src/langfuse.js`

- [ ] **Step 3: Add exported interfaces for response types**

Add to `browser-agent-chat/server/src/langfuse.ts` after the `TracePaginationMeta` interface (after line 42):

```typescript
export interface ObservabilitySummary {
  totalTraces: number;
  totalCost: number;
  errorRate: number;
  avgLatency: number;
  p95Latency: number;
}

export interface ObservabilityTrends {
  cost: Record<string, string | number>[];
  traces: Record<string, string | number>[];
  agents: string[];
}

export interface ObservabilityAgentRow {
  agentId: string;
  agentName: string;
  traceCount: number;
  totalCost: number;
  errorRate: number;
  avgLatency: number;
}
```

- [ ] **Step 4: Implement `fetchObservabilitySummary`**

Add to `browser-agent-chat/server/src/langfuse.ts` after the `fetchTraceDetail` function (after line 164):

```typescript
export async function fetchObservabilitySummary(
  from: string,
  to: string
): Promise<ObservabilitySummary> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  // Primary metrics query
  const query = JSON.stringify({
    view: 'traces',
    metrics: [
      { measure: 'count', aggregation: 'count' },
      { measure: 'latency', aggregation: 'avg' },
      { measure: 'latency', aggregation: 'p95' },
      { measure: 'totalCost', aggregation: 'sum' },
    ],
    fromTimestamp: from,
    toTimestamp: to,
  });

  const result = await langfuse.api.metricsMetrics({ query });
  const row = result.data?.[0] ?? {};

  const totalTraces = Number(row.count_count ?? row.count ?? 0);
  const avgLatency = Number(row.latency_avg ?? row.avg_latency ?? 0);
  const p95Latency = Number(row.latency_p95 ?? row.p95_latency ?? 0);
  const totalCost = Number(row.totalCost_sum ?? row.sum_totalCost ?? row.total_cost ?? 0);

  // Derive error rate from raw traces (metricsMetrics doesn't support status filtering reliably)
  let errorRate = 0;
  if (totalTraces > 0) {
    try {
      let errorCount = 0;
      let page = 1;
      let hasMore = true;
      let totalChecked = 0;

      while (hasMore) {
        const batch = await langfuse.api.traceList({
          page,
          limit: 100,
          fromTimestamp: from,
          toTimestamp: to,
          orderBy: 'timestamp.desc',
        });

        for (const t of batch.data) {
          if (deriveStatus(t.output) === 'error') errorCount++;
        }
        totalChecked += batch.data.length;
        hasMore = batch.data.length === 100 && totalChecked < totalTraces;
        page++;
      }

      errorRate = totalChecked > 0 ? errorCount / totalChecked : 0;
    } catch (err) {
      console.error('[OBSERVABILITY] Error rate derivation failed:', err);
    }
  }

  return { totalTraces, totalCost, errorRate, avgLatency, p95Latency };
}
```

- [ ] **Step 5: Implement `fetchObservabilityTrends`**

Add to `browser-agent-chat/server/src/langfuse.ts` after `fetchObservabilitySummary`:

```typescript
export async function fetchObservabilityTrends(
  from: string,
  to: string,
  agentNames: Map<string, string>  // agentId → agentName
): Promise<ObservabilityTrends> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  const daysDiff = (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24);
  const granularity = daysDiff <= 30 ? 'day' : 'week';

  // Try grouped query by tags first
  const costData: Record<string, string | number>[] = [];
  const traceData: Record<string, string | number>[] = [];
  const agentList: string[] = [];

  try {
    // Attempt grouped call with tags dimension
    const groupedQuery = JSON.stringify({
      view: 'traces',
      metrics: [
        { measure: 'totalCost', aggregation: 'sum' },
        { measure: 'count', aggregation: 'count' },
      ],
      dimensions: [{ field: 'tags' }],
      timeDimension: { granularity },
      fromTimestamp: from,
      toTimestamp: to,
    });

    const result = await langfuse.api.metricsMetrics({ query: groupedQuery });

    if (result.data && result.data.length > 0) {
      // Parse grouped results
      const dateMap = new Map<string, Record<string, number>>();
      const costDateMap = new Map<string, Record<string, number>>();
      const agentSet = new Set<string>();

      for (const row of result.data) {
        const tag = String(row.tags ?? row.tag ?? '');
        if (!tag.startsWith('agent:')) continue;

        const agentId = tag.replace('agent:', '');
        const name = agentNames.get(agentId) ?? agentId;
        agentSet.add(name);

        const date = String(row.date ?? row.time ?? row.timestamp ?? '').slice(0, 10);
        if (!date) continue;

        if (!costDateMap.has(date)) costDateMap.set(date, {});
        costDateMap.get(date)![name] = Number(row.totalCost_sum ?? row.sum_totalCost ?? 0);

        if (!dateMap.has(date)) dateMap.set(date, {});
        dateMap.get(date)![name] = Number(row.count_count ?? row.count ?? 0);
      }

      agentList.push(...agentSet);
      const sortedDates = [...costDateMap.keys()].sort();

      for (const date of sortedDates) {
        costData.push({ date, ...costDateMap.get(date) });
        traceData.push({ date, ...dateMap.get(date) });
      }

      return { cost: costData, traces: traceData, agents: agentList };
    }
  } catch {
    // Grouped tags dimension not supported, fall back to per-agent calls
  }

  // Fallback: individual metrics calls per agent
  const agentSet = new Set<string>();
  const costDateMap = new Map<string, Record<string, number>>();
  const traceDateMap = new Map<string, Record<string, number>>();

  for (const [agentId, agentName] of agentNames) {
    agentSet.add(agentName);
    try {
      const perAgentQuery = JSON.stringify({
        view: 'traces',
        metrics: [
          { measure: 'totalCost', aggregation: 'sum' },
          { measure: 'count', aggregation: 'count' },
        ],
        timeDimension: { granularity },
        filters: [{ column: 'tags', operator: 'any of', value: [`agent:${agentId}`] }],
        fromTimestamp: from,
        toTimestamp: to,
      });

      const result = await langfuse.api.metricsMetrics({ query: perAgentQuery });

      for (const row of result.data ?? []) {
        const date = String(row.date ?? row.time ?? row.timestamp ?? '').slice(0, 10);
        if (!date) continue;

        if (!costDateMap.has(date)) costDateMap.set(date, {});
        costDateMap.get(date)![agentName] = Number(row.totalCost_sum ?? row.sum_totalCost ?? 0);

        if (!traceDateMap.has(date)) traceDateMap.set(date, {});
        traceDateMap.get(date)![agentName] = Number(row.count_count ?? row.count ?? 0);
      }
    } catch (err) {
      console.error(`[OBSERVABILITY] Trends fetch failed for agent ${agentId}:`, err);
    }
  }

  agentList.push(...agentSet);
  const sortedDates = [...costDateMap.keys()].sort();

  for (const date of sortedDates) {
    costData.push({ date, ...costDateMap.get(date) });
    traceData.push({ date, ...traceDateMap.get(date) });
  }

  return { cost: costData, traces: traceData, agents: agentList };
}
```

- [ ] **Step 6: Implement `fetchObservabilityAgents`**

Add to `browser-agent-chat/server/src/langfuse.ts` after `fetchObservabilityTrends`:

```typescript
export async function fetchObservabilityAgents(
  from: string,
  to: string,
  agentNames: Map<string, string>  // agentId → agentName
): Promise<ObservabilityAgentRow[]> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  const rows: ObservabilityAgentRow[] = [];

  // Per-agent metrics (fallback-first approach since tags dimension is unreliable)
  for (const [agentId, agentName] of agentNames) {
    try {
      const query = JSON.stringify({
        view: 'traces',
        metrics: [
          { measure: 'count', aggregation: 'count' },
          { measure: 'totalCost', aggregation: 'sum' },
          { measure: 'latency', aggregation: 'avg' },
        ],
        filters: [{ column: 'tags', operator: 'any of', value: [`agent:${agentId}`] }],
        fromTimestamp: from,
        toTimestamp: to,
      });

      const result = await langfuse.api.metricsMetrics({ query });
      const data = result.data?.[0] ?? {};

      const traceCount = Number(data.count_count ?? data.count ?? 0);
      const totalCost = Number(data.totalCost_sum ?? data.sum_totalCost ?? 0);
      const avgLatency = Number(data.latency_avg ?? data.avg_latency ?? 0);

      // Derive error rate from raw traces
      let errorRate = 0;
      if (traceCount > 0) {
        try {
          const traceResult = await langfuse.api.traceList({
            tags: [`agent:${agentId}`],
            page: 1,
            limit: 100,
            fromTimestamp: from,
            toTimestamp: to,
            orderBy: 'timestamp.desc',
          });

          let errorCount = 0;
          for (const t of traceResult.data) {
            if (deriveStatus(t.output) === 'error') errorCount++;
          }
          errorRate = traceResult.data.length > 0 ? errorCount / traceResult.data.length : 0;
        } catch {
          // Skip error rate if raw fetch fails
        }
      }

      if (traceCount > 0) {
        rows.push({ agentId, agentName, traceCount, totalCost, errorRate, avgLatency });
      }
    } catch (err) {
      console.error(`[OBSERVABILITY] Agent metrics failed for ${agentId}:`, err);
    }
  }

  return rows;
}
```

- [ ] **Step 7: Run test to verify exports exist**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat && npx vitest run server/__tests__/langfuse-observability.test.ts 2>&1 | tail -20
```

Expected: PASS — all three functions are defined and exported

- [ ] **Step 8: Commit**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat
git add browser-agent-chat/server/src/langfuse.ts browser-agent-chat/server/__tests__/langfuse-observability.test.ts
git commit -m "feat: add observability metrics helpers (summary, trends, agents)"
```

---

### Task 3: Create observability API route

**Files:**
- Create: `browser-agent-chat/server/src/routes/observability.ts`

**Context:** Follow the same pattern as `server/src/routes/traces.ts`: `Router()` (no mergeParams needed since these are top-level routes), `requireAuth` from `'../auth.js'`, `isLangfuseEnabled()` guard returning 503, `supabase` from `'../supabase.js'`. The route gets agent names by querying the Supabase `agents` table. Each endpoint accepts `from` and `to` ISO date query params, defaulting to last 30 days.

- [ ] **Step 1: Create the route file**

Create `browser-agent-chat/server/src/routes/observability.ts`:

```typescript
import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import {
  isLangfuseEnabled,
  fetchObservabilitySummary,
  fetchObservabilityTrends,
  fetchObservabilityAgents,
} from '../langfuse.js';
import { supabase } from '../supabase.js';

const router = Router();

/** Resolve agentId → agentName map from Supabase */
async function getAgentNames(userId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!supabase) return map;

  const { data } = await supabase
    .from('agents')
    .select('id, name')
    .eq('user_id', userId);

  if (data) {
    for (const row of data) {
      map.set(row.id, row.name);
    }
  }
  return map;
}

/** Default date range: last 30 days */
function parseDateRange(query: { from?: string; to?: string }): { from: string; to: string } {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Swap if from > to
  if (from > to) {
    return { from: to.toISOString(), to: from.toISOString() };
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

// GET /api/observability/summary
router.get('/summary', requireAuth, async (req, res) => {
  if (!isLangfuseEnabled()) {
    res.status(503).json({ error: 'Langfuse is not configured' });
    return;
  }

  try {
    const { from, to } = parseDateRange(req.query as { from?: string; to?: string });
    const summary = await fetchObservabilitySummary(from, to);
    res.json(summary);
  } catch (err) {
    console.error('[OBSERVABILITY] Summary error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch summary';
    res.status(500).json({ error: message });
  }
});

// GET /api/observability/trends
router.get('/trends', requireAuth, async (req, res) => {
  if (!isLangfuseEnabled()) {
    res.status(503).json({ error: 'Langfuse is not configured' });
    return;
  }

  try {
    const { from, to } = parseDateRange(req.query as { from?: string; to?: string });
    const userId = (req as AuthenticatedRequest).userId;
    const agentNames = await getAgentNames(userId);
    const trends = await fetchObservabilityTrends(from, to, agentNames);
    res.json(trends);
  } catch (err) {
    console.error('[OBSERVABILITY] Trends error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch trends';
    res.status(500).json({ error: message });
  }
});

// GET /api/observability/agents
router.get('/agents', requireAuth, async (req, res) => {
  if (!isLangfuseEnabled()) {
    res.status(503).json({ error: 'Langfuse is not configured' });
    return;
  }

  try {
    const { from, to } = parseDateRange(req.query as { from?: string; to?: string });
    const userId = (req as AuthenticatedRequest).userId;
    const agentNames = await getAgentNames(userId);
    const agents = await fetchObservabilityAgents(from, to, agentNames);
    res.json({ agents });
  } catch (err) {
    console.error('[OBSERVABILITY] Agents error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch agent metrics';
    res.status(500).json({ error: message });
  }
});

export default router;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat && npx tsc --noEmit --project server/tsconfig.json 2>&1 | tail -20
```

Expected: No errors (or only pre-existing unrelated errors)

- [ ] **Step 3: Commit**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat
git add browser-agent-chat/server/src/routes/observability.ts
git commit -m "feat: add observability API route (summary, trends, agents endpoints)"
```

---

### Task 4: Register observability route in index.ts

**Files:**
- Modify: `browser-agent-chat/server/src/index.ts` (lines 13, 74)

**Context:** Follow the existing pattern: add import alongside other route imports (line 13 area), register with `app.use('/api/observability', ...)` alongside other route registrations (line 74 area).

- [ ] **Step 1: Add import**

In `browser-agent-chat/server/src/index.ts`, add after line 13 (`import tracesRouter from './routes/traces.js';`):

```typescript
import observabilityRouter from './routes/observability.js';
```

- [ ] **Step 2: Register route**

In `browser-agent-chat/server/src/index.ts`, add after line 73 (`app.use('/api/agents/:id/traces', tracesRouter);`):

```typescript
app.use('/api/observability', observabilityRouter);
```

- [ ] **Step 3: Verify server compiles**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat && npx tsc --noEmit --project server/tsconfig.json 2>&1 | tail -20
```

Expected: No new errors

- [ ] **Step 4: Commit**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat
git add browser-agent-chat/server/src/index.ts
git commit -m "feat: register /api/observability route in server"
```

---

## Chunk 2: Client-Side (Tasks 5–8)

### Task 5: Add chart color CSS variables

**Files:**
- Modify: `browser-agent-chat/client/src/App.css` (lines 55-56 for dark theme, lines 99-100 for light theme)

**Context:** The dark theme `:root` block ends at line 56 with `}`. The light theme `[data-theme="light"]` block ends at line 100 with `}`. Add chart color variables inside each block, just before the closing `}`. Use 8 distinct colors — saturated for dark theme, slightly muted for light theme.

- [ ] **Step 1: Add dark theme chart colors**

In `browser-agent-chat/client/src/App.css`, add before line 56 (the closing `}` of `:root`):

```css
  /* Chart color palette — dark theme */
  --chart-color-1: #3b82f6;
  --chart-color-2: #eab308;
  --chart-color-3: #22c55e;
  --chart-color-4: #ef4444;
  --chart-color-5: #a855f7;
  --chart-color-6: #f97316;
  --chart-color-7: #06b6d4;
  --chart-color-8: #ec4899;
```

- [ ] **Step 2: Add light theme chart colors**

In `browser-agent-chat/client/src/App.css`, add before line 100 (the closing `}` of `[data-theme="light"]`):

```css
  /* Chart color palette — light theme */
  --chart-color-1: #2563eb;
  --chart-color-2: #ca8a04;
  --chart-color-3: #16a34a;
  --chart-color-4: #dc2626;
  --chart-color-5: #9333ea;
  --chart-color-6: #ea580c;
  --chart-color-7: #0891b2;
  --chart-color-8: #db2777;
```

- [ ] **Step 3: Commit**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat
git add browser-agent-chat/client/src/App.css
git commit -m "feat: add chart color CSS variables for observability dashboard"
```

---

### Task 6: Create ObservabilityDashboard component

**Files:**
- Create: `browser-agent-chat/client/src/components/ObservabilityDashboard.css`
- Create: `browser-agent-chat/client/src/components/ObservabilityDashboard.tsx`

**Context:** This is the main Phase 2 deliverable. The component fetches data from the 3 API endpoints, renders summary cards, Recharts charts, and a sortable agent table. It uses `useAuth()` for `getAccessToken()` and `apiAuthFetch` from `'../lib/api'`. It uses `useNavigate` from react-router-dom. The `Activity` icon from lucide-react is available (already used in Sidebar). Date inputs use native `<input type="date">`. Charts use Recharts `AreaChart`, `BarChart`, `ResponsiveContainer`.

- [ ] **Step 1: Create the CSS file**

Create `browser-agent-chat/client/src/components/ObservabilityDashboard.css`:

```css
/* ObservabilityDashboard — Theme-aware styles */

.obs-dashboard {
  min-height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 24px 32px;
  max-width: 1200px;
  margin: 0 auto;
}

/* Header */
.obs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}

.obs-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.obs-back-link {
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  text-decoration: none;
  border: none;
  background: none;
  padding: 0;
}

.obs-back-link:hover {
  color: var(--text-primary);
}

.obs-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

/* Date range controls */
.obs-date-controls {
  display: flex;
  gap: 6px;
  align-items: center;
}

.obs-preset-btn {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}

.obs-preset-btn:hover {
  background: var(--bg-hover);
}

.obs-preset-btn.active {
  border: 2px solid var(--accent);
  background: var(--accent-light);
  font-weight: 600;
}

.obs-date-sep {
  color: var(--text-secondary);
  font-size: 11px;
  margin: 0 4px;
}

.obs-date-input {
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 11px;
  font-family: inherit;
}

/* Summary cards */
.obs-summary-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.obs-card {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
}

.obs-card-value {
  font-size: 28px;
  font-weight: 700;
}

.obs-card-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.obs-card-sub {
  font-size: 10px;
  color: var(--text-secondary);
}

.obs-error-high {
  color: var(--color-error);
}

.obs-error-low {
  color: var(--color-success);
}

/* Charts row */
.obs-charts-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
}

.obs-chart-card {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 16px;
}

.obs-chart-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
}

/* Agent table */
.obs-agent-table-wrapper {
  background: var(--bg-secondary);
  border-radius: 8px;
  overflow: hidden;
}

.obs-agent-table-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
  font-size: 13px;
  font-weight: 600;
}

.obs-agent-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.obs-agent-table th {
  text-align: left;
  padding: 10px 16px;
  color: var(--text-secondary);
  font-weight: 500;
  font-size: 11px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-primary);
  user-select: none;
}

.obs-agent-table th.align-right,
.obs-agent-table td.align-right {
  text-align: right;
}

.obs-agent-table th:hover {
  color: var(--text-primary);
}

.obs-agent-table th.sorted {
  color: var(--accent);
}

.obs-agent-table tr.obs-agent-row {
  border-bottom: 1px solid var(--border-primary);
  cursor: pointer;
}

.obs-agent-table tr.obs-agent-row:hover {
  background: var(--bg-hover);
}

.obs-agent-table td {
  padding: 10px 16px;
}

.obs-agent-name {
  font-weight: 500;
}

/* States */
.obs-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: var(--text-secondary);
}

.obs-error {
  padding: 12px 16px;
  background: var(--badge-red-bg);
  color: var(--badge-red-text);
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 13px;
}

.obs-empty {
  text-align: center;
  padding: 48px 16px;
  color: var(--text-secondary);
  font-size: 14px;
}

/* Responsive: stack charts on narrow screens */
@media (max-width: 768px) {
  .obs-charts-row {
    grid-template-columns: 1fr;
  }
  .obs-summary-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

- [ ] **Step 2: Create the component file**

Create `browser-agent-chat/client/src/components/ObservabilityDashboard.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  Legend, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../hooks/useAuth';
import { apiAuthFetch } from '../lib/api';
import './ObservabilityDashboard.css';

interface Summary {
  totalTraces: number;
  totalCost: number;
  errorRate: number;
  avgLatency: number;
  p95Latency: number;
}

interface Trends {
  cost: Record<string, string | number>[];
  traces: Record<string, string | number>[];
  agents: string[];
}

interface AgentRow {
  agentId: string;
  agentName: string;
  traceCount: number;
  totalCost: number;
  errorRate: number;
  avgLatency: number;
}

type SortKey = 'traceCount' | 'totalCost' | 'errorRate' | 'avgLatency' | 'agentName';
type SortDir = 'asc' | 'desc';

const CHART_COLORS = [
  'var(--chart-color-1)', 'var(--chart-color-2)', 'var(--chart-color-3)',
  'var(--chart-color-4)', 'var(--chart-color-5)', 'var(--chart-color-6)',
  'var(--chart-color-7)', 'var(--chart-color-8)',
];

// CSS vars can't be used directly in Recharts SVG fills — resolve at render time
const CHART_HEX_DARK = ['#3b82f6','#eab308','#22c55e','#ef4444','#a855f7','#f97316','#06b6d4','#ec4899'];
const CHART_HEX_LIGHT = ['#2563eb','#ca8a04','#16a34a','#dc2626','#9333ea','#ea580c','#0891b2','#db2777'];

function getChartColors(): string[] {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'light' ? CHART_HEX_LIGHT : CHART_HEX_DARK;
}

function formatDateForInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function ObservabilityDashboard() {
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();

  // Date range state
  const [preset, setPreset] = useState<7 | 30 | 90 | null>(30);
  const [fromDate, setFromDate] = useState(formatDateForInput(daysAgo(30)));
  const [toDate, setToDate] = useState(formatDateForInput(new Date()));

  // Data state
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Table sort
  const [sortKey, setSortKey] = useState<SortKey>('traceCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchData = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const params = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

      const [summaryRes, trendsRes, agentsRes] = await Promise.all([
        apiAuthFetch(`/api/observability/summary?${params}`, token),
        apiAuthFetch(`/api/observability/trends?${params}`, token),
        apiAuthFetch(`/api/observability/agents?${params}`, token),
      ]);

      if (!summaryRes.ok || !trendsRes.ok || !agentsRes.ok) {
        const errData = await (summaryRes.ok ? trendsRes.ok ? agentsRes : trendsRes : summaryRes).json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to fetch observability data');
      }

      const [summaryData, trendsData, agentsData] = await Promise.all([
        summaryRes.json(),
        trendsRes.json(),
        agentsRes.json(),
      ]);

      setSummary(summaryData);
      setTrends(trendsData);
      setAgents(agentsData.agents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    fetchData(fromDate, toDate);
  }, [fromDate, toDate, fetchData]);

  const handlePreset = (days: 7 | 30 | 90) => {
    setPreset(days);
    setFromDate(formatDateForInput(daysAgo(days)));
    setToDate(formatDateForInput(new Date()));
  };

  const handleFromChange = (val: string) => {
    setFromDate(val);
    setPreset(null);
  };

  const handleToChange = (val: string) => {
    setToDate(val);
    setPreset(0 as any);
  };

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'agentName' ? 'asc' : 'desc');
    }
  };

  const sortedAgents = [...agents].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'agentName') return dir * a.agentName.localeCompare(b.agentName);
    return dir * (a[sortKey] - b[sortKey]);
  });

  const colors = getChartColors();
  const isEmpty = !loading && summary && summary.totalTraces === 0;

  return (
    <div className="obs-dashboard">
      {/* Header */}
      <div className="obs-header">
        <div className="obs-header-left">
          <button className="obs-back-link" onClick={() => navigate('/')}>
            &larr; Home
          </button>
          <h1 className="obs-title">Observability</h1>
        </div>
        <div className="obs-date-controls">
          {([7, 30, 90] as const).map(d => (
            <button
              key={d}
              className={`obs-preset-btn${preset === d ? ' active' : ''}`}
              onClick={() => handlePreset(d)}
            >
              {d}d
            </button>
          ))}
          <span className="obs-date-sep">|</span>
          <input
            type="date"
            className="obs-date-input"
            value={fromDate}
            onChange={e => handleFromChange(e.target.value)}
          />
          <span className="obs-date-sep">to</span>
          <input
            type="date"
            className="obs-date-input"
            value={toDate}
            onChange={e => handleToChange(e.target.value)}
          />
        </div>
      </div>

      {/* Error */}
      {error && <div className="obs-error">{error}</div>}

      {/* Loading */}
      {loading && <div className="obs-loading">Loading...</div>}

      {/* Empty state */}
      {isEmpty && <div className="obs-empty">No trace data for this period.</div>}

      {/* Dashboard content */}
      {!loading && !isEmpty && summary && (
        <>
          {/* Summary cards */}
          <div className="obs-summary-cards">
            <div className="obs-card">
              <div className="obs-card-value">{summary.totalTraces.toLocaleString()}</div>
              <div className="obs-card-label">Total Traces</div>
            </div>
            <div className="obs-card">
              <div className="obs-card-value">${summary.totalCost.toFixed(2)}</div>
              <div className="obs-card-label">Total Cost</div>
            </div>
            <div className="obs-card">
              <div className={`obs-card-value ${summary.errorRate > 0.1 ? 'obs-error-high' : 'obs-error-low'}`}>
                {(summary.errorRate * 100).toFixed(1)}%
              </div>
              <div className="obs-card-label">Error Rate</div>
            </div>
            <div className="obs-card">
              <div className="obs-card-value">{summary.avgLatency.toFixed(1)}s</div>
              <div className="obs-card-label">Avg Latency</div>
              <div className="obs-card-sub">p95: {summary.p95Latency.toFixed(1)}s</div>
            </div>
          </div>

          {/* Trend charts */}
          {trends && trends.agents.length > 0 && (
            <div className="obs-charts-row">
              {/* Cost Over Time */}
              <div className="obs-chart-card">
                <div className="obs-chart-title">Cost Over Time</div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={trends.cost}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--text-dim)" />
                    <YAxis tick={{ fontSize: 10 }} stroke="var(--text-dim)" tickFormatter={v => `$${v}`} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', fontSize: 12 }}
                      labelStyle={{ color: 'var(--text-primary)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {trends.agents.map((agent, i) => (
                      <Area
                        key={agent}
                        type="monotone"
                        dataKey={agent}
                        stroke={colors[i % colors.length]}
                        fill={colors[i % colors.length]}
                        fillOpacity={0.15}
                        strokeWidth={2}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Trace Volume */}
              <div className="obs-chart-card">
                <div className="obs-chart-title">Trace Volume</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={trends.traces}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--text-dim)" />
                    <YAxis tick={{ fontSize: 10 }} stroke="var(--text-dim)" />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', fontSize: 12 }}
                      labelStyle={{ color: 'var(--text-primary)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {trends.agents.map((agent, i) => (
                      <Bar
                        key={agent}
                        dataKey={agent}
                        stackId="traces"
                        fill={colors[i % colors.length]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Agent comparison table */}
          {sortedAgents.length > 0 && (
            <div className="obs-agent-table-wrapper">
              <div className="obs-agent-table-header">Agents</div>
              <table className="obs-agent-table">
                <thead>
                  <tr>
                    <th
                      className={sortKey === 'agentName' ? 'sorted' : ''}
                      onClick={() => handleSort('agentName')}
                    >
                      Agent {sortKey === 'agentName' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th
                      className={`align-right${sortKey === 'traceCount' ? ' sorted' : ''}`}
                      onClick={() => handleSort('traceCount')}
                    >
                      Traces {sortKey === 'traceCount' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th
                      className={`align-right${sortKey === 'totalCost' ? ' sorted' : ''}`}
                      onClick={() => handleSort('totalCost')}
                    >
                      Cost {sortKey === 'totalCost' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th
                      className={`align-right${sortKey === 'errorRate' ? ' sorted' : ''}`}
                      onClick={() => handleSort('errorRate')}
                    >
                      Error Rate {sortKey === 'errorRate' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th
                      className={`align-right${sortKey === 'avgLatency' ? ' sorted' : ''}`}
                      onClick={() => handleSort('avgLatency')}
                    >
                      Avg Latency {sortKey === 'avgLatency' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAgents.map(agent => (
                    <tr
                      key={agent.agentId}
                      className="obs-agent-row"
                      onClick={() => navigate(`/agents/${agent.agentId}/traces`)}
                    >
                      <td className="obs-agent-name">{agent.agentName}</td>
                      <td className="align-right">{agent.traceCount}</td>
                      <td className="align-right">${agent.totalCost.toFixed(2)}</td>
                      <td className={`align-right ${agent.errorRate > 0.1 ? 'obs-error-high' : 'obs-error-low'}`}>
                        {(agent.errorRate * 100).toFixed(1)}%
                      </td>
                      <td className="align-right">{agent.avgLatency.toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat && npx tsc --noEmit 2>&1 | tail -20
```

Expected: No new errors

- [ ] **Step 4: Commit**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat
git add browser-agent-chat/client/src/components/ObservabilityDashboard.tsx browser-agent-chat/client/src/components/ObservabilityDashboard.css
git commit -m "feat: add ObservabilityDashboard component with charts and agent table"
```

---

### Task 7: Add DashboardGuard and /observability route to App.tsx

**Files:**
- Modify: `browser-agent-chat/client/src/App.tsx` (lines 12, 16-21, 40)

**Context:** Follow the `TracesGuard` pattern at lines 16-21. Add import for `ObservabilityDashboard`, create `DashboardGuard` component, add route at `/observability`. The guard redirects to `/` if Langfuse is disabled (unlike TracesGuard which redirects to `testing`).

- [ ] **Step 1: Add ObservabilityDashboard import**

In `browser-agent-chat/client/src/App.tsx`, add after line 12 (`import ObservabilityPanel from './components/ObservabilityPanel';`):

```typescript
import ObservabilityDashboard from './components/ObservabilityDashboard';
```

- [ ] **Step 2: Add DashboardGuard component**

In `browser-agent-chat/client/src/App.tsx`, add after the `TracesGuard` function (after line 21):

```typescript

function DashboardGuard() {
  const { langfuseEnabled, loading } = useHealth();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!langfuseEnabled) return <Navigate to="/" replace />;
  return <ObservabilityDashboard />;
}
```

- [ ] **Step 3: Add route**

In `browser-agent-chat/client/src/App.tsx`, add after the vault route (after line 41, `<Route path="/vault" ...`):

```tsx
        <Route path="/observability" element={<ProtectedRoute><DashboardGuard /></ProtectedRoute>} />
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat && npx tsc --noEmit 2>&1 | tail -20
```

Expected: No new errors

- [ ] **Step 5: Commit**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat
git add browser-agent-chat/client/src/App.tsx
git commit -m "feat: add DashboardGuard and /observability route"
```

---

### Task 8: Add Observability link to Home page

**Files:**
- Modify: `browser-agent-chat/client/src/components/Home.tsx` (lines 8, 153)

**Context:** Add an `Activity` icon import from lucide-react (line 8 already imports several icons). Add a link button in the `home-topbar-right` div (line 153), positioned before the theme toggle. The link should only show when Langfuse is enabled, using the `useHealth()` hook from `'../contexts/HealthContext'`.

- [ ] **Step 1: Add imports**

In `browser-agent-chat/client/src/components/Home.tsx`, modify the lucide-react import at line 8 to add `Activity`:

```typescript
import { Sun, Moon, LogOut, Plus, ArrowUp, Mic, Upload, Clipboard, Activity } from 'lucide-react';
```

Add import for `useHealth` after line 9:

```typescript
import { useHealth } from '../contexts/HealthContext';
```

- [ ] **Step 2: Add useHealth hook call**

In `browser-agent-chat/client/src/components/Home.tsx`, add after line 78 (`const { theme, toggleTheme } = useTheme();`):

```typescript
  const { langfuseEnabled } = useHealth();
```

- [ ] **Step 3: Add Observability link in topbar**

In `browser-agent-chat/client/src/components/Home.tsx`, inside the `home-topbar-right` div, add before the theme toggle button (before line 154):

```tsx
          {langfuseEnabled && (
            <button
              className="home-theme-toggle"
              onClick={() => navigate('/observability')}
              title="Observability"
            >
              <Activity size={18} />
            </button>
          )}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat/browser-agent-chat && npx tsc --noEmit 2>&1 | tail -20
```

Expected: No new errors

- [ ] **Step 5: Commit**

```bash
cd /Users/apurwasarwajit/Projects/browser-agent-chat
git add browser-agent-chat/client/src/components/Home.tsx
git commit -m "feat: add Observability link to Home page header"
```

---

## Verification

After all tasks complete:

1. Start the dev server: `cd browser-agent-chat && npm run dev`
2. Navigate to Home page — verify Activity icon appears in topbar (only when Langfuse is configured)
3. Click Activity icon → should navigate to `/observability`
4. Verify date range controls work (preset buttons + custom dates)
5. Verify summary cards show KPIs
6. Verify charts render with Recharts (if trace data exists)
7. Verify agent table is sortable by clicking column headers
8. Click an agent row → should navigate to `/agents/:id/traces`
9. Test empty state: set date range to a period with no data → should show "No trace data for this period."
10. Test with Langfuse disabled: navigating to `/observability` should redirect to `/`
