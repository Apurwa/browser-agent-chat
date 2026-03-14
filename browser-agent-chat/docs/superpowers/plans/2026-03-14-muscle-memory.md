# Muscle Memory Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the browser agent progressively faster by recording and replaying login flows and navigation shortcuts via direct Playwright automation, bypassing the LLM for known interactions.

**Architecture:** New `muscle-memory.ts` module handles pattern recording, replay, and self-healing. Patterns are stored in a `learned_patterns` Supabase table. Login recording uses DOM inspection in a new tab; navigation replay uses BFS path-finding on the existing nav graph with text-based Playwright locators. Agent integration follows a replay-first → LLM-fallback strategy.

**Tech Stack:** TypeScript, Playwright (via magnitude-core's `BrowserConnector`), Supabase (PostgreSQL), Vitest

**Spec:** `docs/superpowers/specs/2026-03-14-muscle-memory-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `server/migrations/004_learned_patterns.sql` | **Create** — `learned_patterns` table + `raw_target` column on `nav_edges` |
| `server/src/types.ts` | **Modify** — Add `LearnedPattern`, `LoginTrigger`, `PlaywrightStep` interfaces; add `rawTarget` to `NavEdge` |
| `server/src/nav-graph.ts` | **Modify** — Accept `title` in `recordNavigation`, accept `rawTarget` in `upsertEdge`, update `mapNavEdge` |
| `server/src/muscle-memory.ts` | **Create** — All muscle memory logic: DB ops, recording, replay, helpers |
| `server/src/agent.ts` | **Modify** — Load patterns, replay-first login, nav shortcuts, pass page title + raw target to nav graph |
| `server/__tests__/muscle-memory.test.ts` | **Create** — Unit tests for muscle-memory module |
| `server/__tests__/nav-graph.test.ts` | **Modify** — Add tests for `rawTarget` in edge mapping and `recordNavigation` with title |

---

## Chunk 1: Foundation — Migration, Types, Nav Graph Enhancements

### Task 1: Database Migration

**Files:**
- Create: `server/migrations/004_learned_patterns.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Learned patterns (login flows, navigation shortcuts)
CREATE TABLE learned_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('login', 'navigation')),
  trigger JSONB NOT NULL,
  steps JSONB NOT NULL,
  consecutive_failures INT DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stale')),
  use_count INT DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Only one active login pattern per project
CREATE UNIQUE INDEX learned_patterns_project_type_login
  ON learned_patterns (project_id, pattern_type)
  WHERE pattern_type = 'login';

CREATE INDEX idx_learned_patterns_project ON learned_patterns(project_id);

ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their project patterns"
  ON learned_patterns FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- Add raw_target column to nav_edges for cleaner text during replay
ALTER TABLE nav_edges ADD COLUMN raw_target TEXT;

