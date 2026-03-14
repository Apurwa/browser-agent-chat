# Navigation/Feature Graph — Design Spec

**Phase:** A (of A → B → C → D Product Understanding Layer roadmap)
**Date:** 2026-03-14
**Status:** Approved

## Overview

Build an internal map of the application under test that the agent constructs incrementally through exploration and passive observation. The graph serves as the agent's spatial model — it knows what pages exist, how to navigate between them, and which features live where.

This is the foundation layer. Phases B (Continuous Learning), C (Feedback Reinforcement), and D (Muscle Memory / Playwright Recording) all build on top of this graph.

## Goals

1. Agent builds a navigation graph of any web application it interacts with
2. Graph grows from both dedicated exploration and passive task execution
3. Features (existing `memory_features`) are linked to specific pages via many-to-many relationships
4. Graph is serialized into the agent prompt so it can reason about app structure during tasks
5. Navigation nodes and edges are auto-committed (factual data); feature interpretations continue through the existing human-gated suggestion queue

## Non-Goals

- Visual site map UI (future work)
- Playwright recording/replay (Phase D)
- Automatic feature extraction during tasks (Phase B)
- Feedback-driven memory updates (Phase C)

## Architecture

### Graph Model

**Hybrid approach:** URL nodes as stable anchors, interaction edges as navigation paths.

- **Nodes** = pages/routes the agent has visited. Identified by normalized URL pattern.
- **Edges** = directed transitions between nodes, labeled with the user action that triggers them (e.g., "click Settings in sidebar") and optionally a Playwright selector.
- **Feature links** = many-to-many relationship between features and nodes. A feature like "Search" can appear on multiple pages; a page like `/dashboard` can host multiple features.

### URL Normalization

URLs are normalized before storage to deduplicate dynamic routes:

1. Strip query parameters (`?tab=general` → removed)
2. Strip hash fragments (`#section` → removed)
3. Collapse numeric path segments (`/users/123` → `/users/:id`)
4. Collapse UUID path segments (`/orders/a1b2c3d4-...` → `/orders/:id`)
5. Preserve meaningful path structure (`/settings/billing` stays as-is)

Two visits to `/users/456` and `/users/789` map to the same node `/users/:id`.

### Storage

Three new Supabase tables:

#### `nav_nodes`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | |
| `project_id` | uuid (FK → projects) | |
| `url_pattern` | text | Normalized URL pattern (e.g., `/users/:id`) |
| `page_title` | text | Page title as observed by agent |
| `description` | text | Brief description of the page's purpose |
| `first_seen_at` | timestamptz | When agent first visited this page |
| `last_seen_at` | timestamptz | Most recent visit |

**Unique constraint:** `(project_id, url_pattern)`

#### `nav_edges`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | |
| `project_id` | uuid (FK → projects) | |
| `from_node_id` | uuid (FK → nav_nodes) | Source page |
| `to_node_id` | uuid (FK → nav_nodes) | Destination page |
| `action_label` | text | Human-readable action (e.g., "click 'Users' in sidebar") |
| `selector` | text (nullable) | Playwright selector for the triggering element |
| `discovered_at` | timestamptz | When this edge was first observed |

**Unique constraint:** `(project_id, from_node_id, to_node_id, action_label)`

#### `nav_node_features`

| Column | Type | Description |
|--------|------|-------------|
| `nav_node_id` | uuid (FK → nav_nodes) | |
| `feature_id` | uuid (FK → memory_features) | |

**Primary key:** `(nav_node_id, feature_id)`

### Write Paths

#### 1. Explore Mode (Active Discovery)

**Current state:** `executeExplore` currently does single-page `agent.extract()` only — it does NOT navigate between pages despite `buildExplorePrompt` suggesting multi-page exploration. Phase A changes `executeExplore` to use `agent.act()` for actual multi-page navigation.

**Modified `executeExplore` behavior:**

1. `executeExplore` runs a loop of `agent.act()` → `agent.extract()` cycles. Each cycle navigates to a section (via `act()`) then extracts features from that page (via `extract()`). The loop iterates over the main navigation items (3-5 sections, as defined by the explore prompt).
2. Graph writes happen automatically via the `createAgent()` listeners (see Action-to-navigation correlation below) — `executeExplore` does NOT call `recordNavigation` directly.
3. Feature extraction via `agent.extract()` happens once per cycle, on whatever page the agent lands on after `act()` completes.
4. Extracted features go through the suggestion queue (human-gated, unchanged).
5. When a suggestion is accepted, a `nav_node_features` link is created connecting the feature to the page(s) where it was discovered.
6. Nodes and edges are **auto-committed** — no suggestion queue. The agent visited the URL; it exists.

