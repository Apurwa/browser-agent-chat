# Sidebar Navigation Redesign

**Date:** 2026-03-16
**Status:** Draft

## Problem

The current sidebar mixes organizational and agent-level navigation. Vault (org-level) sits alongside agent capabilities. The home page has no sidebar. There is no way to quickly navigate across artifacts (traces, findings, evals) without drilling into each agent manually.

## Design Principles

1. **Agents are the primary resource** — everything else is tooling around them
2. **Sidebar = structure** — persistent, scope-aware navigation
3. **Cmd+K = speed** — ephemeral search overlay for cross-object discovery
4. **Two scopes, one sidebar** — workspace items always visible, agent items appear contextually

## Information Architecture

```
Org
├ Observability        (cross-agent traces, evals, failures)
├ Vault                (shared credential infrastructure)
├ Agents               (primary resource)
│   └ Agent
│       ├ Testing      (chat + browser)
│       ├ Findings     (discovered bugs)
│       ├ Memory       (learned features/flows)
│       ├ Evals        (evaluation dashboard)
│       └ Traces       (langfuse traces)
└ Settings             (org-level config)
```

## Routing

```
/                           → Home (search + agent cards)
/observability              → Cross-agent observability dashboard
/vault                      → Credential vault
/settings                   → Org settings

/agents/:id/testing         → Agent testing view
/agents/:id/findings        → Agent findings
/agents/:id/memory          → Agent memory
/agents/:id/evals           → Agent evals
/agents/:id/traces          → Agent traces
/agents/:id/settings        → Agent settings
```

## Sidebar: Two States

### State 1 — No Agent Selected (Org View)

Shown on `/`, `/observability`, `/vault`, `/settings`.

```
[QA Agent logo]

── Workspace ──────────
  Observability
  Vault

── Agents ─────────────
  ● Fraud Detection
  ○ Support Bot
  ○ Security Scanner

────────────────────────
  Settings
  Theme toggle
  Collapse toggle
```

- Agents section shows all agents as a quick-access list
- Status dot: green = active session, gray = idle
- Clicking an agent navigates to `/agents/:id/testing`
- Logo click always returns to `/`

### State 2 — Agent Selected (Agent View)

Shown on `/agents/:id/*` routes.

```
[QA Agent logo]

── Workspace ──────────
  Observability
  Vault

── Agent ──────────────
  ● Fraud Detection  ▾

    Testing
    Findings          [3]
    Memory
    Evals
    Traces

────────────────────────
  Settings
  Theme toggle
  Collapse toggle
```

- Workspace section persists — no jarring sidebar rebuild on context switch
- Agent name is a dropdown to switch agents without going home
- Agent capabilities are indented under the agent name
- Badges show counts (findings, pending suggestions)
- Settings at bottom is org-level; agent settings accessible via gear icon next to agent name or as a route

### Collapsed State

Both states support collapsed mode (icon-only, ~56px wide):
- Workspace items: icon only
- Agent list (state 1): status dots only
- Agent capabilities (state 2): icons only, active item highlighted
- Expand/collapse persisted to localStorage

## Cmd+K Command Palette

Global search overlay triggered by `Cmd+K` (or `Ctrl+K` on Windows/Linux).

### Indexed Objects

| Object | Source Table | Example Query |
|--------|-------------|---------------|
| Agents | `agents` | "fraud agent" |
| Traces | Langfuse traces API | "failed login task" |
| Findings | `findings` | "policy violation" |
| Evals | `eval_runs` | "accuracy regression" |
| Memory | `memory_features`, `memory_flows` | "user onboarding workflow" |
| Credentials | `credentials_vault` | "stripe api key" |

### Result Format

Each result returns:
```ts
{
  type: 'agent' | 'trace' | 'finding' | 'eval' | 'memory' | 'credential';
  label: string;
  sublabel?: string;     // e.g. agent name for a trace
  route: string;         // e.g. /agents/:id/traces/:traceId
  agentId?: string;
}
```

### UI Structure

```
┌──────────────────────────────────┐
│ 🔎 Search agents, traces, evals │
├──────────────────────────────────┤
│ Recent                           │
│   Fraud Agent                    │
│   Latest Trace Failures          │
│   Login Test Run                 │
│                                  │
│ Quick Actions                    │
│   + Create Agent                 │
│   ▶ Run Test                     │
│   📊 View Observability          │
└──────────────────────────────────┘
```

- Empty state shows recent items + quick actions
- As user types, results grouped by type (Agents, Traces, Findings, etc.)
- Arrow keys to navigate, Enter to select, Escape to close
- Results limited to 5 per category, with "View all" link

### Implementation Approach

