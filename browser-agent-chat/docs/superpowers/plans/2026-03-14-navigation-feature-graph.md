# Navigation/Feature Graph Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal navigation graph that the agent constructs through exploration and passive observation, mapping pages, transitions between them, and which features live on which pages.

**Architecture:** New `nav-graph.ts` module handles all graph operations (URL normalization, node/edge CRUD, graph loading, prompt serialization). Graph writes happen in `createAgent()` event listeners via a `lastAction`/`currentUrl` buffer on `AgentSession`, shared by both Explore and Task modes. Three new Supabase tables (`nav_nodes`, `nav_edges`, `nav_node_features`) store the graph. `executeExplore` is rewritten from single-page `extract()` to a multi-page `act()`/`extract()` loop.

**Tech Stack:** TypeScript, Supabase (PostgreSQL), Vitest, magnitude-core

**Spec:** `docs/superpowers/specs/2026-03-14-navigation-feature-graph-design.md`

---

## File Structure

**New files:**
- `server/src/nav-graph.ts` — All graph operations (normalizeUrl, upsertNode, upsertEdge, linkFeatureToNode, getGraph, serializeGraph, recordNavigation)
- `server/__tests__/nav-graph.test.ts` — Unit tests for all nav-graph functions
- `server/migrations/003_nav_graph.sql` — Database migration for 3 new tables + RLS + indexes

**Modified files:**
- `server/src/types.ts` — Add NavNode, NavEdge, NavGraph types; extend FeatureSuggestionData with discovered_at_url
- `server/src/memory-engine.ts` — `loadMemoryContext()` includes graph serialization after product knowledge
- `server/src/agent.ts` — Add lastAction/currentUrl to AgentSession interface, extend actionDone/nav listeners for graph writes, rewrite executeExplore as act()/extract() loop
- `server/src/db.ts` — `acceptSuggestion()` creates nav_node_features link when feature has discovered_at_url

---

## Chunk 1: Foundation

### Task 1: Types & Migration

**Files:**
- Modify: `server/src/types.ts`
- Modify: `server/src/agent.ts` (AgentSession interface + createAgent return object)
- Create: `server/migrations/003_nav_graph.sql`

- [ ] **Step 1: Add NavNode, NavEdge, NavGraph types to types.ts**

Add after the `RedisSessionStatus` type (line 123) and before the `// === Suggestions ===` section:

```typescript
// === Navigation Graph ===

export interface NavNode {
  id: string;
  projectId: string;
  urlPattern: string;
  pageTitle: string;
  description: string;
  firstSeenAt: string;
  lastSeenAt: string;
  features: string[]; // feature names, populated from nav_node_features join
}

export interface NavEdge {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  actionLabel: string;
  selector: string | null;
  discoveredAt: string;
}

export interface NavGraph {
  nodes: NavNode[];
  edges: NavEdge[];
}
```

- [ ] **Step 2: Extend AgentSession with lastAction and currentUrl**

In `server/src/agent.ts`, add two fields to the `AgentSession` interface (after `loginDone`):

```typescript
export interface AgentSession {
  agent: BrowserAgent;
  connector: BrowserConnector;
  sessionId: string | null;
  projectId: string | null;
  memoryContext: string;
  stepsHistory: Array<{ order: number; action: string; target?: string }>;
  /** Resolves when background login finishes (or immediately if no login). */
  loginDone: Promise<void>;
  /** Last action performed — consumed by nav listener for edge labels. */
  lastAction: { label: string; selector?: string } | null;
  /** Current page URL — updated on every nav event. */
  currentUrl: string | null;
  close: () => Promise<void>;
}
```

Update the return object in `createAgent()` (around line 163) to include the new fields:

```typescript
  return {
    agent,
    connector,
    sessionId,
    projectId,
    memoryContext,
    stepsHistory,
    loginDone: Promise.resolve(),
    lastAction: null,
    currentUrl: currentPageUrl,
    close: async () => {
      agent.events.removeAllListeners();
      agent.browserAgentEvents.removeAllListeners();
    }
  };
```

- [ ] **Step 3: Add discovered_at_url to FeatureSuggestionData**

In `server/src/types.ts`, add the optional field to `FeatureSuggestionData`:

```typescript
export interface FeatureSuggestionData {
  name: string;
  description: string;
  criticality: Criticality;
  expected_behaviors: string[];
  discovered_at_url?: string; // URL where feature was observed during exploration
}
```

- [ ] **Step 4: Create migration file**

Create `server/migrations/003_nav_graph.sql`:

```sql
-- Navigation nodes (pages/routes the agent has visited)
CREATE TABLE nav_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url_pattern TEXT NOT NULL,
  page_title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, url_pattern)
);

-- Navigation edges (transitions between pages)
CREATE TABLE nav_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL REFERENCES nav_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES nav_nodes(id) ON DELETE CASCADE,
  action_label TEXT NOT NULL DEFAULT '',
  selector TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, from_node_id, to_node_id, action_label)
);

-- Feature-to-node many-to-many
CREATE TABLE nav_node_features (
  nav_node_id UUID NOT NULL REFERENCES nav_nodes(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES memory_features(id) ON DELETE CASCADE,
  PRIMARY KEY (nav_node_id, feature_id)
);

-- Indexes for common queries
CREATE INDEX idx_nav_nodes_project ON nav_nodes(project_id);
CREATE INDEX idx_nav_edges_project ON nav_edges(project_id);
CREATE INDEX idx_nav_edges_from ON nav_edges(from_node_id);
CREATE INDEX idx_nav_edges_to ON nav_edges(to_node_id);
CREATE INDEX idx_nav_node_features_feature ON nav_node_features(feature_id);

-- RLS policies (match existing project-level access pattern)
ALTER TABLE nav_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE nav_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE nav_node_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage nav_nodes for their projects"
  ON nav_nodes FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage nav_edges for their projects"
  ON nav_edges FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage nav_node_features for their projects"
  ON nav_node_features FOR ALL
  USING (nav_node_id IN (
    SELECT id FROM nav_nodes WHERE project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  ));
```

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `cd browser-agent-chat && npm run test --workspace=server`
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add server/src/types.ts server/src/agent.ts server/migrations/003_nav_graph.sql
git commit -m "feat(nav-graph): add types, AgentSession extensions, and migration"
```

---

### Task 2: URL Normalization (TDD)

**Files:**
- Create: `server/src/nav-graph.ts`
- Create: `server/__tests__/nav-graph.test.ts`

- [ ] **Step 1: Write failing tests for normalizeUrl**

Create `server/__tests__/nav-graph.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../src/nav-graph.js';

