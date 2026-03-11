# Auto-Learning Features & Suggestion Review

## Goal

Make the agent automatically learn about the target application's features, expected behaviors, and user flows as it navigates — then let users review, accept, reject, or modify these suggestions through a simple queue-based UX. The knowledge base evolves with usage.

## Architecture

The system has three modes of learning:

1. **Explore & Learn** — Autonomous initial discovery triggered by the user. Agent navigates the app freely, mapping features and flows.
2. **Passive Learning** — Lightweight learning during normal task execution. Agent notices new features/behaviors as a side effect of doing work.
3. **Suggestion Review** — Pending suggestions queue in the Memory section. User reviews at their own pace.

The existing memory infrastructure (features, flows, expected_behaviors in Supabase, memory-engine prompt injection, MEMORY_JSON parsing) is reused and extended.

## Data Model

### New: `memory_suggestions` table

```
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
project_id      UUID REFERENCES projects(id) ON DELETE CASCADE
type            TEXT NOT NULL  -- 'feature' | 'flow' | 'behavior'
status          TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'accepted' | 'dismissed'
data            JSONB NOT NULL
source_session  UUID REFERENCES sessions(id)
created_at      TIMESTAMPTZ DEFAULT now()
resolved_at     TIMESTAMPTZ
```

**`data` field by type:**

- `feature`: `{ name, description, criticality, expected_behaviors: string[] }`
- `flow`: `{ feature_name, name, steps: FlowStep[], checkpoints: Checkpoint[], criticality }` where `FlowStep = { order: number, description: string, url?: string }` and `Checkpoint = { description: string, expected: string }`
- `behavior`: `{ feature_name, behavior: string }`

The `feature_name` field is used for linking — when accepted, the system finds or creates the matching feature. The flow data uses the same structured types as the existing `Flow` model so no transformation is needed on accept.

**Note:** The agent emits flows with simplified text (steps as strings, checkpoints as strings). The `createSuggestion` function transforms these into the structured format: each step string becomes `{ order: i+1, description: str }`, each checkpoint string becomes `{ description: str, expected: str }`.

### No changes to existing tables

`memory_features`, `memory_flows` remain as-is. They store accepted knowledge. Suggestions are a staging area.

## Server Changes

### 1. Suggestion CRUD (`db.ts`)

New functions:

- `createSuggestion(projectId, type, data, sessionId)` → performs deduplication checks (see section 6) internally before inserting. Returns the new suggestion if created, or `null` if deduplicated away. Callers do not need to check for duplicates.
- `listPendingSuggestions(projectId)` → returns pending suggestions ordered by created_at
- `acceptSuggestion(suggestionId)` → sets status='accepted', resolved_at=now(), and:
  - type='feature': calls `createFeature()` with the suggestion data
  - type='flow': finds the parent feature by `data.feature_name` (case-insensitive query on `memory_features.name`). If no matching feature exists, auto-creates a minimal feature (`{ name: data.feature_name, description: null, criticality: data.criticality, expected_behaviors: [] }`) then attaches the flow.
  - type='behavior': finds the feature by `data.feature_name` (same lookup). If no matching feature exists, auto-creates a minimal feature first, then appends to `expected_behaviors` array. The append uses Supabase's `array_append` via RPC or raw SQL (`UPDATE memory_features SET expected_behaviors = array_append(expected_behaviors, $1) WHERE id = $2`) to avoid read-then-write race conditions during bulk accept.
- `findFeatureByName(projectId, name)` → new helper: `SELECT * FROM memory_features WHERE project_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`. Used by `acceptSuggestion` for flow/behavior types.
- `bulkAcceptSuggestions(projectId)` → processes suggestions sequentially (features first, then flows, then behaviors) to ensure parent features exist before flows/behaviors reference them.
- `dismissSuggestion(suggestionId)` → sets status='dismissed', resolved_at=now()
- `updateSuggestionData(suggestionId, data)` → updates the data JSONB (for user edits before accepting)
- `bulkDismissSuggestions(projectId)` → dismisses all pending
- `getPendingSuggestionCount(projectId)` → returns count for badge

### 2. Suggestions REST API (`routes/suggestions.ts`)

New route mounted at `/api/projects/:id/suggestions` (all endpoints use `requireAuth` middleware, same as existing memory routes):

