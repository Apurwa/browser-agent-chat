# Agent Learning System — Phase 1B: Inline Chat Enhancements

## Goal

Enrich the chat experience so users can see, feel, and trust the learning system. No new pages — all enhancements live inline in the existing chat flow.

## Design Principles

1. **Chat communicates learning, it doesn't manage it.** No delete/edit/forget actions in chat. Management belongs in a future Patterns dashboard.
2. **Progressive disclosure.** Start simple, reveal learning context as the system accumulates data.
3. **The agent speaks, not the UI.** Pattern application is conveyed through the agent's natural language, not badges or banners.
4. **Only show major milestones.** Suppress noise — no cards for internal state changes, cluster count bumps, or candidate pattern creation.

## Approach

Client-only changes plus one small server addition (`feedbackAck` message). No new REST endpoints, no database migration, no new pages.

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

The existing `patternLearned` WebSocket message already contains everything needed:
```
{ type: 'patternLearned', name: string, steps: string[], success_rate: number, avg_steps: number, runs: number }
```

The `patternStale` message renders as a plain system message (no card):
```
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

### Confirmation display

The confirmation replaces the feedback buttons inline on the TaskCompletionCard. It does NOT add a new chat message. The card opacity reduces to 0.8 (existing behavior).

---

## 3. feedbackAck Server Message

### New WebSocket message type

```typescript
// Server → Client
{ type: 'feedbackAck',
  taskId: string,
  clustered: boolean,
  clusterName?: string,
  clusterProgress?: { current: number, needed: number },
  isFirstPattern?: boolean }
```

### Server-side change

In `pipeline.ts`, after `processFeedback` completes, broadcast the ack:

```typescript
// After clustering and (optional) extraction
broadcast({
  type: 'feedbackAck',
  taskId,
  clustered: !!clusterId,
  clusterName: cluster?.task_summary,
  clusterProgress: cluster ? { current: cluster.run_count, needed: 5 } : undefined,
  isFirstPattern: !!extractionResult,
});
```

The `needed` value (5) comes from the extraction threshold constant (`MIN_RUNS_FOR_EXTRACTION`).

### Client-side handling

`WebSocketContext` receives `feedbackAck` and stores it in state. `TaskCompletionCard` reads this state to render the appropriate confirmation stage.

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
| `TaskCompletionCard` | Add adaptive confirmation states | `client/src/components/TaskCompletionCard.tsx`, `.css` |
| `WebSocketContext` | Handle `feedbackAck`, render `patternLearned` as card, track first-pattern | `client/src/contexts/WebSocketContext.tsx` |
| `ChatPanel` | Render `PatternLearnedCard` for pattern messages | `client/src/components/ChatPanel.tsx` |
| `pipeline.ts` | Broadcast `feedbackAck` after processing | `server/src/learning/pipeline.ts` |
| `types.ts` (server) | Add `feedbackAck` to `ServerMessage` union | `server/src/types.ts` |
| `types.ts` (client) | Add `feedbackAck` to `ServerMessage` union | `client/src/types.ts` |
| `memory-engine.ts` | Add natural-language pattern instruction | `server/src/memory-engine.ts` |

## 6. What's NOT in scope

- No new sidebar nav item or dashboard page
- No pattern management UI (delete/edit/forget — that's Phase 2)
- No new REST endpoints
- No database migration
- No new background jobs
- No changes to the feedback pipeline logic itself
