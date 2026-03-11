# Auto-Learning Features & Suggestion Review Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an auto-learning system where the browser agent discovers app features/flows during exploration or normal tasks, queues them as pending suggestions, and lets users review/accept/dismiss them in the Memory view.

**Architecture:** A `memory_suggestions` staging table holds agent-discovered knowledge. The agent emits `MEMORY_JSON:{...}` in its thoughts, which a parser extracts and routes to suggestions (instead of directly to `memory_features`). A REST API + WebSocket messages let the client display and manage suggestions. The existing memory infrastructure (features, flows, findings, session pool) is extended, not replaced.

**Tech Stack:** Node.js/Express/ws (server), React 19/Vite/React Router (client), Supabase (DB), vitest (testing), magnitude-core (browser agent)

**Spec:** `docs/superpowers/specs/2026-03-12-auto-learning-features-design.md`

**Branch:** `feat/github-oauth-auth` (all work targets this branch's existing codebase)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `server/src/json-parser.ts` | Brace-counting JSON block extractor (replaces fragile regex) |
| `server/src/suggestion-detector.ts` | Parse MEMORY_JSON → typed suggestion data with flow transformation |
| `server/src/routes/suggestions.ts` | REST API for suggestion CRUD |
| `server/migrations/002_memory_suggestions.sql` | Schema for memory_suggestions table + append RPC |
| `server/__tests__/json-parser.test.ts` | Tests for JSON parser |
| `server/__tests__/suggestion-detector.test.ts` | Tests for suggestion detection |
| `server/vitest.config.ts` | Test framework config |
| `client/src/components/SuggestionCard.tsx` | Individual suggestion card with accept/edit/dismiss |

### Modified Files
| File | Changes |
|------|---------|
| `server/src/types.ts` | Add Suggestion types, `explore` ClientMessage, `suggestion` ServerMessage, remove `memoryUpdate` |
| `server/src/db.ts` | Add `findFeatureByName` + suggestion CRUD functions |
| `server/src/memory-engine.ts` | Add `buildExplorePrompt`, update passive learning instruction |
| `server/src/finding-detector.ts` | Replace MEMORY_REGEX/FINDING_REGEX with `extractJsonBlocks` |
| `server/src/agent.ts` | Route memory updates through suggestions, add `executeExplore`, remove `memoryUpdate` |
| `server/src/index.ts` | Handle `explore` WS message, mount suggestion routes, track suggestion in poolBroadcast |
| `server/package.json` | Add vitest dev dependency |
| `client/src/types.ts` | Add Suggestion types, `explore` message, `suggestion` message, remove `memoryUpdate` |
| `client/src/lib/api.ts` | Add suggestion API functions using existing `apiAuthFetch` |
| `client/src/contexts/WebSocketContext.tsx` | Handle `suggestion` message, add `explore`, `pendingSuggestionCount` |
| `client/src/components/Sidebar.tsx` | Add pending suggestion badge to Memory nav item |
| `client/src/components/MemoryViewer.tsx` | Add pending suggestions section at top of existing layout |
| `client/src/components/TestingView.tsx` | Add Explore button |

---

## Chunk 1: Server Foundation — Types, Migration, DB, Parser, Detector

### Task 1: Set Up Server Test Framework

**Files:**
- Modify: `browser-agent-chat/server/package.json`
- Create: `browser-agent-chat/server/vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
cd browser-agent-chat && npm install -D vitest --workspace=server
```

- [ ] **Step 2: Create vitest config**

Create `browser-agent-chat/server/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Add test script to server/package.json**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/server/package.json browser-agent-chat/server/vitest.config.ts
git commit -m "chore: add vitest test framework to server"
```

---

### Task 2: Extend Types — Add Suggestion Types & WS Messages

**Files:**
- Modify: `browser-agent-chat/server/src/types.ts` (lines 100-176)
- Modify: `browser-agent-chat/client/src/types.ts` (lines 1-93)

Both files need the same additions. The server types.ts already has Project, Feature, Flow, FlowStep, Checkpoint, Finding, etc. The client types.ts mirrors them. We add Suggestion types and update WS message unions.

- [ ] **Step 1: Add Suggestion types to server types.ts**

Append before `// === WebSocket Messages ===` (line 108 of server types.ts):

```typescript
// === Suggestions ===

export interface Suggestion {
  id: string;
  project_id: string;
  type: 'feature' | 'flow' | 'behavior';
  status: 'pending' | 'accepted' | 'dismissed';
  data: FeatureSuggestionData | FlowSuggestionData | BehaviorSuggestionData;
  source_session: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface FeatureSuggestionData {
  name: string;
  description: string;
  criticality: Criticality;
  expected_behaviors: string[];
}

export interface FlowSuggestionData {
  feature_name: string;
  name: string;
  steps: FlowStep[];
  checkpoints: Checkpoint[];
  criticality: Criticality;
}

export interface BehaviorSuggestionData {
  feature_name: string;
  behavior: string;
}
```

- [ ] **Step 2: Update server ClientMessage — add `explore`**

In server `types.ts`, update the `ClientMessage` union (line 110-115) to add the explore variant:

```typescript
export type ClientMessage =
  | { type: 'start'; projectId: string }
  | { type: 'resume'; projectId: string }
  | { type: 'task'; content: string }
  | { type: 'explore'; projectId: string }
  | { type: 'stop' }
  | { type: 'ping' };
```

- [ ] **Step 3: Update server ServerMessage — add `suggestion` (keep `memoryUpdate` for now)**

In server `types.ts`, update the `ServerMessage` union (line 117-128). Add the `suggestion` variant but **keep `memoryUpdate` temporarily** to avoid breaking existing code. It will be removed in Task 8 when the agent code is updated.

```typescript
export type ServerMessage =
  | { type: 'thought'; content: string }
  | { type: 'action'; action: string; target?: string }
  | { type: 'screenshot'; data: string }
  | { type: 'status'; status: AgentStatus }
  | { type: 'nav'; url: string }
  | { type: 'error'; message: string }
  | { type: 'taskComplete'; success: boolean }
  | { type: 'finding'; finding: Finding }
  | { type: 'memoryUpdate'; feature?: Feature; flow?: Flow }
  | { type: 'suggestion'; suggestion: Suggestion }
  | { type: 'pong' }
  | { type: 'sessionRestore'; messages: ChatMessage[] };
```

- [ ] **Step 4: Mirror changes in client types.ts**

In `browser-agent-chat/client/src/types.ts`:

1. Add named FlowStep/Checkpoint interfaces AND update the existing `Flow` interface to use them (replace inline object types with the named interfaces):

```typescript
export interface FlowStep {
  order: number;
  description: string;
  url?: string;
}

export interface Checkpoint {
  description: string;
  expected: string;
}
```

Then update the existing `Flow` interface's `steps` field from `{ order: number; description: string; url?: string }[]` to `FlowStep[]`, and `checkpoints` from `{ description: string; expected: string }[]` to `Checkpoint[]`.

2. Add the Suggestion types (Suggestion, FeatureSuggestionData, FlowSuggestionData, BehaviorSuggestionData)
3. Add `| { type: 'explore'; projectId: string }` to `ClientMessage`
4. Add `| { type: 'suggestion'; suggestion: Suggestion }` to `ServerMessage` (keep `memoryUpdate` for now — removed in Task 8)

- [ ] **Step 5: Verify both compile**

```bash
cd browser-agent-chat && npm run build --workspace=server && npm run build --workspace=client
```

Both should compile cleanly since `memoryUpdate` is still present.

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/server/src/types.ts browser-agent-chat/client/src/types.ts
git commit -m "feat: add Suggestion types, explore WS message, FlowStep/Checkpoint named interfaces"
```

---

### Task 3: Database Migration — memory_suggestions Table

**Files:**
- Create: `browser-agent-chat/server/migrations/002_memory_suggestions.sql`

- [ ] **Step 1: Create migration file**

Create `browser-agent-chat/server/migrations/002_memory_suggestions.sql`:

```sql
-- Memory suggestions table (staging area for agent discoveries)
CREATE TABLE IF NOT EXISTS memory_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('feature', 'flow', 'behavior')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  data JSONB NOT NULL,
  source_session UUID REFERENCES sessions(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_suggestions_project_status
  ON memory_suggestions(project_id, status);

-- RPC for atomic behavior append (avoids read-then-write race conditions)
CREATE OR REPLACE FUNCTION append_expected_behavior(feature_uuid UUID, new_behavior TEXT)
RETURNS void AS $$
BEGIN
  UPDATE memory_features
  SET expected_behaviors = expected_behaviors || to_jsonb(new_behavior),
      updated_at = now()
  WHERE id = feature_uuid;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Run migration in Supabase**

Run the SQL via the Supabase dashboard SQL editor or CLI.

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/server/migrations/002_memory_suggestions.sql
git commit -m "feat: add migration for memory_suggestions table and append_expected_behavior RPC"
```

---

### Task 4: DB Functions — findFeatureByName + Suggestion CRUD

**Files:**
- Modify: `browser-agent-chat/server/src/db.ts`

The existing `db.ts` already has full CRUD for projects, features, flows, findings. We add `findFeatureByName` and all suggestion functions.

- [ ] **Step 1: Add import for Suggestion types**

In `browser-agent-chat/server/src/db.ts`, update the import at line 2-5 to include Suggestion types:

```typescript
import type {
  Project, Feature, Flow, Finding, Session, Message,
  EncryptedCredentials, Criticality, FindingType, FindingStatus, ReproStep,
  Suggestion, FeatureSuggestionData, FlowSuggestionData, BehaviorSuggestionData,
  FlowStep, Checkpoint
} from './types.js';
```

- [ ] **Step 2: Add findFeatureByName after the existing feature functions**

After `deleteFeature` (around line 121), add:

```typescript
export async function findFeatureByName(
  projectId: string,
  name: string
): Promise<Feature | null> {
  if (!isSupabaseEnabled()) return null;
  // Escape SQL wildcards for ilike (case-insensitive exact match)
  const escaped = name.replace(/%/g, '\\%').replace(/_/g, '\\_');
  const { data, error } = await supabase!
    .from('memory_features')
    .select('*')
    .eq('project_id', projectId)
    .ilike('name', escaped)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}
```

- [ ] **Step 3: Add suggestion CRUD functions**

Append at the end of `db.ts`:

```typescript
// === Memory Suggestions ===

export async function createSuggestion(
  projectId: string,
  type: Suggestion['type'],
  data: Suggestion['data'],
  sessionId: string | null
): Promise<Suggestion | null> {
  if (!isSupabaseEnabled()) return null;

  // --- Deduplication ---
  const name = 'name' in data ? (data as any).name : ('feature_name' in data ? (data as any).feature_name : null);

  if (name) {
    // Check for existing pending suggestion with same type and matching identity
    const { data: pendingDupes } = await supabase!
      .from('memory_suggestions')
      .select('id, data')
      .eq('project_id', projectId)
      .eq('type', type)
      .eq('status', 'pending');

    if (pendingDupes) {
      let isDupe = false;
      if (type === 'behavior') {
        // For behaviors, check both feature_name AND behavior text
        const bd = data as BehaviorSuggestionData;
        isDupe = pendingDupes.some((s: any) =>
          s.data?.feature_name?.toLowerCase() === bd.feature_name.toLowerCase()
          && s.data?.behavior === bd.behavior
        );
      } else {
        // For features/flows, check by name
        isDupe = pendingDupes.some((s: any) => {
          const sName = s.data?.name;
          return sName && sName.toLowerCase() === name.toLowerCase();
        });
      }
      if (isDupe) return null;
    }

    // Check for already-accepted entities
    if (type === 'feature') {
      const existing = await findFeatureByName(projectId, name);
      if (existing) return null;
    }

    if (type === 'flow') {
      // Check if a flow with this name already exists under the parent feature
      const fd = data as FlowSuggestionData;
      const feature = await findFeatureByName(projectId, fd.feature_name);
      if (feature) {
        const escaped = fd.name.replace(/%/g, '\\%').replace(/_/g, '\\_');
        const { data: existingFlow } = await supabase!
          .from('memory_flows')
          .select('id')
          .eq('feature_id', feature.id)
          .ilike('name', escaped)
          .limit(1)
          .maybeSingle();
        if (existingFlow) return null;
      }
    }

    if (type === 'behavior') {
      const bd = data as BehaviorSuggestionData;
      const feature = await findFeatureByName(projectId, bd.feature_name);
      if (feature && feature.expected_behaviors?.includes(bd.behavior)) {
        return null; // Identical behavior already accepted
      }
    }
  }

  // --- Insert ---
  const { data: inserted, error } = await supabase!
    .from('memory_suggestions')
    .insert({
      project_id: projectId,
      type,
      data,
      source_session: sessionId,
    })
    .select()
    .single();

  if (error) { console.error('createSuggestion error:', error); return null; }
  return inserted;
}

export async function listPendingSuggestions(projectId: string): Promise<Suggestion[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('memory_suggestions')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) { console.error('listPendingSuggestions error:', error); return []; }
  return data ?? [];
}

export async function getPendingSuggestionCount(projectId: string): Promise<number> {
  if (!isSupabaseEnabled()) return 0;
  const { count, error } = await supabase!
    .from('memory_suggestions')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'pending');
  if (error) { console.error('getPendingSuggestionCount error:', error); return 0; }
  return count ?? 0;
}