describe('normalizeUrl', () => {
  it('strips query parameters', () => {
    expect(normalizeUrl('https://app.com/settings?tab=general')).toBe('/settings');
  });

  it('strips hash fragments', () => {
    expect(normalizeUrl('https://app.com/docs#section-2')).toBe('/docs');
  });

  it('collapses numeric path segments to :id', () => {
    expect(normalizeUrl('https://app.com/users/123')).toBe('/users/:id');
    expect(normalizeUrl('https://app.com/users/456/posts/789')).toBe('/users/:id/posts/:id');
  });

  it('collapses UUID path segments to :id', () => {
    expect(normalizeUrl('https://app.com/orders/a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('/orders/:id');
  });

  it('preserves meaningful path structure', () => {
    expect(normalizeUrl('https://app.com/settings/billing')).toBe('/settings/billing');
    expect(normalizeUrl('https://app.com/admin/users')).toBe('/admin/users');
  });

  it('handles root URL', () => {
    expect(normalizeUrl('https://app.com/')).toBe('/');
    expect(normalizeUrl('https://app.com')).toBe('/');
  });

  it('handles relative paths', () => {
    expect(normalizeUrl('/users/123?page=2')).toBe('/users/:id');
  });

  it('removes trailing slashes except root', () => {
    expect(normalizeUrl('https://app.com/settings/')).toBe('/settings');
  });

  it('handles both query params and hash together', () => {
    expect(normalizeUrl('https://app.com/page?q=search#results')).toBe('/page');
  });

  it('handles mixed numeric and text segments', () => {
    expect(normalizeUrl('https://app.com/projects/42/settings')).toBe('/projects/:id/settings');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/nav-graph.test.ts`
Expected: FAIL — `normalizeUrl` not found (module doesn't exist)

- [ ] **Step 3: Implement normalizeUrl**

Create `server/src/nav-graph.ts`:

```typescript
import { supabase, isSupabaseEnabled } from './supabase.js';
import type { NavNode, NavEdge, NavGraph } from './types.js';

/**
 * Normalize a URL to a canonical pattern for deduplication.
 * Strips query params, hash fragments, collapses numeric/UUID path segments.
 */
export function normalizeUrl(url: string): string {
  let path: string;
  try {
    const parsed = new URL(url);
    path = parsed.pathname;
  } catch {
    // Not a full URL — treat as path, strip query/hash manually
    path = url.split('?')[0].split('#')[0];
  }

  // Remove trailing slash (except root)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // Collapse UUID segments (must run before numeric to avoid partial match)
  path = path.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '/:id'
  );

  // Collapse numeric-only segments
  path = path.replace(/\/\d+(?=\/|$)/g, '/:id');

  return path || '/';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/nav-graph.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/nav-graph.ts server/__tests__/nav-graph.test.ts
git commit -m "feat(nav-graph): add normalizeUrl with TDD tests"
```

---

### Task 3: Graph Serialization (TDD)

**Files:**
- Modify: `server/src/nav-graph.ts`
- Modify: `server/__tests__/nav-graph.test.ts`

- [ ] **Step 1: Write failing tests for serializeGraph**

Add to `server/__tests__/nav-graph.test.ts`:

```typescript
import { normalizeUrl, serializeGraph } from '../src/nav-graph.js';
import type { NavGraph } from '../src/types.js';

describe('serializeGraph', () => {
  it('returns empty string for empty graph', () => {
    expect(serializeGraph({ nodes: [], edges: [] })).toBe('');
  });

  it('serializes nodes with titles', () => {
    const graph: NavGraph = {
      nodes: [{
        id: 'n1', projectId: 'p1', urlPattern: '/dashboard',
        pageTitle: 'Dashboard', description: '', firstSeenAt: '', lastSeenAt: '',
        features: [],
      }],
      edges: [],
    };
    const result = serializeGraph(graph);
    expect(result).toContain('SITE MAP:');
    expect(result).toContain('/dashboard');
    expect(result).toContain('Dashboard');
  });

  it('includes feature names in brackets', () => {
    const graph: NavGraph = {
      nodes: [{
        id: 'n1', projectId: 'p1', urlPattern: '/dashboard',
        pageTitle: 'Dashboard', description: '', firstSeenAt: '', lastSeenAt: '',
        features: ['Analytics Overview', 'Quick Actions'],
      }],
      edges: [],
    };
    const result = serializeGraph(graph);
    expect(result).toContain('[features: Analytics Overview, Quick Actions]');
  });

  it('serializes edges as indented transitions under source node', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/dashboard', pageTitle: 'Dashboard', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n2', projectId: 'p1', urlPattern: '/settings', pageTitle: 'Settings', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [{
        id: 'e1', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'n2',
        actionLabel: 'click "Settings" in sidebar', selector: null, discoveredAt: '',
      }],
    };
    const result = serializeGraph(graph);
    expect(result).toContain('  → /settings (click "Settings" in sidebar)');
  });

  it('omits action label parenthetical when action is empty', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/a', pageTitle: 'A', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n2', projectId: 'p1', urlPattern: '/b', pageTitle: 'B', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [{
        id: 'e1', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'n2',
        actionLabel: '', selector: null, discoveredAt: '',
      }],
    };
    const result = serializeGraph(graph);
    expect(result).toContain('  → /b');
    expect(result).not.toContain('()');
  });

  it('respects maxNodes option', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`, projectId: 'p1', urlPattern: `/page-${i}`,
      pageTitle: `Page ${i}`, description: '', firstSeenAt: '', lastSeenAt: '',
      features: [],
    }));
    const graph: NavGraph = { nodes, edges: [] };
    const result = serializeGraph(graph, { maxNodes: 3 });
    expect(result.match(/\/page-/g)?.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/nav-graph.test.ts`
Expected: FAIL — `serializeGraph` not exported

- [ ] **Step 3: Implement serializeGraph**

Add to `server/src/nav-graph.ts`:

```typescript
export interface SerializeOptions {
  maxNodes?: number;
}

/**
 * Serialize a navigation graph into a prompt-friendly text block.
 */
export function serializeGraph(graph: NavGraph, options?: SerializeOptions): string {
  if (graph.nodes.length === 0) return '';

  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const edgesByFrom = new Map<string, NavEdge[]>();
  for (const edge of graph.edges) {
    const list = edgesByFrom.get(edge.fromNodeId) || [];
    list.push(edge);
    edgesByFrom.set(edge.fromNodeId, list);
  }

  const nodes = options?.maxNodes
    ? graph.nodes.slice(0, options.maxNodes)
    : graph.nodes;

  const lines: string[] = ['SITE MAP:'];
  for (const node of nodes) {
    const featurePart = node.features.length > 0
      ? ` [features: ${node.features.join(', ')}]`
      : '';
    lines.push(`${node.urlPattern} → "${node.pageTitle}"${featurePart}`);

    const edges = edgesByFrom.get(node.id) || [];
    for (const edge of edges) {
      const target = nodeMap.get(edge.toNodeId);
      if (target) {
        const actionPart = edge.actionLabel ? ` (${edge.actionLabel})` : '';
        lines.push(`  → ${target.urlPattern}${actionPart}`);
      }
    }
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/nav-graph.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/nav-graph.ts server/__tests__/nav-graph.test.ts
git commit -m "feat(nav-graph): add serializeGraph with TDD tests"
```

---

### Task 4: Graph Database Operations (TDD)

**Files:**
- Modify: `server/src/nav-graph.ts`
- Modify: `server/__tests__/nav-graph.test.ts`

**Context:** These functions use `supabase` directly (imported from `./supabase.js`), following the same pattern as `db.ts`. Tests mock the supabase module. The Supabase client's chainable API is mocked by building explicit mock chains per test.

**Mock pattern reference:** See `server/__tests__/sessionManager.test.ts` for how modules are mocked with `vi.mock()`. For supabase, mock `from()` to return chainable objects ending in `.single()` / `.maybeSingle()` resolving to `{ data, error }`.

- [ ] **Step 1: Write failing tests for DB operations**

**File restructuring required:** The test file from Tasks 2-3 has no mocks. Adding DB tests requires `vi.mock('../src/supabase.js')` which must be hoisted above all imports. Restructure the file so the top looks like this:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase — must be before any import from nav-graph.js
// vi.mock is hoisted by vitest, so this applies file-wide.
// Pure function tests (normalizeUrl, serializeGraph) are unaffected since they don't call supabase.
const mockFrom = vi.fn();
vi.mock('../src/supabase.js', () => ({
  isSupabaseEnabled: vi.fn().mockReturnValue(true),
  supabase: { from: mockFrom },
}));

// Single merged import — replaces the separate imports from Tasks 2-3
import { normalizeUrl, serializeGraph, upsertNode, upsertEdge, linkFeatureToNode, getGraph } from '../src/nav-graph.js';

// Keep existing normalizeUrl and serializeGraph describe blocks unchanged below.

describe('upsertNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts a nav_node and returns mapped NavNode', async () => {
    const row = {
      id: 'n1', project_id: 'p1', url_pattern: '/users/:id',
      page_title: 'Users', description: '',
      first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z',
    };
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
    });

    const result = await upsertNode('p1', 'https://app.com/users/123', 'Users');

    expect(mockFrom).toHaveBeenCalledWith('nav_nodes');
    expect(result).toEqual(expect.objectContaining({
      id: 'n1',
      projectId: 'p1',
      urlPattern: '/users/:id',
      pageTitle: 'Users',
    }));
  });

  it('returns null when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);

    const result = await upsertNode('p1', 'https://app.com/page');
    expect(result).toBeNull();
  });

  it('returns null on supabase error', async () => {
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
        }),
      }),
    });

    const result = await upsertNode('p1', 'https://app.com/page');
    expect(result).toBeNull();
  });
});