-- RPC function to atomically increment use_count
CREATE OR REPLACE FUNCTION increment_pattern_use_count(pattern_uuid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE learned_patterns
  SET use_count = use_count + 1
  WHERE id = pattern_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Verify migration file exists**

Run: `ls -la browser-agent-chat/server/migrations/004_learned_patterns.sql`
Expected: File listed with correct size

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/server/migrations/004_learned_patterns.sql
git commit -m "feat(db): add learned_patterns table and raw_target column on nav_edges"
```

---

### Task 2: TypeScript Types

**Files:**
- Modify: `server/src/types.ts:126-146` (NavEdge interface, add after existing types)

- [ ] **Step 1: Add LearnedPattern, LoginTrigger, PlaywrightStep interfaces to types.ts**

Add after line 151 (after `NavGraph` interface) in `server/src/types.ts`:

```typescript
// === Muscle Memory ===

export interface LearnedPattern {
  id: string;
  project_id: string;
  pattern_type: 'login' | 'navigation';
  trigger: LoginTrigger;
  steps: PlaywrightStep[];
  consecutive_failures: number;
  status: 'active' | 'stale';
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoginTrigger {
  type: 'login';
  url_pattern: string;
}

export interface PlaywrightStep {
  action: 'fill' | 'click' | 'type' | 'press';
  selector: string;
  value?: string;
  waitAfter?: number;
}
```

- [ ] **Step 2: Add `rawTarget` to NavEdge interface**

In `server/src/types.ts`, update the `NavEdge` interface (lines 138-146) to add `rawTarget`:

```typescript
export interface NavEdge {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  actionLabel: string;
  selector: string | null;
  rawTarget: string | null;  // <-- ADD THIS
  discoveredAt: string;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd browser-agent-chat && npx tsc --noEmit --project server/tsconfig.json 2>&1 | head -20`
Expected: Compilation errors in files that use NavEdge (nav-graph.ts) — expected, we'll fix in Task 3

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/server/src/types.ts
git commit -m "feat(types): add LearnedPattern, LoginTrigger, PlaywrightStep interfaces and rawTarget to NavEdge"
```

---

### Task 3: Nav Graph Enhancements

**Files:**
- Modify: `server/src/nav-graph.ts:96-106` (mapNavEdge), `server/src/nav-graph.ts:140-168` (upsertEdge), `server/src/nav-graph.ts:189-209` (recordNavigation)
- Modify: `server/__tests__/nav-graph.test.ts`

- [ ] **Step 1: Write failing test — mapNavEdge includes rawTarget**

Add to `server/__tests__/nav-graph.test.ts` in the `upsertEdge` describe block, after the existing test:

```typescript
it('maps raw_target from row to rawTarget', async () => {
  const row = {
    id: 'e1', project_id: 'p1', from_node_id: 'n1', to_node_id: 'n2',
    action_label: 'click: Settings', selector: null,
    raw_target: 'Settings gear icon',
    discovered_at: '2026-01-01T00:00:00Z',
  };
  mockFrom.mockReturnValue({
    upsert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: row, error: null }),
      }),
    }),
  });

  const result = await upsertEdge('p1', 'n1', 'n2', 'click: Settings', undefined, 'Settings gear icon');

  expect(result).toEqual(expect.objectContaining({
    rawTarget: 'Settings gear icon',
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/nav-graph.test.ts 2>&1 | tail -20`
Expected: FAIL — `upsertEdge` doesn't accept 6th arg, `rawTarget` not in mapped result

- [ ] **Step 3: Update mapNavEdge to include rawTarget**

In `server/src/nav-graph.ts`, update `mapNavEdge` (lines 96-106):

```typescript
function mapNavEdge(row: any): NavEdge {
  return {
    id: row.id,
    projectId: row.project_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    actionLabel: row.action_label,
    selector: row.selector,
    rawTarget: row.raw_target ?? null,
    discoveredAt: row.discovered_at,
  };
}
```

- [ ] **Step 4: Update upsertEdge to accept rawTarget parameter**

In `server/src/nav-graph.ts`, update `upsertEdge` signature and payload (lines 140-168):

```typescript
export async function upsertEdge(
  projectId: string,
  fromNodeId: string,
  toNodeId: string,
  actionLabel: string,
  selector?: string,
  rawTarget?: string,
): Promise<NavEdge | null> {
  if (!isSupabaseEnabled()) return null;

  const payload: Record<string, string> = {
    project_id: projectId,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    action_label: actionLabel || '',
  };
  if (selector) payload.selector = selector;
  if (rawTarget) payload.raw_target = rawTarget;

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
```

- [ ] **Step 5: Update recordNavigation to accept title and rawTarget, pass them through**

In `server/src/nav-graph.ts`, update `recordNavigation` (lines 189-209):

```typescript
export async function recordNavigation(
  projectId: string,
  fromUrl: string | null,
  toUrl: string,
  action?: string,
  selector?: string,
  title?: string,
  rawTarget?: string,
): Promise<void> {
  try {
    const toNode = await upsertNode(projectId, toUrl, title);
    if (!toNode) return;

    if (fromUrl) {
      const fromNode = await upsertNode(projectId, fromUrl);
      if (fromNode && fromNode.id !== toNode.id) {
        await upsertEdge(projectId, fromNode.id, toNode.id, action || '', selector, rawTarget);
      }
    }
  } catch (err) {
    console.error('[NAV-GRAPH] recordNavigation error:', err);
  }
}
```

- [ ] **Step 6: Update serializeGraph to handle rawTarget in NavEdge**

No changes needed — `serializeGraph` only uses `actionLabel`, not `rawTarget`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/nav-graph.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add browser-agent-chat/server/src/nav-graph.ts browser-agent-chat/server/__tests__/nav-graph.test.ts
git commit -m "feat(nav-graph): add rawTarget to edges, pass title to upsertNode via recordNavigation"
```

---

### Task 4: Agent Nav Handler — Pass Page Title and Raw Target

**Files:**
- Modify: `server/src/agent.ts:159-204` (actionDone and nav handlers)

- [ ] **Step 1: Store raw target in lastAction from actionDone handler**

In `server/src/agent.ts`, update the `actionDone` handler (lines 159-189). Change the `lastAction` assignment at line 167:

```typescript
// Update lastAction buffer for nav graph edge labels
const actionLabel = target ? `${actionName}: ${target}` : actionName;
lastAction = { label: actionLabel, rawTarget: target as string | undefined };
```

Also update the `lastAction` type declaration at line 92:

```typescript
let lastAction: { label: string; selector?: string; rawTarget?: string } | null = null;
```

And update the `AgentSession` interface at line 22:

```typescript
/** Last action performed — consumed by nav listener for edge labels. */
lastAction: { label: string; selector?: string; rawTarget?: string } | null;
```

- [ ] **Step 2: Pass page title and raw target in nav handler**

In `server/src/agent.ts`, update the `nav` handler (lines 192-204):

```typescript
// Listen for navigation events — update graph + broadcast
agent.browserAgentEvents.on('nav', async (navUrl: string) => {
  broadcast({ type: 'nav', url: navUrl });

  // Fire-and-forget graph update
  if (projectId) {
    const action = lastAction?.label;
    const selector = lastAction?.selector;
    const rawTarget = lastAction?.rawTarget;
    lastAction = null; // Consume the action

    // Get page title for nav node
    let title = '';
    try {
      title = await connector.getHarness().page.title();
    } catch {}

    recordNavigation(projectId, previousUrl, navUrl, action, selector, title, rawTarget).catch(() => {});
  }
  previousUrl = navUrl;
  session.currentUrl = navUrl;
});
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit --project server/tsconfig.json 2>&1 | head -20`
Expected: No errors (or only unrelated warnings)

- [ ] **Step 4: Run existing tests**

Run: `cd browser-agent-chat/server && npx vitest run 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/agent.ts
git commit -m "feat(agent): pass page title and raw target to nav graph on navigation events"
```

---

## Chunk 2: Muscle Memory Core — DB Operations & Pure Helpers

### Task 5: Muscle Memory Module — DB Operations

**Files:**
- Create: `server/src/muscle-memory.ts`
- Create: `server/__tests__/muscle-memory.test.ts`

- [ ] **Step 1: Write failing tests for loadPatterns**

Create `server/__tests__/muscle-memory.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock('../src/supabase.js', () => ({
  isSupabaseEnabled: vi.fn().mockReturnValue(true),
  supabase: { from: mockFrom },
}));
vi.mock('../src/nav-graph.js', () => ({
  getGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  normalizeUrl: vi.fn((url: string) => {
    try { return new URL(url).pathname; } catch { return url; }
  }),
}));

import { loadPatterns, markStale, markSuccess } from '../src/muscle-memory.js';

describe('loadPatterns', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns active patterns for a project', async () => {
    const rows = [{
      id: 'p1', project_id: 'proj1', pattern_type: 'login',
      trigger: { type: 'login', url_pattern: '/login' },
      steps: [{ action: 'fill', selector: 'input[type="email"]', value: '{{username}}' }],
      consecutive_failures: 0, status: 'active', use_count: 5,
      last_used_at: null, created_at: '2026-01-01', updated_at: '2026-01-01',
    }];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    });

    const result = await loadPatterns('proj1');
    expect(result).toHaveLength(1);
    expect(result[0].pattern_type).toBe('login');
    expect(mockFrom).toHaveBeenCalledWith('learned_patterns');
  });

  it('returns empty array when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);
    const result = await loadPatterns('proj1');
    expect(result).toEqual([]);
  });
});

describe('markStale', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sets status to stale for a pattern', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    await markStale('pattern-1');

    expect(mockFrom).toHaveBeenCalledWith('learned_patterns');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'stale',
    }));
  });
});