export async function acceptSuggestion(suggestionId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;

  const { data: suggestion, error: fetchError } = await supabase!
    .from('memory_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .single();

  if (fetchError || !suggestion) return false;

  const { type, data: suggData, project_id: projectId } = suggestion;

  // Process by type
  if (type === 'feature') {
    const fd = suggData as FeatureSuggestionData;
    await createFeature(projectId, fd.name, fd.description, fd.criticality, fd.expected_behaviors);
  } else if (type === 'flow') {
    const fd = suggData as FlowSuggestionData;
    let feature = await findFeatureByName(projectId, fd.feature_name);
    if (!feature) {
      feature = await createFeature(projectId, fd.feature_name, null, fd.criticality, []);
    }
    if (feature) {
      await createFlow(feature.id, projectId, fd.name, fd.steps, fd.checkpoints, fd.criticality);
    }
  } else if (type === 'behavior') {
    const fd = suggData as BehaviorSuggestionData;
    let feature = await findFeatureByName(projectId, fd.feature_name);
    if (!feature) {
      feature = await createFeature(projectId, fd.feature_name, null, 'medium', []);
    }
    if (feature) {
      await supabase!.rpc('append_expected_behavior', {
        feature_uuid: feature.id,
        new_behavior: fd.behavior,
      });
    }
  }

  // Mark as accepted
  const { error } = await supabase!
    .from('memory_suggestions')
    .update({ status: 'accepted', resolved_at: new Date().toISOString() })
    .eq('id', suggestionId);

  return !error;
}

export async function dismissSuggestion(suggestionId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;
  const { error } = await supabase!
    .from('memory_suggestions')
    .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
    .eq('id', suggestionId);
  return !error;
}

export async function updateSuggestionData(
  suggestionId: string,
  data: Suggestion['data']
): Promise<Suggestion | null> {
  if (!isSupabaseEnabled()) return null;
  const { data: updated, error } = await supabase!
    .from('memory_suggestions')
    .update({ data })
    .eq('id', suggestionId)
    .select()
    .single();
  if (error) { console.error('updateSuggestionData error:', error); return null; }
  return updated;
}

export async function bulkAcceptSuggestions(projectId: string): Promise<number> {
  if (!isSupabaseEnabled()) return 0;
  const pending = await listPendingSuggestions(projectId);
  if (pending.length === 0) return 0;

  // Process in order: features first, then flows, then behaviors
  const features = pending.filter(s => s.type === 'feature');
  const flows = pending.filter(s => s.type === 'flow');
  const behaviors = pending.filter(s => s.type === 'behavior');

  let accepted = 0;
  for (const s of [...features, ...flows, ...behaviors]) {
    const ok = await acceptSuggestion(s.id);
    if (ok) accepted++;
  }
  return accepted;
}

export async function bulkDismissSuggestions(projectId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;
  const { error } = await supabase!
    .from('memory_suggestions')
    .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('status', 'pending');
  return !error;
}
```

- [ ] **Step 4: Verify server compiles**

```bash
cd browser-agent-chat && npm run build --workspace=server
```

Note: Will show errors from agent.ts referencing removed `memoryUpdate` — those are fixed in Task 8.

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/db.ts
git commit -m "feat: add findFeatureByName and suggestion CRUD with deduplication and accept logic"
```

---

### Task 5: JSON Block Parser

**Files:**
- Create: `browser-agent-chat/server/src/json-parser.ts`
- Create: `browser-agent-chat/server/__tests__/json-parser.test.ts`

- [ ] **Step 1: Write tests**

Create `browser-agent-chat/server/__tests__/json-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractJsonBlocks } from '../src/json-parser.js';

describe('extractJsonBlocks', () => {
  it('extracts simple JSON after prefix', () => {
    const text = 'some text MEMORY_JSON:{"action":"create_feature","data":{"name":"Login"}}';
    const blocks = extractJsonBlocks(text, 'MEMORY_JSON:');
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0])).toEqual({ action: 'create_feature', data: { name: 'Login' } });
  });

  it('extracts multiple JSON blocks', () => {
    const text = `Found MEMORY_JSON:{"action":"create_feature","data":{"name":"Login"}} also MEMORY_JSON:{"action":"add_behavior","data":{"feature_name":"Login","behavior":"validates"}}`;
    expect(extractJsonBlocks(text, 'MEMORY_JSON:')).toHaveLength(2);
  });

  it('handles nested arrays', () => {
    const text = 'MEMORY_JSON:{"action":"create_feature","data":{"name":"Login","expected_behaviors":["validates email","shows error"]}}';
    const blocks = extractJsonBlocks(text, 'MEMORY_JSON:');
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0]).data.expected_behaviors).toEqual(['validates email', 'shows error']);
  });

  it('handles deeply nested objects (flow steps/checkpoints)', () => {
    const text = 'MEMORY_JSON:{"action":"create_flow","data":{"steps":[{"order":1,"description":"click"}],"checkpoints":[{"description":"check","expected":"pass"}]}}';
    const blocks = extractJsonBlocks(text, 'MEMORY_JSON:');
    expect(blocks).toHaveLength(1);
    const parsed = JSON.parse(blocks[0]);
    expect(parsed.data.steps).toHaveLength(1);
    expect(parsed.data.checkpoints).toHaveLength(1);
  });

  it('handles escaped quotes in strings', () => {
    const text = 'MEMORY_JSON:{"data":{"name":"Login \\"Beta\\""}}';
    const blocks = extractJsonBlocks(text, 'MEMORY_JSON:');
    expect(blocks).toHaveLength(1);
  });

  it('returns empty array when no prefix found', () => {
    expect(extractJsonBlocks('regular text', 'MEMORY_JSON:')).toHaveLength(0);
  });

  it('skips when no opening brace after prefix', () => {
    expect(extractJsonBlocks('MEMORY_JSON: not json', 'MEMORY_JSON:')).toHaveLength(0);
  });

  it('works with FINDING_JSON prefix', () => {
    const text = 'FINDING_JSON:{"title":"Bug","type":"functional","severity":"high"}';
    expect(extractJsonBlocks(text, 'FINDING_JSON:')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd browser-agent-chat && npm run test --workspace=server
```

- [ ] **Step 3: Implement parser**

Create `browser-agent-chat/server/src/json-parser.ts`:

```typescript
/**
 * Extract JSON blocks from text following a prefix like "MEMORY_JSON:" or "FINDING_JSON:".
 * Uses brace-counting instead of regex to handle nested objects, arrays, and escaped strings.
 */
export function extractJsonBlocks(text: string, prefix: string): string[] {
  const results: string[] = [];
  let idx = text.indexOf(prefix);

  while (idx !== -1) {
    const start = idx + prefix.length;
    if (start >= text.length || text[start] !== '{') {
      idx = text.indexOf(prefix, start);
      continue;
    }

    let depth = 0;
    let inStr = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth--;
      if (depth === 0) {
        results.push(text.slice(start, i + 1));
        break;
      }
    }

    idx = text.indexOf(prefix, start + 1);
  }

  return results;
}
```

- [ ] **Step 4: Run tests**

```bash
cd browser-agent-chat && npm run test --workspace=server
```

Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/json-parser.ts browser-agent-chat/server/__tests__/json-parser.test.ts
git commit -m "feat: add brace-counting JSON block parser"
```

---

### Task 6: Suggestion Detector

**Files:**
- Create: `browser-agent-chat/server/src/suggestion-detector.ts`
- Create: `browser-agent-chat/server/__tests__/suggestion-detector.test.ts`

- [ ] **Step 1: Write tests**

Create `browser-agent-chat/server/__tests__/suggestion-detector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseMemoryUpdates, transformFlowData } from '../src/suggestion-detector.js';

