# LLM Observability Spec

**Status:** FINAL
**Date:** 2026-03-18
**Goal:** Full LLM input/output visibility in Langfuse — prompts, responses, perception, failures, timing.

---

## 1. Current State

| Source | What's logged | LLM I/O visible? |
|--------|--------------|-------------------|
| `agent.ts` (legacy) | High-level traces: task name, thoughts, actions | No |
| `agent-loop.ts` (new) | Nothing — console.log only | No |
| Magnitude `agent.act/extract()` | Internal to Magnitude | No |
| Planner/Policy | `console.log` server logs only | No |

**Gap:** Zero LLM prompts/responses visible in Langfuse. Cannot debug "what did the model see?" or "why did it choose this action?"

---

## 2. Architecture Decision

**Use direct Langfuse client** (`langfuse.ts`), not Mastra's observability layer.

Rationale: Full control over trace structure. Complex agent system needs custom span types (perception, state). Mastra abstraction would limit flexibility.

**Instrument at the loop level** (Option B) — `agent-loop.ts` owns the trace lifecycle. Modules (planner, policy, executor) stay pure.

---

## 3. Trace Structure

```
Task Trace (top level)
│   input: { goal, taskType, agentId }
│   output: { success, stepsCompleted, pagesVisited }
│   tags: [agent:<id>]
│
├── Planner Generation
│   ├── input: full prompt text
│   ├── output: StrategyPlan JSON
│   ├── metadata: { maxIntents, worldContextLength }
│   └── status: success | error
│
├── Step 1
│   ├── Perception Span
│   │   ├── input: { url, pageTitle }
│   │   ├── output: { elementCount, categories: { nav, actions, other } }
│   │   ├── metadata: { screenshotRef?, extractionTimeMs }
│   │   └── status: success | error
│   │
│   ├── Policy Generation
│   │   ├── input: full prompt text (with perception + progress context)
│   │   ├── output: AgentAction JSON
│   │   ├── metadata: { progressDelta, pageExhausted, heuristicOverride }
│   │   └── status: success | error | fallback
│   │
│   ├── Executor Span
│   │   ├── input: { actionType, elementId, instruction }
│   │   ├── output: ExecutionResult
│   │   ├── metadata: { containsLlm: true, urlBefore, urlAfter }
│   │   ├── failure: { errorType?, errorMessage? }
│   │   └── status: success | error
│   │
│   └── Verification Span
│       ├── input: { action, result, urlBefore, urlAfter }
│       ├── output: { passed, confidence, findings }
│       └── status: success | failure
│
├── Step 2 ... N
│
├── Replan Generation (if triggered)
│   ├── input: full prompt + reason for replan
│   ├── output: new StrategyPlan
│   └── metadata: { replanAttempt, stuckReason }
│
├── Intent Verification Generation (at intent boundary)
│   ├── input: { intent, currentUrl, pageTitle }
│   ├── output: { passed, confidence }
│   └── metadata: { intentId, intentDescription }
│
└── Goal Confirmation Span
    ├── input: { goal, intents, taskType, pagesVisited }
    ├── output: GoalConfirmation
    └── status: success | failure
```

---

## 4. Failure Taxonomy

Every span/generation includes a structured `failure` field when status is `error`:

```typescript
interface TraceFailure {
  errorType:
    | 'element_not_found'        // UI element from policy doesn't exist
    | 'element_not_interactable' // element exists but can't be clicked/typed
    | 'navigation_timeout'       // page didn't load in time
    | 'llm_parse_error'          // LLM response didn't match schema
    | 'llm_hallucination'        // LLM referenced non-existent element
    | 'page_context_lost'        // Playwright page became stale
    | 'login_required'           // hit auth wall
    | 'extraction_empty'         // extract returned no data
    | 'budget_exhausted'         // step/time/replan limit hit
    | 'stuck_loop'               // stuck detection triggered
    | 'unknown';                 // uncategorized
  errorMessage: string;
}
```

