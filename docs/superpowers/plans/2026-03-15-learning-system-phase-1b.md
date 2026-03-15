# Learning System Phase 1B: Inline Chat Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the learning system visible and trustworthy through inline chat enhancements — PatternLearnedCard, adaptive feedback confirmation, feedbackAck server message, and prompt enhancement.

**Architecture:** Server-side changes wire `feedbackAck` broadcasts at the `index.ts` call site and move `patternLearned` broadcasts from `pipeline.ts` (candidate creation, now silent) to `lifecycle.ts` (activation/dominance transitions). Client-side adds a new `PatternLearnedCard` component, enhances `TaskCompletionCard` with 3-stage adaptive confirmation, and updates `WebSocketContext` to handle both new message types and manage feedback lifecycle state.

**Tech Stack:** React 19, TypeScript, CSS custom properties, WebSocket, Supabase (read-only queries)

**Spec:** `docs/superpowers/specs/2026-03-15-learning-system-phase-1b-design.md`

---

## Chunk 1: Server-Side Changes

### Task 1: Type Definitions — Add `feedbackAck` and `transition` to ServerMessage

**Files:**
- Modify: `browser-agent-chat/server/src/types.ts:363` (patternLearned) and `:365` (add feedbackAck)
- Modify: `browser-agent-chat/client/src/types.ts:146` (patternLearned) and `:148` (add feedbackAck)

- [ ] **Step 1: Add `transition` to `patternLearned` in server types**

In `browser-agent-chat/server/src/types.ts`, change the `patternLearned` entry in the `ServerMessage` union:

```typescript
// Before (line 363):
| { type: 'patternLearned'; name: string; steps: string[]; success_rate: number; avg_steps: number; runs: number }

// After:
| { type: 'patternLearned'; name: string; steps: string[]; success_rate: number; avg_steps: number; runs: number; transition: 'active' | 'dominant' }
```

- [ ] **Step 2: Add `feedbackAck` to server `ServerMessage` union**

Add after the `patternStale` entry (line 364):

```typescript
| { type: 'feedbackAck'; taskId: string; rating: FeedbackRating; clustered: boolean; clusterName?: string; clusterProgress?: { current: number; needed: number } }
```

- [ ] **Step 3: Mirror both changes in client types**

In `browser-agent-chat/client/src/types.ts`, make the same two changes to `ServerMessage`:

```typescript
// Update patternLearned (line 146):
| { type: 'patternLearned'; name: string; steps: string[]; success_rate: number; avg_steps: number; runs: number; transition: 'active' | 'dominant' }

// Add feedbackAck after patternStale (line 147):
| { type: 'feedbackAck'; taskId: string; rating: 'positive' | 'negative'; clustered: boolean; clusterName?: string; clusterProgress?: { current: number; needed: number } }
```

Also add `patternData` to the `ChatMessage` interface (line 152-158) so pattern cards render inline in the message flow:

```typescript
export interface ChatMessage {
  id: string;
  type: 'user' | 'agent' | 'system' | 'finding';
  content: string;
  timestamp: number;
  finding?: Finding;
  patternData?: {
    name: string;
    steps: string[];
    successRate: number;
    runs: number;
    transition: 'active' | 'dominant';
    isCelebration: boolean;
  };
}
```

Note: `FeedbackRating` is defined in `server/src/types.ts` but not exported to the client — the client `feedbackAck` type uses inline `'positive' | 'negative'` string literal union instead.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -20`
Expected: Type errors in `pipeline.ts` (missing `transition` field on existing broadcast) — this is expected and will be fixed in Task 3.

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/types.ts browser-agent-chat/client/src/types.ts
git commit -m "feat(types): add feedbackAck message and transition field to patternLearned"
```

---

### Task 2: Export `MIN_CLUSTER_RUNS` and Add `getTaskClusterByTask` DB Helper

**Files:**
- Modify: `browser-agent-chat/server/src/learning/extraction.ts:5`
- Modify: `browser-agent-chat/server/src/db.ts` (add new function after line ~920)

- [ ] **Step 1: Export `MIN_CLUSTER_RUNS` from extraction.ts**

In `browser-agent-chat/server/src/learning/extraction.ts`, change line 5:

```typescript
// Before:
const MIN_CLUSTER_RUNS = 5;

// After:
export const MIN_CLUSTER_RUNS = 5;
```

