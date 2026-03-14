# App Map — Feature Visualization Design

## Goal

Replace the flat feature list (MemoryViewer) with an interactive knowledge graph that shows how the agent understands the application. Users see a living map of pages and features that grows in real-time during exploration, with action-centric curation controls to correct, refine, and trigger testing.

## Architecture

The App Map is a **Graph + Detail Panel hybrid** rendered as a tab alongside Chat in the session view. The left panel shows a React Flow force-directed graph where pages are nodes and navigation paths are edges. The right panel shows the selected node's features with inline curation controls. Real-time updates arrive via existing WebSocket events.

**Tech stack addition:** `@xyflow/react` (React Flow v12) for graph rendering. No other new dependencies.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Visualization type | Graph + Detail Panel | Graph gives spatial overview; panel gives curation depth. Progressive disclosure. |
| Placement | Tab alongside Chat | Stay in session context. See map grow during exploration without navigation. |
| Graph library | React Flow (@xyflow/react) | React-native, handles pan/zoom/selection, custom node API for SVG/animations. |
| Detail panel style | Action-centric | Primary purpose is curation. Edit/test/remove inline. Suggestions integrated. |
| Real-time updates | Instant with dampened layout | New nodes pulse on arrival. Force layout uses high damping to avoid jitter. |
| Test button behavior | Sends task immediately | One click → agent navigates and tests. No queue complexity in v1. |
| Relationship types | Spatial/navigational only | Co-location (same page) and nav edges. Derivable from existing data — no new agent work. |

## Data Flow

### Existing Data (no schema changes)

The App Map consumes data that already exists:

- **`nav_nodes`** — pages the agent has visited (id, urlPattern, pageTitle, features[])
- **`nav_edges`** — transitions between pages (fromNodeId, toNodeId, actionLabel)
- **`memory_features`** — features with criticality, expected_behaviors, flows
- **`nav_node_features`** — M:M join linking features to pages
- **`memory_suggestions`** — pending discoveries awaiting user review

### New API Endpoint

```
GET /api/projects/:id/map
```

Returns the full graph + features in a single denormalized payload. See the `AppMapResponse` type definition in the Server Changes section below for the exact shape.

### Real-time Updates via WebSocket

The App Map uses a **re-fetch strategy** for real-time updates rather than trying to build graph state from events:

- **`suggestion`** — new feature/flow/behavior discovered → triggers `refresh()` to re-fetch the full map. This is simpler than trying to resolve which node a suggestion belongs to client-side.
- **`nav`** — agent navigated to a new URL → triggers a debounced `refresh()` (200ms debounce to batch rapid navigation). The server resolves the URL to a nav_node, so the client doesn't need `normalizeUrl`.

After `refresh()`, the hook diffs the previous node list against the new one. Any node present in the new list but not the old list gets a `isNew: true` flag, triggering the pulse animation. This approach avoids duplicating server logic on the client while still delivering the "live growth" visual.

The WebSocket events themselves are unchanged — no new message types needed.

## Component Architecture

```
client/src/components/
├── AppMap/
│   ├── AppMap.tsx              # Main container — React Flow + detail panel
│   ├── AppMap.css              # Styles
│   ├── PageNode.tsx            # Custom React Flow node (circle, badge, pulse)
│   ├── NavEdge.tsx             # Custom React Flow edge (styled connection)
│   ├── DetailPanel.tsx         # Right panel — features, suggestions, actions
│   ├── FeatureCard.tsx         # Single feature with edit/test/remove
│   ├── SuggestionCard.tsx      # Pending suggestion with accept/dismiss
│   └── useAppMap.ts            # Hook: fetch map data, handle real-time updates
```

### AppMap.tsx

Top-level component rendered as a tab peer to ChatPanel. Receives projectId and WebSocket connection from parent.

