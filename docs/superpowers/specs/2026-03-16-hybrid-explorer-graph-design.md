# Hybrid Explorer Graph — Design Spec

## Overview

Redesign the App Graph into a **Hybrid Explorer** combining a tree navigator, expandable graph canvas, and detail panel. The graph uses a **layered data model** where navigation (pages) and capabilities (actions/features) are separate layers derived from the same exploration data. Users progressively discover the application structure by expanding nodes, with the AI agent exploring unexplored areas on demand.

## Problem

The current App Graph renders all discovered pages as a flat BFS layout. As applications grow beyond 20-30 pages, this becomes unusable — too many nodes, no hierarchy, no way to focus on one area. Users cannot distinguish between "how do I navigate there" and "what can this app do."

## Design Principles

1. **Progressive disclosure** — start with root + top-level sections, expand on demand
2. **Layered graph** — navigation and capabilities are separate layers, not just views
3. **Agent-driven exploration** — unexplored nodes trigger live agent discovery
4. **IDE-like explorer** — tree + graph + detail panel (Chrome DevTools, Neo4j Bloom pattern)

## Architecture

```
API (/api/agents/:id/map)
        ↓
  Canonical Graph Model    ← raw data → GraphEntity + GraphRelation (system truth)
        ↓
  Graph Projection Layer   ← projects canonical model into navigation or capability views
        ↓
  Graph Store (zustand)    ← source of truth for UI state: expansion, selection, mode
        ↓
  Layout Engine (ELK)      ← hierarchical layout with position-interpolated relayout
        ↓
  React Flow Renderer      ← memoized custom nodes, edges, interactions
```

**Why zustand over React Context:** The graph UI has three independently-updating regions (tree panel, graph canvas, toolbar). React Context would re-render all three whenever any graph state changes. Zustand's selector-based subscriptions provide granular updates — the tree only re-renders when tree-relevant state changes, the canvas only when node positions change.

### Canonical Graph Model

The internal representation of the system graph, decoupled from any UI concerns. Navigation and capability views are **projections** of this model, not separate data structures.

```ts
type GraphEntity = {
  id: string
  kind: 'page' | 'feature' | 'cluster'
  sourceIds?: string[]        // for clusters: the page IDs this was derived from
  metadata: Record<string, unknown>  // urlPattern, pageTitle, criticality, etc.
}

type GraphRelation = {
  id: string
  from: string
  to: string
  type: 'navigation' | 'dependency' | 'crosslink'
  metadata?: Record<string, unknown>  // actionLabel, etc.
}
```

**Projection flow:**
```
Raw API Data → Canonical Graph (GraphEntity[] + GraphRelation[])
                    ↓
              Graph Projection Layer
              ├ Navigation view → AppNode[] + AppEdge[] (pages + nav actions)
              └ Capability view → AppNode[] + AppEdge[] (clusters + dependencies)
```

This separation enables future graph views (workflows, traces, test coverage) without changing the underlying model or the rendering layer.

### Graph Projection Layer

Responsibilities:
- Receives the canonical graph model (`GraphEntity[]` + `GraphRelation[]`)
- Projects it into the active view as `AppNode[]` + `AppEdge[]`
- Two projections:
  - **Navigation graph**: nodes = pages, edges = navigation actions
  - **Capability graph**: nodes = features/actions grouped into clusters, edges = dependencies/workflows
- Capabilities are **derived from** pages: `page entities → feature entities → capability clusters`
- Multiple pages can map to one capability cluster (e.g., `/admin/users`, `/admin/users/:id`, `/admin/users/new` → "User Management")
- The mode toggle tells the projection layer which representation to emit

### Graph Store (zustand)

```ts
type GraphStore = {
  // Data
  nodes: AppNode[]
  edges: AppEdge[]

  // UI State
  expandedNodeIds: Set<string> // O(1) membership checks; serialize via Array.from() when needed
  selectedNodeId: string | null
  mode: 'navigation' | 'capabilities'
  searchQuery: string

  // Actions
  toggleExpand: (nodeId: string) => void
  selectNode: (nodeId: string) => void
  setMode: (mode: 'navigation' | 'capabilities') => void
  setSearchQuery: (query: string) => void
}
```

This prevents React Flow from becoming the source of truth. React Flow receives derived, filtered, laid-out nodes — it does not own the graph state.

### Node Types

```ts
type AppNode = {
  id: string
  type: 'root' | 'section' | 'feature' | 'action'
  label: string
  urlPattern?: string
  parent?: string
  state: NodeState
  featureCount?: number
  criticality?: 'critical' | 'high' | 'medium' | 'low'
  childIds: string[]
  pendingSuggestions?: Suggestion[] // carried forward from existing model
}

type NodeState = {
  exploration: 'unknown' | 'exploring' | 'explored' | 'failed'
  validation: 'untested' | 'tested' | 'verified'
}
```