describe('parseMemoryUpdates', () => {
  it('parses create_feature action', () => {
    const text = 'MEMORY_JSON:{"action":"create_feature","data":{"name":"Login","description":"Auth","criticality":"high","expected_behaviors":["validates email"]}}';
    const updates = parseMemoryUpdates(text);
    expect(updates).toHaveLength(1);
    expect(updates[0].type).toBe('feature');
    expect(updates[0].data.name).toBe('Login');
  });

  it('parses create_flow and transforms string steps/checkpoints', () => {
    const text = 'MEMORY_JSON:{"action":"create_flow","data":{"feature_name":"Login","name":"Happy Path","steps":["Go to login","Enter email","Click submit"],"checkpoints":["Dashboard loads"],"criticality":"high"}}';
    const updates = parseMemoryUpdates(text);
    expect(updates).toHaveLength(1);
    expect(updates[0].type).toBe('flow');
    expect(updates[0].data.steps).toEqual([
      { order: 1, description: 'Go to login' },
      { order: 2, description: 'Enter email' },
      { order: 3, description: 'Click submit' },
    ]);
    expect(updates[0].data.checkpoints).toEqual([
      { description: 'Dashboard loads', expected: 'Dashboard loads' },
    ]);
  });

  it('parses add_behavior action', () => {
    const text = 'MEMORY_JSON:{"action":"add_behavior","data":{"feature_name":"Login","behavior":"Shows forgot password link"}}';
    const updates = parseMemoryUpdates(text);
    expect(updates).toHaveLength(1);
    expect(updates[0].type).toBe('behavior');
  });

  it('skips unknown actions', () => {
    expect(parseMemoryUpdates('MEMORY_JSON:{"action":"unknown","data":{}}')).toHaveLength(0);
  });

  it('skips malformed JSON', () => {
    expect(parseMemoryUpdates('MEMORY_JSON:{broken')).toHaveLength(0);
  });

  it('handles multiple actions', () => {
    const text = `MEMORY_JSON:{"action":"create_feature","data":{"name":"A","description":"","criticality":"medium","expected_behaviors":[]}} then MEMORY_JSON:{"action":"add_behavior","data":{"feature_name":"A","behavior":"b"}}`;
    expect(parseMemoryUpdates(text)).toHaveLength(2);
  });
});