describe('markSuccess', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('resets failures and increments use_count', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    await markSuccess('pattern-1');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      consecutive_failures: 0,
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/muscle-memory.test.ts 2>&1 | tail -20`
Expected: FAIL — module `../src/muscle-memory.js` not found

- [ ] **Step 3: Create muscle-memory.ts with DB operations**

Create `server/src/muscle-memory.ts`:

```typescript
import { supabase, isSupabaseEnabled } from './supabase.js';
import { getGraph, normalizeUrl } from './nav-graph.js';
import type { LearnedPattern, PlaywrightStep, NavNode, NavEdge, NavGraph } from './types.js';

// ─── DB Operations ────────────────────────────────────────────────

/** Load active patterns for a project. */
export async function loadPatterns(projectId: string): Promise<LearnedPattern[]> {
  if (!isSupabaseEnabled()) return [];

  const { data, error } = await supabase!
    .from('learned_patterns')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'active');

  if (error || !data) {
    console.error('[MUSCLE-MEMORY] loadPatterns error:', error);
    return [];
  }
  return data;
}

/** Mark a pattern as stale (stop attempting replay). */
export async function markStale(patternId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const { error } = await supabase!
    .from('learned_patterns')
    .update({ status: 'stale', updated_at: new Date().toISOString() })
    .eq('id', patternId);

  if (error) console.error('[MUSCLE-MEMORY] markStale error:', error);
}

/** Reset failures and increment use count on successful replay. */
export async function markSuccess(patternId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  // Reset failures and update timestamps; use_count incremented atomically via RPC
  const { error } = await supabase!
    .from('learned_patterns')
    .update({
      consecutive_failures: 0,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', patternId);

  if (error) console.error('[MUSCLE-MEMORY] markSuccess error:', error);

  // Atomically increment use_count
  await supabase!.rpc('increment_pattern_use_count', { pattern_uuid: patternId }).catch(() => {});
}

/** Increment consecutive_failures; mark stale if >= 3. */
export async function incrementFailures(patternId: string, currentFailures: number): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const newCount = currentFailures + 1;
  const updates: Record<string, unknown> = {
    consecutive_failures: newCount,
    updated_at: new Date().toISOString(),
  };
  if (newCount >= 3) {
    updates.status = 'stale';
  }

  const { error } = await supabase!
    .from('learned_patterns')
    .update(updates)
    .eq('id', patternId);

  if (error) console.error('[MUSCLE-MEMORY] incrementFailures error:', error);
}

/** Upsert a login pattern for a project (manual query since partial unique index). */
export async function upsertLoginPattern(
  projectId: string,
  loginUrl: string,
  steps: PlaywrightStep[],
): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const urlPattern = normalizeUrl(loginUrl);

  // Check for existing login pattern (partial unique index can't be used with .upsert())
  const { data: existing } = await supabase!
    .from('learned_patterns')
    .select('id')
    .eq('project_id', projectId)
    .eq('pattern_type', 'login')
    .limit(1)
    .maybeSingle();

  const payload = {
    project_id: projectId,
    pattern_type: 'login' as const,
    trigger: { type: 'login', url_pattern: urlPattern },
    steps,
    consecutive_failures: 0,
    status: 'active' as const,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase!
      .from('learned_patterns')
      .update(payload)
      .eq('id', existing.id);
    if (error) console.error('[MUSCLE-MEMORY] upsertLoginPattern update error:', error);
  } else {
    const { error } = await supabase!
      .from('learned_patterns')
      .insert(payload);
    if (error) console.error('[MUSCLE-MEMORY] upsertLoginPattern insert error:', error);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/muscle-memory.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/muscle-memory.ts browser-agent-chat/server/__tests__/muscle-memory.test.ts
git commit -m "feat(muscle-memory): add DB operations — loadPatterns, markStale, markSuccess, incrementFailures, upsertLoginPattern"
```

---

### Task 6: Pure Helpers — findFirstVisible, tryLocators, findPath, findNodeByUrlOrTitle

**Files:**
- Modify: `server/src/muscle-memory.ts`
- Modify: `server/__tests__/muscle-memory.test.ts`

- [ ] **Step 1: Write failing tests for credential placeholder injection**

Add to `server/__tests__/muscle-memory.test.ts`:

```typescript
import { injectCredentials } from '../src/muscle-memory.js';

describe('injectCredentials', () => {
  it('replaces {{username}} and {{password}} placeholders', () => {
    const steps: PlaywrightStep[] = [
      { action: 'fill', selector: 'input[type="email"]', value: '{{username}}' },
      { action: 'fill', selector: 'input[type="password"]', value: '{{password}}' },
      { action: 'click', selector: 'button[type="submit"]' },
    ];
    const result = injectCredentials(steps, { username: 'user@test.com', password: 's3cret' });
    expect(result[0].value).toBe('user@test.com');
    expect(result[1].value).toBe('s3cret');
    expect(result[2].value).toBeUndefined();
  });

  it('returns steps unchanged when no placeholders', () => {
    const steps: PlaywrightStep[] = [
      { action: 'click', selector: 'button' },
    ];
    const result = injectCredentials(steps, { username: 'u', password: 'p' });
    expect(result).toEqual(steps);
  });
});
```

Also add import at top: `import type { PlaywrightStep } from '../src/types.js';`

- [ ] **Step 2: Write failing tests for findPath (BFS)**

Add to `server/__tests__/muscle-memory.test.ts`:

```typescript
import { findPath } from '../src/muscle-memory.js';
import type { NavGraph } from '../src/types.js';

describe('findPath', () => {
  it('finds direct edge between two nodes', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/a', pageTitle: 'A', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n2', projectId: 'p1', urlPattern: '/b', pageTitle: 'B', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [
        { id: 'e1', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'n2', actionLabel: 'click: B', selector: null, rawTarget: 'B', discoveredAt: '' },
      ],
    };
    const path = findPath(graph, 'n1', 'n2');
    expect(path).toHaveLength(1);
    expect(path[0].toNodeId).toBe('n2');
  });

  it('finds multi-hop path via BFS', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/a', pageTitle: 'A', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n2', projectId: 'p1', urlPattern: '/b', pageTitle: 'B', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n3', projectId: 'p1', urlPattern: '/c', pageTitle: 'C', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [
        { id: 'e1', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'n2', actionLabel: 'click: B', selector: null, rawTarget: 'B', discoveredAt: '' },
        { id: 'e2', projectId: 'p1', fromNodeId: 'n2', toNodeId: 'n3', actionLabel: 'click: C', selector: null, rawTarget: 'C', discoveredAt: '' },
      ],
    };
    const path = findPath(graph, 'n1', 'n3');
    expect(path).toHaveLength(2);
    expect(path[0].toNodeId).toBe('n2');
    expect(path[1].toNodeId).toBe('n3');
  });

  it('returns empty array when no path exists', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/a', pageTitle: 'A', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n2', projectId: 'p1', urlPattern: '/b', pageTitle: 'B', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [],
    };
    const path = findPath(graph, 'n1', 'n2');
    expect(path).toEqual([]);
  });

  it('returns empty array when from equals to', () => {
    const graph: NavGraph = { nodes: [], edges: [] };
    const path = findPath(graph, 'n1', 'n1');
    expect(path).toEqual([]);
  });
});
```

- [ ] **Step 3: Write failing tests for findNodeByUrlOrTitle**

Add to `server/__tests__/muscle-memory.test.ts`:

```typescript
import { findNodeByUrlOrTitle } from '../src/muscle-memory.js';