- `GET /` → list pending suggestions
- `GET /count` → pending count (for badge polling)
- `PUT /:suggestionId/accept` → accept single
- `PUT /:suggestionId/dismiss` → dismiss single
- `PUT /:suggestionId` → update suggestion data (edit before accept)
- `POST /accept-all` → bulk accept
- `POST /dismiss-all` → bulk dismiss

### 3. Enhanced Memory Update Parsing (`finding-detector.ts`)

Extend `parseMemoryUpdatesFromText()` to handle all suggestion types:

- `create_feature` → creates suggestion with type='feature'
- `create_flow` → creates suggestion with type='flow'
- `add_behavior` → creates suggestion with type='behavior'

Currently only `create_feature` is wired up in `agent.ts`. All three need to route through the suggestion table instead of directly creating features.

**Key change:** Memory updates from agent thoughts go to `memory_suggestions` (pending), NOT directly to `memory_features`/`memory_flows`. The user accepts them into the knowledge base.

**MEMORY_REGEX replacement:** The current regex (`/MEMORY_JSON:(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/g`) only handles one level of brace nesting and breaks on arrays or deeper objects (e.g., `expected_behaviors: ["a", "b"]`). Replace with a brace-counting parser:

```
function extractJsonBlocks(text: string, prefix: string): string[] {
  const results: string[] = [];
  let idx = text.indexOf(prefix);
  while (idx !== -1) {
    const start = idx + prefix.length;
    if (text[start] !== '{') { idx = text.indexOf(prefix, start); continue; }
    let depth = 0, inStr = false, escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth--;
      if (depth === 0) { results.push(text.slice(start, i + 1)); break; }
    }
    idx = text.indexOf(prefix, start + 1);
  }
  return results;
}
```

Use `extractJsonBlocks(text, 'MEMORY_JSON:')` instead of the regex. Apply the same fix to `FINDING_JSON:` parsing for consistency.

### 4. Agent Changes (`agent.ts`)

**Explore & Learn mode:**

When the client sends `{ type: 'explore', projectId }`, the server:
1. Creates/reuses agent session
2. Builds an exploration prompt using the project's `context` field:
   ```
   Explore this application thoroughly. Start from the current page and navigate
   through all reachable sections. For each feature you discover, report it as:
   MEMORY_JSON:{"action":"create_feature","data":{"name":"...","description":"...","criticality":"...","expected_behaviors":[...]}}

   For each user flow you observe, report it as:
   MEMORY_JSON:{"action":"create_flow","data":{"feature_name":"...","name":"...","steps":[...],"checkpoints":[...],"criticality":"..."}}

   Context about this app: {project.context || "No context provided, discover freely"}
   ```
3. Calls `agent.act(explorationPrompt)`
4. All MEMORY_JSON emissions during exploration create pending suggestions

**Passive learning during tasks:**

The existing task prompt (from `buildTaskPrompt`) already includes memory context. Add a line:
```
If you notice any new features, behaviors, or flows that aren't in the product
knowledge above, report them using MEMORY_JSON.
```

This makes passive learning happen without a separate mode.

### 5. WebSocket Messages