describe('transformFlowData', () => {
  it('transforms string arrays to structured objects', () => {
    const result = transformFlowData(['Step 1', 'Step 2'], ['Check 1']);
    expect(result.steps).toEqual([{ order: 1, description: 'Step 1' }, { order: 2, description: 'Step 2' }]);
    expect(result.checkpoints).toEqual([{ description: 'Check 1', expected: 'Check 1' }]);
  });

  it('passes through already-structured objects', () => {
    const steps = [{ order: 1, description: 'Step 1' }];
    const checkpoints = [{ description: 'Check', expected: 'Pass' }];
    const result = transformFlowData(steps as any, checkpoints as any);
    expect(result.steps).toEqual(steps);
    expect(result.checkpoints).toEqual(checkpoints);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd browser-agent-chat && npm run test --workspace=server
```

- [ ] **Step 3: Implement suggestion detector**

Create `browser-agent-chat/server/src/suggestion-detector.ts`:

```typescript
import { extractJsonBlocks } from './json-parser.js';
import type { Suggestion, FlowStep, Checkpoint } from './types.js';

interface ParsedUpdate {
  action: string;
  type: Suggestion['type'];
  data: Suggestion['data'];
}

const ACTION_TO_TYPE: Record<string, Suggestion['type']> = {
  create_feature: 'feature',
  create_flow: 'flow',
  add_behavior: 'behavior',
};

/**
 * Transform agent-emitted flow data (string arrays) into structured FlowStep[]/Checkpoint[].
 * Passes through already-structured objects unchanged.
 */
export function transformFlowData(
  steps: (string | FlowStep)[],
  checkpoints: (string | Checkpoint)[]
): { steps: FlowStep[]; checkpoints: Checkpoint[] } {
  return {
    steps: steps.map((s, i) => typeof s === 'string' ? { order: i + 1, description: s } : s),
    checkpoints: checkpoints.map(c => typeof c === 'string' ? { description: c, expected: c } : c),
  };
}

/**
 * Parse MEMORY_JSON blocks from agent thought text.
 * Returns typed suggestion data ready for createSuggestion().
 */
export function parseMemoryUpdates(text: string): ParsedUpdate[] {
  const blocks = extractJsonBlocks(text, 'MEMORY_JSON:');
  const updates: ParsedUpdate[] = [];

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block);
      if (!parsed.action || !parsed.data) continue;

      const type = ACTION_TO_TYPE[parsed.action];
      if (!type) continue;

      let data = parsed.data;
      if (type === 'flow' && data.steps && data.checkpoints) {
        const transformed = transformFlowData(data.steps, data.checkpoints);
        data = { ...data, ...transformed };
      }

      updates.push({ action: parsed.action, type, data });
    } catch {
      // Skip malformed JSON
    }
  }

  return updates;
}
```

- [ ] **Step 4: Run tests**

```bash
cd browser-agent-chat && npm run test --workspace=server
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/suggestion-detector.ts browser-agent-chat/server/__tests__/suggestion-detector.test.ts
git commit -m "feat: add suggestion detector with flow data transformation"
```

---

## Chunk 2: Server Integration — Memory Engine, Finding Detector, Agent, WebSocket

### Task 7: Update Memory Engine — Add Explore Prompt + Passive Learning

**Files:**
- Modify: `browser-agent-chat/server/src/memory-engine.ts`

The existing `memory-engine.ts` has `serializeMemory`, `buildTaskPrompt`, and `loadMemoryContext`. We add `buildExplorePrompt` and update `buildTaskPrompt` to include passive learning instructions.

- [ ] **Step 1: Add buildExplorePrompt function**

Append to `browser-agent-chat/server/src/memory-engine.ts`:

```typescript
/**
 * Build an exploration prompt for Explore & Learn mode.
 */
export function buildExplorePrompt(context: string | null): string {
  return `Explore this application thoroughly. Start from the current page and navigate through all reachable sections. For each distinct feature you discover, report it using MEMORY_JSON.

For features: MEMORY_JSON:{"action":"create_feature","data":{"name":"...","description":"...","criticality":"critical|high|medium|low","expected_behaviors":["..."]}}
For flows: MEMORY_JSON:{"action":"create_flow","data":{"feature_name":"...","name":"...","steps":["..."],"checkpoints":["..."],"criticality":"critical|high|medium|low"}}
For behaviors: MEMORY_JSON:{"action":"add_behavior","data":{"feature_name":"...","behavior":"..."}}

Context about this app: ${context || 'No context provided, discover freely.'}

Guidelines:
- Navigate methodically: main menu, each section, forms, buttons
- Report each feature once with a clear name and description
- For multi-step workflows (login, checkout, etc.), report them as flows
- Note any expected behaviors you observe (error handling, validation, redirects)
- Do NOT report the same feature twice`;
}
```

- [ ] **Step 2: Update buildTaskPrompt to include passive learning**

In `browser-agent-chat/server/src/memory-engine.ts`, update `buildTaskPrompt` (line 45-57). Add passive learning instruction after the existing memory instruction on line 56:

Replace the line:
```
   MEMORY_JSON:{"action":"create_feature|update_feature|create_flow|add_behavior","data":{...}}
```

With:
```
   MEMORY_JSON:{"action":"create_feature","data":{"name":"...","description":"...","criticality":"...","expected_behaviors":[...]}}
   MEMORY_JSON:{"action":"create_flow","data":{"feature_name":"...","name":"...","steps":["..."],"checkpoints":["..."],"criticality":"..."}}
   MEMORY_JSON:{"action":"add_behavior","data":{"feature_name":"...","behavior":"..."}}
```

And after the existing line 56, add:
```
   If you notice any new features, behaviors, or flows that aren't in the product knowledge above, report them using MEMORY_JSON.
```

- [ ] **Step 3: Verify server compiles**

```bash
cd browser-agent-chat && npm run build --workspace=server
```

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/server/src/memory-engine.ts
git commit -m "feat: add buildExplorePrompt and passive learning instruction"
```

---

### Task 8: Update Finding Detector — Replace Regex with Parser + Update Agent

**Files:**
- Modify: `browser-agent-chat/server/src/finding-detector.ts`
- Modify: `browser-agent-chat/server/src/agent.ts`

This is the critical integration task. The finding detector gets the robust parser, and the agent routes memory updates through suggestions instead of directly creating features.

- [ ] **Step 1: Update finding-detector.ts — use extractJsonBlocks**

In `browser-agent-chat/server/src/finding-detector.ts`:

1. Add import at top:
```typescript
import { extractJsonBlocks } from './json-parser.js';
```

2. Remove the regex constants (lines 14-15):
```typescript
// DELETE these lines:
const FINDING_REGEX = /FINDING_JSON:(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/g;
const MEMORY_REGEX = /MEMORY_JSON:(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/g;
```

3. Replace `parseFindingsFromText` body (lines 20-37) with:
```typescript
export function parseFindingsFromText(text: string): RawFinding[] {
  const findings: RawFinding[] = [];
  const blocks = extractJsonBlocks(text, 'FINDING_JSON:');

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block);
      if (parsed.title && parsed.type && parsed.severity) {
        findings.push(parsed);
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return findings;
}
```

4. **Remove** `parseMemoryUpdatesFromText` entirely (lines 42-59). This function is replaced by `parseMemoryUpdates` in `suggestion-detector.ts` and is no longer imported by anything. Delete the function and the `MEMORY_REGEX` usage above it.

- [ ] **Step 2: Update agent.ts — route memory updates through suggestions**

In `browser-agent-chat/server/src/agent.ts`:

1. Update imports (line 1-5). Replace:
```typescript
import type { ServerMessage, Finding, Feature, Flow, Criticality } from './types.js';
import { saveMessage, createFeature, updateFeature } from './db.js';
```
With:
```typescript
import type { ServerMessage } from './types.js';
import { saveMessage, createSuggestion } from './db.js';
import { parseMemoryUpdates } from './suggestion-detector.js';
```

Keep the existing imports for `loadMemoryContext`, `buildTaskPrompt`, `parseFindingsFromText`, `processFinding`. Add `buildExplorePrompt` to the existing `memory-engine.js` import:
```typescript
import { loadMemoryContext, buildTaskPrompt, buildExplorePrompt } from './memory-engine.js';
```

Remove `parseMemoryUpdatesFromText` from the finding-detector import (line 5) since we now use `parseMemoryUpdates` from `suggestion-detector`.

2. The `createAgent` signature stays unchanged (5 parameters). No `onSuggestion` callback needed since `broadcast` already handles suggestion messages.

3. Replace the memory update handling in the `thought` event listener (lines 82-97). Replace:
```typescript
      // Check for memory updates
      const memoryUpdates = parseMemoryUpdatesFromText(thought);
      for (const update of memoryUpdates) {
        if (update.action === 'create_feature' && update.data.name) {
          const feature = await createFeature(
            projectId,
            update.data.name as string,
            (update.data.description as string) ?? null,
            ((update.data.criticality as string) ?? 'medium') as Criticality,
            (update.data.expected_behaviors as string[]) ?? []
          );
          if (feature) broadcast({ type: 'memoryUpdate', feature });
        }
        // Additional memory update actions can be added here
      }
```

With:
```typescript
      // Parse MEMORY_JSON → create suggestions (not direct features)
      const memUpdates = parseMemoryUpdates(thought);
      for (const update of memUpdates) {
        const suggestion = await createSuggestion(
          projectId, update.type, update.data, sessionId
        );
        if (suggestion) {
          broadcast({ type: 'suggestion', suggestion });
        }
      }
```

4. Now that agent.ts no longer sends `memoryUpdate`, remove the `memoryUpdate` variant from `ServerMessage` in both `server/src/types.ts` and `client/src/types.ts`. Also remove the `memoryUpdate` case from the client's WebSocket handler (WebSocketContext.tsx).

- [ ] **Step 3: Add executeExplore function to agent.ts**

Append to `browser-agent-chat/server/src/agent.ts` (note: `buildExplorePrompt` was already added to the `memory-engine.js` import in Step 2):

```typescript
export async function executeExplore(
  session: AgentSession,
  context: string | null,
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  broadcast({ type: 'status', status: 'working' });

  const prompt = buildExplorePrompt(context);
  session.stepsHistory.length = 0;

  try {
    await session.agent.act(prompt);
    broadcast({ type: 'taskComplete', success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Exploration failed';
    broadcast({ type: 'error', message });
    broadcast({ type: 'taskComplete', success: false });
  } finally {
    broadcast({ type: 'status', status: 'idle' });
  }
}
```

- [ ] **Step 4: Verify server compiles**

```bash
cd browser-agent-chat && npm run build --workspace=server
```

- [ ] **Step 5: Run tests**

```bash
cd browser-agent-chat && npm run test --workspace=server
```

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/server/src/finding-detector.ts browser-agent-chat/server/src/agent.ts
git commit -m "feat: route memory updates through suggestions, add explore mode, replace regex with parser"
```

---

### Task 9: Suggestions REST API + Server Wiring

**Files:**
- Create: `browser-agent-chat/server/src/routes/suggestions.ts`
- Modify: `browser-agent-chat/server/src/index.ts`

- [ ] **Step 1: Create suggestions route**

Create `browser-agent-chat/server/src/routes/suggestions.ts`:

```typescript
import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import {
  listPendingSuggestions,
  getPendingSuggestionCount,
  acceptSuggestion,
  dismissSuggestion,
  updateSuggestionData,
  bulkAcceptSuggestions,
  bulkDismissSuggestions,
} from '../db.js';

const router = Router({ mergeParams: true });

// All routes require auth (same as memory routes)
router.use(requireAuth);

// GET /api/projects/:id/suggestions
router.get('/', async (req, res) => {
  const suggestions = await listPendingSuggestions(req.params.id);
  res.json(suggestions);
});

// GET /api/projects/:id/suggestions/count
router.get('/count', async (req, res) => {
  const count = await getPendingSuggestionCount(req.params.id);
  res.json({ count });
});

// PUT /api/projects/:id/suggestions/:suggestionId/accept
router.put('/:suggestionId/accept', async (req, res) => {
  const ok = await acceptSuggestion(req.params.suggestionId);
  if (!ok) { res.status(500).json({ error: 'Failed to accept suggestion' }); return; }
  res.json({ success: true });
});

// PUT /api/projects/:id/suggestions/:suggestionId/dismiss
router.put('/:suggestionId/dismiss', async (req, res) => {
  const ok = await dismissSuggestion(req.params.suggestionId);
  if (!ok) { res.status(500).json({ error: 'Failed to dismiss suggestion' }); return; }
  res.json({ success: true });
});

// PUT /api/projects/:id/suggestions/:suggestionId — edit data before accept
router.put('/:suggestionId', async (req, res) => {
  const { data } = req.body;
  if (!data) { res.status(400).json({ error: 'data is required' }); return; }
  const updated = await updateSuggestionData(req.params.suggestionId, data);
  if (!updated) { res.status(500).json({ error: 'Failed to update suggestion' }); return; }
  res.json(updated);
});

// POST /api/projects/:id/suggestions/accept-all
router.post('/accept-all', async (req, res) => {
  const count = await bulkAcceptSuggestions(req.params.id);
  res.json({ accepted: count });
});

// POST /api/projects/:id/suggestions/dismiss-all
router.post('/dismiss-all', async (req, res) => {
  const ok = await bulkDismissSuggestions(req.params.id);
  res.json({ success: ok });
});

export default router;
```

Note: This imports `requireAuth` from `auth.ts` (same import used by `routes/projects.ts` and `routes/memory.ts`).

- [ ] **Step 2: Mount suggestions route + handle `explore` WS message in index.ts**

In `browser-agent-chat/server/src/index.ts`:

1. Add import:
```typescript
import suggestionsRouter from './routes/suggestions.js';
import { executeExplore } from './agent.js';
```

Update the existing `createAgent` import to also import `executeExplore`:
```typescript
import { createAgent, executeTask, executeExplore } from './agent.js';
```

2. Mount the route after the existing memory route (line 35):
```typescript
app.use('/api/projects/:id/suggestions', suggestionsRouter);
```

3. Add `suggestion` message tracking in the `poolBroadcast` function (inside the `start` handler, after the `finding` tracking block around line 131):
```typescript
          } else if (serverMsg.type === 'suggestion') {
            const s = serverMsg.suggestion;
            const typeLabel = s.type === 'feature' ? 'feature' : s.type === 'flow' ? 'flow' : 'behavior';
            const name = 'name' in s.data ? (s.data as any).name : (s.data as any).feature_name;
            sessionPool.addMessage(session, makeChatMessage('system', `💡 Learned: "${name}" ${typeLabel}`));
          }