The structured `NodeState` supports current exploration tracking and future QA/test coverage overlays. For Phase 5 (exploration status), only `exploration` is used. The `validation` field enables future workflows where nodes can be marked as tested or verified.

### Data Mapping: Existing → New

The Graph Projection Layer derives `AppNode` from the existing server types:

| AppNode field | Source | Derivation |
|---------------|--------|------------|
| `id` | `NavNode.id` | Direct |
| `type` | Computed | `'root'` if first node by `firstSeenAt`; `'section'` if depth 1 from root via `nav_edges`; `'feature'` if it's a `memory_features` entry |
| `label` | `NavNode.pageTitle` | Direct (falls back to URL pattern) |
| `urlPattern` | `NavNode.urlPattern` | Direct |
| `parent` | `nav_edges` | The source node of the inbound edge in the BFS tree |
| `state.exploration` | Computed client-side | `'explored'` if `features.length > 0`; `'unknown'` if node exists but has no features; `'exploring'` if agent is currently on this URL (from WebSocket `currentUrl`); `'failed'` if agent reported an error |
| `state.validation` | Computed client-side | `'untested'` by default; `'tested'` / `'verified'` set by user action in detail panel (future Phase) |
| `featureCount` | `NavNode.features.length` | Count of attached features |
| `criticality` | `memory_features` | Highest criticality among node's features |
| `childIds` | `nav_edges` | All target nodes where this node is the source |
| `pendingSuggestions` | `AppMapNode.pendingSuggestions` | Direct — the accept/dismiss workflow is preserved in the detail panel |

**Note:** `state` is computed client-side, not persisted. The server provides the raw data; the Graph Projection Layer computes `state.exploration` from feature presence + WebSocket state. `state.validation` defaults to `'untested'` and is user-driven.

### Edge Types

```ts
type AppEdge = {
  id: string
  source: string
  target: string
  type: 'navigation' | 'dependency' | 'cross-link'
  label?: string // e.g., "click sidebar", "submit form"
}
```

### Visual Hierarchy

| Level | Node Type | Card Size | Border Style |
|-------|-----------|-----------|--------------|
| Root | `root` | Large (200px) | 2px solid `--brand` |
| Section | `section` | Medium (160px) | 1px solid `--border-primary` |
| Feature | `feature` | Small (130px) | 1px solid `--border-primary` |
| Unexplored | any | Same as level | 1px dashed, 50% opacity |

### Exploration Status Indicators

| State | Indicator | Visual |
|-------|-----------|--------|
| Explored | `●` | Solid dot, full opacity |
| Unexplored | `○` | Hollow dot, 50% opacity, dashed border |
| Exploring | `⟳` | Animated spinner, glowing border |
| Failed | `⚠` | Warning icon, red border |

## UI Layout

```
+-----------------------------------------------------------+
| ⌘K Search  |  Filters (●○⟳⚠)  | [Navigation|Capabilities]|
+-------------------+---------------------------------------+
|                   |                                       |
|   Explorer Tree   |          Graph Canvas                 |
|   (220px)         |          (React Flow)                 |
|                   |                                       |
|   ● Login         |     [Login] → [Dashboard] → ...      |
|   ├ ● Dashboard   |                                       |
|   │ ├ Revenue     |     Expandable nodes with             |
|   │ └ Activity    |     progressive disclosure            |
|   ├ ⟳ Users       |                                       |
|   └ ○ Reports     |                          [minimap]    |
|                   |                                       |
|   Agent Activity  +---------------------------------------+
|   ✓ Login         |        Detail Panel                   |
|   ✓ Dashboard     |  Node: Dashboard · /dashboard         |
|   ⟳ Users...      |  Features: Revenue, Activity, ...     |
|   ○ Settings      |  Connections: Login→here, here→Users  |
+-------------------+---------------------------------------+
```

### Component Breakdown

**Top Bar** (`GraphToolbar.tsx`)
- Search input (⌘K shortcut, filters visible nodes)
- Status filter chips (toggle explored/unexplored/exploring/failed)
- Mode toggle (Navigation / Capabilities)

**Tree Panel** (`GraphTreePanel.tsx`)
- Hierarchical tree mirroring graph structure
- Status indicators inline (●/○/⟳/⚠)
- Click: centers graph on node + highlights neighbors
- Expand/collapse in tree syncs with graph expansion
- **Agent Activity** section at bottom showing exploration progress

