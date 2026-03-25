# Hybrid Explorer Graph Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the App Graph into a Hybrid Explorer with tree navigator, expandable graph canvas, and detail panel — powered by ELK layout, zustand state, and a canonical graph model.

**Architecture:** Raw API data flows through a Canonical Graph Model (GraphEntity + GraphRelation) into a Graph Projection Layer that emits navigation or capability views as AppNode[]/AppEdge[]. A zustand store owns UI state (expansion, selection, mode). ELK computes layout in a Web Worker. React Flow renders memoized custom nodes.

**Tech Stack:** React 19, TypeScript, @xyflow/react v12, elkjs, zustand, Vite, vitest

**Spec:** `docs/superpowers/specs/2026-03-16-hybrid-explorer-graph-design.md`

---

## File Structure

All paths are relative to `browser-agent-chat/`.

### New Files (Client)

| File | Responsibility |
|------|---------------|
| `client/src/components/AppMap/types.ts` | All graph types: `GraphEntity`, `GraphRelation`, `AppNode`, `AppEdge`, `NodeState` |
| `client/src/components/AppMap/CanonicalGraph.ts` | Builds canonical model from API response |
| `client/src/components/AppMap/GraphProjectionLayer.ts` | Projects canonical model → navigation or capability AppNode[]/AppEdge[] |
| `client/src/components/AppMap/GraphStore.ts` | Zustand store: nodes, edges, expandedNodeIds, selectedNodeId, mode, search |
| `client/src/components/AppMap/useExpandCollapse.ts` | Custom hook: filters visible nodes based on expansion state |
| `client/src/components/AppMap/useELKLayout.ts` | Hook wrapping ELK Web Worker for layout computation |
| `client/src/components/AppMap/elk-worker.ts` | Web Worker: receives node/edge data, runs ELK, returns positions |
| `client/src/components/AppMap/nodes/RootNode.tsx` | Root-level node component (200px, brand border) |
| `client/src/components/AppMap/nodes/SectionNode.tsx` | Section-level node with expand/collapse button (160px) |
| `client/src/components/AppMap/nodes/FeatureNode.tsx` | Feature-level leaf node (130px) |
| `client/src/components/AppMap/GraphToolbar.tsx` | Top bar: search, filters, mode toggle |
| `client/src/components/AppMap/GraphTreePanel.tsx` | Left tree navigator with agent activity |
| `client/src/components/AppMap/GraphDetailPanel.tsx` | Bottom detail panel (replaces DetailPanel.tsx) |

### New Files (Client Tests)

| File | Tests |
|------|-------|
| `client/src/components/AppMap/__tests__/CanonicalGraph.test.ts` | Canonical model builder |
| `client/src/components/AppMap/__tests__/GraphProjectionLayer.test.ts` | Navigation + capability projections |
| `client/src/components/AppMap/__tests__/GraphStore.test.ts` | Store actions and state transitions |
| `client/src/components/AppMap/__tests__/useExpandCollapse.test.ts` | Visibility filtering logic |

### New Files (Server)

| File | Responsibility |
|------|---------------|
| `server/src/capability-graph.ts` | `buildCapabilityGraph()` — URL-prefix clustering with split rule |

### New Files (Server Tests)

| File | Tests |
|------|-------|
| `server/__tests__/capability-graph.test.ts` | Clustering algorithm, split rule, dependency inference |

### Modified Files

| File | Changes |
|------|---------|
| `client/src/components/AppMap/AppMap.tsx` | Replace BFS layout with ELK, integrate store, add tree panel + toolbar |
| `client/src/components/AppMap/AppMap.css` | Styles for new components (tree, toolbar, detail panel, node types) |
| `client/src/components/AppMap/useAppMap.ts` | Feed data into CanonicalGraph builder instead of directly to state |
| `client/package.json` | Add `elkjs`, `zustand` |
| `server/src/routes/map.ts` | Accept `mode` query param, add `explorationStatus` to response |
| `server/src/nav-graph.ts` | Export types needed by capability-graph.ts |
| `server/src/types.ts` | Add `explore_node` WebSocket message type |

### Removed Files

| File | Replaced By |
|------|-------------|
| `client/src/components/AppMap/DetailPanel.tsx` | `GraphDetailPanel.tsx` |
| `client/src/components/AppMap/PageNode.tsx` | `nodes/RootNode.tsx`, `nodes/SectionNode.tsx`, `nodes/FeatureNode.tsx` |

---

## Chunk 0: Prerequisites

### Task 0: Configure vitest for client

**Files:**
- Modify: `client/vite.config.ts`

The client has vitest in devDependencies but may not have the test configuration wired up. Before writing any client tests, ensure vitest is configured.

- [ ] **Step 1: Add vitest config to vite.config.ts**

Add `/// <reference types="vitest" />` at the top and a `test` block:
```ts
/// <reference types="vitest" />
// ... existing config ...
export default defineConfig({
  // ... existing ...
  test: {
    globals: true,
    environment: 'node',
  },
})
```

- [ ] **Step 2: Verify vitest works**

```bash
cd browser-agent-chat/client && npx vitest run --passWithNoTests
```

Expected: `No test files found` or 0 tests pass — no errors

- [ ] **Step 3: Commit**

```bash
cd browser-agent-chat && git add client/vite.config.ts && git commit -m "chore: configure vitest for client"
```

---

## Chunk 1: Foundation — Types, Canonical Model, Store (Phase 1-2 prep)

### Task 1: Install dependencies

**Files:**
- Modify: `client/package.json`

- [ ] **Step 1: Install elkjs and zustand**

```bash
cd browser-agent-chat && npm install --workspace=client elkjs zustand
```

- [ ] **Step 2: Verify installation**

```bash
cd browser-agent-chat && node -e "require('elkjs'); require('zustand'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd browser-agent-chat && git add client/package.json package-lock.json && git commit -m "chore: add elkjs and zustand dependencies"
```

---

### Task 2: Define graph types

**Files:**
- Create: `client/src/components/AppMap/types.ts`

- [ ] **Step 1: Write type definitions**

```ts
// client/src/components/AppMap/types.ts

// --- Canonical Graph Model (internal representation) ---

export type GraphEntity = {
  readonly id: string
  readonly kind: 'page' | 'feature' | 'cluster'
  readonly sourceIds?: readonly string[]
  readonly metadata: Readonly<Record<string, unknown>>
}

export type GraphRelation = {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly type: 'navigation' | 'dependency' | 'cross-link'
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type CanonicalGraph = {
  readonly entities: readonly GraphEntity[]
  readonly relations: readonly GraphRelation[]
}

// --- Projected Graph (UI-ready) ---

export type NodeState = {
  readonly exploration: 'unknown' | 'exploring' | 'explored' | 'failed'
  readonly validation: 'untested' | 'tested' | 'verified'
}

export type AppNode = {
  readonly id: string
  readonly type: 'root' | 'section' | 'feature'
  readonly label: string
  readonly urlPattern?: string
  readonly parent?: string
  readonly state: NodeState
  readonly featureCount?: number
  readonly criticality?: 'critical' | 'high' | 'medium' | 'low'
  readonly childIds: readonly string[]
  readonly pendingSuggestions?: readonly unknown[]
}

export type AppEdge = {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly type: 'navigation' | 'dependency' | 'cross-link'
  readonly label?: string
}

export const DEFAULT_NODE_STATE: NodeState = {
  exploration: 'unknown',
  validation: 'untested',
} as const

export const MAX_VISIBLE_NODES = 300
export const MAX_CROSS_LINKS_PER_NODE = 3
```

- [ ] **Step 2: Verify types compile**

```bash
cd browser-agent-chat/client && npx tsc --noEmit
```

Expected: No new errors (pre-existing errors are acceptable)