describe('upsertEdge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts a nav_edge and returns mapped NavEdge', async () => {
    const row = {
      id: 'e1', project_id: 'p1', from_node_id: 'n1', to_node_id: 'n2',
      action_label: 'click: Settings', selector: null,
      discovered_at: '2026-01-01T00:00:00Z',
    };
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
    });

    const result = await upsertEdge('p1', 'n1', 'n2', 'click: Settings');

    expect(mockFrom).toHaveBeenCalledWith('nav_edges');
    expect(result).toEqual(expect.objectContaining({
      id: 'e1',
      fromNodeId: 'n1',
      toNodeId: 'n2',
      actionLabel: 'click: Settings',
    }));
  });
});

describe('linkFeatureToNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts into nav_node_features', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await linkFeatureToNode('n1', 'f1');

    expect(mockFrom).toHaveBeenCalledWith('nav_node_features');
    expect(mockUpsert).toHaveBeenCalledWith(
      { nav_node_id: 'n1', feature_id: 'f1' },
      { onConflict: 'nav_node_id,feature_id', ignoreDuplicates: true }
    );
  });
});

describe('getGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads nodes, edges, and feature names', async () => {
    const nodeRows = [
      { id: 'n1', project_id: 'p1', url_pattern: '/dashboard', page_title: 'Dashboard', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' },
    ];
    const edgeRows = [
      { id: 'e1', project_id: 'p1', from_node_id: 'n1', to_node_id: 'n2', action_label: 'click', selector: null, discovered_at: '2026-01-01' },
    ];
    const featureLinks = [
      { nav_node_id: 'n1', memory_features: { name: 'Search' } },
    ];

    // Three sequential from() calls: nav_nodes, nav_edges, nav_node_features
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: nodeRows, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: edgeRows, error: null }),
        }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: featureLinks, error: null }),
        }),
      });

    const graph = await getGraph('p1');

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].features).toEqual(['Search']);
    expect(graph.edges).toHaveLength(1);
  });

  it('returns empty graph when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);

    const graph = await getGraph('p1');
    expect(graph).toEqual({ nodes: [], edges: [] });
  });
});
```

**Note:** The `vi.mock('../src/supabase.js')` at the top of the test file applies to ALL tests in the file. The pure function tests (normalizeUrl, serializeGraph) don't call supabase, so they're unaffected.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/nav-graph.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement database operations**

Add to `server/src/nav-graph.ts`:

```typescript
// --- Internal helpers ---

function mapNavNode(row: any): NavNode {
  return {
    id: row.id,
    projectId: row.project_id,
    urlPattern: row.url_pattern,
    pageTitle: row.page_title,
    description: row.description,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    features: [],
  };
}

function mapNavEdge(row: any): NavEdge {
  return {
    id: row.id,
    projectId: row.project_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    actionLabel: row.action_label,
    selector: row.selector,
    discoveredAt: row.discovered_at,
  };
}

// --- Database operations ---

/**
 * Create or update a navigation node. On conflict, updates last_seen_at
 * and any provided title/description.
 */
export async function upsertNode(
  projectId: string,
  url: string,
  title?: string,
  description?: string,
): Promise<NavNode | null> {
  if (!isSupabaseEnabled()) return null;

  const urlPattern = normalizeUrl(url);
  const payload: Record<string, string> = {
    project_id: projectId,
    url_pattern: urlPattern,
    last_seen_at: new Date().toISOString(),
  };
  if (title !== undefined) payload.page_title = title;
  if (description !== undefined) payload.description = description;

  const { data, error } = await supabase!
    .from('nav_nodes')
    .upsert(payload, { onConflict: 'project_id,url_pattern' })
    .select()
    .single();

  if (error) {
    console.error('[NAV-GRAPH] upsertNode error:', error);
    return null;
  }
  return mapNavNode(data);
}

/**
 * Create or update a navigation edge between two nodes.
 */
export async function upsertEdge(
  projectId: string,
  fromNodeId: string,
  toNodeId: string,
  actionLabel: string,
  selector?: string,
): Promise<NavEdge | null> {
  if (!isSupabaseEnabled()) return null;

  const payload: Record<string, string> = {
    project_id: projectId,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    action_label: actionLabel || '',
  };
  if (selector) payload.selector = selector;

  const { data, error } = await supabase!
    .from('nav_edges')
    .upsert(payload, { onConflict: 'project_id,from_node_id,to_node_id,action_label' })
    .select()
    .single();

  if (error) {
    console.error('[NAV-GRAPH] upsertEdge error:', error);
    return null;
  }
  return mapNavEdge(data);
}

/**
 * Link a feature to a navigation node (many-to-many).
 */
export async function linkFeatureToNode(nodeId: string, featureId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const { error } = await supabase!
    .from('nav_node_features')
    .upsert(
      { nav_node_id: nodeId, feature_id: featureId },
      { onConflict: 'nav_node_id,feature_id', ignoreDuplicates: true }
    );

  if (error) {
    console.error('[NAV-GRAPH] linkFeatureToNode error:', error);
  }
}

/**
 * Load the full navigation graph for a project.
 * Three queries: nodes, edges, feature links (joined with memory_features for names).
 */
