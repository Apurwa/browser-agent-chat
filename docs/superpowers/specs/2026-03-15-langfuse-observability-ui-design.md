# Langfuse Observability UI — Design Spec

## Goal

Add a per-agent Observability tab to the sidebar that shows historical Langfuse traces grouped by session, with inline span-tree detail on click. The tab only appears when Langfuse is configured.

## Scope

**Phase 1 (this spec):** Per-agent trace list with session grouping and span-tree detail.
**Phase 2 (future):** Admin dashboard with cross-agent analytics, cost trends, and aggregate stats.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary audience | Both end-users and platform developer | Users debug failed tasks; developer monitors performance |
| What ships first | Per-agent trace list | Fits existing sidebar pattern, immediately useful |
| Architecture | Server-side Langfuse proxy | Keeps credentials server-side, follows existing route pattern |
| Detail level | Medium — inline span tree | Enough to answer "what happened?" without duplicating Langfuse dashboard |
| History scope | All traces, grouped by session | Collapsible sessions give both "current only" simplicity and full history |
| Tab visibility | Hidden when Langfuse not configured | Clean UI for users without tracing; matches HeyGen pattern |

## Architecture

### Data Flow

```
Langfuse API ← server/routes/traces.ts ← client/ObservabilityPanel.tsx
                       ↕
               Supabase sessions table (for session grouping metadata)
```

### Server

**New file: `server/src/routes/traces.ts`**

Two endpoints behind `requireAuth` middleware:

#### `GET /api/agents/:id/traces`

- Calls `langfuse.api.traceList()` (Langfuse SDK v3) filtered by tag `agent:<id>`, ordered by timestamp DESC
- Langfuse uses **page-based pagination**: accepts `page` (1-indexed) and `limit` query params
- Server endpoint accepts `?page=1&limit=50` and passes directly to Langfuse API
- Joins with Supabase `sessions` table to add session `startedAt` timestamps (Langfuse traces already have `sessionId` which matches our Supabase `sessions.id`)
- **Status derivation:** `ApiTrace` has no `status` field. Derive from `output`: if `output.success === true` → `"success"`, otherwise `"error"`. If `output` is null/missing, default to `"success"`.
- **Observation count:** `ApiTraceWithDetails.observations` is `string[]` (array of IDs). Derive count via `observations.length`.
- Response shape:
  ```json
  {
    "sessions": [
      {
        "sessionId": "uuid",
        "startedAt": "ISO timestamp",
        "traces": [
          {
            "id": "trace-id",
            "name": "user-task | login | explore",
            "input": "Click subscribe button",
            "latency": 4.2,
            "totalCost": 0.03,
            "status": "success | error",
            "observationCount": 3,
            "timestamp": "ISO timestamp"
          }
        ]
      }
    ],
    "meta": {
      "page": 1,
      "limit": 50,
      "totalItems": 12,
      "totalPages": 1
    }
  }
  ```

#### `GET /api/agents/:id/traces/:traceId`

- Calls `langfuse.api.traceGet(traceId)` for full trace with observations
- Returns `ApiTraceWithFullDetails` which includes full observation objects (not just IDs)
- **Status derivation:** Same logic as list endpoint — derived from `output.success`
- Response shape:
  ```json
  {
    "id": "trace-id",
    "name": "Login to account",
    "input": "login task prompt",
    "output": "error: CAPTCHA detected",
    "latency": 15.3,
    "totalCost": 0.08,
    "status": "error",
    "timestamp": "ISO timestamp",
    "observations": [
      {
        "name": "muscle-memory-login-replay",
        "startTime": "ISO",
        "endTime": "ISO",
        "duration": 2.1,
        "model": "claude-sonnet-4-20250514",
        "tokenCount": 1240,
        "level": "DEFAULT | ERROR"
      }
    ]
  }
  ```

**Modification: `server/src/langfuse.ts`**

Add two helper functions:
- `fetchAgentTraces(agentId, page, limit)` — wraps `langfuse.api.traceList({ tags: ['agent:<agentId>'], page, limit, orderBy: 'timestamp.desc' })`, transforms `observations` array to count, derives `status` from `output`
- `fetchTraceDetail(traceId)` — wraps `langfuse.api.traceGet(traceId)`, flattens observations to `{ name, startTime, endTime, duration, model, tokenCount, level }`