describe('findNodeByUrlOrTitle', () => {
  const nodes = [
    { id: 'n1', projectId: 'p1', urlPattern: '/dashboard', pageTitle: 'Dashboard', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
    { id: 'n2', projectId: 'p1', urlPattern: '/ai-studio/pipelines', pageTitle: 'Pipelines', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
    { id: 'n3', projectId: 'p1', urlPattern: '/settings', pageTitle: 'Account Settings', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
  ];

  it('matches exact page title (case insensitive)', () => {
    const result = findNodeByUrlOrTitle(nodes, 'pipelines');
    expect(result?.id).toBe('n2');
  });

  it('matches by URL path segment', () => {
    const result = findNodeByUrlOrTitle(nodes, 'dashboard');
    expect(result?.id).toBe('n1');
  });

  it('returns null when no match', () => {
    const result = findNodeByUrlOrTitle(nodes, 'nonexistent');
    expect(result).toBeNull();
  });

  it('prefers exact title match over URL match', () => {
    const result = findNodeByUrlOrTitle(nodes, 'Account Settings');
    expect(result?.id).toBe('n3');
  });
});
```

- [ ] **Step 4: Write failing tests for stripActionPrefix**

Add to `server/__tests__/muscle-memory.test.ts`:

```typescript
import { stripActionPrefix } from '../src/muscle-memory.js';

describe('stripActionPrefix', () => {
  it('strips "click: " prefix', () => {
    expect(stripActionPrefix('click: Pipelines')).toBe('Pipelines');
  });

  it('strips "type: " prefix', () => {
    expect(stripActionPrefix('type: search query')).toBe('search query');
  });

  it('returns original string when no prefix', () => {
    expect(stripActionPrefix('Pipelines')).toBe('Pipelines');
  });

  it('handles empty string', () => {
    expect(stripActionPrefix('')).toBe('');
  });
});
```

- [ ] **Step 5: Write failing test for incrementFailures stale detection**

Add to `server/__tests__/muscle-memory.test.ts`:

```typescript
import { incrementFailures } from '../src/muscle-memory.js';

describe('incrementFailures', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('increments consecutive_failures count', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    await incrementFailures('pattern-1', 1);

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      consecutive_failures: 2,
    }));
  });

  it('marks pattern stale when failures reach 3', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    await incrementFailures('pattern-1', 2);

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      consecutive_failures: 3,
      status: 'stale',
    }));
  });

  it('does not mark stale when failures below 3', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    await incrementFailures('pattern-1', 0);

    const updateArg = mockUpdate.mock.calls[0][0];
    expect(updateArg.consecutive_failures).toBe(1);
    expect(updateArg.status).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/muscle-memory.test.ts 2>&1 | tail -30`
Expected: FAIL — functions not exported from muscle-memory.js

- [ ] **Step 7: Implement the helper functions in muscle-memory.ts**

Add to `server/src/muscle-memory.ts`:

```typescript
// ─── Pure Helpers ─────────────────────────────────────────────────

/** Inject credential values into placeholder steps. */
export function injectCredentials(
  steps: PlaywrightStep[],
  credentials: { username: string; password: string },
): PlaywrightStep[] {
  return steps.map(step => {
    if (!step.value) return step;
    return {
      ...step,
      value: step.value
        .replace('{{username}}', credentials.username)
        .replace('{{password}}', credentials.password),
    };
  });
}

/** Strip action prefix from nav edge labels: "click: Pipelines" → "Pipelines" */
export function stripActionPrefix(label: string): string {
  return label.replace(/^\w+:\s*/, '').trim();
}

/** Find a nav node by page title or URL path segment. */
export function findNodeByUrlOrTitle(nodes: NavNode[], query: string): NavNode | null {
  const q = query.toLowerCase();

  // 1. Exact page_title match (strongest signal)
  const exactTitle = nodes.find(n =>
    n.pageTitle && n.pageTitle.toLowerCase() === q
  );
  if (exactTitle) return exactTitle;

  // 2. Word-boundary match on URL path segments
  const byUrl = nodes.find(n => {
    const segments = n.urlPattern.split('/').filter(Boolean);
    return segments.some(seg => seg.toLowerCase() === q);
  });
  if (byUrl) return byUrl;

  // 3. Substring match on page_title (weakest)
  return nodes.find(n =>
    n.pageTitle && n.pageTitle.toLowerCase().includes(q)
  ) || null;
}

/** BFS shortest path through nav edges. Operates on in-memory graph. */
export function findPath(graph: NavGraph, fromId: string, toId: string): NavEdge[] {
  if (fromId === toId) return [];

  // Build adjacency list
  const adj = new Map<string, NavEdge[]>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.fromNodeId)) adj.set(edge.fromNodeId, []);
    adj.get(edge.fromNodeId)!.push(edge);
  }

  // BFS
  const queue: Array<{ nodeId: string; path: NavEdge[] }> = [{ nodeId: fromId, path: [] }];
  const visited = new Set<string>([fromId]);

  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;
    for (const edge of adj.get(nodeId) || []) {
      if (edge.toNodeId === toId) return [...path, edge];
      if (!visited.has(edge.toNodeId)) {
        visited.add(edge.toNodeId);
        queue.push({ nodeId: edge.toNodeId, path: [...path, edge] });
      }
    }
  }
  return [];
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/muscle-memory.test.ts 2>&1 | tail -30`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add browser-agent-chat/server/src/muscle-memory.ts browser-agent-chat/server/__tests__/muscle-memory.test.ts
git commit -m "feat(muscle-memory): add pure helpers — injectCredentials, stripActionPrefix, findNodeByUrlOrTitle, findPath BFS"
```

---

## Chunk 3: Login Recording & Replay

### Task 7: Login Recording — DOM Inspection

**Files:**
- Modify: `server/src/muscle-memory.ts`
- Modify: `server/__tests__/muscle-memory.test.ts`

- [ ] **Step 1: Write failing test for findFirstVisible**