export async function getGraph(projectId: string): Promise<NavGraph> {
  if (!isSupabaseEnabled()) return { nodes: [], edges: [] };

  // 1. Load nodes
  const { data: nodeRows, error: nodeErr } = await supabase!
    .from('nav_nodes')
    .select('*')
    .eq('project_id', projectId)
    .order('first_seen_at', { ascending: true });

  if (nodeErr || !nodeRows) {
    console.error('[NAV-GRAPH] getGraph nodes error:', nodeErr);
    return { nodes: [], edges: [] };
  }

  // 2. Load edges
  const { data: edgeRows, error: edgeErr } = await supabase!
    .from('nav_edges')
    .select('*')
    .eq('project_id', projectId);

  if (edgeErr) {
    console.error('[NAV-GRAPH] getGraph edges error:', edgeErr);
  }

  // 3. Load feature links (join with memory_features for names)
  const nodeIds = nodeRows.map((r: any) => r.id);
  const featuresByNode = new Map<string, string[]>();

  if (nodeIds.length > 0) {
    const { data: featureLinks, error: linkErr } = await supabase!
      .from('nav_node_features')
      .select('nav_node_id, memory_features(name)')
      .in('nav_node_id', nodeIds);

    if (!linkErr && featureLinks) {
      for (const link of featureLinks as any[]) {
        const nodeId = link.nav_node_id;
        const featureName = link.memory_features?.name;
        if (featureName) {
          const list = featuresByNode.get(nodeId) || [];
          list.push(featureName);
          featuresByNode.set(nodeId, list);
        }
      }
    }
  }

  return {
    nodes: nodeRows.map((r: any) => ({
      ...mapNavNode(r),
      features: featuresByNode.get(r.id) || [],
    })),
    edges: (edgeRows || []).map((r: any) => mapNavEdge(r)),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/nav-graph.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd browser-agent-chat && npm run test --workspace=server`
Expected: All tests PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add server/src/nav-graph.ts server/__tests__/nav-graph.test.ts
git commit -m "feat(nav-graph): add DB operations (upsertNode, upsertEdge, linkFeatureToNode, getGraph)"
```

---

## Chunk 2: Integration

### Task 5: recordNavigation Helper

**Files:**
- Modify: `server/src/nav-graph.ts`
- Modify: `server/__tests__/nav-graph.test.ts`

**Context:** `recordNavigation` is a high-level helper that combines normalize + upsert node + upsert edge. It's called from the `nav` event listener in `createAgent()`. All errors are caught and logged (fire-and-forget).

- [ ] **Step 1: Write failing test for recordNavigation**

Add to `server/__tests__/nav-graph.test.ts`:

```typescript
import { ..., recordNavigation } from '../src/nav-graph.js';

describe('recordNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts to-node and creates edge from from-node', async () => {
    // Mock two upsert calls (toNode, fromNode) + one edge upsert
    const toNodeRow = { id: 'n2', project_id: 'p1', url_pattern: '/settings', page_title: '', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' };
    const fromNodeRow = { id: 'n1', project_id: 'p1', url_pattern: '/dashboard', page_title: '', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' };
    const edgeRow = { id: 'e1', project_id: 'p1', from_node_id: 'n1', to_node_id: 'n2', action_label: 'click: Settings', selector: null, discovered_at: '2026-01-01' };

    const mockUpsertChain = (row: any) => ({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
    });

    mockFrom
      .mockReturnValueOnce(mockUpsertChain(toNodeRow))   // upsertNode(toUrl)
      .mockReturnValueOnce(mockUpsertChain(fromNodeRow)) // upsertNode(fromUrl)
      .mockReturnValueOnce(mockUpsertChain(edgeRow));    // upsertEdge

    await recordNavigation('p1', 'https://app.com/dashboard', 'https://app.com/settings', 'click: Settings');

    expect(mockFrom).toHaveBeenCalledTimes(3);
  });

  it('upserts only to-node when fromUrl is null', async () => {
    const toNodeRow = { id: 'n1', project_id: 'p1', url_pattern: '/home', page_title: '', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' };

    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: toNodeRow, error: null }),
        }),
      }),
    });

    await recordNavigation('p1', null, 'https://app.com/home');

    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('does not create edge when from and to normalize to same pattern', async () => {
    const nodeRow = { id: 'n1', project_id: 'p1', url_pattern: '/users/:id', page_title: '', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' };

    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: nodeRow, error: null }),
        }),
      }),
    });

    await recordNavigation('p1', 'https://app.com/users/1', 'https://app.com/users/2');

    // Two upsertNode calls (both return same node), no edge call
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('swallows errors without throwing', async () => {
    mockFrom.mockImplementation(() => { throw new Error('DB down'); });

    // Should not throw
    await expect(recordNavigation('p1', null, 'https://app.com/page')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/nav-graph.test.ts`
Expected: FAIL — `recordNavigation` not exported

- [ ] **Step 3: Implement recordNavigation**

Add to `server/src/nav-graph.ts`:

```typescript
/**
 * High-level helper: record a navigation from one URL to another.
 * Creates/updates nodes and edge. Fire-and-forget — errors are logged, never thrown.
 */
export async function recordNavigation(
  projectId: string,
  fromUrl: string | null,
  toUrl: string,
  action?: string,
  selector?: string,
): Promise<void> {
  try {
    const toNode = await upsertNode(projectId, toUrl);
    if (!toNode) return;

    if (fromUrl) {
      const fromNode = await upsertNode(projectId, fromUrl);
      if (fromNode && fromNode.id !== toNode.id) {
        await upsertEdge(projectId, fromNode.id, toNode.id, action || '', selector);
      }
    }
  } catch (err) {
    console.error('[NAV-GRAPH] recordNavigation error:', err);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/nav-graph.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/nav-graph.ts server/__tests__/nav-graph.test.ts
git commit -m "feat(nav-graph): add recordNavigation helper"
```

---

### Task 6: Memory Engine Integration

**Files:**
- Modify: `server/src/memory-engine.ts`
- Modify: `server/__tests__/nav-graph.test.ts` (or create a separate test)

**Context:** `loadMemoryContext()` is currently a simple async function that loads features and serializes them. It needs to also load the nav graph and append the SITE MAP block. `serializeMemory()` remains unchanged (pure function).

- [ ] **Step 1: Write failing test for updated loadMemoryContext**

Add to `server/__tests__/nav-graph.test.ts` (since it already mocks supabase):

```typescript
import { loadMemoryContext } from '../src/memory-engine.js';

// Mock db.ts (listFeatures) — needed by loadMemoryContext
vi.mock('../src/db.js', () => ({
  listFeatures: vi.fn().mockResolvedValue([]),
}));

describe('loadMemoryContext — graph integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes SITE MAP block when graph has nodes', async () => {
    // Mock getGraph to return a graph with nodes
    const nodeRows = [
      { id: 'n1', project_id: 'p1', url_pattern: '/dashboard', page_title: 'Dashboard', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' },
    ];

    // nav_nodes query
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: nodeRows, error: null }),
        }),
      }),
    });
    // nav_edges query
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });
    // nav_node_features query
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const result = await loadMemoryContext('p1');

    expect(result).toContain('SITE MAP:');
    expect(result).toContain('/dashboard');
  });

  it('omits SITE MAP block when graph is empty', async () => {
    // nav_nodes returns empty
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });

    const result = await loadMemoryContext('p1');

    expect(result).not.toContain('SITE MAP:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/nav-graph.test.ts`
Expected: FAIL — loadMemoryContext doesn't include SITE MAP

- [ ] **Step 3: Modify loadMemoryContext**

In `server/src/memory-engine.ts`, update the import and `loadMemoryContext`:

```typescript
import { listFeatures } from './db.js';
import { getGraph, serializeGraph } from './nav-graph.js';
import type { Feature, Flow } from './types.js';

// ... serializeMemory, buildTaskPrompt, buildExplorePrompt stay unchanged ...

/**
 * Load memory for a project and build the serialized context.
 * Includes both product knowledge (features/flows) and navigation graph.
 */
export async function loadMemoryContext(projectId: string): Promise<string> {
  const features = await listFeatures(projectId);
  const memoryBlock = serializeMemory(features);

  const graph = await getGraph(projectId);
  const graphBlock = serializeGraph(graph);

  if (graphBlock) {
    return memoryBlock + '\n\n' + graphBlock;
  }
  return memoryBlock;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat && npx vitest run server/__tests__/nav-graph.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `cd browser-agent-chat && npm run test --workspace=server`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/memory-engine.ts server/__tests__/nav-graph.test.ts
git commit -m "feat(nav-graph): integrate graph serialization into loadMemoryContext"
```

---

### Task 7: Agent — Passive Graph Writes

**Files:**
- Modify: `server/src/agent.ts`

**Context:** Extend the existing `actionDone` and `nav` event listeners in `createAgent()` to maintain the `lastAction` buffer and call `recordNavigation()`. The graph write is fire-and-forget. This handles BOTH Explore and Task modes from a single place.

- [ ] **Step 1: Add import for recordNavigation**

At the top of `server/src/agent.ts`, add:

```typescript
import { recordNavigation } from './nav-graph.js';
```

- [ ] **Step 2: Create session-scoped state variables in createAgent**

Inside `createAgent()`, after `let stepOrder = 0;` (around line 70), add:

```typescript
  // Session-scoped state for nav graph writes
  let lastAction: { label: string; selector?: string } | null = null;
  let previousUrl: string | null = null;
```

- [ ] **Step 3: Extend actionDone listener to update lastAction**

In the `actionDone` listener (around line 112), add after the existing `stepsHistory.push(...)` line:

```typescript
    // Update lastAction buffer for nav graph edge labels
    const actionLabel = target ? `${actionName}: ${target}` : actionName;
    lastAction = { label: actionLabel };
```

- [ ] **Step 4: Extend nav listener to call recordNavigation**

Replace the existing `nav` listener (lines 138-140):

```typescript
  // Listen for navigation events — update graph + broadcast
  agent.browserAgentEvents.on('nav', (navUrl: string) => {
    broadcast({ type: 'nav', url: navUrl });

    // Update session state
    session.currentUrl = navUrl;

    // Fire-and-forget graph update
    if (projectId) {
      const action = lastAction?.label;
      const selector = lastAction?.selector;
      lastAction = null; // Consume the action
      recordNavigation(projectId, previousUrl, navUrl, action, selector).catch(() => {});
    }
    previousUrl = navUrl;
  });
```

- [ ] **Step 5: Restructure createAgent to declare session before listeners**

The `nav` listener writes to `session.currentUrl`, so `session` must be declared before event listeners are set up. Restructure `createAgent()` in this order:

1. Call `startBrowserAgent()`, create `connector`, `stepsHistory`, `stepOrder`, `lastAction`, `previousUrl`
2. Get `currentPageUrl` and initialize `previousUrl`
3. **Declare `session` object** (with all fields including `currentUrl`)
4. Set up event listeners (they reference `session` via closure)
5. Emit initial screenshot and metrics
6. Return `session`

Replace the current return block (around line 160-178) and move the session declaration above the event listeners:

```typescript
  // Initialize previous URL for nav graph tracking
  const currentPageUrl = connector.getHarness().page.url();
  previousUrl = currentPageUrl;

  // Declare session BEFORE event listeners — listeners reference it via closure
  const session: AgentSession = {
    agent,
    connector,
    sessionId,
    projectId,
    memoryContext,
    stepsHistory,
    loginDone: Promise.resolve(),
    lastAction: null,
    currentUrl: currentPageUrl,
    close: async () => {
      agent.events.removeAllListeners();
      agent.browserAgentEvents.removeAllListeners();
    }
  };

  // --- Event listeners go here (they use `session` via closure) ---
  // ... thought listener ...
  // ... actionDone listener (with lastAction update from Step 3) ...
  // ... nav listener (with recordNavigation from Step 4) ...

  // Initial screenshot + metrics
  broadcast({ type: 'nav', url: currentPageUrl });
  // ... existing screenshot + metrics code ...

  return session;
```

**Note:** `lastAction` and `previousUrl` are **local closure variables** inside `createAgent()` — they are NOT properties on the `session` object. The `session.lastAction` field exists on `AgentSession` for external read access (e.g., `executeExplore` could read it), but the `nav` listener reads the local `lastAction` variable directly via closure. Keep `session.lastAction = null` as the initial value; the local `lastAction` variable is what the listeners actually use.

- [ ] **Step 6: Run full test suite**

Run: `cd browser-agent-chat && npm run test --workspace=server`
Expected: All tests PASS (existing agent tests may need mock updates for the new import)

- [ ] **Step 7: Commit**

```bash
git add server/src/agent.ts
git commit -m "feat(nav-graph): add passive graph writes via actionDone/nav listeners"
```

---

### Task 8: Agent — Explore Rewrite

**Files:**
- Modify: `server/src/agent.ts`

**Context:** Rewrite `executeExplore` from a single `agent.extract()` call to a loop of `agent.act()` → `agent.extract()` cycles. First, extract navigation items from the current page. Then visit each section and extract features. Graph writes happen automatically via the `nav` listener from Task 7. Feature suggestions include `discovered_at_url`.

- [ ] **Step 1: Update executeExplore with act/extract loop**

Replace the `executeExplore` function (starting at line 228):

```typescript
// Schema for navigation items visible on the page
const NavItemsSchema = z.object({
  items: z.array(z.object({
    label: z.string().describe('The clickable text label of the navigation item'),
    description: z.string().describe('Brief description of what section this leads to'),
  })),
});

export async function executeExplore(
  session: AgentSession,
  context: string | null,
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  console.log('[EXPLORE] Starting explore...');
  broadcast({ type: 'status', status: 'working' });

  await session.loginDone;
  console.log('[EXPLORE] Login done, starting exploration...');

  session.stepsHistory.length = 0;

  try {
    // Step 1: Identify navigation items on the current page
    const contextHint = context ? `\nContext about this app: ${context}` : '';
    broadcast({ type: 'thought', content: 'Scanning navigation structure...' });
    const navItems = await session.agent.extract(
      `List the main navigation items visible on this page (sidebar, top menu, tabs). For each, provide the exact clickable text label and a brief description of what section it leads to. Only include top-level navigation — not sub-items or dropdowns.${contextHint}`,
      NavItemsSchema
    );
    console.log('[EXPLORE] Found nav items:', navItems.items.map(i => i.label));

    // Step 2: Extract features from the current page first
    broadcast({ type: 'thought', content: 'Analyzing current page...' });
    const currentFeatures = await session.agent.extract(
      'Look at this application page carefully. Identify ALL features visible in the navigation, sidebar, main content, and any menus. For each feature, describe what it does and list expected behaviors. Also identify any multi-step flows. Be thorough.',
      ExtractedFeatureSchema
    );
    await createSuggestionsFromExtraction(session, currentFeatures, broadcast);

    // Step 3: Navigate to each section and extract features
    const maxSections = Math.min(navItems.items.length, 5);
    for (let i = 0; i < maxSections; i++) {
      const item = navItems.items[i];
      broadcast({ type: 'thought', content: `Navigating to ${item.label}...` });

      try {
        await session.agent.act(`Click on "${item.label}" in the navigation`);

        broadcast({ type: 'thought', content: `Analyzing ${item.label}...` });
        const pageFeatures = await session.agent.extract(
          'Look at this application page carefully. Identify ALL features visible in the navigation, sidebar, main content, and any menus. For each feature, describe what it does and list expected behaviors. Also identify any multi-step flows. Be thorough.',
          ExtractedFeatureSchema
        );
        await createSuggestionsFromExtraction(session, pageFeatures, broadcast);
      } catch (navErr) {
        console.error(`[EXPLORE] Failed to explore "${item.label}":`, navErr);
        broadcast({ type: 'thought', content: `Could not explore ${item.label}, continuing...` });
      }
    }

    const context_str = context ? ` Context: ${context}` : '';
    broadcast({ type: 'thought', content: `Exploration complete.${context_str}` });
    broadcast({ type: 'taskComplete', success: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Exploration failed';
    console.error('[EXPLORE] Failed:', errMsg);
    broadcast({ type: 'error', message: errMsg });
    broadcast({ type: 'taskComplete', success: false });
  } finally {
    broadcast({ type: 'status', status: 'idle' });
  }
}

/**
 * Helper: create feature/flow suggestions from extracted data, including discovered_at_url.
 */
async function createSuggestionsFromExtraction(
  session: AgentSession,
  extracted: z.infer<typeof ExtractedFeatureSchema>,
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  if (!session.projectId || !session.sessionId) return;

  for (const feature of extracted.features) {
    const suggestion = await createSuggestion(
      session.projectId,
      'feature',
      {
        name: feature.name,
        description: feature.description,
        criticality: feature.criticality,
        expected_behaviors: feature.expected_behaviors,
        discovered_at_url: session.currentUrl || undefined,
      },
      session.sessionId
    );
    if (suggestion) {
      broadcast({ type: 'suggestion', suggestion });
    }
  }

  for (const flow of extracted.flows) {
    const suggestion = await createSuggestion(
      session.projectId,
      'flow',
      {
        feature_name: flow.feature_name,
        name: flow.name,
        steps: flow.steps.map((s, i) => ({ order: i + 1, description: s })),
        checkpoints: [],
        criticality: flow.criticality,
      },
      session.sessionId
    );
    if (suggestion) {
      broadcast({ type: 'suggestion', suggestion });
    }
  }

  const total = extracted.features.length + extracted.flows.length;
  if (total > 0) {
    broadcast({ type: 'thought', content: `Discovered ${extracted.features.length} feature(s) and ${extracted.flows.length} flow(s).` });
  }
}
```

- [ ] **Step 2: Run full test suite**

Run: `cd browser-agent-chat && npm run test --workspace=server`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/agent.ts
git commit -m "feat(nav-graph): rewrite executeExplore as multi-page act/extract loop"
```

---

### Task 9: Suggestion Acceptance — Feature-to-Node Link

**Files:**
- Modify: `server/src/db.ts`

**Context:** When a feature suggestion with `discovered_at_url` is accepted, create a `nav_node_features` link connecting the feature to the page where it was discovered. The URL is normalized and looked up in `nav_nodes`. This is a best-effort operation — if the node doesn't exist, log a warning and skip.

- [ ] **Step 1: Add import for normalizeUrl**

At the top of `server/src/db.ts`, add:

```typescript
import { normalizeUrl } from './nav-graph.js';
```

- [ ] **Step 2: Modify acceptSuggestion to create nav_node_features link**

In the `acceptSuggestion` function, after the `createFeature` call in the `type === 'feature'` branch (around line 434), add the nav_node_features link logic:

```typescript
  if (type === 'feature') {
    const fd = suggData as FeatureSuggestionData;
    const created = await createFeature(projectId, fd.name, fd.description, fd.criticality, fd.expected_behaviors);

    // Link feature to nav node if discovery URL is known
    if (created && fd.discovered_at_url) {
      try {
        const urlPattern = normalizeUrl(fd.discovered_at_url);
        const { data: node } = await supabase!
          .from('nav_nodes')
          .select('id')
          .eq('project_id', projectId)
          .eq('url_pattern', urlPattern)
          .maybeSingle();

        if (node) {
          await supabase!
            .from('nav_node_features')
            .upsert(
              { nav_node_id: node.id, feature_id: created.id },
              { onConflict: 'nav_node_id,feature_id', ignoreDuplicates: true }
            );
        } else {
          console.warn(`[DB] No nav_node found for URL pattern "${urlPattern}" — skipping feature link`);
        }
      } catch (err) {
        console.warn('[DB] Failed to link feature to nav node:', err);
      }
    }
  }
```

**Important:** The existing code at line 434 does NOT capture the return value — it calls `await createFeature(...)` without assignment. You must change it to `const created = await createFeature(...)` as shown in the code above. The `createFeature` function returns `Feature | null`, so we need the returned feature to get its `id` for the `nav_node_features` link.

- [ ] **Step 3: Run full test suite**

Run: `cd browser-agent-chat && npm run test --workspace=server`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add server/src/db.ts
git commit -m "feat(nav-graph): link features to nav nodes on suggestion acceptance"
```

---

### Task 10: Apply Migration to Supabase

**Files:**
- Reference: `server/migrations/003_nav_graph.sql`

**Context:** Run the migration SQL against the Supabase project. The project ID is `nzgomknojsgampfqvabr` and the region is `ap-south-1`.

- [ ] **Step 1: Apply migration via Supabase MCP**

Use the Supabase MCP `apply_migration` tool to run the SQL from `server/migrations/003_nav_graph.sql` against the project.

Alternatively, use the `execute_sql` tool to run the SQL directly.

- [ ] **Step 2: Verify tables were created**

Use `list_tables` to confirm `nav_nodes`, `nav_edges`, and `nav_node_features` exist.

- [ ] **Step 3: Commit any migration tracking files**

If Supabase generates migration tracking files, stage them individually (do NOT use `git add -A` — other sessions may have uncommitted work).

```bash
git status
# Stage only migration-related files
git commit -m "chore: apply 003_nav_graph migration to Supabase"
```

---

## Final Verification

After all tasks are complete:

1. Run the full test suite: `cd browser-agent-chat && npm run test --workspace=server`
2. Verify all tests pass with no regressions
3. Review the complete diff against the spec to ensure all requirements are met