**Graph Canvas** (`AppMap.tsx` — evolved)
- React Flow with ELK layout
- Custom node types: `RootNode`, `SectionNode`, `FeatureNode`
- Expand/collapse button on nodes with children
- Single click: select node → detail panel
- "Explore →" button on unexplored nodes triggers agent
- Animated node entry (spring transitions, 250ms)
- MiniMap in bottom-right

**Detail Panel** (`GraphDetailPanel.tsx` — evolved from `DetailPanel.tsx`)
- Horizontal layout at bottom (height: 180px, resizable via drag handle, collapses to 36px header-only)
- Sections: Node info | Features with criticality + pending suggestions (accept/dismiss) | Connections
- Actions: explore, mark as tested, add notes
- Responsive: on viewports < 768px, switches to right-side overlay panel

## Interaction Model

### Expand/Collapse
- **Expand button** (▾) on section/root nodes that have children
- **Alt+Click** on a node collapses its entire subtree (power-user shortcut)
- Clicking expand triggers position-interpolated layout transition:
  1. Save current positions: `previousPositions[nodeId] = { x, y }`
  2. Run ELK layout on the new visible graph (full relayout)
  3. Animate all nodes from `previousPositions` → new ELK positions via CSS `transition: transform 250ms ease-out`
  4. Anchor the clicked node at its current viewport position using `setCenter()` — siblings and children animate outward
- No additional animation library needed — CSS transitions on React Flow node `style.transform` are sufficient
- React Flow handles position updates automatically when node positions change in state

### Agent Exploration
- Unexplored nodes show an "explore →" button
- Clicking sends a WebSocket message to the server: `{ type: 'explore_node', nodeId: '...' }` (distinct from the existing `{ type: 'explore' }` which triggers full app exploration)
- Node transitions to `exploring` state (⟳ spinner, glowing border)
- As the agent discovers features, they animate into the graph via existing WebSocket real-time updates
- On completion, node transitions to `explored` (● solid)

### Tree ↔ Graph Sync
- Clicking a tree node centers the graph on that node and selects it
- Expanding/collapsing in the tree syncs with graph expand state (and vice versa)
- Both read from the same zustand store

### Mode Toggle
- Switching modes tells the Graph Projection Layer to emit a different node/edge set
- Navigation mode: nodes = pages, edges = navigation actions
- Capabilities mode: nodes = feature clusters, edges = dependencies
- The graph animates between layouts (nodes morph to new positions)

### Search
- Filters the tree and highlights matching nodes in the graph
- Enter jumps to first match and centers it
- Matches against node label, URL pattern, and feature names

## Layout Engine: ELK

Replace current BFS layout with ELK layered algorithm.

```ts
const elkOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.layered.spacing.edgeNodeBetweenLayers': '40',
  'elk.spacing.nodeNode': '60',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
}
```

Key properties:
- **Full relayout with position interpolation**: ELK does not have a native incremental/subtree-only mode. On expand/collapse, ELK relayouts the entire visible graph. To achieve smooth transitions: (1) save all current node positions before layout, (2) run ELK, (3) animate each node from its old position to its new position via CSS transitions (250ms ease-out), (4) anchor the expanded node using `setCenter()`. For graphs under 500 nodes, ELK layout takes < 50ms — the animation is the only perceivable change.
- **Compound nodes**: ELK natively handles parent-child node grouping via its `children` property
- **Stable ordering**: ELK's `NETWORK_SIMPLEX` node placement strategy preserves relative sibling order across relayouts

**Vite bundling strategy**: Use `elkjs/lib/elk.bundled.js` imported in a custom Web Worker via Vite's `new Worker(new URL('./elk-worker.ts', import.meta.url), { type: 'module' })` pattern. Do NOT use ELK's built-in worker mechanism as it conflicts with Vite's module resolution. The worker receives node/edge data, runs ELK layout, and returns computed positions.

## Cross-Links

Edges between features in different sections (e.g., Dashboard.Roles → Settings.Permissions).

- Rendered as **curved dashed lines** with `--accent` color
- Secondary to hierarchy — they should not dominate the layout
- ELK's layered algorithm handles these as "long edges" that span layers

**Visibility guardrails** to prevent visual clutter:
1. **Endpoint expansion rule**: cross-links only render when **both** source and target sections are expanded
2. **Maximum per node**: `maxCrossLinksPerNode = 3` — if a node has more, show the 3 highest-criticality cross-links and a "+N more" indicator in the detail panel
3. When a cross-link's endpoint is collapsed, the link is hidden entirely (not routed to the parent)

## Data Flow

### API Response (existing, extended)