**Action-to-navigation correlation:** Both Explore and Task modes need to correlate `actionDone` events with subsequent `nav` events. The `AgentSession` object gets a new `lastAction: { label: string, selector?: string } | null` field. The existing `actionDone` and `nav` listeners in `createAgent()` are extended (not duplicated) to maintain this buffer:

- On `actionDone`: store `"${action.variant}: ${action.target || action.content}"` as the label (e.g., `"click: Settings"`, `"type: search query"`). This matches the existing formatting at agent.ts line 121.
- On `nav`: consume `session.lastAction` as the edge's action label, then reset to null. If `nav` fires with no preceding `actionDone` (e.g., redirect), the edge gets an empty action label.

The graph write logic (calling `navGraph.recordNavigation`) lives in the existing `createAgent()` listeners — it is NOT duplicated in `executeExplore`/`executeTask`.

#### 2. Task Execution (Passive Updates)

During `executeTask`, lightweight graph updates happen as a side effect:

1. On each `actionDone` event, store the action description in a `lastAction` buffer (same mechanism as Explore Mode).
2. On each `nav` event (URL change), normalize the URL and upsert a `nav_node`.
3. If there was a previous URL, create a `nav_edge` using `lastAction` as the action label (may be empty if no `actionDone` preceded the `nav`). Reset `lastAction` to null.
4. Update `last_seen_at` on existing nodes.

**Note:** The `nav` event (agent.ts line 138) provides only the URL string. The action label comes from correlating with the most recent `actionDone` event via the `lastAction` buffer. Passive edges may have empty action labels when navigation occurs without a tracked action (e.g., server-side redirects).

This is a **fire-and-forget** write — it should not block or slow down task execution. Errors are logged and swallowed.

### Read Path

The navigation graph is serialized alongside existing product knowledge and injected into the agent prompt.

**Current behavior:** `loadMemoryContext()` is called once during `createAgent()` and cached in `session.memoryContext`. This means graph updates during a session won't appear in subsequent task prompts within the same session. Phase A accepts this limitation — the graph is primarily useful across sessions. Phase B may address per-task reloading if needed.

**Serialization format:**

```
SITE MAP:
/dashboard → "Dashboard" [features: Analytics Overview, Quick Actions]
  → /settings (click "Settings" in sidebar)
  → /users (click "Users" in sidebar)
/users → "User Management" [features: User List, User Search]
  → /users/:id (click any user row)
/users/:id → "User Detail" [features: User Profile, Role Assignment]
  → /users (click "Back to list")
```

This gives the agent:
- Awareness of all known pages
- How to navigate between them (action labels)
- Which features live where
- A mental model of the app's information architecture

### Graph size management

For large apps, the full graph may exceed reasonable prompt size. Strategies:

- **Depth limit:** Serialize only nodes within N hops of the current page (default: 3).
- **Relevance filtering:** If the task mentions a specific feature, prioritize nodes linked to that feature.
- **Token budget:** Cap serialized graph at ~2000 tokens. If exceeded, summarize distant branches.

These are implemented as options on the serialization function, not separate modules.

## New Server Module

### `server/src/nav-graph.ts`

Single module responsible for all graph operations:

- `normalizeUrl(url: string): string` — URL normalization (strip params, collapse IDs)
- `upsertNode(projectId, url, title?, description?): Promise<NavNode>` — Create or update a node
- `upsertEdge(projectId, fromNodeId, toNodeId, actionLabel, selector?): Promise<NavEdge>` — Create or update an edge
- `linkFeatureToNode(nodeId, featureId): Promise<void>` — Create feature-node association
- `getGraph(projectId): Promise<NavGraph>` — Load full graph for a project. Queries `nav_nodes` and `nav_edges` by project_id, then queries `nav_node_features` for all returned node IDs to populate the `features` array on each node. Three queries total (not a join, for simplicity).
- `serializeGraph(graph, options?): string` — Serialize to prompt-friendly text
- `recordNavigation(projectId, fromUrl, toUrl, action?, selector?): Promise<void>` — High-level helper for passive updates (combines normalize + upsert node + upsert edge)