**Modification: `server/src/index.ts`**

- Register route: `app.use('/api/agents/:id/traces', tracesRouter)`

**Modification: `GET /health`**

- Add `langfuseEnabled: boolean` to health response (calls `isLangfuseEnabled()`)

### Client

**New file: `client/src/components/ObservabilityPanel.tsx`**

Master-detail layout matching FindingsDashboard pattern:

**Left panel — Trace list:**
- Fetches `GET /api/agents/:id/traces` on mount
- Renders collapsible session groups (most recent first)
- Each session header: date/time, trace count, collapse/expand toggle
- Each trace row: task name, type badge, step count, latency, cost, success/fail left-border color
- Selected trace highlighted with blue outline

**Right panel — Trace detail:**
- Fetches `GET /api/agents/:id/traces/:traceId` on trace click
- Summary stats row: total latency, total cost, step count
- Span tree: numbered list of observations with:
  - Span name
  - Model used + token count
  - Duration bar (proportional width relative to longest span)
  - Duration text
- Failed spans: red border, red step number, ERROR label
- Error output section at bottom for failed traces (shows `output` field)

**New file: `client/src/components/ObservabilityPanel.css`**

- All colors via CSS custom properties (theme-aware)
- Follows existing component CSS patterns (FindingsDashboard.css as reference)

**Modification: `client/src/components/Sidebar.tsx`**

- Add "Traces" tab with `Activity` icon from Lucide
- Position after Evals, above the sidebar spacer (in the main nav group, not the bottom settings group)
- Conditionally rendered based on `langfuseEnabled` flag

**Modification: `client/src/App.tsx`**

- Add route: `/agents/:id/traces` → `ObservabilityPanel`
- If Langfuse is off and user navigates to `/agents/:id/traces` directly, redirect to `/agents/:id/testing`

**New file: `client/src/contexts/HealthContext.tsx`**

- Fetches `GET /health` once on mount, stores response in React context
- Exposes `useHealth()` hook returning `{ langfuseEnabled: boolean, loading: boolean }`
- Sidebar and App.tsx consume this context to conditionally show the Traces tab/route
- This avoids duplicating the health fetch across multiple components and follows the existing context pattern (`WebSocketContext`, `AssistantContext`)

### Tagging Contract

For traces to be filterable by agent, `agent.ts` must tag traces with `agent:<agentId>`. Current implementation uses `metadata.agentId` — we need to also add it as a Langfuse tag for the `fetchTraces` tag filter to work.

**Modification: `server/src/agent.ts`**

- Add `tags: ['agent:<agentId>']` to all three trace creation sites (user-task, login, explore)

## File Summary

| Action | File | What changes |
|--------|------|-------------|
| Create | `server/src/routes/traces.ts` | Two API endpoints for trace list and detail |
| Modify | `server/src/langfuse.ts` | Add `fetchAgentTraces()` and `fetchTraceDetail()` helpers |
| Modify | `server/src/index.ts` | Register traces route, add `langfuseEnabled` to health |
| Modify | `server/src/agent.ts` | Add `tags: ['agent:<agentId>']` to trace creation |
| Create | `client/src/components/ObservabilityPanel.tsx` | Master-detail trace viewer component |
| Create | `client/src/components/ObservabilityPanel.css` | Theme-aware styles |
| Create | `client/src/contexts/HealthContext.tsx` | Health flag context + `useHealth()` hook |
| Modify | `client/src/components/Sidebar.tsx` | Add conditional "Traces" tab |
| Modify | `client/src/App.tsx` | Add route, wrap with HealthProvider |

## UI Behavior

- **Empty state:** If Langfuse is enabled but no traces exist yet, show "No traces yet. Run a task to see observability data here."
- **Loading:** Skeleton loader in left panel while fetching traces
- **Error:** If Langfuse API call fails, show inline error message (not a toast)
- **No detail selected:** Right panel shows a centered prompt: "Select a trace to view details"

## What This Does NOT Include

- Admin dashboard / cross-agent analytics (Phase 2)
- Token-level cost breakdown per span
- Screenshot replay within traces
- Real-time trace streaming via WebSocket
- Flame graph / waterfall visualization
- Date range filtering or search