**Phase 1 (MVP):** Client-side search across agents only (data already loaded). Keyboard shortcut + overlay component.

**Phase 2:** Server endpoint `GET /api/search?q=...&types=agent,trace,finding` that queries across tables. Client calls on keystroke with debounce.

**Phase 3:** Context-aware search within agent pages (search traces, findings, memory scoped to current agent).

## Landing Page (Home)

Hybrid layout: search bar prominent at top, agent cards below.

```
┌─────────────────────────────────────┐
│  🔎 Search agents, traces, evals.. │
├─────────────────────────────────────┤
│                                     │
│  Recent Activity                    │
│  • Failed Trace: Fraud Agent  2m    │
│  • Eval Run: Prompt Accuracy  1h    │
│  • Agent Created: Support Bot 3d    │
│                                     │
│  Agents                             │
│  ┌──────────┐  ┌──────────┐        │
│  │ Fraud    │  │ Support  │        │
│  │ 3 bugs   │  │ clean    │        │
│  └──────────┘  └──────────┘        │
│                                     │
│  Quick Actions                      │
│  + Create Agent  ▶ Run Test         │
└─────────────────────────────────────┘
```

- Search bar at top (same as Cmd+K but inline)
- Recent activity feed (cross-agent events: traces, findings, evals)
- Agent cards grid (existing, with status indicators)
- Quick actions row

## Component Changes

### New Components

| Component | Description |
|-----------|-------------|
| `CommandPalette.tsx` | Cmd+K overlay with search, results, keyboard nav |
| `CommandPalette.css` | Styling for overlay, results, categories |

### Modified Components

| Component | Changes |
|-----------|---------|
| `Sidebar.tsx` | Two-state rendering (org view vs agent view), workspace section, agent list/dropdown |
| Sidebar styles in `App.css` | New styles for workspace section, agent list, agent dropdown, section labels |
| `Home.tsx` | Add inline search bar, quick actions |
| `Home.css` | Styles for search bar, activity feed, quick actions |
| `App.tsx` | Replace per-component sidebar with `SidebarLayout` wrapper, add CommandPalette |
| `TestingView.tsx`, `FindingsDashboard.tsx`, `MemoryViewer.tsx`, `AgentSettings.tsx`, `EvalDashboard.tsx`, `ObservabilityPanel.tsx`, `VaultPage.tsx` | Remove embedded `<Sidebar />` and `.app-layout` wrapper |

### Removed Components

None. All existing components are modified, not removed.

## Data Requirements

### Recent Activity Feed

New server endpoint: `GET /api/activity?limit=10`

Returns cross-agent events sorted by timestamp:
```ts
{
  events: Array<{
    type: 'trace' | 'finding' | 'eval' | 'agent_created';
    agentId: string;
    agentName: string;
    label: string;
    timestamp: string;
    route: string;
  }>;
}
```

Sources: `sessions` table (traces), `findings` table, `eval_runs` table, `agents` table.

### Search Endpoint (Phase 2)

`GET /api/search?q=:query&types=agent,trace,finding,eval,memory,credential&limit=5`

Returns categorized results matching the query across all indexed objects.

## CSS Theme Compliance

All new components use existing CSS variables:
- Backgrounds: `var(--bg-primary)`, `var(--bg-secondary)`, `var(--bg-card)`
- Text: `var(--text-body)`, `var(--text-muted)`, `var(--text-dim)`
- Borders: `var(--border-primary)`
- Brand: `var(--brand)`, `var(--accent)`
- Section labels: `var(--text-dim)`, 10px uppercase with letter-spacing

No hardcoded hex colors.

## Sidebar Layout Architecture

### Lifting Sidebar to App.tsx

Currently, each agent page embeds `<Sidebar />` individually. Phase 1 lifts the Sidebar into a layout wrapper in `App.tsx` using React Router's layout route pattern:

```tsx
// App.tsx — layout route wraps all pages with sidebar
<Route element={<SidebarLayout />}>
  <Route path="/" element={<Home />} />
  <Route path="/observability" element={<DashboardGuard />} />
  <Route path="/vault" element={<VaultPage />} />
  <Route path="/agents/:id/testing" element={<TestingView />} />
  {/* ... all other routes */}
</Route>
<Route path="/login" element={<LoginPage />} />
```

`SidebarLayout` renders `<Sidebar />` + `<Outlet />` and provides shared data to the sidebar.

**Migration:** Remove `<Sidebar />` from these 7 components:
- `TestingView.tsx`
- `FindingsDashboard.tsx`
- `MemoryViewer.tsx`
- `AgentSettings.tsx`
- `EvalDashboard.tsx`
- `ObservabilityPanel.tsx`
- `VaultPage.tsx`