```

Do the same in the `taskBroadcast` function (around line 207).

4. The `createAgent` call (line 144-145) remains unchanged — no signature change needed.

5. Add `explore` message handler. After the `stop` handler (after line 223), add:

```typescript
    } else if (msg.type === 'explore') {
      const projectId = clientProjects.get(ws);
      if (!projectId) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active session. Send start first.' } as ServerMessage));
        return;
      }
      if (projectId !== msg.projectId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Project ID mismatch with active session.' } as ServerMessage));
        return;
      }

      const session = sessionPool.getSession(projectId);
      if (!session) {
        ws.send(JSON.stringify({ type: 'error', message: 'Session expired.' } as ServerMessage));
        return;
      }

      const project = await getProject(msg.projectId);
      if (!project) {
        ws.send(JSON.stringify({ type: 'error', message: 'Project not found.' } as ServerMessage));
        return;
      }

      // Log explore start in chat history
      sessionPool.addMessage(session, makeChatMessage('system', 'Explore & Learn started...'));

      // Reuse the task broadcast pattern
      const exploreBroadcast = (serverMsg: ServerMessage) => {
        const s = sessionPool.getSession(projectId);
        if (!s) return;
        if (serverMsg.type === 'screenshot') sessionPool.updateScreenshot(s, serverMsg.data);
        else if (serverMsg.type === 'nav') sessionPool.updateUrl(s, serverMsg.url);
        else if (serverMsg.type === 'status') sessionPool.updateStatus(s, serverMsg.status as any);

        if (serverMsg.type === 'thought') sessionPool.addMessage(s, makeChatMessage('agent', serverMsg.content));
        else if (serverMsg.type === 'action') sessionPool.addMessage(s, makeChatMessage('agent', `Action: ${serverMsg.action}${serverMsg.target ? ` → ${serverMsg.target}` : ''}`));
        else if (serverMsg.type === 'error') sessionPool.addMessage(s, makeChatMessage('system', `Error: ${serverMsg.message}`));
        else if (serverMsg.type === 'taskComplete') sessionPool.addMessage(s, makeChatMessage('system', serverMsg.success ? 'Exploration completed.' : 'Exploration failed.'));
        else if (serverMsg.type === 'finding') sessionPool.addMessage(s, { id: crypto.randomUUID(), type: 'finding', content: serverMsg.finding.title, timestamp: Date.now() });
        else if (serverMsg.type === 'suggestion') {
          const sg = serverMsg.suggestion;
          const name = 'name' in sg.data ? (sg.data as any).name : (sg.data as any).feature_name;
          sessionPool.addMessage(s, makeChatMessage('system', `💡 Learned: "${name}" ${sg.type}`));
        }

        sessionPool.broadcast(s, serverMsg);
      };

      executeExplore(session.agentSession, project?.context || null, exploreBroadcast);
    }