- [ ] **Step 2: Add `getTaskClusterByTask` to db.ts**

Add after the `updateLearningPoolCluster` function (around line 925):

```typescript
export async function getTaskClusterByTask(taskId: string): Promise<TaskCluster | null> {
  if (!isSupabaseEnabled()) return null;

  // Step 1: Find the learning pool entry for this task
  const { data: poolEntry, error: poolError } = await supabase!
    .from('learning_pool')
    .select('cluster_id')
    .eq('task_id', taskId)
    .single();

  if (poolError || !poolEntry?.cluster_id) return null;

  // Step 2: Fetch the cluster
  return getTaskCluster(poolEntry.cluster_id);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -20`
Expected: Still type errors from `pipeline.ts` `patternLearned` (missing `transition`) — fixed in Task 3.

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/server/src/learning/extraction.ts browser-agent-chat/server/src/db.ts
git commit -m "feat(db): export MIN_CLUSTER_RUNS and add getTaskClusterByTask helper"
```

---

### Task 3: Move `patternLearned` Broadcasts to lifecycle.ts

**Files:**
- Modify: `browser-agent-chat/server/src/learning/pipeline.ts:87-98` (remove broadcast)
- Modify: `browser-agent-chat/server/src/learning/lifecycle.ts:18,42,99` (add broadcast param chain)

- [ ] **Step 1: Remove `patternLearned` broadcast from pipeline.ts**

In `browser-agent-chat/server/src/learning/pipeline.ts`, replace lines 87-98 with a log-only version:

```typescript
  if (result) {
    console.log(`[LEARNING] Pattern extracted for cluster "${cluster.task_summary}": ${result.steps.length} steps`);
    // patternLearned broadcast moved to lifecycle.ts — candidate creation is silent
  }