- [ ] **Step 3: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/types.ts && git commit -m "feat(graph): add canonical graph and projected node/edge types"
```

---

### Task 3: Build canonical graph from API response

**Files:**
- Create: `client/src/components/AppMap/__tests__/CanonicalGraph.test.ts`
- Create: `client/src/components/AppMap/CanonicalGraph.ts`

- [ ] **Step 1: Write failing tests**

```ts
// client/src/components/AppMap/__tests__/CanonicalGraph.test.ts
import { describe, it, expect } from 'vitest'
import { buildCanonicalGraph } from '../CanonicalGraph'

const API_RESPONSE = {
  nodes: [
    {
      id: 'n1', urlPattern: '/login', pageTitle: 'Login',
      firstSeenAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-01T00:00:00Z',
      features: [
        { id: 'f1', name: 'Auth Form', description: 'Login form', criticality: 'critical', expected_behaviors: [] }
      ],
      pendingSuggestions: [],
    },
    {
      id: 'n2', urlPattern: '/dashboard', pageTitle: 'Dashboard',
      firstSeenAt: '2026-01-01T00:01:00Z', lastSeenAt: '2026-01-01T00:01:00Z',
      features: [],
      pendingSuggestions: [{ id: 's1', type: 'feature', status: 'pending', data: {}, agent_id: 'a1', source_session: null, created_at: '', resolved_at: null }],
    },
  ],
  edges: [
    { id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', actionLabel: 'submit form' },
  ],
  unlinkedSuggestions: [],
}

describe('buildCanonicalGraph', () => {
  it('creates page entities from API nodes', () => {
    const graph = buildCanonicalGraph(API_RESPONSE)
    const pages = graph.entities.filter(e => e.kind === 'page')
    expect(pages).toHaveLength(2)
    expect(pages[0].metadata).toMatchObject({ urlPattern: '/login', pageTitle: 'Login' })
  })

  it('creates feature entities from node features', () => {
    const graph = buildCanonicalGraph(API_RESPONSE)
    const features = graph.entities.filter(e => e.kind === 'feature')
    expect(features).toHaveLength(1)
    expect(features[0].metadata).toMatchObject({ name: 'Auth Form', criticality: 'critical' })
  })

  it('creates navigation relations from API edges', () => {
    const graph = buildCanonicalGraph(API_RESPONSE)
    const navRelations = graph.relations.filter(r => r.type === 'navigation')
    expect(navRelations).toHaveLength(1)
    expect(navRelations[0]).toMatchObject({ from: 'n1', to: 'n2' })
    expect(navRelations[0].metadata).toMatchObject({ actionLabel: 'submit form' })
  })

  it('preserves pending suggestions in page metadata', () => {
    const graph = buildCanonicalGraph(API_RESPONSE)
    const dashboard = graph.entities.find(e => e.id === 'n2')
    expect((dashboard?.metadata.pendingSuggestions as unknown[])?.length).toBe(1)
  })

  it('returns empty graph for empty API response', () => {
    const graph = buildCanonicalGraph({ nodes: [], edges: [], unlinkedSuggestions: [] })
    expect(graph.entities).toHaveLength(0)
    expect(graph.relations).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd browser-agent-chat/client && npx vitest run src/components/AppMap/__tests__/CanonicalGraph.test.ts
```

Expected: FAIL — `buildCanonicalGraph` not found

- [ ] **Step 3: Implement buildCanonicalGraph**

```ts
// client/src/components/AppMap/CanonicalGraph.ts
import type { CanonicalGraph, GraphEntity, GraphRelation } from './types'
import type { MapNode, MapEdge } from './useAppMap'

interface ApiResponse {
  readonly nodes: readonly MapNode[]
  readonly edges: readonly MapEdge[]
  readonly unlinkedSuggestions: readonly unknown[]
}

export function buildCanonicalGraph(api: ApiResponse): CanonicalGraph {
  const entities: GraphEntity[] = []
  const relations: GraphRelation[] = []

  // Create page entities
  for (const node of api.nodes) {
    entities.push({
      id: node.id,
      kind: 'page',
      metadata: {
        urlPattern: node.urlPattern,
        pageTitle: node.pageTitle,
        firstSeenAt: node.firstSeenAt,
        lastSeenAt: node.lastSeenAt,
        pendingSuggestions: node.pendingSuggestions,
      },
    })

    // Create feature entities for each feature on this page
    for (const feature of node.features) {
      entities.push({
        id: feature.id,
        kind: 'feature',
        sourceIds: [node.id],
        metadata: {
          name: feature.name,
          description: feature.description,
          criticality: feature.criticality,
          expected_behaviors: feature.expected_behaviors,
          flows: feature.flows,
          pageId: node.id,
        },
      })
    }
  }

  // Create navigation relations
  for (const edge of api.edges) {
    relations.push({
      id: edge.id,
      from: edge.fromNodeId,
      to: edge.toNodeId,
      type: 'navigation',
      metadata: { actionLabel: edge.actionLabel },
    })
  }

  return { entities, relations }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd browser-agent-chat/client && npx vitest run src/components/AppMap/__tests__/CanonicalGraph.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/CanonicalGraph.ts client/src/components/AppMap/__tests__/CanonicalGraph.test.ts && git commit -m "feat(graph): canonical graph model builder with tests"
```

---

### Task 4: Graph Projection Layer — navigation projection

**Files:**
- Create: `client/src/components/AppMap/__tests__/GraphProjectionLayer.test.ts`
- Create: `client/src/components/AppMap/GraphProjectionLayer.ts`

- [ ] **Step 1: Write failing tests for navigation projection**

```ts
// client/src/components/AppMap/__tests__/GraphProjectionLayer.test.ts
import { describe, it, expect } from 'vitest'
import { projectNavigation } from '../GraphProjectionLayer'
import type { CanonicalGraph } from '../types'

const CANONICAL: CanonicalGraph = {
  entities: [
    { id: 'n1', kind: 'page', metadata: { urlPattern: '/login', pageTitle: 'Login', firstSeenAt: '2026-01-01T00:00:00Z', pendingSuggestions: [] } },
    { id: 'n2', kind: 'page', metadata: { urlPattern: '/dashboard', pageTitle: 'Dashboard', firstSeenAt: '2026-01-01T00:01:00Z', pendingSuggestions: [] } },
    { id: 'n3', kind: 'page', metadata: { urlPattern: '/users', pageTitle: 'Users', firstSeenAt: '2026-01-01T00:02:00Z', pendingSuggestions: [] } },
    { id: 'f1', kind: 'feature', sourceIds: ['n2'], metadata: { name: 'Charts', criticality: 'high', pageId: 'n2' } },
    { id: 'f2', kind: 'feature', sourceIds: ['n2'], metadata: { name: 'Activity', criticality: 'medium', pageId: 'n2' } },
  ],
  relations: [
    { id: 'e1', from: 'n1', to: 'n2', type: 'navigation', metadata: { actionLabel: 'submit form' } },
    { id: 'e2', from: 'n2', to: 'n3', type: 'navigation', metadata: { actionLabel: 'click sidebar' } },
  ],
}

describe('projectNavigation', () => {
  it('identifies root as earliest page by firstSeenAt', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const root = nodes.find(n => n.type === 'root')
    expect(root?.id).toBe('n1')
  })

  it('assigns section type to depth-1 pages', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const dashboard = nodes.find(n => n.id === 'n2')
    expect(dashboard?.type).toBe('section')
  })

  it('computes childIds from navigation edges', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const root = nodes.find(n => n.id === 'n1')
    expect(root?.childIds).toContain('n2')
  })

  it('counts features per page', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const dashboard = nodes.find(n => n.id === 'n2')
    expect(dashboard?.featureCount).toBe(2)
  })

  it('computes highest criticality from features', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const dashboard = nodes.find(n => n.id === 'n2')
    expect(dashboard?.criticality).toBe('high')
  })

  it('sets exploration state based on feature presence', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const login = nodes.find(n => n.id === 'n1')
    const dashboard = nodes.find(n => n.id === 'n2')
    expect(login?.state.exploration).toBe('unknown')
    expect(dashboard?.state.exploration).toBe('explored')
  })

  it('creates navigation edges', () => {
    const { edges } = projectNavigation(CANONICAL)
    expect(edges).toHaveLength(2)
    expect(edges[0]).toMatchObject({ source: 'n1', target: 'n2', type: 'navigation' })
  })

  it('sets parent for child nodes', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const dashboard = nodes.find(n => n.id === 'n2')
    expect(dashboard?.parent).toBe('n1')
  })

  it('sets exploring state when currentUrl matches', () => {
    const { nodes } = projectNavigation(CANONICAL, '/users')
    const users = nodes.find(n => n.id === 'n3')
    expect(users?.state.exploration).toBe('exploring')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd browser-agent-chat/client && npx vitest run src/components/AppMap/__tests__/GraphProjectionLayer.test.ts
```

Expected: FAIL — `projectNavigation` not found

- [ ] **Step 3: Implement projectNavigation**

```ts
// client/src/components/AppMap/GraphProjectionLayer.ts
import type { CanonicalGraph, AppNode, AppEdge, NodeState, GraphEntity } from './types'
import { DEFAULT_NODE_STATE } from './types'

const CRITICALITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

function getHighestCriticality(features: readonly GraphEntity[]): AppNode['criticality'] {
  if (features.length === 0) return undefined
  let highest = 'low'
  for (const f of features) {
    const crit = f.metadata.criticality as string
    if ((CRITICALITY_ORDER[crit] ?? 3) < (CRITICALITY_ORDER[highest] ?? 3)) {
      highest = crit
    }
  }
  return highest as AppNode['criticality']
}

export function projectNavigation(
  canonical: CanonicalGraph,
  currentUrl?: string,
): { nodes: AppNode[]; edges: AppEdge[] } {
  const pages = canonical.entities.filter(e => e.kind === 'page')
  const features = canonical.entities.filter(e => e.kind === 'feature')
  const navRelations = canonical.relations.filter(r => r.type === 'navigation')

  if (pages.length === 0) return { nodes: [], edges: [] }

  // Sort pages by firstSeenAt to find root
  const sorted = [...pages].sort((a, b) => {
    const aTime = new Date(a.metadata.firstSeenAt as string).getTime()
    const bTime = new Date(b.metadata.firstSeenAt as string).getTime()
    return aTime - bTime
  })
  const rootId = sorted[0].id

  // Build adjacency list from nav relations
  const childMap = new Map<string, string[]>()
  const parentMap = new Map<string, string>()
  for (const rel of navRelations) {
    const children = childMap.get(rel.from) ?? []
    childMap.set(rel.from, [...children, rel.to])
    if (!parentMap.has(rel.to)) {
      parentMap.set(rel.to, rel.from)
    }
  }

  // BFS to compute depth
  const depth = new Map<string, number>()
  const queue = [rootId]
  depth.set(rootId, 0)
  while (queue.length > 0) {
    const current = queue.shift()!
    const d = depth.get(current)!
    for (const child of childMap.get(current) ?? []) {
      if (!depth.has(child)) {
        depth.set(child, d + 1)
        queue.push(child)
      }
    }
  }

  // Group features by pageId
  const featuresByPage = new Map<string, GraphEntity[]>()
  for (const f of features) {
    const pageId = f.metadata.pageId as string
    const list = featuresByPage.get(pageId) ?? []
    featuresByPage.set(pageId, [...list, f])
  }

  // Build AppNodes
  const nodes: AppNode[] = pages.map(page => {
    const pageFeatures = featuresByPage.get(page.id) ?? []
    const d = depth.get(page.id)
    const isExploring = currentUrl !== undefined &&
      (page.metadata.urlPattern as string) === currentUrl

    let explorationState: NodeState['exploration'] = 'unknown'
    if (isExploring) {
      explorationState = 'exploring'
    } else if (pageFeatures.length > 0) {
      explorationState = 'explored'
    }

    let nodeType: AppNode['type']
    if (page.id === rootId) {
      nodeType = 'root'
    } else if (d === 1) {
      nodeType = 'section'
    } else {
      nodeType = 'feature'
    }

    return {
      id: page.id,
      type: nodeType,
      label: (page.metadata.pageTitle as string) || (page.metadata.urlPattern as string),
      urlPattern: page.metadata.urlPattern as string,
      parent: parentMap.get(page.id),
      state: {
        ...DEFAULT_NODE_STATE,
        exploration: explorationState,
      },
      featureCount: pageFeatures.length,
      criticality: getHighestCriticality(pageFeatures),
      childIds: childMap.get(page.id) ?? [],
      pendingSuggestions: page.metadata.pendingSuggestions as unknown[] ?? [],
    }
  })

  // Build AppEdges
  const edges: AppEdge[] = navRelations.map(rel => ({
    id: rel.id,
    source: rel.from,
    target: rel.to,
    type: 'navigation' as const,
    label: rel.metadata?.actionLabel as string,
  }))

  return { nodes, edges }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd browser-agent-chat/client && npx vitest run src/components/AppMap/__tests__/GraphProjectionLayer.test.ts
```

Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/GraphProjectionLayer.ts client/src/components/AppMap/__tests__/GraphProjectionLayer.test.ts && git commit -m "feat(graph): navigation projection layer with tests"
```

---

### Task 5: Zustand Graph Store

**Files:**
- Create: `client/src/components/AppMap/__tests__/GraphStore.test.ts`
- Create: `client/src/components/AppMap/GraphStore.ts`

- [ ] **Step 1: Write failing tests**

```ts
// client/src/components/AppMap/__tests__/GraphStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphStore } from '../GraphStore'
import type { AppNode } from '../types'

const MOCK_NODE: AppNode = {
  id: 'n1', type: 'section', label: 'Dashboard',
  state: { exploration: 'explored', validation: 'untested' },
  childIds: ['n2', 'n3'],
}

describe('useGraphStore', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [MOCK_NODE],
      edges: [],
      expandedNodeIds: new Set<string>(),
      selectedNodeId: null,
      mode: 'navigation',
      searchQuery: '',
      lastEventVersion: 0,
    })
  })

  it('initializes with empty state', () => {
    const state = useGraphStore.getState()
    expect(state.expandedNodeIds.size).toBe(0)
    expect(state.selectedNodeId).toBeNull()
    expect(state.mode).toBe('navigation')
  })

  it('toggleExpand adds nodeId to expandedNodeIds', () => {
    useGraphStore.getState().toggleExpand('n1')
    expect(useGraphStore.getState().expandedNodeIds.has('n1')).toBe(true)
  })

  it('toggleExpand removes nodeId if already expanded', () => {
    useGraphStore.getState().toggleExpand('n1')
    useGraphStore.getState().toggleExpand('n1')
    expect(useGraphStore.getState().expandedNodeIds.has('n1')).toBe(false)
  })

  it('selectNode sets selectedNodeId', () => {
    useGraphStore.getState().selectNode('n1')
    expect(useGraphStore.getState().selectedNodeId).toBe('n1')
  })

  it('selectNode with same id deselects', () => {
    useGraphStore.getState().selectNode('n1')
    useGraphStore.getState().selectNode('n1')
    expect(useGraphStore.getState().selectedNodeId).toBeNull()
  })

  it('setMode changes mode', () => {
    useGraphStore.getState().setMode('capabilities')
    expect(useGraphStore.getState().mode).toBe('capabilities')
  })

  it('setSearchQuery updates query', () => {
    useGraphStore.getState().setSearchQuery('users')
    expect(useGraphStore.getState().searchQuery).toBe('users')
  })

  it('processEvent ignores stale versions', () => {
    useGraphStore.setState({ lastEventVersion: 10 })
    useGraphStore.getState().processEvent({ type: 'node:discovered', version: 5, payload: {} })
    expect(useGraphStore.getState().lastEventVersion).toBe(10)
  })

  it('processEvent accepts newer versions', () => {
    useGraphStore.setState({ lastEventVersion: 5 })
    useGraphStore.getState().processEvent({ type: 'node:discovered', version: 10, payload: {} })
    expect(useGraphStore.getState().lastEventVersion).toBe(10)
  })

  it('setGraph replaces nodes and edges', () => {
    const newNode = { ...MOCK_NODE, id: 'n2', label: 'Users' }
    useGraphStore.getState().setGraph([newNode], [])
    expect(useGraphStore.getState().nodes).toHaveLength(1)
    expect(useGraphStore.getState().nodes[0].id).toBe('n2')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd browser-agent-chat/client && npx vitest run src/components/AppMap/__tests__/GraphStore.test.ts
```

Expected: FAIL — `useGraphStore` not found

- [ ] **Step 3: Implement GraphStore**

```ts
// client/src/components/AppMap/GraphStore.ts
import { create } from 'zustand'
import type { AppNode, AppEdge } from './types'

type GraphEvent = {
  readonly type: string
  readonly version: number
  readonly payload: Record<string, unknown>
}

type GraphStoreState = {
  // Data
  nodes: readonly AppNode[]
  edges: readonly AppEdge[]

  // UI State
  expandedNodeIds: Set<string>
  selectedNodeId: string | null
  mode: 'navigation' | 'capabilities'
  searchQuery: string
  lastEventVersion: number
}

type GraphStoreActions = {
  setGraph: (nodes: readonly AppNode[], edges: readonly AppEdge[]) => void
  toggleExpand: (nodeId: string) => void
  selectNode: (nodeId: string) => void
  setMode: (mode: 'navigation' | 'capabilities') => void
  setSearchQuery: (query: string) => void
  processEvent: (event: GraphEvent) => void
}

export const useGraphStore = create<GraphStoreState & GraphStoreActions>((set, get) => ({
  // Initial state
  nodes: [],
  edges: [],
  expandedNodeIds: new Set<string>(),
  selectedNodeId: null,
  mode: 'navigation',
  searchQuery: '',
  lastEventVersion: 0,

  // Actions
  setGraph: (nodes, edges) => set({ nodes, edges }),

  toggleExpand: (nodeId) => set(state => {
    const next = new Set(state.expandedNodeIds)
    if (next.has(nodeId)) {
      next.delete(nodeId)
    } else {
      next.add(nodeId)
    }
    return { expandedNodeIds: next }
  }),

  selectNode: (nodeId) => set(state => ({
    selectedNodeId: state.selectedNodeId === nodeId ? null : nodeId,
  })),

  setMode: (mode) => set({ mode }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  processEvent: (event) => {
    const { lastEventVersion } = get()
    if (event.version <= lastEventVersion) return
    set({ lastEventVersion: event.version })
  },
}))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd browser-agent-chat/client && npx vitest run src/components/AppMap/__tests__/GraphStore.test.ts
```

Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/GraphStore.ts client/src/components/AppMap/__tests__/GraphStore.test.ts && git commit -m "feat(graph): zustand graph store with event versioning"
```

---

### Task 6: useExpandCollapse hook

**Files:**
- Create: `client/src/components/AppMap/__tests__/useExpandCollapse.test.ts`
- Create: `client/src/components/AppMap/useExpandCollapse.ts`

- [ ] **Step 1: Write failing tests**

```ts
// client/src/components/AppMap/__tests__/useExpandCollapse.test.ts
import { describe, it, expect } from 'vitest'
import { filterVisibleNodes, filterVisibleEdges } from '../useExpandCollapse'
import type { AppNode, AppEdge } from '../types'

const NODES: AppNode[] = [
  { id: 'root', type: 'root', label: 'Login', state: { exploration: 'explored', validation: 'untested' }, childIds: ['s1', 's2'] },
  { id: 's1', type: 'section', label: 'Dashboard', parent: 'root', state: { exploration: 'explored', validation: 'untested' }, childIds: ['f1', 'f2'] },
  { id: 's2', type: 'section', label: 'Users', parent: 'root', state: { exploration: 'unknown', validation: 'untested' }, childIds: [] },
  { id: 'f1', type: 'feature', label: 'Charts', parent: 's1', state: { exploration: 'explored', validation: 'untested' }, childIds: [] },
  { id: 'f2', type: 'feature', label: 'Activity', parent: 's1', state: { exploration: 'explored', validation: 'untested' }, childIds: [] },
]

const EDGES: AppEdge[] = [
  { id: 'e1', source: 'root', target: 's1', type: 'navigation', label: 'submit' },
  { id: 'e2', source: 'root', target: 's2', type: 'navigation', label: 'click' },
  { id: 'e3', source: 's1', target: 'f1', type: 'navigation' },
  { id: 'e4', source: 's1', target: 'f2', type: 'navigation' },
]

describe('filterVisibleNodes', () => {
  it('shows only root when nothing is expanded', () => {
    const visible = filterVisibleNodes(NODES, new Set())
    expect(visible.map(n => n.id)).toEqual(['root'])
  })

  it('shows root + children when root is expanded', () => {
    const visible = filterVisibleNodes(NODES, new Set(['root']))
    expect(visible.map(n => n.id)).toEqual(['root', 's1', 's2'])
  })

  it('shows grandchildren when both root and section are expanded', () => {
    const visible = filterVisibleNodes(NODES, new Set(['root', 's1']))
    expect(visible.map(n => n.id)).toEqual(['root', 's1', 's2', 'f1', 'f2'])
  })

  it('root is always visible even with empty expandedIds', () => {
    const visible = filterVisibleNodes(NODES, new Set())
    expect(visible.some(n => n.id === 'root')).toBe(true)
  })
})

describe('filterVisibleEdges', () => {
  it('only includes edges where both endpoints are visible', () => {
    const visibleIds = new Set(['root', 's1', 's2'])
    const visible = filterVisibleEdges(EDGES, visibleIds)
    expect(visible.map(e => e.id)).toEqual(['e1', 'e2'])
  })

  it('returns empty for no visible nodes', () => {
    const visible = filterVisibleEdges(EDGES, new Set(['root']))
    expect(visible).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd browser-agent-chat/client && npx vitest run src/components/AppMap/__tests__/useExpandCollapse.test.ts
```

Expected: FAIL — `filterVisibleNodes` not found

- [ ] **Step 3: Implement useExpandCollapse**

```ts
// client/src/components/AppMap/useExpandCollapse.ts
import { useMemo } from 'react'
import { useGraphStore } from './GraphStore'
import type { AppNode, AppEdge } from './types'
import { MAX_VISIBLE_NODES } from './types'

/**
 * A node is visible if:
 * 1. It has no parent (root), OR
 * 2. All its ancestors are in expandedNodeIds
 */
export function filterVisibleNodes(
  nodes: readonly AppNode[],
  expandedNodeIds: Set<string>,
): AppNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  function isVisible(node: AppNode): boolean {
    if (!node.parent) return true
    if (!expandedNodeIds.has(node.parent)) return false
    const parent = nodeMap.get(node.parent)
    return parent ? isVisible(parent) : true
  }

  return nodes.filter(n => isVisible(n))
}

/**
 * An edge is visible if both source and target are in the visible set.
 */
export function filterVisibleEdges(
  edges: readonly AppEdge[],
  visibleNodeIds: Set<string>,
): AppEdge[] {
  return edges.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
}

/**
 * Hook that returns only the visible nodes and edges based on expansion state.
 * Enforces MAX_VISIBLE_NODES guardrail.
 */
export function useExpandCollapse() {
  const nodes = useGraphStore(s => s.nodes)
  const edges = useGraphStore(s => s.edges)
  const expandedNodeIds = useGraphStore(s => s.expandedNodeIds)

  const visibleNodes = useMemo(() => {
    const visible = filterVisibleNodes(nodes, expandedNodeIds)
    if (visible.length > MAX_VISIBLE_NODES) {
      return visible.slice(0, MAX_VISIBLE_NODES)
    }
    return visible
  }, [nodes, expandedNodeIds])

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map(n => n.id)),
    [visibleNodes],
  )

  const visibleEdges = useMemo(
    () => filterVisibleEdges(edges, visibleNodeIds),
    [edges, visibleNodeIds],
  )

  return { visibleNodes, visibleEdges, visibleNodeIds }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd browser-agent-chat/client && npx vitest run src/components/AppMap/__tests__/useExpandCollapse.test.ts
```

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/useExpandCollapse.ts client/src/components/AppMap/__tests__/useExpandCollapse.test.ts && git commit -m "feat(graph): expand/collapse visibility filtering with tests"
```

---

## Chunk 2: ELK Layout Engine (Phase 1)

### Task 7: ELK Web Worker

**Files:**
- Create: `client/src/components/AppMap/elk-worker.ts`
- Create: `client/src/components/AppMap/useELKLayout.ts`

- [ ] **Step 1: Create the ELK Web Worker**

```ts
// client/src/components/AppMap/elk-worker.ts
import ELK from 'elkjs/lib/elk.bundled.js'

const elk = new ELK()

type LayoutRequest = {
  id: string
  nodes: Array<{ id: string; width: number; height: number; parentId?: string }>
  edges: Array<{ id: string; source: string; target: string }>
  options?: Record<string, string>
}

type LayoutResult = {
  id: string
  positions: Record<string, { x: number; y: number }>
}

self.onmessage = async (event: MessageEvent<LayoutRequest>) => {
  const { id, nodes, edges, options } = event.data

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.layered.spacing.edgeNodeBetweenLayers': '40',
      'elk.spacing.nodeNode': '60',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      ...options,
    },
    children: nodes.map(n => ({
      id: n.id,
      width: n.width,
      height: n.height,
    })),
    edges: edges.map(e => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  }

  try {
    const result = await elk.layout(elkGraph)
    const positions: Record<string, { x: number; y: number }> = {}
    for (const child of result.children ?? []) {
      positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
    }
    self.postMessage({ id, positions } satisfies LayoutResult)
  } catch (err) {
    self.postMessage({ id, positions: {}, error: String(err) })
  }
}
```

- [ ] **Step 2: Create the useELKLayout hook**

```ts
// client/src/components/AppMap/useELKLayout.ts
import { useCallback, useRef, useEffect, useState } from 'react'
import type { AppNode } from './types'

type NodePosition = { x: number; y: number }

const NODE_SIZES: Record<string, { width: number; height: number }> = {
  root: { width: 200, height: 70 },
  section: { width: 160, height: 60 },
  feature: { width: 130, height: 50 },
}

export function useELKLayout() {
  const workerRef = useRef<Worker | null>(null)
  const callbackRef = useRef<Map<string, (positions: Record<string, NodePosition>) => void>>(new Map())
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const worker = new Worker(
      new URL('./elk-worker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.onmessage = (event) => {
      const { id, positions } = event.data
      const cb = callbackRef.current.get(id)
      if (cb) {
        cb(positions)
        callbackRef.current.delete(id)
      }
    }
    workerRef.current = worker
    setIsReady(true)

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const computeLayout = useCallback(
    (
      nodes: readonly AppNode[],
      edges: readonly { id: string; source: string; target: string }[],
    ): Promise<Record<string, NodePosition>> => {
      return new Promise((resolve) => {
        if (!workerRef.current) {
          resolve({})
          return
        }

        const id = `layout-${Date.now()}-${Math.random()}`
        callbackRef.current.set(id, resolve)

        workerRef.current.postMessage({
          id,
          nodes: nodes.map(n => ({
            id: n.id,
            ...(NODE_SIZES[n.type] ?? NODE_SIZES.feature),
          })),
          edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
        })
      })
    },
    [],
  )

  return { computeLayout, isReady }
}
```

- [ ] **Step 3: Verify types compile**

```bash
cd browser-agent-chat/client && npx tsc --noEmit
```

Expected: No errors (or only pre-existing errors)

- [ ] **Step 4: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/elk-worker.ts client/src/components/AppMap/useELKLayout.ts && git commit -m "feat(graph): ELK Web Worker layout engine with Vite-compatible bundling"
```

---

### Task 8: Integrate ELK into AppMap — replace BFS layout

**Files:**
- Modify: `client/src/components/AppMap/AppMap.tsx`
- Modify: `client/src/components/AppMap/useAppMap.ts`

- [ ] **Step 1: Update useAppMap to build canonical graph and project navigation**

Add imports and integrate the canonical graph + projection pipeline. The hook still returns the same external API shape so AppMap.tsx doesn't break yet.

In `useAppMap.ts`, add at the top:
```ts
import { buildCanonicalGraph } from './CanonicalGraph'
import { projectNavigation } from './GraphProjectionLayer'
import { useGraphStore } from './GraphStore'
```

After `setNodes(newNodes)` and `setEdges(data.edges)` (around line 97-98), add:
```ts
// Feed into canonical graph pipeline
const canonical = buildCanonicalGraph(data)
const projected = projectNavigation(canonical)
useGraphStore.getState().setGraph(projected.nodes, projected.edges)
```

- [ ] **Step 2: Update AppMap.tsx to use ELK layout instead of BFS**

Remove the `layoutNodes` function (lines 24-103) and the `layoutEdges` function (lines 105-120). Replace the entire component body with ELK-based layout. Here is the updated component:

```tsx
// client/src/components/AppMap/AppMap.tsx
import { useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import RootNode from './nodes/RootNode'
import SectionNode from './nodes/SectionNode'
import FeatureNode from './nodes/FeatureNode'
import NavEdge from './NavEdge'
import DetailPanel from './DetailPanel'
import { useAppMap } from './useAppMap'
import { useExpandCollapse } from './useExpandCollapse'
import { useELKLayout } from './useELKLayout'
import { useGraphStore } from './GraphStore'
import './AppMap.css'

const nodeTypes = { root: RootNode, section: SectionNode, feature: FeatureNode }
const edgeTypes = { nav: NavEdge }

const EXPLORATION_ICONS: Record<string, string> = {
  explored: '\u25CF', unknown: '\u25CB', exploring: '\u27F3', failed: '\u26A0',
}

interface AppMapProps {
  agentId: string
  onSendTask: (task: string) => void
  onExplore?: () => void
}

export default function AppMap({ agentId, onSendTask, onExplore }: AppMapProps) {
  const { loading, error } = useAppMap(agentId) // feeds data into store
  const { visibleNodes, visibleEdges } = useExpandCollapse()
  const { computeLayout, isReady } = useELKLayout()
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const selectNode = useGraphStore(s => s.selectNode)
  const nodes = useGraphStore(s => s.nodes)
  const prevPositionsRef = useRef<Record<string, { x: number; y: number }>>({})

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([])

  // Run ELK layout when visible nodes/edges change
  useEffect(() => {
    if (!isReady || visibleNodes.length === 0) return

    // Save previous positions for interpolation
    for (const n of rfNodes) {
      prevPositionsRef.current[n.id] = n.position
    }

    computeLayout(visibleNodes, visibleEdges).then(positions => {
      const newNodes: Node[] = visibleNodes.map(n => ({
        id: n.id,
        type: n.type === 'root' ? 'root' : n.type === 'section' ? 'section' : 'feature',
        position: positions[n.id] ?? prevPositionsRef.current[n.id] ?? { x: 0, y: 0 },
        data: {
          label: n.label,
          urlPattern: n.urlPattern,
          featureCount: n.featureCount,
          criticality: n.criticality,
          childIds: n.childIds,
          explorationIcon: EXPLORATION_ICONS[n.state.exploration] ?? '\u25CB',
          explorationLabel: n.state.exploration,
          isSelected: n.id === selectedNodeId,
        },
        style: { transition: 'transform 250ms ease-out' },
      }))

      setRfNodes(newNodes)
      setRfEdges(visibleEdges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'nav',
        data: { actionLabel: e.label, isUnexplored: false },
      })))
    })
  }, [visibleNodes, visibleEdges, isReady, selectedNodeId, computeLayout, setRfNodes, setRfEdges])

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    selectNode(node.id)
  }, [selectNode])

  if (loading) return <div className="app-map-loading">Loading app map...</div>
  if (error) return <div className="app-map-error">Error: {error}</div>
  if (nodes.length === 0) {
    return (
      <div className="app-map-empty">
        <p>No map data yet.</p>
        <p>Start an exploration to build the app map.</p>
        {onExplore && <button className="btn-add" onClick={onExplore}>Explore & Learn</button>}
      </div>
    )
  }

  return (
    <div className="app-map">
      <div className="app-map-graph">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.3}
          maxZoom={2}
        >
          <Background color="var(--border-subtle, #252218)" gap={24} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor="var(--brand, #3D6B4F)"
            maskColor="rgba(0,0,0,0.5)"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          />
        </ReactFlow>
      </div>
      {/* DetailPanel stays temporarily until GraphDetailPanel replaces it in Task 12 */}
      <DetailPanel
        selectedNode={null}
        unlinkedSuggestions={[]}
        agentId={agentId}
        onRefresh={() => {}}
        onSendTask={onSendTask}
        onSelectNode={(id) => selectNode(id)}
        edges={[]}
        nodes={[]}
      />
    </div>
  )
}
```

**Note:** This temporarily stubs out the DetailPanel props. Task 12 replaces it entirely.

- [ ] **Step 3: Verify the graph still renders**

```bash
cd browser-agent-chat && npm run build
```

Expected: Build succeeds. Visually verify the graph looks similar to before (manually in browser).

- [ ] **Step 4: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/AppMap.tsx client/src/components/AppMap/useAppMap.ts && git commit -m "feat(graph): replace BFS layout with ELK engine"
```

---

## Chunk 3: Node Components + Expand/Collapse UI (Phase 2)

### Task 9: Create node components — RootNode, SectionNode, FeatureNode

**Files:**
- Create: `client/src/components/AppMap/nodes/RootNode.tsx`
- Create: `client/src/components/AppMap/nodes/SectionNode.tsx`
- Create: `client/src/components/AppMap/nodes/FeatureNode.tsx`

- [ ] **Step 1: Create RootNode**

```tsx
// client/src/components/AppMap/nodes/RootNode.tsx
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

function RootNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>
  return (
    <div className="graph-node graph-node--root" aria-label={`Root: ${d.label}`}>
      <Handle type="target" position={Position.Top} className="graph-node-handle" />
      <div className="graph-node-card">
        <span className="graph-node-status" aria-label={d.explorationLabel as string}>
          {d.explorationIcon}
        </span>
        <span className="graph-node-title">{d.label as string}</span>
      </div>
      <span className="graph-node-url">{d.urlPattern as string}</span>
      <Handle type="source" position={Position.Bottom} className="graph-node-handle" />
    </div>
  )
}

export default memo(RootNode)
```

- [ ] **Step 2: Create SectionNode with expand/collapse button**

```tsx
// client/src/components/AppMap/nodes/SectionNode.tsx
import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useGraphStore } from '../GraphStore'

function SectionNode({ data, id }: NodeProps) {
  const d = data as Record<string, unknown>
  const toggleExpand = useGraphStore(s => s.toggleExpand)
  const expandedNodeIds = useGraphStore(s => s.expandedNodeIds)
  const isExpanded = expandedNodeIds.has(id)
  const hasChildren = ((d.childIds as string[]) ?? []).length > 0

  const handleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    toggleExpand(id)
  }, [id, toggleExpand])

  const handleAltClick = useCallback((e: React.MouseEvent) => {
    if (e.altKey && isExpanded) {
      e.stopPropagation()
      // Collapse entire subtree — for now just collapse this node
      toggleExpand(id)
    }
  }, [id, isExpanded, toggleExpand])

  return (
    <div
      className={`graph-node graph-node--section ${isExpanded ? 'graph-node--expanded' : ''}`}
      onClick={handleAltClick}
      aria-label={`Section: ${d.label}`}
    >
      <Handle type="target" position={Position.Top} className="graph-node-handle" />
      <div className="graph-node-card">
        <span className="graph-node-status" aria-label={d.explorationLabel as string}>
          {d.explorationIcon}
        </span>
        <span className="graph-node-title">{d.label as string}</span>
        {(d.featureCount as number) > 0 && (
          <span className="graph-node-badge">{d.featureCount as number}</span>
        )}
      </div>
      <span className="graph-node-url">{d.urlPattern as string}</span>
      {hasChildren && (
        <button
          className="graph-node-expand"
          onClick={handleExpand}
          aria-label={isExpanded ? `Collapse ${d.label}` : `Expand ${d.label}`}
        >
          {isExpanded ? '\u25B4' : '\u25BE'}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="graph-node-handle" />
    </div>
  )
}

export default memo(SectionNode)
```

- [ ] **Step 3: Create FeatureNode**

```tsx
// client/src/components/AppMap/nodes/FeatureNode.tsx
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

const CRITICALITY_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#D4874D', medium: '#3D6B4F', low: '#443E35',
}

function FeatureNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>
  const borderColor = CRITICALITY_COLORS[(d.criticality as string) ?? 'low'] ?? 'var(--border-primary)'

  return (
    <div className="graph-node graph-node--feature" aria-label={`Feature: ${d.label}`}>
      <Handle type="target" position={Position.Top} className="graph-node-handle" />
      <div className="graph-node-card" style={{ borderLeftColor: borderColor }}>
        <span className="graph-node-title">{d.label as string}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="graph-node-handle" />
    </div>
  )
}

export default memo(FeatureNode)
```

- [ ] **Step 4: Register node types in AppMap.tsx**

Replace the `nodeTypes` constant:
```ts
import RootNode from './nodes/RootNode'
import SectionNode from './nodes/SectionNode'
import FeatureNode from './nodes/FeatureNode'

const nodeTypes = { root: RootNode, section: SectionNode, feature: FeatureNode }
```

- [ ] **Step 5: Add CSS styles for new node components**

Add to `AppMap.css` the `.graph-node`, `.graph-node--root`, `.graph-node--section`, `.graph-node--feature`, `.graph-node-expand`, `.graph-node-badge`, `.graph-node-status` classes following the Visual Hierarchy table from the spec (root = 200px/brand border, section = 160px, feature = 130px). Use CSS variables from the theme system.

- [ ] **Step 6: Verify build compiles**

```bash
cd browser-agent-chat && npm run build
```

Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/nodes/ client/src/components/AppMap/AppMap.tsx client/src/components/AppMap/AppMap.css && git commit -m "feat(graph): add RootNode, SectionNode, FeatureNode with expand/collapse"
```

---

## Chunk 4: Tree Panel + Toolbar (Phase 3)

### Task 10: GraphTreePanel component

**Files:**
- Create: `client/src/components/AppMap/GraphTreePanel.tsx`

- [ ] **Step 1: Implement the tree panel**

Build `GraphTreePanel` that:
1. Reads `nodes` and `expandedNodeIds` from the zustand store
2. Renders a recursive tree using `role="tree"` and `role="treeitem"` with `aria-expanded`
3. Shows status indicators (use `state.exploration` to pick icon)
4. Clicking a tree item calls `selectNode` and fires an `onCenterNode` callback
5. Shows "Agent Activity" section at the bottom (reads exploration states from nodes)

The component should be ~80-120 lines. Key helper: `buildTree(nodes)` that creates a nested structure from flat nodes using `parent` field.

- [ ] **Step 2: Add CSS for tree panel**

Add to `AppMap.css`:
- `.graph-tree-panel` (width: 220px, left sidebar)
- `.graph-tree-item`, `.graph-tree-item--selected`
- `.graph-tree-status` (status icon)
- `.graph-tree-activity` (agent activity section)

All using CSS variables from the theme system.

- [ ] **Step 3: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/GraphTreePanel.tsx client/src/components/AppMap/AppMap.css && git commit -m "feat(graph): tree navigation panel with agent activity"
```

---

### Task 11: GraphToolbar component

**Files:**
- Create: `client/src/components/AppMap/GraphToolbar.tsx`

- [ ] **Step 1: Implement the toolbar**

Build `GraphToolbar` that:
1. Search input with `Cmd+K` / `Ctrl+K` keyboard shortcut
2. Status filter chips (explored/unexplored/exploring/failed) — toggle visibility
3. Mode toggle button group (Navigation / Capabilities) — reads/writes `mode` from store
4. Stats display (node count, feature count)

- [ ] **Step 2: Add CSS for toolbar**

Add to `AppMap.css`:
- `.graph-toolbar` (top bar, flex row)
- `.graph-toolbar-search`
- `.graph-toolbar-filters`
- `.graph-toolbar-mode-toggle`

- [ ] **Step 3: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/GraphToolbar.tsx client/src/components/AppMap/AppMap.css && git commit -m "feat(graph): toolbar with search, filters, and mode toggle"
```

---

### Task 12: GraphDetailPanel — replace DetailPanel

**Files:**
- Create: `client/src/components/AppMap/GraphDetailPanel.tsx`
- Remove: `client/src/components/AppMap/DetailPanel.tsx` (after migration)

- [ ] **Step 1: Create GraphDetailPanel**

Port the existing `DetailPanel.tsx` logic into a horizontal bottom panel layout. Key changes:
1. Layout: horizontal at bottom (height: 180px, 36px collapsed)
2. Three sections side by side: Node info | Features + suggestions | Connections
3. Keep all existing functionality (accept/dismiss suggestions, re-explore, connected nodes)
4. Read `selectedNodeId` from zustand store instead of props

- [ ] **Step 2: Integrate all panels into AppMap.tsx**

Update `AppMap.tsx` to render the three-panel layout:
```
<GraphToolbar />
<div className="app-map-main">
  <GraphTreePanel onCenterNode={...} />
  <div className="app-map-graph">
    <ReactFlow ... />
  </div>
</div>
<GraphDetailPanel ... />
```

- [ ] **Step 3: Remove old DetailPanel.tsx and PageNode.tsx**

```bash
cd browser-agent-chat && git rm client/src/components/AppMap/DetailPanel.tsx client/src/components/AppMap/PageNode.tsx
```

- [ ] **Step 4: Verify build**

```bash
cd browser-agent-chat && npm run build
```

Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
cd browser-agent-chat && git add -A client/src/components/AppMap/ && git commit -m "feat(graph): hybrid explorer layout with tree + graph + detail panel"
```

---

## Chunk 5: Capability Mode + Server Changes (Phase 4)

### Task 13: Server-side capability clustering

**Files:**
- Create: `server/__tests__/capability-graph.test.ts`
- Create: `server/src/capability-graph.ts`
- Modify: `server/src/routes/map.ts`

- [ ] **Step 1: Write failing tests for capability clustering**

```ts
// server/__tests__/capability-graph.test.ts
import { describe, it, expect } from 'vitest'
import { buildCapabilityClusters } from '../src/capability-graph.js'

describe('buildCapabilityClusters', () => {
  it('groups pages by first URL path segment', () => {
    const nodes = [
      { id: 'n1', urlPattern: '/admin/users', pageTitle: 'Users', features: [{ name: 'Invite' }] },
      { id: 'n2', urlPattern: '/admin/users/:id', pageTitle: 'User Detail', features: [{ name: 'Edit' }] },
      { id: 'n3', urlPattern: '/settings', pageTitle: 'Settings', features: [{ name: 'Theme' }] },
    ]
    const clusters = buildCapabilityClusters(nodes as any, [])
    expect(clusters).toHaveLength(2)
    const adminCluster = clusters.find(c => c.sourcePageIds.includes('n1'))
    expect(adminCluster?.sourcePageIds).toContain('n2')
  })

  it('splits clusters with > 6 pages by second segment', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => ({
      id: `n${i}`,
      urlPattern: `/settings/${['security', 'billing', 'team', 'api', 'webhooks', 'logs', 'sso', 'notifications'][i]}`,
      pageTitle: `Settings ${i}`,
      features: [],
    }))
    const clusters = buildCapabilityClusters(nodes as any, [])
    expect(clusters.length).toBeGreaterThan(1)
  })

  it('infers dependencies from cross-cluster edges', () => {
    const nodes = [
      { id: 'n1', urlPattern: '/users', pageTitle: 'Users', features: [] },
      { id: 'n2', urlPattern: '/roles', pageTitle: 'Roles', features: [] },
    ]
    const edges = [{ id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', actionLabel: 'click' }]
    const clusters = buildCapabilityClusters(nodes as any, edges as any)
    const userCluster = clusters.find(c => c.sourcePageIds.includes('n1'))
    const roleCluster = clusters.find(c => c.sourcePageIds.includes('n2'))
    expect(userCluster?.dependencies).toContain(roleCluster?.id)
  })

  it('returns empty for empty input', () => {
    expect(buildCapabilityClusters([], [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd browser-agent-chat/server && npx vitest run __tests__/capability-graph.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement buildCapabilityClusters**

```ts
// server/src/capability-graph.ts
import type { Feature } from './types.js'

export interface CapabilityCluster {
  id: string
  name: string
  sourcePageIds: string[]
  features: Feature[]
  dependencies: string[]
}

interface MinimalNode {
  id: string
  urlPattern: string
  pageTitle: string
  features: Feature[]
}

interface MinimalEdge {
  fromNodeId: string
  toNodeId: string
}

function getPathSegments(urlPattern: string): string[] {
  return urlPattern.split('/').filter(Boolean)
}

function titleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function buildCapabilityClusters(
  nodes: readonly MinimalNode[],
  edges: readonly MinimalEdge[],
): CapabilityCluster[] {
  if (nodes.length === 0) return []

  // Group by first path segment
  const groups = new Map<string, MinimalNode[]>()
  for (const node of nodes) {
    const segments = getPathSegments(node.urlPattern)
    const key = segments[0] ?? '/'
    const group = groups.get(key) ?? []
    groups.set(key, [...group, node])
  }

  // Split groups > 6 by second segment
  const finalGroups = new Map<string, MinimalNode[]>()
  for (const [key, group] of groups) {
    if (group.length > 6) {
      for (const node of group) {
        const segments = getPathSegments(node.urlPattern)
        const subKey = segments.length > 1 ? `${key}/${segments[1]}` : key
        const subGroup = finalGroups.get(subKey) ?? []
        finalGroups.set(subKey, [...subGroup, node])
      }
    } else {
      finalGroups.set(key, group)
    }
  }

  // Build cluster for each group
  const nodeToClusterId = new Map<string, string>()
  const clusters: CapabilityCluster[] = []

  for (const [key, group] of finalGroups) {
    const clusterId = `cluster-${key}`
    const rootNode = group[0]
    const allFeatures = group.flatMap(n => n.features)

    const cluster: CapabilityCluster = {
      id: clusterId,
      name: rootNode.pageTitle || titleCase(key),
      sourcePageIds: group.map(n => n.id),
      features: allFeatures,
      dependencies: [],
    }
    clusters.push(cluster)

    for (const node of group) {
      nodeToClusterId.set(node.id, clusterId)
    }
  }

  // Infer dependencies from cross-cluster edges
  for (const edge of edges) {
    const fromCluster = nodeToClusterId.get(edge.fromNodeId)
    const toCluster = nodeToClusterId.get(edge.toNodeId)
    if (fromCluster && toCluster && fromCluster !== toCluster) {
      const cluster = clusters.find(c => c.id === fromCluster)
      if (cluster && !cluster.dependencies.includes(toCluster)) {
        cluster.dependencies = [...cluster.dependencies, toCluster]
      }
    }
  }

  return clusters
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd browser-agent-chat/server && npx vitest run __tests__/capability-graph.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 5: Update routes/map.ts to accept mode param**

Add `mode` query param support to the GET handler. When `mode=capabilities`, also return `capabilityClusters` in the response. Add `explorationStatus` summary to all responses.

In `routes/map.ts`, update the route handler:
```ts
router.get('/', requireAuth, async (req, res) => {
  try {
    const agentId = req.params.id as string;
    const mode = (req.query.mode as string) || 'navigation';
    const result = await buildAppMapResponse(agentId);

    const explorationStatus = {
      explored: result.nodes.filter(n => n.features.length > 0).length,
      unexplored: result.nodes.filter(n => n.features.length === 0).length,
      exploring: 0,
      total: result.nodes.length,
    };

    if (mode === 'capabilities') {
      const { buildCapabilityClusters } = await import('../capability-graph.js');
      const clusters = buildCapabilityClusters(result.nodes, result.edges);
      res.json({ ...result, capabilityClusters: clusters, explorationStatus });
    } else {
      res.json({ ...result, explorationStatus });
    }
  } catch (err) {
    console.error('[MAP] Error:', err);
    res.status(500).json({ error: 'Failed to load app map' });
  }
});
```

- [ ] **Step 6: Commit**

```bash
cd browser-agent-chat && git add server/src/capability-graph.ts server/__tests__/capability-graph.test.ts server/src/routes/map.ts && git commit -m "feat(graph): server-side capability clustering with split rule"
```

---

### Task 14: Client-side capability projection

**Files:**
- Modify: `client/src/components/AppMap/GraphProjectionLayer.ts`
- Modify: `client/src/components/AppMap/__tests__/GraphProjectionLayer.test.ts`

- [ ] **Step 1: Add failing tests for capability projection**

Add to the test file:
```ts
import { projectCapabilities } from '../GraphProjectionLayer'

const CLUSTERS = [
  { id: 'c1', name: 'User Management', sourcePageIds: ['n3'], features: [
    { id: 'f3', name: 'Invite', description: null, criticality: 'high', expected_behaviors: [] },
    { id: 'f4', name: 'List', description: null, criticality: 'medium', expected_behaviors: [] },
  ], dependencies: ['c2'] },
  { id: 'c2', name: 'Settings', sourcePageIds: ['n4'], features: [], dependencies: [] },
]

describe('projectCapabilities', () => {
  it('creates section nodes from capability clusters', () => {
    const { nodes } = projectCapabilities(CLUSTERS)
    const sections = nodes.filter(n => n.type === 'section')
    expect(sections).toHaveLength(2)
    expect(sections[0].label).toBe('User Management')
  })

  it('creates feature child nodes within clusters', () => {
    const { nodes } = projectCapabilities(CLUSTERS)
    const features = nodes.filter(n => n.type === 'feature')
    expect(features).toHaveLength(2)
    expect(features[0].parent).toBe('c1')
  })

  it('creates dependency edges between clusters', () => {
    const { edges } = projectCapabilities(CLUSTERS)
    const deps = edges.filter(e => e.type === 'dependency')
    expect(deps).toHaveLength(1)
    expect(deps[0]).toMatchObject({ source: 'c1', target: 'c2' })
  })
})
```

- [ ] **Step 2: Implement projectCapabilities**

Add `projectCapabilities(canonical, clusters)` function to `GraphProjectionLayer.ts` that:
1. Creates an `AppNode` with `type: 'section'` for each `CapabilityCluster`
2. Creates `AppNode` with `type: 'feature'` for each feature in the cluster
3. Creates `AppEdge` with `type: 'dependency'` for cluster dependencies

- [ ] **Step 3: Run tests**

```bash
cd browser-agent-chat/client && npx vitest run src/components/AppMap/__tests__/GraphProjectionLayer.test.ts
```

Expected: All tests PASS

- [ ] **Step 4: Wire up mode toggle in useAppMap.ts**

When `mode` changes in the store, re-fetch with `?mode=capabilities` and run `projectCapabilities` instead of `projectNavigation`.

- [ ] **Step 5: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/GraphProjectionLayer.ts client/src/components/AppMap/__tests__/GraphProjectionLayer.test.ts client/src/components/AppMap/useAppMap.ts && git commit -m "feat(graph): capability projection layer with mode toggle"
```

---

## Chunk 6: Exploration Status + Cross-Links + Search (Phase 5-6)

### Task 15: Exploration status indicators

**Files:**
- Modify: Node components (`RootNode.tsx`, `SectionNode.tsx`, `FeatureNode.tsx`)
- Modify: `client/src/components/AppMap/AppMap.css`

- [ ] **Step 1: Add status icons to node data mapping**

In the `AppMap.tsx` where nodes are mapped to React Flow nodes, compute `explorationIcon` and `explorationLabel` from `NodeState`:

```ts
const EXPLORATION_ICONS: Record<string, string> = {
  explored: '\u25CF',    // ●
  unknown: '\u25CB',     // ○
  exploring: '\u27F3',   // ⟳
  failed: '\u26A0',      // ⚠
}
```

- [ ] **Step 2: Add CSS for exploration states**

Add to `AppMap.css`:
- `.graph-node--exploring` (glowing border animation)
- `.graph-node--unknown` (50% opacity, dashed border)
- `.graph-node--failed` (red border)
- `@keyframes exploring-pulse` (glow animation)

- [ ] **Step 3: Add explore_node WebSocket message**

In `server/src/types.ts`, add `'explore_node'` to the WebSocket message union type. In `server/src/index.ts`, handle `explore_node` messages by navigating the agent to the specified URL.

- [ ] **Step 4: Add "Explore" button on unexplored nodes**

In `SectionNode.tsx`, when `state.exploration === 'unknown'`, show an "explore" button that sends the `explore_node` WebSocket message.

- [ ] **Step 5: Commit**

```bash
cd browser-agent-chat && git add -A && git commit -m "feat(graph): exploration status indicators and agent triggers"
```

---

### Task 16: Cross-links with visibility guardrails

**Files:**
- Modify: `client/src/components/AppMap/useExpandCollapse.ts`
- Modify: `client/src/components/AppMap/NavEdge.tsx`

- [ ] **Step 1: Add cross-link filtering logic**

In `useExpandCollapse.ts`, add a `filterCrossLinks` function that:
1. Only includes cross-links where both endpoints are in the visible set
2. Limits to `MAX_CROSS_LINKS_PER_NODE` (3) per node, prioritizing by criticality

- [ ] **Step 2: Style cross-links differently**

In `NavEdge.tsx`, when `data.type === 'cross-link'`, render with:
- Curved dashed stroke using `--accent` color
- Lighter opacity than navigation edges

- [ ] **Step 3: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/useExpandCollapse.ts client/src/components/AppMap/NavEdge.tsx && git commit -m "feat(graph): cross-link rendering with visibility guardrails"
```

---

### Task 17: Search with Cmd+K

**Files:**
- Modify: `client/src/components/AppMap/GraphToolbar.tsx`
- Modify: `client/src/components/AppMap/GraphTreePanel.tsx`

- [ ] **Step 1: Implement search filtering**

In `GraphToolbar.tsx`:
1. Add `useEffect` for `Cmd+K` / `Ctrl+K` keyboard shortcut
2. On search query change, update `searchQuery` in store
3. Matching logic: case-insensitive match on node `label`, `urlPattern`, and feature names

In `GraphTreePanel.tsx`:
1. Filter tree items by `searchQuery` — show only matching items and their ancestors
2. Highlight matched text in tree items

In `AppMap.tsx`:
1. When `searchQuery` is non-empty, highlight matching nodes with a distinct border
2. On Enter in search, center the graph on the first match using `fitView`

- [ ] **Step 2: Commit**

```bash
cd browser-agent-chat && git add client/src/components/AppMap/GraphToolbar.tsx client/src/components/AppMap/GraphTreePanel.tsx client/src/components/AppMap/AppMap.tsx && git commit -m "feat(graph): Cmd+K search with node highlighting"
```

---

### Task 18: Final integration and cleanup

- [ ] **Step 1: Run full build**

```bash
cd browser-agent-chat && npm run build
```

Expected: Build succeeds with no errors

- [ ] **Step 2: Run all tests**

```bash
cd browser-agent-chat && npm test
```

Expected: All tests pass

- [ ] **Step 3: Verify .gitignore includes .superpowers/**

```bash
cd browser-agent-chat && grep -q '.superpowers/' .gitignore || echo '.superpowers/' >> .gitignore
```

- [ ] **Step 4: Final commit**

```bash
cd browser-agent-chat && git add -A && git commit -m "chore: hybrid explorer graph — final integration and cleanup"
```