```

- [ ] **Step 3: Verify server compiles**

```bash
cd browser-agent-chat && npm run build --workspace=server
```

- [ ] **Step 4: Run all tests**

```bash
cd browser-agent-chat && npm run test --workspace=server
```

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/routes/suggestions.ts browser-agent-chat/server/src/index.ts
git commit -m "feat: add suggestions REST API route and explore WS handler"
```

---

## Chunk 3: Client — API, WebSocket, Components

### Task 10: Client API + WebSocket Context Updates

**Files:**
- Modify: `browser-agent-chat/client/src/lib/api.ts`
- Modify: `browser-agent-chat/client/src/contexts/WebSocketContext.tsx`

- [ ] **Step 1: Add suggestion API functions to api.ts**

Append to `browser-agent-chat/client/src/lib/api.ts`:

```typescript
import type { Suggestion } from '../types';

export async function fetchPendingSuggestions(projectId: string, token: string | null): Promise<Suggestion[]> {
  const res = await apiAuthFetch(`/api/projects/${projectId}/suggestions`, token);
  if (!res.ok) throw new Error('Failed to fetch suggestions');
  return res.json();
}

export async function fetchSuggestionCount(projectId: string, token: string | null): Promise<number> {
  const res = await apiAuthFetch(`/api/projects/${projectId}/suggestions/count`, token);
  if (!res.ok) return 0;
  const data = await res.json();
  return data.count;
}

export async function acceptSuggestionApi(projectId: string, suggestionId: string, token: string | null): Promise<boolean> {
  const res = await apiAuthFetch(`/api/projects/${projectId}/suggestions/${suggestionId}/accept`, token, { method: 'PUT' });
  return res.ok;
}

export async function dismissSuggestionApi(projectId: string, suggestionId: string, token: string | null): Promise<boolean> {
  const res = await apiAuthFetch(`/api/projects/${projectId}/suggestions/${suggestionId}/dismiss`, token, { method: 'PUT' });
  return res.ok;
}

export async function updateSuggestionApi(projectId: string, suggestionId: string, data: unknown, token: string | null): Promise<Suggestion | null> {
  const res = await apiAuthFetch(`/api/projects/${projectId}/suggestions/${suggestionId}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function bulkAcceptSuggestionsApi(projectId: string, token: string | null): Promise<number> {
  const res = await apiAuthFetch(`/api/projects/${projectId}/suggestions/accept-all`, token, { method: 'POST' });
  if (!res.ok) return 0;
  const data = await res.json();
  return data.accepted;
}

