# Agent Learning System — Phase 1B: Inline Chat Enhancements

## Goal

Enrich the chat experience so users can see, feel, and trust the learning system. No new pages — all enhancements live inline in the existing chat flow.

## Design Principles

1. **Chat communicates learning, it doesn't manage it.** No delete/edit/forget actions in chat. Management belongs in a future Patterns dashboard.
2. **Progressive disclosure.** Start simple, reveal learning context as the system accumulates data.
3. **The agent speaks, not the UI.** Pattern application is conveyed through the agent's natural language, not badges or banners.
4. **Only show major milestones.** Suppress noise — no cards for internal state changes, cluster count bumps, or candidate pattern creation.

## Approach

Client changes plus two small server additions: a `feedbackAck` WebSocket message in `pipeline.ts` and a `transition` field on the existing `patternLearned` message. No new REST endpoints, no database migration, no new pages.

---

## 1. PatternLearnedCard

A compact, expandable knowledge card shown in the chat when a pattern graduates to `active` or `dominant`.

### When shown

| Event | Card shown? |
|-------|-------------|
| Candidate pattern created | No (silent) |
| Pattern becomes `active` (candidate → active) | Yes |
| Pattern becomes `dominant` (active → dominant) | Yes, with emphasis |
| Pattern becomes `stale` | Subtle system message (text only) |
| Cluster run count increases | No (silent) |

### Collapsed state (~75px)

- Green-tinted border (`--brand` at 30% opacity)
- Sparkle icon + "LEARNED WORKFLOW" label (uppercase, `--brand` color)
- Pattern name (body text)
- Run count + success rate percentage on the right
- Expand chevron

### Expanded state