```ts
// GET /api/agents/:id/map?mode=navigation|capabilities
{
  nodes: AppMapNode[]
  edges: AppMapEdge[]
  capabilityClusters?: CapabilityCluster[]  // only in capabilities mode
  explorationStatus: {
    explored: number
    unexplored: number
    exploring: number
    total: number
  }
}
```

### Capability Cluster (new)

```ts
type CapabilityCluster = {
  id: string
  name: string              // e.g., "User Management"
  sourcePageIds: string[]   // pages this cluster is derived from
  features: Feature[]
  dependencies: string[]    // other cluster IDs this depends on
}
```

### Server Changes

- Extend `buildAppMapResponse()` in `routes/map.ts` to accept a `mode` query param
- Add `buildCapabilityGraph()` in `nav-graph.ts` that groups features by logical domain
- As the function grows, extract to a separate `capability-graph.ts` module

**Initial capability clustering algorithm (Phase 4):**
1. Group pages by first URL path segment (e.g., `/admin/users`, `/admin/users/:id` → group `admin/users`)
2. **Cluster split rule**: if a cluster contains > 6 pages, split by second path segment (e.g., `/settings/security`, `/settings/billing`, `/settings/team` → three sub-clusters instead of one mega "Settings" cluster)
3. For each group, merge all `memory_features` from the member pages
4. Cluster name is derived from the shared path segment, title-cased (e.g., `admin/users` → "User Management" — use `pageTitle` of the root page in the group if available)
5. Dependencies between clusters are inferred from cross-page `nav_edges` that connect pages in different clusters

This simple URL-prefix clustering can evolve to AI-driven clustering later (out of scope).

## Real-Time Updates

Existing WebSocket mechanism stays. New events:

| Event | Trigger | Effect |
|-------|---------|--------|
| `node:discovered` | Agent visits new page | New node animates into graph |
| `node:exploring` | Agent starts exploring a section | Node state.exploration → `exploring` |
| `node:explored` | Agent finishes a section | Node state.exploration → `explored`, features populate |
| `feature:discovered` | Agent finds new feature | Feature appears in expanded node + detail panel |

**Event versioning**: All graph update events include a monotonically increasing `version: number` field. The client tracks `lastProcessedVersion` and ignores events with `version <= lastProcessedVersion`. This prevents race conditions during heavy exploration when events may arrive out of order.

```ts
type GraphEvent = {
  type: 'node:discovered' | 'node:exploring' | 'node:explored' | 'feature:discovered'
  version: number
  payload: Record<string, unknown>
}
```

## Performance

| Node Count | Strategy |
|------------|----------|
| < 200 | Progressive expansion keeps visible nodes manageable |
| 200-500 | ELK handles layout; React Flow viewport culling handles rendering |
| 500-1500 | Add node virtualization (React Flow supports this) |
| 1500+ | Progressive node hydration: load graph skeleton first, hydrate metadata on expand |

**Visible node guardrail**: `MAX_VISIBLE_NODES = 300`. If the visible node count exceeds this threshold after an expand, auto-collapse the most distant expanded sections (furthest from the currently selected node) until under the limit. Show a toast: "Some distant sections were collapsed to keep the graph responsive."

**Progressive node hydration** (for large graphs): Initial graph load returns only node IDs, labels, and parent relationships (the skeleton). Full metadata (features, criticality, pendingSuggestions, connections) is loaded on demand when a node is expanded or selected. This keeps the initial load fast and memory usage low.

**Node memoization**: All custom node components (`RootNode`, `SectionNode`, `FeatureNode`) are wrapped with `React.memo()` to prevent unnecessary re-renders during pan/zoom and unrelated state changes.

Progressive expansion is the primary scaling strategy — users rarely need to see more than 50-100 nodes at once.

## Phased Rollout

### Phase 1: Layout Engine Swap (ELK)
- Replace BFS layout with ELK layered algorithm
- No UI changes — same visual output, better layout quality
- Add ELK Web Worker with Vite-compatible bundling (see Layout Engine section)
- Verify layout parity: existing graph should look the same or better after swap
- **Risk:** Medium — replaces entire layout algorithm; requires Vite Web Worker integration testing

### Phase 2: Expand / Collapse
- Build custom `useExpandCollapse` hook (this is NOT a React Flow built-in — it is a custom hook we author). Responsibilities: read `expandedNodeIds` from zustand store, filter the full node array to only visible nodes (a node is visible if all its ancestors are in `expandedNodeIds`), compute hidden edges for collapsed subtrees
- Implement `expandedNodeIds` state in zustand store
- Filter visible nodes based on expansion state
- CSS transition animation on expand (250ms `ease-out` on `transform`)
- Introduce zustand store (GraphStore.ts) in this phase
- **Risk:** Low