export async function bulkDismissSuggestionsApi(projectId: string, token: string | null): Promise<boolean> {
  const res = await apiAuthFetch(`/api/projects/${projectId}/suggestions/dismiss-all`, token, { method: 'POST' });
  return res.ok;
}
```

- [ ] **Step 2: Update WebSocketContext — add suggestion handling + explore**

In `browser-agent-chat/client/src/contexts/WebSocketContext.tsx`:

1. Add `Suggestion` to the import (line 2):
```typescript
import type { ClientMessage, ServerMessage, AgentStatus, ChatMessage, Finding, Suggestion } from '../types';
```

2. Add to `WebSocketState` interface (after `findingsCount`, around line 14):
```typescript
  pendingSuggestionCount: number;
  explore: (projectId: string) => void;
  resetSuggestionCount: () => void;
  decrementSuggestionCount: () => void;
```

3. Add state in `WebSocketProvider` (after `activeProjectId` state, line 41):
```typescript
  const [pendingSuggestionCount, setPendingSuggestionCount] = useState(0);
```

4. Replace the `memoryUpdate` case in `handleMessage` (lines 100-105) with `suggestion`:
```typescript
      case 'suggestion': {
        const suggestion = (msg as any).suggestion as Suggestion;
        setPendingSuggestionCount(c => c + 1);
        const typeLabel = suggestion.type === 'feature' ? 'feature' : suggestion.type === 'flow' ? 'flow' : 'behavior';
        const name = 'name' in suggestion.data ? (suggestion.data as any).name : (suggestion.data as any).feature_name;
        addMessage('system', `💡 Learned: "${name}" ${typeLabel}`);
        break;
      }
```

5. Add `explore`, `resetSuggestionCount`, and `decrementSuggestionCount` functions (after `stopAgent`, around line 207):
```typescript
  const explore = useCallback((projectId: string) => {
    send({ type: 'explore', projectId });
  }, [send]);

  const resetSuggestionCount = useCallback(() => {
    setPendingSuggestionCount(0);
  }, []);

  const decrementSuggestionCount = useCallback(() => {
    setPendingSuggestionCount(c => Math.max(0, c - 1));
  }, []);
```

6. Add to the `value` object (around line 221):
```typescript
    pendingSuggestionCount,
    explore,
    resetSuggestionCount,
    decrementSuggestionCount,
```

- [ ] **Step 3: Verify client compiles**

```bash
cd browser-agent-chat && npm run build --workspace=client
```

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/client/src/lib/api.ts browser-agent-chat/client/src/contexts/WebSocketContext.tsx
git commit -m "feat: add suggestion API client and WebSocket suggestion handling"
```

---

### Task 11: SuggestionCard Component

**Files:**
- Create: `browser-agent-chat/client/src/components/SuggestionCard.tsx`

- [ ] **Step 1: Create SuggestionCard**

Create `browser-agent-chat/client/src/components/SuggestionCard.tsx`:

```tsx
import { useState } from 'react';
import type { Suggestion, FeatureSuggestionData, FlowSuggestionData, BehaviorSuggestionData } from '../types';

interface SuggestionCardProps {
  suggestion: Suggestion;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onEdit: (id: string, data: Suggestion['data']) => void;
}

export default function SuggestionCard({ suggestion, onAccept, onDismiss, onEdit }: SuggestionCardProps) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(JSON.stringify(suggestion.data, null, 2));

  const handleSaveEdit = () => {
    try {
      const parsed = JSON.parse(editData);
      onEdit(suggestion.id, parsed);
      setEditing(false);
    } catch {
      // Invalid JSON
    }
  };

  const typeBadge = {
    feature: <span className="severity-badge" style={{ background: '#7c5cff22', color: '#7c5cff' }}>NEW FEATURE</span>,
    flow: <span className="severity-badge" style={{ background: '#00b89422', color: '#00b894' }}>NEW FLOW</span>,
    behavior: <span className="severity-badge" style={{ background: '#74b9ff22', color: '#74b9ff' }}>ADD BEHAVIOR</span>,
  }[suggestion.type];

  if (editing) {
    return (
      <div className="memory-item" style={{ padding: '1rem' }}>
        <textarea
          value={editData}
          onChange={e => setEditData(e.target.value)}
          rows={8}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem', background: '#1a1a2e', color: '#ccc', border: '1px solid #2a2a2e', borderRadius: '4px', padding: '0.5rem' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button className="btn-add" onClick={handleSaveEdit}>Save</button>
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  const d = suggestion.data;

  return (
    <div className="memory-item" style={{ padding: '0.8rem' }}>
      <div className="memory-item-header">
        {suggestion.type === 'feature' && (
          <>
            <span className="memory-item-name">{(d as FeatureSuggestionData).name}</span>
            <span className={`severity-badge severity-${(d as FeatureSuggestionData).criticality}`}>
              {(d as FeatureSuggestionData).criticality.toUpperCase()}
            </span>
          </>
        )}
        {suggestion.type === 'flow' && (
          <>
            <span className="memory-item-name">
              {(d as FlowSuggestionData).feature_name} → {(d as FlowSuggestionData).name}
            </span>
            <span className={`severity-badge severity-${(d as FlowSuggestionData).criticality}`}>
              {(d as FlowSuggestionData).criticality.toUpperCase()}
            </span>
          </>
        )}
        {suggestion.type === 'behavior' && (
          <span className="memory-item-name">{(d as BehaviorSuggestionData).feature_name}</span>
        )}
        {typeBadge}
      </div>
      <div className="memory-item-meta" style={{ marginTop: '0.3rem' }}>
        {suggestion.type === 'feature' && (d as FeatureSuggestionData).description}
        {suggestion.type === 'flow' && (d as FlowSuggestionData).steps.map(s => s.description).join(' → ')}
        {suggestion.type === 'behavior' && (d as BehaviorSuggestionData).behavior}
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
        <button className="btn-add" onClick={() => onAccept(suggestion.id)} title="Accept">✓ Accept</button>
        <button onClick={() => setEditing(true)} title="Edit">✏️ Edit</button>
        <button onClick={() => onDismiss(suggestion.id)} title="Dismiss" style={{ color: '#da3633' }}>✕ Dismiss</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/src/components/SuggestionCard.tsx
git commit -m "feat: add SuggestionCard component"
```

---

### Task 12: Update MemoryViewer — Add Pending Suggestions Section

**Files:**
- Modify: `browser-agent-chat/client/src/components/MemoryViewer.tsx`

The existing MemoryViewer (119 lines) has a two-column layout: feature list on the left, FeatureDetail on the right. We add a pending suggestions section at the top.

- [ ] **Step 1: Add suggestion imports and state**

At the top of `browser-agent-chat/client/src/components/MemoryViewer.tsx`, add imports:

```typescript
import SuggestionCard from './SuggestionCard';
import type { Suggestion } from '../types';
import {
  fetchPendingSuggestions,
  acceptSuggestionApi,
  dismissSuggestionApi,
  updateSuggestionApi,
  bulkAcceptSuggestionsApi,
  bulkDismissSuggestionsApi,
} from '../lib/api';
import { useWS } from '../contexts/WebSocketContext';
```