- Same header as collapsed
- Divider line below header
- "STEPS LEARNED" label (uppercase, dim)
- Numbered list of dominant path steps (extracted from the pattern's `steps` field)
- Step numbers in `--brand` color

### First pattern celebration

One-time card when the agent learns its very first pattern. Centered layout with:
- Party icon
- "Your agent learned its first workflow" (bold)
- Pattern name, run count, success rate, step count
- Gradient background using both `--brand` (green) and `--accent` (amber)

Detection: Track in localStorage whether a first-pattern celebration has been shown for this agent. Key: `learning:firstPattern:<agentId>`.

### Data source

The `patternLearned` WebSocket message carries pattern data plus a `transition` field so the client knows which milestone triggered the card:
```typescript
{ type: 'patternLearned',
  name: string,
  steps: string[],
  success_rate: number,
  avg_steps: number,
  runs: number,
  transition: 'active' | 'dominant' }
```

### Where `patternLearned` is broadcast

Currently, `pipeline.ts` broadcasts `patternLearned` after `extractPattern` succeeds — but extraction creates a **candidate** pattern, which should be **silent** per the event table above.

Phase 1B changes this:

1. **Remove** the existing `patternLearned` broadcast from `pipeline.ts` (candidate creation is silent).
2. **Add** `broadcast` callback parameter to `lifecycle.ts::recordPatternSuccess`, which passes it through to `checkActivation`, which passes it through to `checkDominance`. All three functions in the chain need the parameter added:
   - `recordPatternSuccess(pattern, broadcast)` → calls `checkActivation(pattern, broadcast)`
   - `checkActivation(pattern, broadcast)` → calls `checkDominance(pattern, broadcast)`
   - `checkDominance(pattern, broadcast)` — private function, also needs the parameter
3. In `lifecycle.ts::checkActivation`, when a pattern is promoted to `active`, broadcast:
   ```typescript
   broadcast({ type: 'patternLearned', name, steps, success_rate, avg_steps, runs, transition: 'active' });
   ```
4. In `lifecycle.ts::checkDominance`, when a pattern is promoted to `dominant`, broadcast:
   ```typescript
   broadcast({ type: 'patternLearned', name, steps, success_rate, avg_steps, runs, transition: 'dominant' });
   ```

The pattern data comes from the `LearnedPattern` record and its cluster:
- `name`: from the cluster's `task_summary` (fetched via `getTaskCluster(pattern.cluster_id)`)
- `steps`: `pattern.steps.map(s => s.action)` — note that for task patterns, `LearnedPattern.steps` is typed as `PlaywrightStep[]` but `createTaskPattern` stores `ExtractedStep[]` (JSONB with free-text `action: string`). The type mismatch is pre-existing; the implementer should cast via `(pattern.steps as Array<{ action: string }>).map(s => s.action)` or add a `TaskPatternStep` type alias to `types.ts`
- `success_rate`, `avg_steps`, `runs`: from pattern fields and cluster `run_count`

The client uses `transition` to:
- Render the standard card for `'active'`
- Render the emphasized card for `'dominant'`
- Determine first-pattern celebration eligibility (only on `'active'` transition, since that's the first time a pattern graduates)

The `patternStale` message renders as a plain system message (no card):
```typescript
{ type: 'patternStale', name: string, reason: string }
```

---

## 2. Adaptive Feedback Confirmation

Enhance the existing `TaskCompletionCard` submitted state to progressively reveal learning context.

### Stage determination

After the user submits feedback (thumbs up or down), the server responds with a `feedbackAck` message containing cluster context. The client uses this to determine which stage to render:

- **No `feedbackAck` received / no cluster**: Stage 1
- **`feedbackAck` with `clustered: true`**: Stage 2
- **`feedbackAck` with `clusterProgress.current / clusterProgress.needed >= 0.8`**: Stage 3
- **Negative feedback**: Always simple confirmation (no learning context)

### Stage 1 — Early usage

```
✓ Feedback recorded
  This helps your agent improve
```

Green check, encouraging subtext. Goal: reinforce the feedback habit.

### Stage 2 — Learning underway

```
✓ Added to learning pool
  Create Jenkins Pipeline · [====------] 3 / 5 runs
```

Shows cluster name + progress bar (48px × 4px, green fill). Creates anticipation.

### Stage 3 — Near extraction (progress ≥ 80%)

```
✓ Added to learning pool
  Create Jenkins Pipeline · [========--] 4 / 5 runs
  One more successful run will teach a reusable workflow
```

Progress bar color shifts from `--brand` (green) to `--accent` (amber). Anticipation message in amber.

### Negative feedback — always simple

```
✓ Feedback recorded
```

No learning context. No cluster progress. Keep it clean.

### Feedback submission flow

When the user clicks thumbs up or down:

1. `sendFeedback(taskId, rating)` sends the WebSocket message and sets `submittedRating` on the card — but does **not** clear `lastCompletedTask`. The card remains visible.
2. The card immediately shows Stage 1 confirmation ("Feedback recorded") as a placeholder.
3. When `feedbackAck` arrives (matched by `taskId`), the card upgrades to Stage 2 or 3 if cluster data is present.
4. `lastCompletedTask` is cleared only when the **next task starts** (on `taskStarted` message), not on feedback submission.

This avoids the race where clearing the card on submit would destroy it before the ack arrives.

### Required WebSocketContext changes

```typescript
// CHANGE: sendFeedback must NOT call setLastCompletedTask(null)
// (current implementation does — remove that line)
const sendFeedback = (taskId: string, rating: 'positive' | 'negative') => {
  ws.send(JSON.stringify({ type: 'taskFeedback', task_id: taskId, rating }));
  // Do NOT clear lastCompletedTask here — card stays visible for ack
};

// CHANGE: taskStarted handler clears previous task state
case 'taskStarted':
  setLastCompletedTask(null);        // Clear the old card
  feedbackAcks.delete(prevTaskId);   // Prune ack map
  setActiveTaskId(msg.taskId);
  break;
```

### Confirmation display

The confirmation replaces the feedback buttons inline on the TaskCompletionCard. It does NOT add a new chat message. The card opacity reduces to 0.8 (existing behavior).

---

## 3. feedbackAck Server Message

### New WebSocket message type

```typescript
// Server → Client
{ type: 'feedbackAck',
  taskId: string,
  rating: 'positive' | 'negative',
  clustered: boolean,
  clusterName?: string,
  clusterProgress?: { current: number, needed: number } }
```

Note: `isFirstPattern` is **not** on this message. First-pattern detection is handled entirely client-side via localStorage when `patternLearned` arrives (see Section 1).

### Server-side change

The `feedbackAck` broadcast lives at the **call site** in `index.ts` (inside the `taskFeedback` WebSocket handler), not inside `processFeedback`. This is because `feedbackAck` must be sent even if `processFeedback` throws, and `processFeedback` returns `void` — it doesn't expose cluster state to its caller.

To get cluster data for the ack, the call site queries the cluster **after** `processFeedback` completes:

```typescript
// In index.ts taskFeedback handler — wraps the existing processFeedback call
try {
  await processFeedback(agentId, taskId, sessionId, prompt, rating, correction, broadcast);

  // Query cluster state for the ack (processFeedback doesn't return it)
  const cluster = await getTaskClusterByTask(taskId);

  broadcast({
    type: 'feedbackAck',
    taskId,
    rating,
    clustered: !!cluster,
    clusterName: cluster?.task_summary,
    clusterProgress: cluster
      ? { current: cluster.run_count, needed: MIN_CLUSTER_RUNS }
      : undefined,
  });
} catch (err) {
  // Still ack so the client can show confirmation
  broadcast({
    type: 'feedbackAck',
    taskId,
    rating,
    clustered: false,
  });
}
```

This requires a small DB helper added to `db.ts`:

```typescript
// Looks up the cluster a task was assigned to via learning_pool → task_clusters join
async function getTaskClusterByTask(taskId: string): Promise<TaskCluster | null>
```

Queries `learning_pool` by `task_id`, gets `cluster_id`, then fetches from `task_clusters`. Returns `null` if the task has no pool entry or no cluster assignment.

The `needed` value comes from `MIN_CLUSTER_RUNS` (currently 5) in `extraction.ts`. This constant must be **exported** (it's currently private) so `index.ts` can import it.

### Client-side handling

`WebSocketContext` receives `feedbackAck` and stores it in a map keyed by `taskId`. The map is pruned: when `taskStarted` fires, clear the previous task's entry (same cleanup point as `lastCompletedTask`). `TaskCompletionCard` reads the ack for its task to determine which confirmation stage to render:

- If `rating === 'negative'`: always show simple "Feedback recorded" (no learning context)
- If `clustered === false`: Stage 1
- If `clustered === true`: Stage 2 (or Stage 3 if progress ≥ 80%)

### Type additions (both server and client)

Add `feedbackAck` to the `ServerMessage` union in both `server/src/types.ts` and `client/src/types.ts` (identical definition):

```typescript
| { type: 'feedbackAck';
    taskId: string;
    rating: 'positive' | 'negative';
    clustered: boolean;
    clusterName?: string;
    clusterProgress?: { current: number; needed: number } }
```

Add `transition` to the existing `patternLearned` entry in both `ServerMessage` unions:

```typescript
// Before:
| { type: 'patternLearned'; name: string; steps: string[]; success_rate: number; avg_steps: number; runs: number }
// After:
| { type: 'patternLearned'; name: string; steps: string[]; success_rate: number; avg_steps: number; runs: number; transition: 'active' | 'dominant' }
```

---

## 4. Agent Prompt Enhancement

When `buildTaskPromptWithPatterns` injects retrieved patterns into the prompt context, append this instruction:

```
If you recognize this task from your learned patterns, mention it naturally in your first thought —
for example: "I've done this before, I know a good approach." Do NOT list the learned steps
mechanically; just let the knowledge guide your actions.
```

This makes pattern application visible through the agent's natural conversation, not through UI chrome.

---

## 5. Component Changes Summary

| Component | Change | Files |
|-----------|--------|-------|
| `PatternLearnedCard` | New component + CSS | `client/src/components/PatternLearnedCard.tsx`, `.css` |
| `TaskCompletionCard` | Add adaptive confirmation states, feedback submission flow | `client/src/components/TaskCompletionCard.tsx`, `.css` |
| `WebSocketContext` | Handle `feedbackAck` (store in map by taskId), render `patternLearned` as card, track first-pattern via localStorage, clear `lastCompletedTask` on `taskStarted` instead of on feedback submit | `client/src/contexts/WebSocketContext.tsx` |
| `ChatPanel` | Render `PatternLearnedCard` for pattern messages | `client/src/components/ChatPanel.tsx` |
| `index.ts` | Wrap `processFeedback` call with `feedbackAck` broadcast (try/catch) | `server/src/index.ts` |
| `pipeline.ts` | Remove candidate-creation `patternLearned` broadcast (now silent) | `server/src/learning/pipeline.ts` |
| `lifecycle.ts` | Add `broadcast` param to `recordPatternSuccess` → `checkActivation` → `checkDominance` (full chain); broadcast `patternLearned` with `transition` on activation/dominance | `server/src/learning/lifecycle.ts` |
| `db.ts` | Add `getTaskClusterByTask(taskId)` helper | `server/src/db.ts` |
| `types.ts` (server) | Add `feedbackAck` to `ServerMessage` union, add `transition` to `patternLearned` | `server/src/types.ts` |
| `types.ts` (client) | Add `feedbackAck` to `ServerMessage` union, add `transition` to `patternLearned` | `client/src/types.ts` |
| `memory-engine.ts` | Add natural-language pattern instruction | `server/src/memory-engine.ts` |

## 6. What's NOT in scope

- No new sidebar nav item or dashboard page
- No pattern management UI (delete/edit/forget — that's Phase 2)
- No new REST endpoints
- No database migration
- No new background jobs
- No changes to the feedback pipeline **processing logic** (clustering, extraction algorithms remain unchanged — only adding the `feedbackAck` broadcast and `transition` field to existing broadcasts)