### Types

```typescript
interface NavNode {
  id: string;
  projectId: string;
  urlPattern: string;
  pageTitle: string;
  description: string;
  firstSeenAt: string;  // ISO 8601 timestamptz from Supabase
  lastSeenAt: string;
  features: string[]; // feature IDs
}

interface NavEdge {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  actionLabel: string;
  selector: string | null;
  discoveredAt: string;  // ISO 8601 timestamptz from Supabase
}

interface NavGraph {
  nodes: NavNode[];
  edges: NavEdge[];
}
```

## Modified Modules

### `memory-engine.ts`

- `loadMemoryContext()` (the async function, not the pure `serializeMemory()`) extended to also load and serialize the nav graph
- After calling `serializeMemory(features)`, calls `navGraph.getGraph(projectId)` + `navGraph.serializeGraph(graph)` and appends the SITE MAP block after the PRODUCT KNOWLEDGE block
- `serializeMemory()` remains a pure synchronous function — it is NOT modified

### `agent.ts`

- **`createAgent`**: Extend existing `actionDone` listener to update `session.lastAction` buffer. Extend existing `nav` listener to call `navGraph.recordNavigation()` with `session.lastAction` (fire-and-forget). This handles graph writes for BOTH Explore and Task modes from a single place.
- **`executeExplore`**: Rewrite to loop `agent.act()` → `agent.extract()` for multi-page navigation + per-page feature extraction. Associate extracted features with the current nav node via `navGraph.linkFeatureToNode()`.
- **`executeTask`**: No graph-specific changes needed — the `createAgent()` listeners handle passive updates automatically.

### `db.ts`

- Add query functions for `nav_nodes`, `nav_edges`, `nav_node_features` tables (these are called from `nav-graph.ts`, not directly from agent code)
- Modify `acceptSuggestion` to create `nav_node_features` link when accepting a feature suggestion that has `discovered_at_url` in its data payload:
  1. After inserting the feature into `memory_features`, check if `suggestion.data.discovered_at_url` exists
  2. Normalize the URL via `navGraph.normalizeUrl()`
  3. Look up the `nav_node` by `(project_id, url_pattern)` — it should exist since the agent visited it
  4. If found, insert into `nav_node_features(nav_node_id, feature_id)` with `ON CONFLICT DO NOTHING`
  5. If the node doesn't exist (edge case — data race or URL mismatch), log a warning and skip

### Suggestion data extension

When the agent discovers a feature during Explore, the suggestion's `data` payload includes the URL where it was found. This is the `discovered_at_url` field — stored in the suggestion's JSON `data` column, NOT as a separate database column:

```typescript
interface FeatureSuggestionData {
  name: string;
  description: string;
  criticality: Criticality;
  expected_behaviors: string[];
  discovered_at_url?: string; // NEW — URL where feature was observed
}
```

When the suggestion is accepted, `discovered_at_url` is normalized and used to look up the `nav_node`, then create the `nav_node_features` link.

## Migration

New Supabase migration `003_nav_graph.sql` (next after existing `002_memory_suggestions.sql`):

```sql
-- Navigation nodes (pages/routes)
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

## Testing Strategy

- **Unit tests** for `nav-graph.ts`: URL normalization (parameterized tests for various URL patterns), graph serialization, node/edge dedup logic
- **Integration tests** for passive updates: mock navigation events, verify nodes/edges created
- **Existing tests** must continue to pass — no changes to suggestion-detector, json-parser, or session persistence tests

## Error Handling

- All passive graph updates are **fire-and-forget**: wrapped in try/catch, errors logged, never block task execution
- Supabase unique constraint violations on upsert are expected (duplicate node/edge) and silently ignored via `ON CONFLICT DO UPDATE SET last_seen_at = now()`
- Graph serialization gracefully handles empty graphs (returns empty string, no SITE MAP block in prompt)

## Future Phases (Not in This Spec)

- **Phase B: Continuous Learning** — Agent proposes features/flows during task execution, not just Explore
- **Phase C: Feedback Reinforcement** — User corrections update the graph and feature memory
- **Phase D: Muscle Memory** — Playwright selector recording on edges, replay for known navigation paths
