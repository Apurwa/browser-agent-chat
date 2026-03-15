# Langfuse Phase 2 — Admin Observability Dashboard Design Spec

## Goal

Add a cross-agent observability dashboard at `/observability` showing aggregate cost, performance, and usage trends across all agents, with date range filtering. This is the Phase 2 follow-up to the per-agent trace viewer built in Phase 1.

## Scope

**This spec:** Cross-agent admin dashboard with summary KPIs, trend charts, agent comparison table, and date range controls.

**Not in scope:** Per-agent trace view enhancements (pagination, search, token breakdown), real-time streaming, flame graphs, screenshot replay. These remain deferred.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary audience | Platform operator / developer | Users managing multiple agents need cross-agent visibility |
| Access pattern | Top-level `/observability` route | Cross-agent data doesn't belong inside agent-scoped sidebar |
| Aggregation strategy | Hybrid — Langfuse `metricsMetrics()` + raw fallback | Metrics API handles heavy lifting; raw fetch only for edge cases |
| Metrics scope | Both cost and performance | Near-zero incremental effort since both use same API |
| Chart library | Recharts | React-native, composable, theme-friendly, widely adopted |
| Date range controls | Preset buttons (7d/30d/90d) + native `<input type="date">` | Covers 90% of use cases with zero dependencies |

## Architecture

### Data Flow

```
Langfuse metricsMetrics() API
  ↓
server/src/routes/observability.ts (3 endpoints)
  ↓
server/src/langfuse.ts (new helper functions)
  ↓
client/src/components/ObservabilityDashboard.tsx (Recharts + table)
```

### Server

**New file: `server/src/routes/observability.ts`**

Three endpoints behind `requireAuth` middleware:

#### `GET /api/observability/summary`

Returns aggregate KPIs for the selected date range.

- Calls `metricsMetrics()` with a serialized JSON query string containing:
  - `view: "traces"`
  - `metrics: [{measure: "count", aggregation: "count"}, {measure: "latency", aggregation: "avg"}, {measure: "latency", aggregation: "p95"}, {measure: "totalCost", aggregation: "sum"}]`
  - `fromTimestamp`, `toTimestamp`
- **Error rate derivation:** Make a second `metricsMetrics()` call with an additional filter for traces where output indicates failure (filter column `"output"` or use the same `deriveStatus()` logic from Phase 1). If the metrics API does not support filtering by output status, fall back to: fetch raw traces via `traceList()` for the date range, count errors server-side using `deriveStatus()`, and compute `errorCount / totalCount`. The helper should try the metrics approach first, catch errors, and fall back gracefully.
- Response shape:
  ```json
  {
    "totalTraces": 342,
    "totalCost": 12.47,
    "errorRate": 0.082,
    "avgLatency": 6.2,
    "p95Latency": 18.4
  }
  ```
- Query params: `from` (ISO), `to` (ISO)

#### `GET /api/observability/trends`

Returns time-series data for trend charts, grouped by agent.

- Calls `metricsMetrics()` with time dimension, granularity auto-determined:
  - `<=30 days` → `"day"`
  - `>30 days` → `"week"`
- Groups by agent tag dimension to produce per-agent series. **Fallback strategy:** If `"tags"` is not a valid dimension field for `metricsMetrics()`, fall back to: (1) fetch the list of agents from Supabase, (2) make individual `metricsMetrics()` calls per agent with a tag filter `agent:<agentId>`, (3) merge results into the unified response shape. The helper should attempt the grouped call first and fall back if it returns empty/error.
- Two metric series: cost (sum per period) and trace count (count per period)
- Joins with Supabase `agents` table to resolve agent names from IDs. **Tag parsing:** Langfuse tag values are `agent:<uuid>` strings. The helper must strip the `agent:` prefix before querying the Supabase `agents` table by ID.
- Response shape:
  ```json
  {
    "cost": [
      { "date": "2026-03-10", "Agent A": 1.20, "Agent B": 0.85 },
      { "date": "2026-03-11", "Agent A": 2.10, "Agent B": 1.30 }
    ],
    "traces": [
      { "date": "2026-03-10", "Agent A": 15, "Agent B": 22 },
      { "date": "2026-03-11", "Agent A": 18, "Agent B": 25 }
    ],
    "agents": ["Agent A", "Agent B"]
  }
  ```