### Phase 3: Tree Navigation Panel
- Add `GraphTreePanel` component (left sidebar, 220px)
- Sync tree expand state with graph expand state via zustand
- Click tree node → center graph + select
- Add Agent Activity section
- **Risk:** Low

### Phase 4: Canonical Graph Model + Projection Layer + Mode Toggle
- Introduce Canonical Graph Model (`CanonicalGraph.ts`) as the internal representation
- Introduce Graph Projection Layer between canonical model and store
- Implement `buildCapabilityGraph()` on server (with cluster split rule for > 6 pages)
- Add Navigation/Capabilities toggle in toolbar
- Animate transition between modes using position interpolation
- **Risk:** Medium — requires server-side capability clustering logic

### Phase 5: Exploration Status + Agent Triggers
- Implement `NodeState` model (`exploration` + `validation` fields)
- Add node status indicators (●/○/⟳/⚠) driven by `state.exploration`
- "Explore →" button on unexplored nodes
- WebSocket message (`explore_node`) to trigger agent exploration
- Real-time status transitions with event versioning
- **Risk:** Low

### Phase 6: Cross-Links + Search
- Render cross-section edges as curved dashed lines with visibility guardrails (both endpoints expanded, max 3 per node)
- Add ⌘K search with node/feature matching
- Search highlights in tree + graph
- Add Alt+Click subtree collapse shortcut
- **Risk:** Medium — cross-link layout can affect visual clarity

## Files Affected

### New Files
- `client/src/components/AppMap/GraphStore.ts` — zustand store
- `client/src/components/AppMap/CanonicalGraph.ts` — GraphEntity + GraphRelation types and builder from API data
- `client/src/components/AppMap/GraphProjectionLayer.ts` — projects canonical model into navigation/capability views
- `client/src/components/AppMap/GraphToolbar.tsx` — search + filters + mode toggle
- `client/src/components/AppMap/GraphTreePanel.tsx` — left tree navigator
- `client/src/components/AppMap/useExpandCollapse.ts` — expand/collapse hook
- `client/src/components/AppMap/useELKLayout.ts` — ELK layout hook (Web Worker)
- `client/src/components/AppMap/nodes/RootNode.tsx` — root node component
- `client/src/components/AppMap/nodes/SectionNode.tsx` — section node component
- `client/src/components/AppMap/nodes/FeatureNode.tsx` — feature node component

### Modified Files
- `client/src/components/AppMap/AppMap.tsx` — integrate store, ELK, tree panel
- `client/src/components/AppMap/AppMap.css` — new component styles
- `client/src/components/AppMap/useAppMap.ts` — feed data into Canonical Graph → Projection Layer instead of directly to React Flow
- `server/src/routes/map.ts` — add `mode` param, capability clustering
- `server/src/nav-graph.ts` — add `buildCapabilityGraph()`

### Removed/Replaced
- `client/src/components/AppMap/DetailPanel.tsx` → replaced by `GraphDetailPanel.tsx`
- BFS layout logic in `AppMap.tsx` → replaced by ELK

## Dependencies

### New
- `elkjs` — ELK layout engine (~200KB, runs in Web Worker)
- `zustand` — lightweight state management (~2KB)

### Existing (kept)
- `@xyflow/react` v12 — graph renderer

## Accessibility

- Tree panel uses `role="tree"` and `role="treeitem"` with `aria-expanded` attributes
- Status indicators (●/○/⟳/⚠) have `aria-label` attributes (e.g., `aria-label="explored"`, `aria-label="exploring"`)
- ⌘K search is accessible via keyboard; focus trap within search when open
- Expand/collapse buttons have `aria-label="Expand Dashboard"` / `aria-label="Collapse Dashboard"`
- Graph canvas: React Flow provides built-in keyboard navigation (arrow keys for pan, +/- for zoom)
- Focus moves to newly expanded children after expand animation completes

## Out of Scope (Future)

- AI-driven capability clustering (Phase 4 starts with page-based grouping)
- **Workflow graph** — a third projection of the canonical model: Pages → Actions → Workflows (e.g., "Create User → Assign Role → Send Invite"). Derived from navigation edges, feature events, and agent interaction traces. Enables automated workflow discovery, test generation, and AI automation. The canonical graph model is designed to support this without architectural changes.
- DOM selector / screenshot annotations on nodes
- API call tracking per feature
- Time-travel exploration replay
- Node `state.validation` workflows (mark as tested/verified) — the field exists in `NodeState` but UI for it is deferred