Add to `server/__tests__/muscle-memory.test.ts`:

```typescript
import { findFirstVisible } from '../src/muscle-memory.js';

describe('findFirstVisible', () => {
  it('returns the first visible selector', async () => {
    const mockPage = {
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn()
            .mockResolvedValueOnce(false)  // first selector not visible
            .mockResolvedValueOnce(true),  // second selector visible
        }),
      }),
    };

    // Mock locator to return different chains per call
    const isVisibleFn = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockPage.locator.mockReturnValue({
      first: vi.fn().mockReturnValue({
        isVisible: isVisibleFn,
      }),
    });

    const result = await findFirstVisible(mockPage as any, [
      'input[type="email"]',
      'input[name="username"]',
    ]);

    // Since both selectors use the same mock chain, the second call returns true
    // The function should return the selector where isVisible returned true
    expect(result).toBe('input[name="username"]');
  });

  it('returns null when no selectors are visible', async () => {
    const mockPage = {
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(false),
        }),
      }),
    };

    const result = await findFirstVisible(mockPage as any, ['input[type="email"]']);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/muscle-memory.test.ts -t "findFirstVisible" 2>&1 | tail -20`
Expected: FAIL — `findFirstVisible` not exported

- [ ] **Step 3: Implement findFirstVisible**

Add to `server/src/muscle-memory.ts`:

```typescript
// ─── DOM Inspection Helpers ───────────────────────────────────────

/** Find the first visible element matching one of the candidate selectors. */
export async function findFirstVisible(
  page: { locator: (selector: string) => { first: () => { isVisible: () => Promise<boolean> } } },
  selectors: string[],
): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const visible = await page.locator(selector).first().isVisible();
      if (visible) return selector;
    } catch {
      // Selector not found or page error — try next
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/muscle-memory.test.ts -t "findFirstVisible" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Implement recordLoginPattern (DOM inspection in new tab)**

Add to `server/src/muscle-memory.ts`:

```typescript
// ─── Login Recording ──────────────────────────────────────────────

const USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[type="text"][autocomplete="username"]',
  'input[type="text"]',
];

const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Sign in")',
  'button:has-text("Log in")',
  'button:has-text("Login")',
  'button:has-text("Submit")',
];

/**
 * Record a login pattern by inspecting the login page DOM in a new tab.
 * Called after successful LLM login to capture the form structure.
 */