- Query params: `from` (ISO), `to` (ISO)
- The `agents` array tells the client which keys exist in the data objects, for dynamic Recharts series rendering

#### `GET /api/observability/agents`

Returns per-agent breakdown for the comparison table.

- Calls `metricsMetrics()` grouped by agent tag dimension with metrics: `[{measure: "count", aggregation: "count"}, {measure: "totalCost", aggregation: "sum"}, {measure: "latency", aggregation: "avg"}]`. Error rate computed per agent using the same approach as the summary endpoint (second filtered call or raw trace fallback).
- Same tag-dimension fallback strategy as trends endpoint if `"tags"` grouping is not supported.
- Joins with Supabase `agents` table to get agent names and IDs (stripping `agent:` prefix from tag values before lookup)
- Response shape:
  ```json
  {
    "agents": [
      {
        "agentId": "uuid",
        "agentName": "QA Bot",
        "traceCount": 198,
        "totalCost": 7.24,
        "errorRate": 0.045,
        "avgLatency": 5.1
      }
    ]
  }
  ```
- Query params: `from` (ISO), `to` (ISO)

**Modification: `server/src/langfuse.ts`**

Add helper functions:
- `fetchObservabilitySummary(from, to)` — wraps metrics calls for summary KPIs
- `fetchObservabilityTrends(from, to)` — wraps metrics call with time dimension + agent grouping
- `fetchObservabilityAgents(from, to)` — wraps metrics call grouped by agent tag

These functions encapsulate the `metricsMetrics()` query construction and response transformation, keeping the route handler clean. Each helper must serialize the query object via `JSON.stringify()` into the `query` string parameter expected by `metricsMetrics({ query: string })`.

**Modification: `server/src/index.ts`**

- Import and register: `app.use('/api/observability', observabilityRouter)`

**Modification: `client/vite.config.ts`**

- No changes needed — `/api` proxy already covers `/api/observability/*`

### Client

**New file: `client/src/components/ObservabilityDashboard.tsx`**

Full-page dashboard layout (~300 lines):

**Header section:**
- Back link to Home (`← Home`)
- Title: "Observability"
- Date range controls: preset buttons (7d/30d/90d) + two native `<input type="date">` fields
- Default range: last 30 days
- Active preset highlighted with accent border

**Summary cards row (4 cards):**
- Total Traces (count)
- Total Cost (formatted as `$X.XX`)
- Error Rate (percentage, colored red if >10%, green if <=10%)
- Avg Latency (seconds, with p95 shown below in smaller text)

**Trend charts row (2 charts, side by side):**
- **Cost Over Time:** Recharts `AreaChart` with one `Area` per agent, semi-transparent fills, distinct colors
- **Trace Volume:** Recharts `BarChart` with stacked bars per agent
- Both charts share the same agent color mapping
- X-axis: date labels, Y-axis: auto-scaled values
- Legend below each chart showing agent names with color swatches
- Charts render dynamically based on the `agents` array from the trends response

**Agent comparison table:**
- Columns: Agent name, Traces, Cost, Error Rate, Avg Latency
- Sortable by clicking column headers (client-side sort)
- Default sort: by trace count descending
- Clickable rows → navigate to `/agents/:id/traces`
- Error rate colored green (<=10%) or red (>10%)

**New file: `client/src/components/ObservabilityDashboard.css`**

- Theme-aware styles using CSS custom properties
- Follows existing component CSS patterns
- Responsive: charts stack vertically on narrow screens (future consideration, not required for MVP)

**New dependency: `recharts`**

- Install in client workspace: `npm install recharts --workspace=client`
- Used for: `AreaChart`, `BarChart`, `XAxis`, `YAxis`, `Tooltip`, `Legend`, `Area`, `Bar`, `CartesianGrid`, `ResponsiveContainer`

**Modification: `client/src/App.tsx`**