This enables: failure aggregation, reliability metrics per error type, auto-prioritization of fixes.

---

## 5. Perception Span (Critical Addition)

Logged on every step, BEFORE the policy decision:

```typescript
const perceptionSpan = trace.span({
  name: 'perception',
  input: { url: urlBefore, pageTitle },
});

const perception = await perceive(page, activeIntent, '');

perceptionSpan.end({
  output: {
    elementCount: perception.uiElements.length,
    categories: {
      navigation: progressContext.unexplored.navigation.length,
      actions: progressContext.unexplored.actions.length,
      other: progressContext.unexplored.other.length,
    },
    extractedPages: [...extractedPages],
    pageAlreadyExtracted: progressContext.pageAlreadyExtracted,
  },
  metadata: {
    extractionTimeMs: Date.now() - perceptionStart,
  },
});
```

**What to log:** element count, categories, extracted pages, timing.
**What NOT to log:** full DOM (too large), raw screenshot (store as blob reference if needed).

---

## 6. Prompt Size Management

| Component | Strategy | Max size |
|-----------|----------|----------|
| Planner prompt | Full text | ~500 tokens |
| Policy prompt | Full text (includes UI elements) | ~1000 tokens |
| DOM/elements | Structured JSON (id, role, label only) | ~200 tokens |
| Screenshot | Reference only (not stored in trace) | 0 tokens |
| Perception | Summary counts, not raw data | ~50 tokens |
| World context | Truncate to 500 chars | ~100 tokens |

Policy prompt is the largest — UI elements list can grow. Cap at 30 elements in the prompt, log full list in perception span.

---

## 7. Implementation Plan

### Phase 1 (Ship Now)

**Files:**
- Modify: `server/src/agent-loop.ts` — add trace lifecycle, wrap each step
- Modify: `server/src/agent-types.ts` — add TraceFailure type
- Create: `server/src/trace-helpers.ts` — helper functions for creating generations/spans with consistent structure

**Steps:**
1. Create top-level trace at loop start
2. Wrap `planStrategy` in a generation (input: prompt, output: plan)
3. Add perception span before each policy call
4. Wrap `decideNextAction` in a generation (input: prompt, output: action)
5. Wrap `executeAction` in a span (input: action, output: result, failure taxonomy)
6. Wrap `verifyAction` in a span
7. Wrap replan calls in generations
8. Wrap `confirmGoalCompletion` in a span
9. Flush trace at loop end

**Key constraint:** Planner and policy prompts are constructed INSIDE those modules. To log them in agent-loop.ts, either:
- (a) Have modules return the prompt alongside the result
- (b) Reconstruct the prompt in agent-loop.ts (duplication)
- (c) Pass a trace callback into the module

**Recommendation:** (a) — have planner and policy return `{ result, prompt }` so the loop can log both. Minimal change, no duplication.

### Phase 2 (Next Sprint)

- State snapshots per step (URL + page type + auth + goal progress)
- Shadow prompt layer for Magnitude executor calls
- Failure aggregation queries in Langfuse

### Phase 3 (When Eval Harness Matures)

- Full replay system with stored perception snapshots
- Deterministic reproduction from trace data

---

## 8. Resolved Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Langfuse vs Mastra observability | **Direct Langfuse** | Full control for complex agent |
| Where to instrument | **agent-loop.ts (Option B)** | Modules stay pure |
| Perception tracing | **Phase 1** | #1 debugging question for browser agents |
| Failure taxonomy | **Phase 1** | Unlocks metrics, not just logs |
| State snapshots | **Phase 2** | Useful but adds storage overhead |
| Magnitude shadow prompts | **Phase 2** | Speculative — own perception gives 80% value |
| Replay system | **Phase 3** | Big scope, needs snapshot infrastructure |
| Prompt logging | **Structured, size-managed** | Full DOM is a trap |
| Executor as generation vs span | **Span with `containsLlm: true` tag** | Can't observe Magnitude's internal LLM |