### Data Flow for Layout-Level Sidebar

The sidebar needs data that currently lives inside per-component WebSocket hooks. Solution: a lightweight `SidebarDataProvider` context that:

1. **Reads `agentId` from URL params** (`useParams`)
2. **Fetches agent list** via `GET /api/agents` on mount (already exists)
3. **Subscribes to badge counts** — `findingsCount` and `pendingSuggestionCount` come from the existing `WebSocketContext`. The sidebar reads from the same context; no new data source needed since `WebSocketProvider` already wraps the app.
4. **Reads `langfuseEnabled`** from existing `HealthContext`

No new API endpoints required for Phase 1.

### Agent Dropdown (State 2)

The agent name with `▾` chevron opens a dropdown for switching agents:

- **Data:** Uses the same agent list fetched by `SidebarDataProvider` (preloaded, not on-demand)
- **Items:** Agent name + status dot (green/gray), max 10 visible, scroll if more, "View all" link at bottom navigates to `/`
- **On select:** Navigate to `/agents/:newId/testing`. The existing WebSocket auto-reconnects to the new agent (current behavior when URL changes).
- **Close on:** Click outside, Escape key, or selection

### Observability Feature Flag

The Observability sidebar item respects `langfuseEnabled` from `HealthContext`:
- **Enabled:** Normal clickable link to `/observability`
- **Disabled:** Hidden (consistent with current Traces behavior)

### Collapsed State Details

- Workspace items: icon only
- Agent list (state 1): agent initial letter (first char of name) in a small circle with status color border
- Agent capabilities (state 2): icons only, active item has accent border
- Expand/collapse persisted to localStorage key `'sidebar-expanded'`

### `/settings` Org Route

Out of scope for this spec. The sidebar shows a Settings item at the bottom that currently navigates to `/agents/:id/settings` when in agent context. In org context (no agent selected), the Settings item is disabled with a tooltip "Coming soon". Will be addressed in a future spec when org-level settings are needed.

## Error & Loading States

| Section | Loading State | Error State |
|---------|--------------|-------------|
| Agent list (sidebar) | 3 skeleton items with shimmer | "Failed to load agents" with retry link |
| Agent dropdown | Reuses preloaded list (no loading) | Falls back to stale cached list |
| Command palette results | Spinner in results area | "Search failed" inline message |
| Activity feed (home) | 3 skeleton rows | "Could not load activity" with retry |
| Badge counts | No badge shown until data arrives | No badge shown (silent failure) |

## Responsive Behavior

Mobile is out of scope for this phase. The sidebar assumes desktop viewports (>1024px). On viewports below 1024px, the sidebar auto-collapses to icon-only mode. No hamburger menu or bottom nav is planned.

## Accessibility

- Sidebar uses `<nav aria-label="Main navigation">`
- Agent list items use `role="link"` with `aria-current="page"` for active item
- Command palette traps focus when open, returns focus to trigger on close
- All interactive elements are keyboard-accessible (Tab, Enter, Escape)
- Status dots include `aria-label` (e.g., "Active session" / "Idle")
- Section labels use `role="heading" aria-level="2"`

## Phased Implementation

### Phase 1: Sidebar Restructure
- Lift Sidebar from 7 components into `SidebarLayout` in `App.tsx`
- Add `SidebarDataProvider` context for agent list and badge data
- Refactor Sidebar.tsx to two-state model (org view / agent view)
- Add workspace section (Observability, Vault) always visible
- Agent list in org view, agent capabilities in agent view
- Agent dropdown for switching in agent view
- Show sidebar on all pages (except login)

### Phase 2: Cmd+K Command Palette + Home Search
- `CommandPalette.tsx` component with `Cmd+K` / `Ctrl+K` shortcut
- Client-side agent search (MVP — data already in context)
- Recent items tracked in localStorage
- Quick actions routing
- Inline search bar on Home page (reuses CommandPalette as embedded variant)

### Phase 3: Landing Page Redesign
- Recent activity feed (new `GET /api/activity` endpoint)
- Refined agent cards grid with status indicators
- Quick actions row

### Phase 4: Server-Side Search
- `GET /api/search` endpoint querying across tables
- Full-text search across agents, traces, findings, evals, memory, credentials
- Context-aware search within agent pages (scoped to current agent)

## Migration

- No database changes required for Phase 1-2
- Phase 3 needs `GET /api/activity` endpoint (server change)
- Phase 4 needs `GET /api/search` endpoint (server change)
- Existing routes preserved — no breaking changes
- `localStorage` key `'sidebar-expanded'` remains compatible
- Remove `<Sidebar />` imports from 7 components in Phase 1