export async function recordLoginPattern(
  page: any, // Playwright Page
  projectId: string,
  loginUrl: string,
): Promise<void> {
  if (!isSupabaseEnabled()) return;

  let inspectPage: any = null;
  try {
    // Open a new tab to inspect the login page without disrupting the main view
    const context = page.context();
    inspectPage = await context.newPage();
    await inspectPage.goto(loginUrl, { waitUntil: 'networkidle', timeout: 5000 });

    // Find form elements
    const usernameSelector = await findFirstVisible(inspectPage, USERNAME_SELECTORS);
    const passwordSelector = await findFirstVisible(inspectPage, PASSWORD_SELECTORS);
    const submitSelector = await findFirstVisible(inspectPage, SUBMIT_SELECTORS);

    if (!usernameSelector || !passwordSelector || !submitSelector) {
      console.warn('[MUSCLE-MEMORY] Could not identify all login form elements, skipping recording');
      return;
    }

    const steps: PlaywrightStep[] = [
      { action: 'fill', selector: usernameSelector, value: '{{username}}' },
      { action: 'fill', selector: passwordSelector, value: '{{password}}' },
      { action: 'click', selector: submitSelector },
    ];

    await upsertLoginPattern(projectId, loginUrl, steps);
    console.log('[MUSCLE-MEMORY] Login pattern recorded for project:', projectId);
  } catch (err) {
    console.error('[MUSCLE-MEMORY] recordLoginPattern error:', err);
  } finally {
    if (inspectPage) {
      await inspectPage.close().catch(() => {});
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/server/src/muscle-memory.ts browser-agent-chat/server/__tests__/muscle-memory.test.ts
git commit -m "feat(muscle-memory): add findFirstVisible helper and recordLoginPattern with new-tab DOM inspection"
```

---

### Task 8: Login Replay

**Files:**
- Modify: `server/src/muscle-memory.ts`
- Modify: `server/__tests__/muscle-memory.test.ts`

- [ ] **Step 1: Write failing test for replayLogin**

Add to `server/__tests__/muscle-memory.test.ts`:

```typescript
import { replayLogin } from '../src/muscle-memory.js';
import type { LearnedPattern } from '../src/types.js';

describe('replayLogin', () => {
  const makePattern = (overrides?: Partial<LearnedPattern>): LearnedPattern => ({
    id: 'pat-1',
    project_id: 'proj-1',
    pattern_type: 'login',
    trigger: { type: 'login', url_pattern: '/login' },
    steps: [
      { action: 'fill', selector: 'input[type="email"]', value: '{{username}}' },
      { action: 'fill', selector: 'input[type="password"]', value: '{{password}}' },
      { action: 'click', selector: 'button[type="submit"]' },
    ],
    consecutive_failures: 0,
    status: 'active',
    use_count: 3,
    last_used_at: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  });

  it('returns false when no active login pattern exists', async () => {
    const mockPage = {} as any;
    const result = await replayLogin(mockPage, [], { username: 'u', password: 'p' });
    expect(result).toBe(false);
  });

  it('returns false when only stale patterns exist', async () => {
    const mockPage = {} as any;
    const patterns = [makePattern({ status: 'stale' })];
    const result = await replayLogin(mockPage, patterns, { username: 'u', password: 'p' });
    expect(result).toBe(false);
  });

  it('returns false when pattern_type is not login', async () => {
    const mockPage = {} as any;
    const patterns = [makePattern({ pattern_type: 'navigation' })];
    const result = await replayLogin(mockPage, patterns, { username: 'u', password: 'p' });
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/muscle-memory.test.ts -t "replayLogin" 2>&1 | tail -20`
Expected: FAIL — `replayLogin` not exported

- [ ] **Step 3: Implement replayLogin**

Add to `server/src/muscle-memory.ts`:

```typescript
// ─── Login Replay ─────────────────────────────────────────────────

const LOGIN_REPLAY_TIMEOUT = 10_000;

/**
 * Attempt login via a recorded pattern.
 * Returns true if login succeeded, false if failed (caller should fall back to LLM).
 */
export async function replayLogin(
  page: any, // Playwright Page
  patterns: LearnedPattern[],
  credentials: { username: string; password: string },
): Promise<boolean> {
  const pattern = patterns.find(
    p => p.pattern_type === 'login' && p.status === 'active'
  );
  if (!pattern) return false;

  try {
    const steps = injectCredentials(pattern.steps, credentials);

    // Race against timeout
    const success = await Promise.race([
      executeSteps(page, steps),
      new Promise<false>(resolve => setTimeout(() => resolve(false), LOGIN_REPLAY_TIMEOUT)),
    ]);

    if (!success) return false;

    // Verify login succeeded
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const onLogin = /\/(login|signin|sign-in|auth)\b/i.test(page.url())
      || await page.locator('input[type="password"]').isVisible().catch(() => false);

    return !onLogin;
  } catch {
    return false;
  }
}

/** Execute a sequence of Playwright steps on a page. Returns true on success. */
async function executeSteps(page: any, steps: PlaywrightStep[]): Promise<boolean> {
  for (const step of steps) {
    try {
      await page.waitForSelector(step.selector, { timeout: 5000 });

      switch (step.action) {
        case 'fill':
          await page.fill(step.selector, step.value || '');
          break;
        case 'click':
          await page.click(step.selector);
          break;
        case 'type':
          await page.type(step.selector, step.value || '');
          break;
        case 'press':
          await page.keyboard.press(step.value || '');
          break;
      }

      if (step.waitAfter) {
        await page.waitForTimeout(step.waitAfter);
      }
    } catch {
      return false;
    }
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/muscle-memory.test.ts -t "replayLogin" 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/muscle-memory.ts browser-agent-chat/server/__tests__/muscle-memory.test.ts
git commit -m "feat(muscle-memory): add replayLogin with step execution and login verification"
```

---

## Chunk 4: Navigation Replay

### Task 9: Navigation Replay

**Files:**
- Modify: `server/src/muscle-memory.ts`
- Modify: `server/__tests__/muscle-memory.test.ts`

- [ ] **Step 1: Write failing test for replayNavigation returning false when no graph**

Add to `server/__tests__/muscle-memory.test.ts`:

```typescript
import { replayNavigation } from '../src/muscle-memory.js';
import { getGraph } from '../src/nav-graph.js';

describe('replayNavigation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns false when graph has no nodes', async () => {
    (getGraph as any).mockResolvedValue({ nodes: [], edges: [] });
    const mockPage = { url: () => 'https://app.com/dashboard' } as any;
    const result = await replayNavigation(mockPage, 'proj1', 'https://app.com/dashboard', 'Pipelines');
    expect(result).toBe(false);
  });

  it('returns false when target node not found', async () => {
    (getGraph as any).mockResolvedValue({
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/dashboard', pageTitle: 'Dashboard', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [],
    });
    const mockPage = { url: () => 'https://app.com/dashboard' } as any;
    const result = await replayNavigation(mockPage, 'proj1', 'https://app.com/dashboard', 'NonexistentPage');
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/muscle-memory.test.ts -t "replayNavigation" 2>&1 | tail -20`
Expected: FAIL — `replayNavigation` not exported

- [ ] **Step 3: Write test for tryLocators fallback chain**

Add to `server/__tests__/muscle-memory.test.ts`:

```typescript
import { tryLocators } from '../src/muscle-memory.js';

describe('tryLocators', () => {
  it('returns true when getByText matches', async () => {
    const mockPage = {
      getByText: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          click: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      getByRole: vi.fn(),
    };

    const result = await tryLocators(mockPage as any, 'Settings', 5000);
    expect(result).toBe(true);
    expect(mockPage.getByText).toHaveBeenCalledWith('Settings', { exact: false });
  });

  it('falls back to getByRole link when getByText fails', async () => {
    const mockPage = {
      getByText: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          click: vi.fn().mockRejectedValue(new Error('not found')),
        }),
      }),
      getByRole: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          click: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const result = await tryLocators(mockPage as any, 'Settings', 5000);
    expect(result).toBe(true);
    expect(mockPage.getByRole).toHaveBeenCalledWith('link', { name: 'Settings' });
  });

  it('returns false when all locators fail', async () => {
    const failClick = vi.fn().mockRejectedValue(new Error('not found'));
    const mockPage = {
      getByText: vi.fn().mockReturnValue({ first: vi.fn().mockReturnValue({ click: failClick }) }),
      getByRole: vi.fn().mockReturnValue({ first: vi.fn().mockReturnValue({ click: failClick }) }),
    };

    const result = await tryLocators(mockPage as any, 'NonExistent', 5000);
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 4: Implement tryLocators helper**

Add to `server/src/muscle-memory.ts`:

```typescript
// ─── Navigation Replay ───────────────────────────────────────────

const NAV_HOP_TIMEOUT = 5000;
const NAV_TOTAL_TIMEOUT = 15_000;

/** Try multiple Playwright locator strategies to click an element. */
export async function tryLocators(page: any, label: string, timeout: number): Promise<boolean> {
  // Try text match first (most common for nav items)
  try {
    await page.getByText(label, { exact: false }).first().click({ timeout });
    return true;
  } catch {}

  // Try link role
  try {
    await page.getByRole('link', { name: label }).first().click({ timeout });
    return true;
  } catch {}

  // Try button role
  try {
    await page.getByRole('button', { name: label }).first().click({ timeout });
    return true;
  } catch {}

  // Try menuitem role (for sidebar nav)
  try {
    await page.getByRole('menuitem', { name: label }).first().click({ timeout });
    return true;
  } catch {}

  return false;
}
```

- [ ] **Step 4: Implement replayNavigation**

Add to `server/src/muscle-memory.ts`:

```typescript
/**
 * Attempt navigation to a target page via recorded nav graph edges.
 * Uses BFS to find shortest path, then replays each hop with text-based locators.
 */
export async function replayNavigation(
  page: any, // Playwright Page
  projectId: string,
  currentUrl: string,
  targetQuery: string,
): Promise<boolean> {
  try {
    const graph = await getGraph(projectId);
    if (graph.nodes.length === 0) return false;

    // Resolve current node by URL
    const currentPattern = normalizeUrl(currentUrl);
    const currentNode = graph.nodes.find(n => n.urlPattern === currentPattern);
    if (!currentNode) return false;

    // Resolve target node by title/URL
    const targetNode = findNodeByUrlOrTitle(graph.nodes, targetQuery);
    if (!targetNode) return false;
    if (currentNode.id === targetNode.id) return true; // Already there

    // BFS shortest path
    const edges = findPath(graph, currentNode.id, targetNode.id);
    if (edges.length === 0) return false;

    // Race against total timeout
    const success = await Promise.race([
      replayEdges(page, edges),
      new Promise<false>(resolve => setTimeout(() => resolve(false), NAV_TOTAL_TIMEOUT)),
    ]);

    if (!success) return false;

    // Verify we arrived
    const finalPattern = normalizeUrl(page.url());
    return finalPattern === targetNode.urlPattern;
  } catch {
    return false;
  }
}

/** Replay a sequence of nav graph edges by clicking through pages. */
async function replayEdges(page: any, edges: NavEdge[]): Promise<boolean> {
  for (const edge of edges) {
    const textLabel = stripActionPrefix(edge.rawTarget || edge.actionLabel);
    if (!textLabel) return false;

    const clicked = await tryLocators(page, textLabel, NAV_HOP_TIMEOUT);
    if (!clicked) return false;

    try {
      await page.waitForLoadState('networkidle', { timeout: NAV_HOP_TIMEOUT });
    } catch {
      // Timeout waiting for network idle — continue anyway, page might be an SPA
    }
  }
  return true;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/muscle-memory.test.ts 2>&1 | tail -30`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/server/src/muscle-memory.ts browser-agent-chat/server/__tests__/muscle-memory.test.ts
git commit -m "feat(muscle-memory): add navigation replay with tryLocators fallback chain and BFS path finding"
```

---

## Chunk 5: Agent Integration

### Task 10: Load Patterns at Session Creation

**Files:**
- Modify: `server/src/agent.ts:12-28` (AgentSession interface), `server/src/agent.ts:45-57` (createAgent)

- [ ] **Step 1: Add `patterns` field to AgentSession interface**

In `server/src/agent.ts`, update the `AgentSession` interface (lines 12-28):

Add after line 17 (`memoryContext: string;`):

```typescript
  patterns: import('./types.js').LearnedPattern[];
```

Actually, add the import at the top of the file (after line 3):

```typescript
import type { LearnedPattern } from './types.js';
```

And update the interface:

```typescript
export interface AgentSession {
  agent: BrowserAgent;
  connector: BrowserConnector;
  sessionId: string | null;
  projectId: string | null;
  memoryContext: string;
  patterns: LearnedPattern[];
  stepsHistory: Array<{ order: number; action: string; target?: string }>;
  /** Resolves when background login finishes (or immediately if no login). */
  loginDone: Promise<void>;
  /** Last action performed — consumed by nav listener for edge labels. */
  lastAction: { label: string; selector?: string; rawTarget?: string } | null;
  /** Current page URL — updated on every nav event. */
  currentUrl: string | null;
  /** Active Langfuse trace — set during task/explore/login execution. */
  currentTrace: LangfuseTraceClient | null;
  close: () => Promise<void>;
}
```

- [ ] **Step 2: Load patterns in createAgent**

In `server/src/agent.ts`, add import at top (alongside other imports):

```typescript
import { loadPatterns, replayLogin, replayNavigation, recordLoginPattern, markSuccess, incrementFailures, findNodeByUrlOrTitle } from './muscle-memory.js';
```

Also update the existing `nav-graph.js` import (line 8) to include `getGraph`:

```typescript
import { recordNavigation, getGraph } from './nav-graph.js';
```

In the `createAgent` function, after line 56 (`const memoryContext = ...`), add:

```typescript
  const patterns = projectId ? await loadPatterns(projectId) : [];
  timer.step('load_patterns');
```

- [ ] **Step 3: Initialize patterns in the session object**

In `server/src/agent.ts`, update the `session` object literal (around line 108-123) to include `patterns`:

```typescript
  const session: AgentSession = {
    agent,
    connector,
    sessionId,
    projectId,
    memoryContext,
    patterns,
    stepsHistory,
    loginDone: Promise.resolve(),
    lastAction: null,
    currentUrl: currentPageUrl,
    currentTrace: null,
    close: async () => {
      agent.events.removeAllListeners();
      agent.browserAgentEvents.removeAllListeners();
    }
  };
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit --project server/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Run all tests**

Run: `cd browser-agent-chat/server && npx vitest run 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/server/src/agent.ts
git commit -m "feat(agent): load muscle memory patterns at session creation"
```

---

### Task 11: Integrate Replay-First Login

**Files:**
- Modify: `server/src/agent.ts:229-272` (executeLogin)

- [ ] **Step 1: Update executeLogin with replay-first logic**

In `server/src/agent.ts`, replace the `executeLogin` function (lines 229-272):

```typescript
export async function executeLogin(
  session: AgentSession,
  credentials: { username: string; password: string },
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  const page = session.connector.getHarness().page;
  const loginUrl = page.url(); // Capture login URL before any navigation

  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: 'login',
    metadata: { projectId: session.projectId, sessionId: session.sessionId },
    input: { username: credentials.username },
  }) ?? null;
  session.currentTrace = trace;

  // 1. Try muscle memory replay first
  if (session.patterns.length > 0) {
    broadcast({ type: 'thought', content: 'Replaying saved login pattern...' });
    const replaySpan = trace?.span({ name: 'muscle-memory-login-replay' });

    const startTime = Date.now();
    const success = await replayLogin(page, session.patterns, credentials);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (success) {
      replaySpan?.end({ output: { success: true, elapsed } });
      const pattern = session.patterns.find(p => p.pattern_type === 'login' && p.status === 'active');
      if (pattern) markSuccess(pattern.id).catch(() => {});

      broadcast({ type: 'thought', content: `Logged in via muscle memory (${elapsed}s)` });
      broadcast({ type: 'screenshot', data: (await page.screenshot({ type: 'png' })).toString('base64') });
      broadcast({ type: 'nav', url: page.url() });
      trace?.update({ output: { success: true, method: 'muscle-memory', elapsed } });
      session.currentTrace = null;
      return;
    }

    // Replay failed — increment failures
    replaySpan?.end({ output: { success: false, elapsed } });
    const pattern = session.patterns.find(p => p.pattern_type === 'login' && p.status === 'active');
    if (pattern) {
      incrementFailures(pattern.id, pattern.consecutive_failures).catch(() => {});
    }
    broadcast({ type: 'thought', content: 'Saved login pattern failed, using AI agent...' });
  } else {
    broadcast({ type: 'thought', content: 'Logging in...' });
  }

  // 2. Fall back to LLM agent
  try {
    const span = trace?.span({ name: 'agent-act-login' });
    await session.agent.act(`Log in with username "${credentials.username}" and password "${credentials.password}"`);
    span?.end({ output: { success: true } });
    console.log('[LOGIN] Done, URL:', page.url());
  } catch (err) {
    console.error('[LOGIN] Failed:', err);
    trace?.update({ output: { success: false, error: String(err) } });
    session.currentTrace = null;
    broadcast({ type: 'error', message: 'Auto-login failed. You can log in via chat.' });
    return;
  }

  // 3. Capture post-login state
  try {
    const buf = await page.screenshot({ type: 'png' });
    broadcast({ type: 'screenshot', data: buf.toString('base64') });
    broadcast({ type: 'nav', url: page.url() });

    const onLogin = /\/(login|signin|sign-in|auth)\b/i.test(page.url())
      || await page.locator('input[type="password"]').isVisible().catch(() => false);
    broadcast({ type: 'thought', content: onLogin
      ? 'Could not log in. Please log in via chat.'
      : 'Logged in successfully' });
    trace?.update({ output: { success: !onLogin, method: 'llm', url: page.url() } });

    // 4. Record login pattern for next time (background, fire-and-forget)
    if (!onLogin && session.projectId) {
      recordLoginPattern(page, session.projectId, loginUrl).catch(err => {
        console.error('[MUSCLE-MEMORY] Background recording error:', err);
      });
    }
  } catch {}
  session.currentTrace = null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit --project server/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Run all tests**

Run: `cd browser-agent-chat/server && npx vitest run 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/server/src/agent.ts
git commit -m "feat(agent): integrate muscle memory replay-first login with LLM fallback and background recording"
```

---

### Task 12: Integrate Navigation Shortcuts in executeTask

**Files:**
- Modify: `server/src/agent.ts:433-482` (executeTask)

- [ ] **Step 1: Update executeTask with nav shortcut detection**

In `server/src/agent.ts`, replace the `executeTask` function (lines 433-482):

```typescript
export async function executeTask(
  session: AgentSession,
  task: string,
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  broadcast({ type: 'status', status: 'working' });

  // Wait for login to finish before using the agent
  await session.loginDone;

  if (session.sessionId) {
    await saveMessage(session.sessionId, 'user', task);
  }

  // Build prompt with memory context
  const prompt = session.projectId
    ? buildTaskPrompt(task, session.memoryContext)
    : task;

  // Reset step counter for this task
  session.stepsHistory.length = 0;

  // Create Langfuse trace for this task
  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: 'user-task',
    metadata: { projectId: session.projectId, sessionId: session.sessionId },
    input: { task },
  }) ?? null;
  session.currentTrace = trace;

  // Try navigation shortcut if project has nav graph data
  if (session.projectId && session.currentUrl) {
    try {
      const graph = await getGraph(session.projectId);

      if (graph.nodes.length > 0) {
        // Check if task mentions a known page title or URL segment
        const targetNode = findNodeByUrlOrTitle(graph.nodes, task);

        if (targetNode) {
          const navSpan = trace?.span({ name: 'muscle-memory-nav-shortcut' });
          broadcast({ type: 'thought', content: `Navigating to ${targetNode.pageTitle || targetNode.urlPattern} via shortcut...` });

          const navSuccess = await replayNavigation(
            session.connector.getHarness().page,
            session.projectId,
            session.currentUrl,
            task,
          );

          if (navSuccess) {
            navSpan?.end({ output: { success: true, target: targetNode.urlPattern } });
            broadcast({ type: 'thought', content: `Navigated to ${targetNode.pageTitle || targetNode.urlPattern} via shortcut` });

            // Capture screenshot after navigation
            try {
              const buf = await session.connector.getHarness().page.screenshot({ type: 'png' });
              broadcast({ type: 'screenshot', data: buf.toString('base64') });
              broadcast({ type: 'nav', url: session.connector.getHarness().page.url() });
            } catch {}

            // If the task was just navigation, we're done
            const isNavOnly = /^(go to|navigate to|open)\s/i.test(task);
            if (isNavOnly) {
              trace?.update({ output: { success: true, method: 'nav-shortcut' } });
              broadcast({ type: 'taskComplete', success: true });
              session.currentTrace = null;
              broadcast({ type: 'status', status: 'idle' });
              return;
            }
            // Otherwise continue with the task (now on the right page)
          } else {
            navSpan?.end({ output: { success: false } });
          }
        }
      }
    } catch (err) {
      // Nav shortcut failed silently — fall through to LLM
      console.error('[TASK] Nav shortcut error:', err);
    }
  }

  try {
    const span = trace?.span({ name: 'agent-act', input: { prompt } });
    await session.agent.act(prompt);
    span?.end({ output: { success: true, steps: session.stepsHistory.length } });
    trace?.update({ output: { success: true, stepsCount: session.stepsHistory.length } });
    broadcast({ type: 'taskComplete', success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    trace?.update({ output: { success: false, error: message } });
    broadcast({ type: 'error', message });
    broadcast({ type: 'taskComplete', success: false });
    if (session.sessionId) {
      await saveMessage(session.sessionId, 'system', `Error: ${message}`);
    }
  } finally {
    session.currentTrace = null;
    broadcast({ type: 'status', status: 'idle' });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit --project server/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Run all tests**

Run: `cd browser-agent-chat/server && npx vitest run 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/server/src/agent.ts
git commit -m "feat(agent): integrate navigation shortcuts in executeTask with nav-only task detection"
```

---

### Task 13: Final — Run Full Test Suite and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `cd browser-agent-chat/server && npx vitest run 2>&1`
Expected: All tests PASS

- [ ] **Step 2: Verify TypeScript compiles with no errors**

Run: `cd browser-agent-chat && npx tsc --noEmit --project server/tsconfig.json 2>&1`
Expected: No errors

- [ ] **Step 3: Verify the migration file is complete**

Run: `cat browser-agent-chat/server/migrations/004_learned_patterns.sql`
Expected: Contains CREATE TABLE, indexes, RLS policy, raw_target column, and RPC function

- [ ] **Step 4: Verify all new exports from muscle-memory.ts**

Run: `grep '^export' browser-agent-chat/server/src/muscle-memory.ts`
Expected: loadPatterns, markStale, markSuccess, incrementFailures, upsertLoginPattern, injectCredentials, stripActionPrefix, findNodeByUrlOrTitle, findPath, findFirstVisible, recordLoginPattern, replayLogin, tryLocators, replayNavigation

- [ ] **Step 5: Final commit (if any uncommitted changes)**

```bash
git status
```