- Fetches initial map data via `GET /api/projects/:id/map`
- Subscribes to WebSocket `suggestion` and `nav` events for live updates
- Manages selected node state
- Renders React Flow graph (left) and DetailPanel (right)

### PageNode.tsx (Custom React Flow Node)

Each node represents a page (nav_node). Visual properties:

- **Size**: Radius scales with feature count: `Math.max(20, Math.min(40, 20 + featureCount * 4))`
- **Border color**: Criticality of highest-severity feature on that page
  - Critical → `#ef4444` (red)
  - High → `#f59e0b` (amber)
  - Medium → `#a78bfa` (purple)
  - Low / no features → `#334155` (gray)
- **Badge**: Circle showing feature count (top-right)
- **Label**: Page title + URL pattern
- **Selected state**: Glow ring (two concentric circles with decreasing opacity)
- **New discovery**: Amber pulse animation (CSS keyframe, fades after 10s)
- **Unexplored**: Dashed border, muted colors, "unexplored" label

### NavEdge.tsx (Custom React Flow Edge)

Simple styled connection between nodes. Solid for explored paths, dashed for paths to unexplored pages.

### DetailPanel.tsx

Right panel (fixed 300px width). Shows when a node is selected, empty state when nothing selected.

Sections (top to bottom):
1. **Page header** — title, URL, last-seen timestamp, action buttons (+ Feature, Re-explore)
2. **Features list** — sorted by criticality (critical first). Each rendered as FeatureCard.
3. **Pending suggestions** — dashed amber cards with accept/dismiss. Feature suggestions matched to this page via `discovered_at_url`. Flow and behavior suggestions matched indirectly: find the parent feature by `feature_name`, then resolve to a node via `nav_node_features`. Suggestions that can't be matched to any node appear in a global "Unlinked Suggestions" section when no node is selected.
4. **Connected pages** — clickable chips showing inbound/outbound nav edges. Clicking one selects that node in the graph.

### FeatureCard.tsx

Single feature card with:
- Left border colored by criticality
- Name, description (truncated)
- Expected behaviors as small chips
- Flows shown as `↳ FlowName (N steps)`
- Actions: **edit** (inline rename + edit behaviors), **test** (sends task to agent), **remove** (delete with confirm)

**Test action:** Sends a WebSocket `task` message: `"Test the {feature.name} feature on {pageTitle} ({urlPattern}). Verify: {expected_behaviors.join(', ')}"`. The agent receives this as a normal task and executes it.

**Re-explore action (on page header):** Sends a WebSocket `task` message: `"Navigate to {urlPattern} and identify all features, interactions, and flows on this page."` Agent re-scans and generates new suggestions.

### useAppMap.ts Hook

```typescript
function useAppMap(projectId: string, ws: WebSocket | null): {
  nodes: MapNode[];
  edges: MapEdge[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}
```

- Fetches `GET /api/projects/:id/map` on mount
- Listens for WebSocket `suggestion` events → appends to the correct node's pendingSuggestions
- Listens for WebSocket `nav` events → checks if URL matches existing node; if not, adds a new node with pulse state
- Exposes `refresh()` for manual re-fetch after mutations (accept, dismiss, delete)

## Server Changes

### New Route: `GET /api/projects/:id/map`

Added to a new file `server/src/routes/map.ts`. Uses `requireAuth` middleware consistent with existing routes. Returns empty graph when Supabase is disabled.

Query strategy:

1. Load nav graph via existing `getGraph(projectId)` — returns nodes with `features: string[]` (names only) and edges
2. Load all features with flows via existing `listFeatures(projectId)` — returns full feature objects
3. For each node, resolve feature names to full feature objects by matching `node.features[]` (names) against the full feature list. This avoids modifying the `nav_node_features` join query.
4. Load pending suggestions via existing `listPendingSuggestions(projectId)`
5. Attach feature suggestions to nodes by matching `discovered_at_url` → `normalizeUrl` → node's `urlPattern`
6. Attach flow/behavior suggestions to nodes by: find feature by `data.feature_name` in the full feature list → find which node(s) contain that feature → attach to first matching node
7. Suggestions that don't match any node go into a top-level `unlinkedSuggestions` array
8. Return combined `AppMapResponse`