New client → server message:
- `{ type: 'explore', projectId: string }` — triggers Explore & Learn. **Precondition:** the client must have already sent a `start` message for this project (agent session exists). The `explore` handler looks up the existing session from `clientProjects.get(ws)` — the `projectId` field is used only for validation (must match the active session's project). If no session exists, the server responds with `{ type: 'error', message: 'No active session. Send start first.' }`.

New server → client message:
- `{ type: 'suggestion', suggestion: Suggestion }` — real-time notification when agent creates a suggestion

The existing `memoryUpdate` message type (`{ type: 'memoryUpdate'; feature?: Feature; flow?: Flow }` in `ServerMessage`) is **removed** from the union type and replaced by `{ type: 'suggestion'; suggestion: Suggestion }`. The `memoryUpdate` variant is deleted from `types.ts` on both server and client. Any code that currently sends or handles `memoryUpdate` (in `agent.ts` and client WS handler) is updated to send/handle `suggestion` instead. This is a clean replacement, not a deprecation — both cannot coexist.

### 6. Deduplication

Before creating a suggestion, check:
- Is there already a pending suggestion with the same `type` and `data.name`? → Skip
- Is there already an accepted feature/flow with that name? → For features, skip. For behaviors, only skip if identical behavior text exists.

This prevents the agent from suggesting "Login" five times during one exploration.

## Client Changes

### 1. Types (`types.ts`)

Add:
```typescript
interface Suggestion {
  id: string;
  project_id: string;
  type: 'feature' | 'flow' | 'behavior';
  status: 'pending' | 'accepted' | 'dismissed';
  data: FeatureSuggestionData | FlowSuggestionData | BehaviorSuggestionData;
  created_at: string;
}

interface FeatureSuggestionData {
  name: string;
  description: string;
  criticality: Criticality;
  expected_behaviors: string[];
}

interface FlowSuggestionData {
  feature_name: string;
  name: string;
  steps: FlowStep[];
  checkpoints: Checkpoint[];
  criticality: Criticality;
}

interface BehaviorSuggestionData {
  feature_name: string;
  behavior: string;
}
```

Add `ClientMessage`:
- `{ type: 'explore'; projectId: string }`

Add `ServerMessage`:
- `{ type: 'suggestion'; suggestion: Suggestion }`

### 2. Sidebar Badge

The Sidebar component shows a badge on the Memory (🧠) icon with the count of pending suggestions. The count comes from:
- Real-time: incremented when `suggestion` WebSocket messages arrive
- On mount: fetched from `GET /api/projects/:id/suggestions/count`

### 3. Chat Learning Indicator

When a `suggestion` message arrives during testing, show a subtle inline message in the chat:
```
💡 Learned: "Login" feature with email + password flow
```

This is informational only — no action buttons. User reviews in Memory section.

### 4. Memory View — Suggestion Review Queue

The existing MemoryViewer component is extended with a "Pending Suggestions" section at the top (only visible when there are pending suggestions).

**Pending Suggestions section:**
- Header: "⏳ N Pending Suggestions" with "Accept All" and "Dismiss All" buttons
- Each suggestion is a card showing:
  - Type badge: NEW FEATURE (purple), NEW FLOW (green), ADD BEHAVIOR (blue)
  - Criticality badge (for features/flows)
  - Name, description, and details
  - Three action buttons: Accept (✓), Edit (✏️), Dismiss (✕)
- Edit opens an inline form pre-filled with the suggestion data — user modifies and saves, then accepts

**Below the pending section:** Existing accepted features list (unchanged from current MemoryViewer).

### 5. Explore & Learn Button

In the TestingView, add an "Explore App" button (visible when agent is idle and the project has few/no features). Clicking it sends the `explore` WebSocket message. The agent status changes to 'working' and the user watches the browser view as the agent explores.

After exploration completes, the sidebar badge updates with the count of new suggestions.

### 6. API Client (`lib/api.ts`)

Add functions for the suggestions API:
- `fetchPendingSuggestions(projectId)`
- `fetchSuggestionCount(projectId)`
- `acceptSuggestion(projectId, suggestionId)`
- `dismissSuggestion(projectId, suggestionId)`
- `updateSuggestion(projectId, suggestionId, data)`
- `bulkAcceptSuggestions(projectId)`
- `bulkDismissSuggestions(projectId)`

## UX Flow

### First-time experience

1. User creates a project with URL + optional context ("e-commerce app with login, catalog, checkout")
2. User navigates to Testing view
3. "Explore App" button is prominent (no features learned yet)
4. User clicks it → agent explores autonomously
5. Suggestions stream in, badge count increments on Memory tab
6. When exploration finishes, user clicks Memory tab
7. Reviews suggestions: accepts most, edits a couple, dismisses irrelevant ones
8. Accepted features now appear in the knowledge base and inform future agent tasks

### Ongoing usage

1. User sends a task: "Test the checkout flow"
2. Agent performs the task with memory context injected
3. Agent notices the checkout has a coupon code field not in the knowledge base
4. Agent emits MEMORY_JSON for the new behavior
5. Suggestion created, badge increments
6. User sees "💡 Learned: new behavior for Checkout" in chat
7. Later, user reviews and accepts in Memory section

## What We're NOT Building

- No drag-and-drop reordering of features/flows
- No version history for suggestions
- No collaborative review (single user per project)
- No auto-accept mode (user always reviews)
- No real-time editing of suggestion data during exploration (edit only in review queue)
- No separate "Explore" page — it uses the existing Testing view