Inside the component function, add state and load logic:

```typescript
  const { resetSuggestionCount, decrementSuggestionCount, pendingSuggestionCount } = useWS();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => { loadSuggestions(); }, [id]);

  // Re-fetch suggestions when new ones arrive via WebSocket
  useEffect(() => { loadSuggestions(); }, [pendingSuggestionCount]);

  const loadSuggestions = async () => {
    if (!id) return;
    const token = await getAccessToken();
    try {
      const data = await fetchPendingSuggestions(id, token);
      setSuggestions(data);
    } catch (err) {
      console.error('Failed to load suggestions:', err);
    }
  };

  const handleAcceptSuggestion = async (suggestionId: string) => {
    const token = await getAccessToken();
    await acceptSuggestionApi(id!, suggestionId, token);
    setSuggestions(prev => prev.filter(s => s.id !== suggestionId));
    decrementSuggestionCount();
    await loadFeatures();
  };

  const handleDismissSuggestion = async (suggestionId: string) => {
    const token = await getAccessToken();
    await dismissSuggestionApi(id!, suggestionId, token);
    setSuggestions(prev => prev.filter(s => s.id !== suggestionId));
    decrementSuggestionCount();
  };

  const handleEditSuggestion = async (suggestionId: string, data: Suggestion['data']) => {
    const token = await getAccessToken();
    const updated = await updateSuggestionApi(id!, suggestionId, data, token);
    if (updated) {
      setSuggestions(prev => prev.map(s => s.id === suggestionId ? updated : s));
    }
  };

  const handleAcceptAll = async () => {
    const token = await getAccessToken();
    await bulkAcceptSuggestionsApi(id!, token);
    setSuggestions([]);
    resetSuggestionCount();
    await loadFeatures();
  };

  const handleDismissAll = async () => {
    const token = await getAccessToken();
    await bulkDismissSuggestionsApi(id!, token);
    setSuggestions([]);
    resetSuggestionCount();
  };
```

- [ ] **Step 2: Add pending suggestions section to the render**

In the `return` JSX, inside `<div className="memory-content">`, add the pending section BEFORE the `<div className="memory-list">`:

```tsx
        {suggestions.length > 0 && (
          <div className="memory-suggestions-pending" style={{ marginBottom: '1rem', borderLeft: '3px solid #fdcb6e' }}>
            <div className="memory-list-header">
              <h2 style={{ color: '#fdcb6e' }}>
                ⏳ Pending Suggestions <span className="count">({suggestions.length})</span>
              </h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-add" onClick={handleAcceptAll}>Accept All</button>
                <button onClick={handleDismissAll}>Dismiss All</button>
              </div>
            </div>
            <div className="memory-items">
              {suggestions.map(s => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  onAccept={handleAcceptSuggestion}
                  onDismiss={handleDismissSuggestion}
                  onEdit={handleEditSuggestion}
                />
              ))}
            </div>
          </div>
        )}
```

- [ ] **Step 3: Verify client compiles**

```bash
cd browser-agent-chat && npm run build --workspace=client
```

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/client/src/components/MemoryViewer.tsx
git commit -m "feat: add pending suggestions review queue to MemoryViewer"
```

---

### Task 13: Update Sidebar + TestingView — Badge and Explore Button

**Files:**
- Modify: `browser-agent-chat/client/src/components/Sidebar.tsx`
- Modify: `browser-agent-chat/client/src/components/TestingView.tsx`

- [ ] **Step 1: Add suggestion badge to Sidebar Memory nav item**

In `browser-agent-chat/client/src/components/Sidebar.tsx`:

1. Add import:
```typescript
import { useWS } from '../contexts/WebSocketContext';
```

2. Inside the component, add:
```typescript
  const { pendingSuggestionCount } = useWS();
```

3. Update the Memory nav item (around line 40-45) to include a badge:
```tsx
      <div
        className={`sidebar-item ${isActive('memory') ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => navTo('memory')}
        title="Memory"
      >
        <span role="img" aria-label="Memory">&#x1F9E0;</span>
        {pendingSuggestionCount > 0 && (
          <span className="sidebar-badge" style={{ background: '#fdcb6e', color: '#000' }}>
            {pendingSuggestionCount}
          </span>
        )}
      </div>
```

- [ ] **Step 2: Add Explore button to TestingView**

In `browser-agent-chat/client/src/components/TestingView.tsx`:

1. The existing component uses `useWS()`. Also import and track features count to show Explore button conditionally (per spec: "visible when agent is idle and the project has few/no features"):
```typescript
  const ws = useWS();
  const [featuresCount, setFeaturesCount] = useState(0);

  // Fetch feature count on mount to decide Explore button visibility
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await apiAuthFetch(`/api/projects/${id}/memory/features`, token);
        if (res.ok) {
          const features = await res.json();
          setFeaturesCount(features.length);
        }
      } catch { /* ignore */ }
    })();
  }, [id]);
```

2. Add an Explore button in the JSX. Place inside the `testing-content` div, before `ChatPanel`. Show when agent is idle AND the project has few features (<=3):

```tsx
        {ws.status === 'idle' && id && featuresCount <= 3 && (
          <button
            className="btn-add"
            onClick={() => ws.explore(id)}
            style={{ margin: '0.5rem', alignSelf: 'flex-start' }}
            title="Explore the app to discover features"
          >
            🔍 Explore App
          </button>
        )}
```

- [ ] **Step 3: Verify client compiles**

```bash
cd browser-agent-chat && npm run build --workspace=client
```

- [ ] **Step 4: Manual E2E test**

```bash
cd browser-agent-chat && npm run dev
```

Verify:
1. Create a project → agent starts
2. Click "Explore App" → agent explores autonomously
3. Suggestions appear as "💡 Learned..." in chat
4. Memory icon shows badge count
5. Navigate to Memory → pending suggestions visible
6. Accept/dismiss/edit suggestions works
7. Accepted features appear in the features list below

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/client/src/components/Sidebar.tsx browser-agent-chat/client/src/components/TestingView.tsx
git commit -m "feat: add suggestion badge to sidebar and explore button to testing view"
```

---

## Summary

| # | Task | Chunk | Key Change |
|---|------|-------|-----------|
| 1 | Set up vitest | 1 | Test framework |
| 2 | Extend types | 1 | Suggestion types + WS messages |
| 3 | Migration | 1 | memory_suggestions table |
| 4 | DB functions | 1 | findFeatureByName + suggestion CRUD |
| 5 | JSON parser | 1 | Brace-counting extractor |
| 6 | Suggestion detector | 1 | Parse MEMORY_JSON → typed data |
| 7 | Memory engine | 2 | buildExplorePrompt + passive learning |
| 8 | Finding detector + agent | 2 | Route through suggestions, add explore |
| 9 | REST API + server wiring | 2 | Suggestions route, explore WS handler |
| 10 | Client API + WebSocket | 3 | Suggestion API, WS suggestion handling |
| 11 | SuggestionCard | 3 | Accept/edit/dismiss card component |
| 12 | MemoryViewer | 3 | Pending suggestions section |
| 13 | Sidebar + TestingView | 3 | Badge + Explore button |