Updated response type:

```typescript
interface AppMapResponse {
  nodes: Array<{
    id: string;
    urlPattern: string;
    pageTitle: string;
    features: Array<{
      id: string;
      name: string;
      description: string | null;
      criticality: Criticality;
      expected_behaviors: string[];
      flows: Flow[];
    }>;
    pendingSuggestions: Array<Suggestion>;
  }>;
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    actionLabel: string;
  }>;
  unlinkedSuggestions: Array<Suggestion>;
}
```

### Existing Route Changes

None. All mutation routes already exist:
- `PUT /api/projects/:id/suggestions/:sid/accept` — accept suggestion
- `PUT /api/projects/:id/suggestions/:sid/dismiss` — dismiss suggestion
- `PUT /api/projects/:id/memory/features/:fid` — update feature
- `DELETE /api/projects/:id/memory/features/:fid` — delete feature

The detail panel calls these directly and triggers `refresh()` on the hook.

## Graph Layout

React Flow's built-in force simulation is not ideal for this use case. Instead:

1. **Initial layout**: Use a simple hierarchical layout based on BFS from the root node. The root node is identified as: (a) the node with the earliest `firstSeenAt` timestamp, or (b) if all timestamps are equal, the node with the most outbound edges. Pages closer to root are placed at the top, deeper pages further down. Left-right spread based on sibling count at each depth level.

2. **User can drag**: Once placed, nodes are draggable. Positions are stored in component state (not persisted to DB in v1).

3. **New node placement**: When a new node appears via WebSocket, place it adjacent to its parent (the node that has an edge to it), offset by a small random angle to avoid overlap. Animate entry with scale-in + pulse.

4. **Fit view**: Toolbar "Fit" button calls React Flow's `fitView()` to recenter.

## UI Integration

### Tab System

App.tsx gets a tab bar in the left panel (where ChatPanel currently renders). App Map replaces MemoryViewer as the primary way to view features — MemoryViewer remains accessible but is no longer the default features UI:

```
[ Chat ]  [ App Map ]
```

- **Chat tab**: Shows the existing ChatPanel + BrowserView layout
- **App Map tab**: Shows the AppMap component full-width (graph + detail panel)

Both tabs share the same WebSocket connection and session state. Switching tabs does not disconnect or restart anything.

The tab bar is minimal — two text tabs with an underline indicator. Matches the existing dark theme.

### Empty State

When a project has no nav graph data (agent hasn't explored yet):

```
No map data yet.
Start an exploration to build the app map.
[ Explore & Learn ]
```

The button triggers the existing explore flow.

## What This Does NOT Include (v1 Scope)

- **Persisted node positions** — dragged positions reset on page reload. Not worth a DB migration for v1.
- **Feature-to-feature relationships** — only page-to-page (nav edges). Semantic relationships are a future iteration.
- **Batch test queue** — test button sends immediately. Queue is future.
- **Coverage metrics/percentages** — the visual gaps (unexplored nodes) serve this purpose for now.
- **Graph search/filter** — with <50 nodes typical, pan/zoom is sufficient for v1.
- **Editing nav graph structure** — users curate features, not the graph topology. The agent builds the graph.

## Success Criteria

1. User can see all explored pages as nodes in an interactive graph
2. Clicking a node shows its features with edit/test/remove controls
3. New discoveries during exploration appear in real-time with pulse animation
4. "Test" button sends a targeted task to the agent and it executes
5. Pending suggestions appear inline on the page where they were discovered
6. Connected page chips allow navigating between nodes without manual graph interaction
7. Unexplored pages (detected from nav edges but never visited) show as ghost nodes