```

- [ ] **Step 2: Add `broadcast` parameter to `recordPatternSuccess`**

In `browser-agent-chat/server/src/learning/lifecycle.ts`, update `recordPatternSuccess` (line 99):

```typescript
// Before:
export async function recordPatternSuccess(pattern: LearnedPattern): Promise<void> {

// After:
export async function recordPatternSuccess(
  pattern: LearnedPattern,
  broadcast?: (msg: ServerMessage) => void,
): Promise<void> {
```

Add `ServerMessage` to the **existing** type-only import at line 5. Do NOT touch the `db.js` imports on lines 1-4:

```typescript
// Before (line 5):
import type { LearnedPattern, PatternState } from '../types.js';

// After (line 5):
import type { LearnedPattern, PatternState, ServerMessage } from '../types.js';
```

Update the `checkActivation` call inside `recordPatternSuccess` (line 116 of lifecycle.ts):

```typescript
// Before:
await checkActivation({ ...pattern, use_count: newUseCount, success_rate: newSuccessRate });

// After:
await checkActivation({ ...pattern, use_count: newUseCount, success_rate: newSuccessRate }, broadcast);
```

- [ ] **Step 3: Add `broadcast` parameter to `checkActivation`**

```typescript
// Before (line 18):
export async function checkActivation(pattern: LearnedPattern): Promise<boolean> {

// After:
export async function checkActivation(
  pattern: LearnedPattern,
  broadcast?: (msg: ServerMessage) => void,
): Promise<boolean> {
```

After the `updatePatternState(pattern.id, 'active', ...)` call (line 29-31), add the broadcast:

```typescript
  await updatePatternState(pattern.id, 'active', {
    last_verified_success: new Date().toISOString(),
  });

  // Broadcast activation milestone
  if (broadcast && pattern.cluster_id) {
    const cluster = await getTaskCluster(pattern.cluster_id);
    if (cluster) {
      const steps = (pattern.steps as Array<{ action: string }>).map(s => s.action);
      broadcast({
        type: 'patternLearned',
        name: cluster.task_summary,
        steps,
        success_rate: pattern.success_rate ?? 0,
        avg_steps: pattern.avg_steps ?? steps.length,
        runs: cluster.run_count,
        transition: 'active',
      });
    }
  }

  // Check if this should become dominant (pass broadcast through)
  await checkDominance(pattern, broadcast);
```

Note: `checkActivation` has two changes: (1) new broadcast parameter in its signature, (2) the existing `checkDominance(pattern)` call on line 34 updated to `checkDominance(pattern, broadcast)`. Both are shown in the snippet above.

- [ ] **Step 4: Add `broadcast` parameter to `checkDominance`**

```typescript
// Before (line 42):
async function checkDominance(pattern: LearnedPattern): Promise<void> {

// After:
async function checkDominance(
  pattern: LearnedPattern,
  broadcast?: (msg: ServerMessage) => void,
): Promise<void> {
```

After promoting best to dominant (line 63-65), add the broadcast:

```typescript
  // Promote best to dominant
  if (best.pattern_state !== 'dominant') {
    await updatePatternState(best.id, 'dominant');

    // Broadcast dominance milestone
    if (broadcast && best.cluster_id) {
      const cluster = await getTaskCluster(best.cluster_id);
      if (cluster) {
        const steps = (best.steps as Array<{ action: string }>).map(s => s.action);
        broadcast({
          type: 'patternLearned',
          name: cluster.task_summary,
          steps,
          success_rate: best.success_rate ?? 0,
          avg_steps: best.avg_steps ?? steps.length,
          runs: cluster.run_count,
          transition: 'dominant',
        });
      }
    }
  }
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -20`
Expected: PASS (no errors)

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/server/src/learning/pipeline.ts browser-agent-chat/server/src/learning/lifecycle.ts
git commit -m "feat(lifecycle): move patternLearned broadcasts to activation/dominance transitions"
```

---

### Task 4: Wire `feedbackAck` Broadcast in index.ts

**Files:**
- Modify: `browser-agent-chat/server/src/index.ts:302-325` (taskFeedback handler)

- [ ] **Step 1: Add imports**

At the top of `browser-agent-chat/server/src/index.ts`, add to the existing import block:

```typescript
import { getTaskClusterByTask } from './db.js';
import { MIN_CLUSTER_RUNS } from './learning/extraction.js';
```

- [ ] **Step 2: Replace the `taskFeedback` handler**

Replace lines 302-325 (the `else if (msg.type === 'taskFeedback')` block) with:

```typescript
    } else if (msg.type === 'taskFeedback') {
      const agentId = clientAgents.get(ws);
      if (!agentId) return;

      const activeTask = activeTasks.get(agentId);
      const agentSession = sessionManager.getAgent(agentId);

      // Only use stored prompt if it matches the feedback task
      const prompt = (activeTask?.taskId === msg.task_id) ? activeTask.prompt : '';
      const broadcastFn = (broadcastMsg: ServerMessage) => broadcastToAgent(agentId, broadcastMsg);

      try {
        await processFeedback(
          agentId,
          msg.task_id,
          agentSession?.sessionId ?? null,
          prompt,
          msg.rating,
          msg.correction ?? null,
          broadcastFn,
        );

        // Query cluster state for the ack
        const cluster = await getTaskClusterByTask(msg.task_id);

        broadcastFn({
          type: 'feedbackAck',
          taskId: msg.task_id,
          rating: msg.rating,
          clustered: !!cluster,
          clusterName: cluster?.task_summary,
          clusterProgress: cluster
            ? { current: cluster.run_count, needed: MIN_CLUSTER_RUNS }
            : undefined,
        });
      } catch (err) {
        console.error('[LEARNING] Feedback processing error:', err);
        // Still ack so the client can show confirmation
        broadcastFn({
          type: 'feedbackAck',
          taskId: msg.task_id,
          rating: msg.rating,
          clustered: false,
        });
      }

      // Clean up if this was the active task
      if (activeTask?.taskId === msg.task_id) {
        activeTasks.delete(agentId);
      }
```

Note: The key change from the old code is `await processFeedback(...)` instead of `.catch(err => ...)` — we need to `await` so we can query the cluster state afterwards.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -20`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/server/src/index.ts
git commit -m "feat(feedback): wire feedbackAck broadcast in taskFeedback handler"
```

---

### Task 5: Agent Prompt Enhancement

**Files:**
- Modify: `browser-agent-chat/server/src/memory-engine.ts:98-103`

- [ ] **Step 1: Add pattern recognition instruction**

In `browser-agent-chat/server/src/memory-engine.ts`, **replace** lines 97-100 (the existing `enrichedContext` assignment) with the version that includes the pattern instruction. Do NOT add a second `const enrichedContext` — replace the existing one:

```typescript
  // Before (lines 97-100):
  const enrichedContext = patternBlock
    ? `${memoryContext}\n\n${patternBlock}`
    : memoryContext;

  // After (replace lines 97-100):
  const patternInstruction = `If you recognize this task from your learned patterns, mention it naturally in your first thought — for example: "I've done this before, I know a good approach." Do NOT list the learned steps mechanically; just let the knowledge guide your actions.`;

  const enrichedContext = patternBlock
    ? `${memoryContext}\n\n${patternBlock}\n\n${patternInstruction}`
    : memoryContext;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -20`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/server/src/memory-engine.ts
git commit -m "feat(prompt): add natural language pattern recognition instruction"
```

---

## Chunk 2: Client-Side Changes

### Task 6: PatternLearnedCard Component

**Files:**
- Create: `browser-agent-chat/client/src/components/PatternLearnedCard.tsx`
- Create: `browser-agent-chat/client/src/components/PatternLearnedCard.css`

- [ ] **Step 1: Create PatternLearnedCard.css**

Create `browser-agent-chat/client/src/components/PatternLearnedCard.css`:

```css
.pattern-learned-card {
  background: linear-gradient(135deg, var(--bg-primary), var(--bg-secondary));
  border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
  border-radius: 12px;
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.pattern-learned-card:hover {
  border-color: color-mix(in srgb, var(--brand) 50%, transparent);
}

.pattern-learned-card--dominant {
  border-color: color-mix(in srgb, var(--brand) 50%, transparent);
}

.pattern-learned-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pattern-learned-card__icon {
  font-size: 14px;
  line-height: 1;
}

.pattern-learned-card__info {
  flex: 1;
  min-width: 0;
}

.pattern-learned-card__label {
  font-size: 11px;
  color: var(--brand);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.pattern-learned-card__name {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pattern-learned-card__stats {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.pattern-learned-card__stat {
  font-size: 11px;
  color: var(--text-muted);
}

.pattern-learned-card__stat--success {
  color: #4ade80;
}

.pattern-learned-card__chevron {
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
}

.pattern-learned-card__steps {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-secondary);
}

.pattern-learned-card__steps-label {
  font-size: 10px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.pattern-learned-card__step-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pattern-learned-card__step {
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  gap: 6px;
}

.pattern-learned-card__step-num {
  color: var(--brand);
  min-width: 14px;
}

/* First pattern celebration */
.pattern-learned-card--celebration {
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 15%, var(--bg-primary)), color-mix(in srgb, var(--accent) 10%, var(--bg-primary)));
  border-color: color-mix(in srgb, var(--brand) 40%, transparent);
  text-align: center;
  cursor: default;
}

.pattern-learned-card__celebration-icon {
  font-size: 20px;
  margin-bottom: 8px;
}

.pattern-learned-card__celebration-title {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 600;
}

.pattern-learned-card__celebration-name {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
}

.pattern-learned-card__celebration-stats {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 10px;
}

.pattern-learned-card__celebration-stat {
  font-size: 11px;
}

.pattern-learned-card__celebration-stat--runs {
  color: var(--text-muted);
}

.pattern-learned-card__celebration-stat--success {
  color: #4ade80;
}

.pattern-learned-card__celebration-stat--steps {
  color: var(--accent);
}
```

- [ ] **Step 2: Create PatternLearnedCard.tsx**

Create `browser-agent-chat/client/src/components/PatternLearnedCard.tsx`:

```tsx
import { useState } from 'react';
import './PatternLearnedCard.css';

interface PatternLearnedCardProps {
  name: string;
  steps: string[];
  successRate: number;
  runs: number;
  transition: 'active' | 'dominant';
  isCelebration?: boolean;
}

export default function PatternLearnedCard({
  name,
  steps,
  successRate,
  runs,
  transition,
  isCelebration,
}: PatternLearnedCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (isCelebration) {
    return (
      <div className="pattern-learned-card pattern-learned-card--celebration">
        <div className="pattern-learned-card__celebration-icon">🎉</div>
        <div className="pattern-learned-card__celebration-title">
          Your agent learned its first workflow
        </div>
        <div className="pattern-learned-card__celebration-name">{name}</div>
        <div className="pattern-learned-card__celebration-stats">
          <span className="pattern-learned-card__celebration-stat pattern-learned-card__celebration-stat--runs">
            {runs} runs
          </span>
          <span className="pattern-learned-card__celebration-stat pattern-learned-card__celebration-stat--success">
            {Math.round(successRate * 100)}% success
          </span>
          <span className="pattern-learned-card__celebration-stat pattern-learned-card__celebration-stat--steps">
            {steps.length} steps
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`pattern-learned-card ${transition === 'dominant' ? 'pattern-learned-card--dominant' : ''}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="pattern-learned-card__header">
        <span className="pattern-learned-card__icon">✨</span>
        <div className="pattern-learned-card__info">
          <div className="pattern-learned-card__label">Learned Workflow</div>
          <div className="pattern-learned-card__name">{name}</div>
        </div>
        <div className="pattern-learned-card__stats">
          <span className="pattern-learned-card__stat">{runs} runs</span>
          <span className="pattern-learned-card__stat pattern-learned-card__stat--success">
            {Math.round(successRate * 100)}%
          </span>
          <span className="pattern-learned-card__chevron">
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="pattern-learned-card__steps">
          <div className="pattern-learned-card__steps-label">Steps learned</div>
          <div className="pattern-learned-card__step-list">
            {steps.map((step, i) => (
              <div key={i} className="pattern-learned-card__step">
                <span className="pattern-learned-card__step-num">{i + 1}.</span>
                {step}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify client compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p client/tsconfig.json 2>&1 | head -20`
Expected: PASS (component is standalone, not yet imported)

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/client/src/components/PatternLearnedCard.tsx browser-agent-chat/client/src/components/PatternLearnedCard.css
git commit -m "feat(ui): add PatternLearnedCard component with collapsed/expanded/celebration states"
```

---

### Task 7: Update WebSocketContext — feedbackAck Handling and Lifecycle Changes

**Files:**
- Modify: `browser-agent-chat/client/src/contexts/WebSocketContext.tsx`

This task modifies WebSocketContext to:
1. Add `feedbackAck` state (single nullable value — only one task is active at a time, so a map is unnecessary; the `taskId` guard in `getConfirmationStage` prevents mismatches)
2. Handle `feedbackAck` messages
3. Change `sendFeedback` to NOT clear `lastCompletedTask` (intentional: card must stay visible until `feedbackAck` arrives)
4. Clear `lastCompletedTask` on `taskStarted` instead
5. Store `patternLearned` data inline in `messages` as `ChatMessage` with `patternData` (renders as PatternLearnedCard, not plain text)
6. Track first-pattern celebration via localStorage

- [ ] **Step 1: Add new state and types to WebSocketState interface**

In `browser-agent-chat/client/src/contexts/WebSocketContext.tsx`, update the `WebSocketState` interface (lines 7-29) to add:

```typescript
interface FeedbackAckData {
  taskId: string;
  rating: 'positive' | 'negative';
  clustered: boolean;
  clusterName?: string;
  clusterProgress?: { current: number; needed: number };
}
```

Add to the `WebSocketState` interface:

```typescript
  feedbackAck: FeedbackAckData | null;
```

Note: Pattern data is stored inline in `ChatMessage.patternData` (added in Task 1 Step 3), not as a separate state array. This ensures pattern cards render in correct chronological order in the chat flow.

- [ ] **Step 2: Add state variables**

After the `pendingCredentialRequest` state (line 59), add:

```typescript
  const [feedbackAck, setFeedbackAck] = useState<FeedbackAckData | null>(null);
```

Note: `activeAgentRef` already exists at line ~62 and is used throughout the file. Do NOT add a duplicate — the `patternLearned` handler in Step 5 uses this existing ref. No `patternMessages` state is needed — pattern data goes into the existing `messages` array via `ChatMessage.patternData`.

- [ ] **Step 3: Update `taskStarted` handler to clear previous task state**

In the `handleMessage` callback, update the `taskStarted` case (line 111-113):

```typescript
      case 'taskStarted':
        setActiveTaskId((msg as any).taskId);
        setLastCompletedTask(null);  // Clear previous card
        setFeedbackAck(null);        // Prune ack
        break;
```

- [ ] **Step 4: Add `feedbackAck` handler**

After the `patternStale` case (line 158-161), add:

```typescript
      case 'feedbackAck': {
        const ack = msg as any;
        setFeedbackAck({
          taskId: ack.taskId,
          rating: ack.rating,
          clustered: ack.clustered,
          clusterName: ack.clusterName,
          clusterProgress: ack.clusterProgress,
        });
        break;
      }
```

- [ ] **Step 5: Update `patternLearned` handler to store card data**

Replace the existing `patternLearned` case (lines 153-157):

```typescript
      case 'patternLearned': {
        const pl = msg as any;
        const agentId = activeAgentRef.current;

        // Check if this is the first pattern (localStorage)
        const lsKey = agentId ? `learning:firstPattern:${agentId}` : null;
        let isCelebration = false;
        if (pl.transition === 'active' && lsKey && !localStorage.getItem(lsKey)) {
          isCelebration = true;
          localStorage.setItem(lsKey, 'true');
        }

        // Add as a special message type so it renders inline in the chat flow
        const patternMsg: ChatMessage = {
          id: crypto.randomUUID(),
          type: 'system',
          content: `__patternLearned__`,  // Sentinel — ChatPanel renders PatternLearnedCard instead of text
          timestamp: Date.now(),
          patternData: {
            name: pl.name,
            steps: pl.steps,
            successRate: pl.success_rate,
            runs: pl.runs,
            transition: pl.transition,
            isCelebration,
          },
        };
        setMessages(prev => [...prev, patternMsg]);
        break;
      }
```

- [ ] **Step 6: Update `sendFeedback` to NOT clear `lastCompletedTask`**

Replace lines 335-338:

```typescript
  // Before:
  const sendFeedback = useCallback((taskId: string, rating: 'positive' | 'negative', correction?: string) => {
    send({ type: 'taskFeedback', task_id: taskId, rating, correction });
    setLastCompletedTask(null);
  }, [send]);

  // After:
  const sendFeedback = useCallback((taskId: string, rating: 'positive' | 'negative', correction?: string) => {
    send({ type: 'taskFeedback', task_id: taskId, rating, correction });
    // Do NOT clear lastCompletedTask here — card stays visible for feedbackAck
  }, [send]);
```

- [ ] **Step 7: Add new state to context value**

In the `value` object (line 355+), add:

```typescript
    feedbackAck,
```

- [ ] **Step 8: Verify client compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p client/tsconfig.json 2>&1 | head -20`
Expected: Type errors in files that use `WebSocketState` but don't yet pass the new fields — this is expected. The core context should compile.

- [ ] **Step 9: Commit**

```bash
git add browser-agent-chat/client/src/contexts/WebSocketContext.tsx
git commit -m "feat(ws): handle feedbackAck, pattern data storage, fix feedback lifecycle"
```

---

### Task 8: Adaptive Feedback Confirmation in TaskCompletionCard

**Files:**
- Modify: `browser-agent-chat/client/src/components/TaskCompletionCard.tsx`
- Modify: `browser-agent-chat/client/src/components/TaskCompletionCard.css`

- [ ] **Step 1: Add `feedbackAck` prop to TaskCompletionCard**

In `browser-agent-chat/client/src/components/TaskCompletionCard.tsx`, update the interface. Use inline type for `feedbackAck` to avoid importing from WebSocketContext (keep the component self-contained):

```typescript
interface TaskCompletionCardProps {
  taskId: string;
  success: boolean;
  stepCount: number;
  durationMs: number;
  onFeedback: (taskId: string, rating: 'positive' | 'negative', correction?: string) => void;
  feedbackAck?: {
    taskId: string;
    rating: 'positive' | 'negative';
    clustered: boolean;
    clusterName?: string;
    clusterProgress?: { current: number; needed: number };
  } | null;
}
```

Add `feedbackAck` to destructured props.

- [ ] **Step 2: Add stage determination helper**

Inside the component, add:

```typescript
  const getConfirmationStage = (): 1 | 2 | 3 => {
    if (!feedbackAck || feedbackAck.taskId !== taskId) return 1;
    if (submittedRating === 'negative') return 1;
    if (!feedbackAck.clustered) return 1;
    if (feedbackAck.clusterProgress) {
      const ratio = feedbackAck.clusterProgress.current / feedbackAck.clusterProgress.needed;
      if (ratio >= 0.8) return 3;
    }
    return 2;
  };
```

- [ ] **Step 3: Replace the submitted state render**

Replace the `if (state === 'submitted')` block (lines 50-64) with the adaptive confirmation:

```tsx
  if (state === 'submitted') {
    const stage = getConfirmationStage();
    const isNearExtraction = stage === 3;
    const progress = feedbackAck?.clusterProgress;
    const progressPct = progress ? (progress.current / progress.needed) * 100 : 0;

    return (
      <div className={`task-completion-card task-completion-card--${success ? 'success' : 'failed'} task-completion-card--submitted`}>
        <div className="task-completion-card__header">
          <span className={`task-completion-card__dot task-completion-card__dot--${success ? 'success' : 'failed'}`} />
          <span className="task-completion-card__title">Task {success ? 'completed' : 'failed'}</span>
          <span className="task-completion-card__meta">{stepCount} steps · {formatDuration(durationMs)}</span>
        </div>
        <div className="task-completion-card__confirmation">
          <div className="task-completion-card__confirmation-check">
            <span className="task-completion-card__check-icon">✓</span>
            <span className={`task-completion-card__check-text ${stage > 1 ? 'task-completion-card__check-text--pool' : ''}`}>
              {stage > 1 && submittedRating === 'positive' ? 'Added to learning pool' : 'Feedback recorded'}
            </span>
          </div>
          {stage === 1 && submittedRating === 'positive' && (
            <div className="task-completion-card__confirmation-subtext">
              This helps your agent improve
            </div>
          )}
          {stage >= 2 && progress && (
            <div className="task-completion-card__progress-row">
              <span className="task-completion-card__cluster-name">{feedbackAck?.clusterName}</span>
              <span className="task-completion-card__progress-dot">·</span>
              <div className="task-completion-card__progress-bar-wrap">
                <div className="task-completion-card__progress-bar-bg">
                  <div
                    className={`task-completion-card__progress-bar-fill ${isNearExtraction ? 'task-completion-card__progress-bar-fill--near' : ''}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className={`task-completion-card__progress-label ${isNearExtraction ? 'task-completion-card__progress-label--near' : ''}`}>
                  {progress.current} / {progress.needed} runs
                </span>
              </div>
            </div>
          )}
          {stage === 3 && (
            <div className="task-completion-card__near-extraction">
              One more successful run will teach a reusable workflow
            </div>
          )}
        </div>
      </div>
    );
  }
```

- [ ] **Step 4: Add confirmation CSS styles**

Append to `browser-agent-chat/client/src/components/TaskCompletionCard.css`:

```css
/* Adaptive confirmation states */
.task-completion-card__confirmation {
  padding-top: 10px;
  border-top: 1px solid var(--border-secondary);
}

.task-completion-card__confirmation-check {
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-completion-card__check-icon {
  color: #4ade80;
  font-size: 13px;
}

.task-completion-card__check-text {
  font-size: 12px;
  color: #4ade80;
}

.task-completion-card__check-text--pool {
  color: #4ade80;
}

.task-completion-card__confirmation-subtext {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 2px;
  margin-left: 19px;
}

.task-completion-card__progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  margin-left: 19px;
}

.task-completion-card__cluster-name {
  font-size: 11px;
  color: var(--text-muted);
}

.task-completion-card__progress-dot {
  font-size: 11px;
  color: var(--text-dim);
}

.task-completion-card__progress-bar-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-completion-card__progress-bar-bg {
  width: 48px;
  height: 4px;
  background: var(--border-secondary);
  border-radius: 2px;
  overflow: hidden;
}

.task-completion-card__progress-bar-fill {
  height: 100%;
  background: var(--brand);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.task-completion-card__progress-bar-fill--near {
  background: var(--accent);
}

.task-completion-card__progress-label {
  font-size: 10px;
  color: var(--text-dim);
}

.task-completion-card__progress-label--near {
  color: var(--accent);
}

.task-completion-card__near-extraction {
  font-size: 11px;
  color: var(--accent);
  margin-top: 4px;
  margin-left: 19px;
}
```

- [ ] **Step 5: Verify client compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p client/tsconfig.json 2>&1 | head -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/client/src/components/TaskCompletionCard.tsx browser-agent-chat/client/src/components/TaskCompletionCard.css
git commit -m "feat(ui): add 3-stage adaptive feedback confirmation to TaskCompletionCard"
```

---

### Task 9: Wire Everything Together in ChatPanel

**Files:**
- Modify: `browser-agent-chat/client/src/components/ChatPanel.tsx`

Note: `ChatPanel` already uses `useWS()` directly (line 7-8, 29). We read `feedbackAck` from the hook instead of prop-drilling, consistent with how `pendingCredentialRequest` is already accessed.

- [ ] **Step 1: Import PatternLearnedCard and read feedbackAck from context**

In `browser-agent-chat/client/src/components/ChatPanel.tsx`, add import:

```typescript
import PatternLearnedCard from './PatternLearnedCard';
```

Inside the component, read feedbackAck from the existing `useWS()` call:

```typescript
  const { pendingCredentialRequest, sendCredentialProvided, feedbackAck } = useWS();
```

No changes to `ChatPanelProps` — feedbackAck comes from context, not props.

- [ ] **Step 2: Render PatternLearnedCard inline in message loop**

Update the messages map (line 118-126) to render PatternLearnedCard when a message has `patternData`:

```tsx
        {messages.map(msg => (
          <div key={msg.id} className={`chat-message chat-message-${msg.type}`}>
            {msg.type === 'finding' && msg.finding ? (
              <FindingAlert finding={msg.finding} />
            ) : msg.patternData ? (
              <PatternLearnedCard
                name={msg.patternData.name}
                steps={msg.patternData.steps}
                successRate={msg.patternData.successRate}
                runs={msg.patternData.runs}
                transition={msg.patternData.transition}
                isCelebration={msg.patternData.isCelebration}
              />
            ) : (
              <p>{msg.content}</p>
            )}
          </div>
        ))}
```

This renders pattern cards in chronological order within the message flow, not as a separate block.

- [ ] **Step 3: Pass `feedbackAck` to TaskCompletionCard**

Update the `TaskCompletionCard` render (line 128-134) to pass feedbackAck:

```tsx
        {lastCompletedTask && (
          <TaskCompletionCard
            taskId={lastCompletedTask.taskId}
            success={lastCompletedTask.success}
            stepCount={lastCompletedTask.stepCount}
            durationMs={lastCompletedTask.durationMs}
            onFeedback={onFeedback}
            feedbackAck={feedbackAck}
          />
        )}
```

- [ ] **Step 4: Clean up dead CSS**

In `browser-agent-chat/client/src/components/TaskCompletionCard.css`, remove the now-unused class (lines 134-137):

```css
/* DELETE this — replaced by the adaptive confirmation styles */
.task-completion-card__feedback-done {
  color: #4ade80;
  font-size: 11px;
}
```

- [ ] **Step 5: Verify full client compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p client/tsconfig.json 2>&1 | head -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/client/src/components/ChatPanel.tsx browser-agent-chat/client/src/components/TaskCompletionCard.css
git commit -m "feat(ui): wire PatternLearnedCard and feedbackAck into chat flow"
```

---

### Task 10: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Full server TypeScript check**

Run: `cd browser-agent-chat && npx tsc --noEmit -p server/tsconfig.json`
Expected: PASS with no errors

- [ ] **Step 2: Full client TypeScript check**

Run: `cd browser-agent-chat && npx tsc --noEmit -p client/tsconfig.json`
Expected: PASS with no errors

- [ ] **Step 3: Dev server smoke test**

Run: `cd browser-agent-chat && npm run build`
Expected: Both server and client build successfully

- [ ] **Step 4: Verify no regressions in existing functionality**

Check key data flows:
1. `taskFeedback` handler in `index.ts` now `await`s `processFeedback` (was fire-and-forget) — intentional, needed to query cluster state for feedbackAck
2. `sendFeedback` in `WebSocketContext` no longer clears `lastCompletedTask` — intentional, card must stay visible until feedbackAck arrives; cleared on next `taskStarted` instead
3. `patternLearned` broadcast removed from `pipeline.ts` — intentional, candidate creation is now silent; broadcasts moved to lifecycle.ts for activation/dominance
4. `recordPatternSuccess` in `lifecycle.ts` accepts optional `broadcast` param — backward-compatible, callers without broadcast still work

- [ ] **Step 5: Commit any final fixes**

If any compilation or build issues were found, fix and commit (only add specific changed files):

```bash
git add <specific-files-that-were-fixed>
git commit -m "fix: resolve Phase 1B compilation issues"
```