- Add import for `ObservabilityDashboard`
- Add `DashboardGuard` component (same pattern as `TracesGuard`):
  ```typescript
  function DashboardGuard() {
    const { langfuseEnabled, loading } = useHealth();
    if (loading) return <div className="loading-screen">Loading...</div>;
    if (!langfuseEnabled) return <Navigate to="/" replace />;
    return <ObservabilityDashboard />;
  }
  ```
- Add route: `<Route path="/observability" element={<ProtectedRoute><DashboardGuard /></ProtectedRoute>} />`

**Modification: `client/src/components/Home.tsx`**

- Add "Observability" link/button visible when `langfuseEnabled` is true
- Positioned in the header area, links to `/observability`
- Uses `Activity` icon from lucide-react (same as Sidebar Traces tab)

### Langfuse `metricsMetrics()` API Usage

The metrics API accepts:
- `view`: `"traces"` — aggregate over traces
- `metrics`: Array of `{ measure, aggregation }` — e.g., `{ measure: "count", aggregation: "count" }`, `{ measure: "totalCost", aggregation: "sum" }`
- `dimensions`: Array of grouping dimensions — e.g., `[{ field: "tags" }]` for agent grouping
- `timeDimension`: `{ granularity: "day" | "week" | "month" }` for time-series
- `filters`: Column-based filters with operators
- `fromTimestamp`, `toTimestamp`: ISO 8601 date range
- `orderBy`: Sort field + direction

Response: `{ data: Record<string, any>[] }` — flat array of grouped results.

**Important — SDK contract:**
- `metricsMetrics()` takes `{ query: string }` where `query` is a JSON-serialized object with the fields described above. The helpers must call `JSON.stringify()` on the query object.
- The SDK types use `Record<string, any>` for response data, so helpers must use defensive type narrowing.
- Valid `measure` values need verification during implementation. The SDK docs show `"count"`, `"latency"`, `"value"` as examples. If `"totalCost"` is not valid, try `"value"` as an alternative (some Langfuse versions use `"value"` for cost).
- The `"tags"` dimension field is not explicitly documented. Implementation should verify it works and use the per-agent fallback strategy documented in the trends/agents endpoint sections if it does not.

### Agent Color Mapping

For consistent colors across charts and legend:
- Use a fixed palette of 8-10 distinct colors
- Assign colors by agent index in the response (first agent = color[0], etc.)
- Colors defined as CSS variables in App.css for theme awareness:
  ```
  --chart-color-1 through --chart-color-8
  ```
- Light theme: saturated colors. Dark theme: slightly muted versions.

## File Summary

| Action | File | What changes |
|--------|------|-------------|
| Create | `server/src/routes/observability.ts` | Three API endpoints for summary, trends, agents |
| Modify | `server/src/langfuse.ts` | Add 3 helper functions for metrics queries |
| Modify | `server/src/index.ts` | Register observability route |
| Create | `client/src/components/ObservabilityDashboard.tsx` | Full dashboard page component |
| Create | `client/src/components/ObservabilityDashboard.css` | Theme-aware styles |
| Modify | `client/src/App.tsx` | Add DashboardGuard + route |
| Modify | `client/src/App.css` | Add chart color CSS variables |
| Modify | `client/src/components/Home.tsx` | Add Observability link |
| Install | `recharts` | Chart library (client workspace) |

## UI Behavior

- **Empty state:** If no traces exist for the selected date range, show "No trace data for this period." in place of charts/table
- **Loading:** Skeleton placeholders for cards, charts show empty container with "Loading..." centered
- **Error:** If Langfuse API call fails, show inline error message below the header
- **Date range validation:** If `from` > `to`, swap them silently
- **Default range:** Last 30 days from today
- **Agent table click:** Navigates to `/agents/:id/traces` (Phase 1 per-agent view)

## What This Does NOT Include

- Per-agent trace view enhancements (pagination controls, search, token breakdown)
- Real-time trace streaming via WebSocket
- Flame graph / waterfall visualization
- Screenshot replay within traces
- Model-level cost breakdown (which LLM model costs most)
- Export/download of analytics data
- Configurable dashboard widgets or layout customization
