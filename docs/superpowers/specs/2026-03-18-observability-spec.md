# Observability Specification (Living Document)

**Date:** 2026-03-18
**Status:** Active — updated as new signals are added
**Last Updated:** 2026-03-18

---

## Vision

As a user, I should be able to:
1. **See what the agent did** at every level — session, task, step, LLM call
2. **Understand why** the agent made each decision
3. **Debug failures** by inspecting the exact LLM request/response that caused them
4. **Improve the agent** by identifying patterns in failures across tasks

---

## Observability Hierarchy

```
SESSION (browser lifecycle)
│
├── TASK 1: "What is the page title?"
│   ├── Strategy: single_shot
│   ├── LLM CALL: agent.act(prompt)
│   │   ├── Request: { model, system, messages, tools }
│   │   ├── Response: { completion, tokens, finish_reason }
│   │   └── Duration: 8.2s, Cost: $0.003
│   ├── Actions: [extract]
│   └── Result: success, 1 step, 11s
│
├── TASK 2: "Navigate to settings and update profile"
│   ├── Strategy: multi_step
│   ├── PLANNER
│   │   ├── LLM CALL: plan intents
│   │   │   ├── Request: { goal, worldContext, currentUrl }
│   │   │   ├── Response: { intents: [...] }
│   │   │   └── Duration: 3.1s
│   │   └── Result: 3 intents planned
│   │
│   ├── INTENT 1: "Navigate to settings page"
│   │   ├── PERCEPTION: { url, elements: 42, title: "Dashboard" }
│   │   ├── POLICY
│   │   │   ├── LLM CALL: decide action
│   │   │   │   ├── Request: { perception, history, progressContext }
│   │   │   │   ├── Response: { type: "click", elementId: "el_7" }
│   │   │   │   └── Duration: 2.4s
│   │   │   └── Decision: click "Settings" nav item
│   │   ├── EXECUTE: click el_7 → success, URL changed
│   │   ├── VERIFY: intent passed (URL contains /settings)
│   │   └── Result: completed, confidence: 0.8
│   │
│   ├── INTENT 2: "Update profile information"
│   │   ├── PERCEPTION → POLICY → EXECUTE → VERIFY (loop)
│   │   └── Result: completed
│   │
│   └── Result: success, 8 steps, 45s, $0.024
│
├── TASK 3: ...
│
└── SESSION END: TTL expired, 3 tasks, 12 navigations
```

---

## Level 1: Session

**What to track:**

| Signal | Description | Current Status |
|--------|-------------|---------------|
| Session ID | Unique identifier | ✅ Redis + Supabase |
| Agent ID | Which agent | ✅ Redis |
| Owner (server) | Which server instance | ✅ Redis |
| Start time | Session creation | ✅ Redis `createdAt` |
| End time | Session destruction | ❌ Not tracked |
| End reason | TTL / health / max_tasks / idle / user / evicted | ❌ Not tracked |
| Total tasks | Count of tasks executed | ✅ Redis `taskCount` |
| Total navigations | Page changes | ✅ Redis `navigationCount` |
| Total LLM calls | Across all tasks | ❌ Not tracked |
| Total tokens | Input + output across all calls | ❌ Not tracked |
| Total cost | Dollar cost of all LLM calls | ❌ Not tracked |
| Total duration | Wall clock session time | ❌ Derivable from createdAt but not stored |
| Browser PID | Process identifier | ✅ Redis `browserPid` |
| Health transitions | healthy → degraded → unhealthy | ❌ Only latest state stored |
| Login events | How many times login was detected/handled | ❌ Not tracked |
| Errors | Count and types of errors | ❌ Not aggregated |

**Langfuse representation:** No session-level trace exists today. Sessions should map to Langfuse's `sessionId` field so all tasks within a session are grouped.

---

## Level 2: Task

**What to track:**

| Signal | Description | Current Status |
|--------|-------------|---------------|
| Task ID | Unique identifier | ✅ Supabase `tasks` table |
| Task content | User's input | ✅ Langfuse trace input |
| Strategy | single_shot / multi_step | ✅ Langfuse trace metadata |
| Start time | Task dispatch | ✅ Langfuse trace timestamp |
| End time | Task completion | ✅ Derivable from duration |
| Duration | Wall clock | ✅ Langfuse trace + `[DISPATCH]` log |
| Success | Pass/fail | ✅ Langfuse trace output |
| Error message | If failed | ✅ Langfuse trace output |
| Step count | Agent actions taken | ✅ Langfuse trace output |
| Intent count | Planner intents (multi_step) | ✅ Langfuse planner span |
| Intents completed | How many passed | ❌ Not aggregated at task level |
| Intents failed | How many didn't pass | ❌ Not aggregated at task level |
| Replan count | How many times replanned | ❌ Not tracked in trace |
| Total LLM calls | All calls within this task | ❌ Not counted |
| Total tokens | Input + output | ❌ Not tracked |
| Total cost | Dollar cost | ❌ Not tracked |
| Pages visited | URLs navigated during task | ❌ Not in trace output |
| Findings discovered | Bugs found during task | ❌ Not linked to trace |
| Login occurred | Was login needed mid-task | ❌ Not in trace |
| Pre-task checks | Health check result, sanity check result | ❌ Not in trace |

---

## Level 3: Step (Within a Task)

**What to track per step (perception → policy → execute cycle):**

| Signal | Description | Current Status |
|--------|-------------|---------------|
| Step number | Sequential within task | ✅ Langfuse span names |
| **Perception** | | |
| → URL | Current page | ✅ Langfuse perception span |
| → Page title | Document title | ✅ Langfuse perception span |
| → UI elements | Count and categories | ✅ Langfuse perception span |
| → DOM snapshot | Lightweight page structure | ❌ Not captured |
| **Policy Decision** | | |
| → Active intent | What the agent is trying to do | ✅ Langfuse policy generation |
| → Full prompt | System + user messages sent to LLM | ⚠️ In metadata, not structured |
| → LLM response | Raw response body | ⚠️ Parsed action only, not raw |
| → Decision | Action type + target | ✅ Langfuse policy generation output |
| → Heuristic override | Was policy overridden by stuck detector | ✅ Metadata flag |
| → Progress context | pageAlreadyExtracted, progressDelta, etc. | ⚠️ Partial |
| **Execution** | | |
| → Action type | click / type / extract / navigate / etc. | ✅ Langfuse execute span |
| → Element ID | Target element | ✅ Langfuse execute span |
| → Success | Did the action work | ✅ Langfuse execute span |
| → Error | Why it failed | ✅ Langfuse execute span (ERROR level) |
| → URL before/after | Navigation detection | ❌ Not in span |
| → Screenshot before/after | Visual state | ❌ Not captured |
| **Verification** | | |
| → Passed | Did the action produce expected outcome | ✅ Langfuse verify span |
| → Confidence | How sure | ✅ Langfuse verify span |
| → Stuck signals | repeatedAction, samePage, failedExecution counts | ❌ Not in trace |

---

## Level 4: LLM Call (The Missing Layer)

**This is the primary gap.** Every LLM call should capture:

| Signal | Description | Current Status |
|--------|-------------|---------------|
| **Request** | | |
| → Model | claude-sonnet-4-20250514 etc. | ❌ Not tracked |
| → System prompt | Full system message | ❌ Not tracked |
| → Messages | Full conversation array | ❌ Not tracked |
| → Tools/schemas | Zod schemas passed to extract | ❌ Not tracked |
| → Temperature | Sampling parameter | ❌ Not tracked |
| → Max tokens | Output limit | ❌ Not tracked |
| **Response** | | |
| → Completion | Full response text/object | ⚠️ Parsed output only |
| → Tokens (input) | Prompt token count | ❌ Not tracked |
| → Tokens (output) | Completion token count | ❌ Not tracked |
| → Finish reason | stop / max_tokens / tool_use | ❌ Not tracked |
| → Latency | Time from request to first token | ❌ Not tracked |
| → Cache hit | Was prompt cache used | ❌ Not tracked |
| **Metadata** | | |
| → Caller | Which module initiated the call | ⚠️ Implicit from span name |
| → Purpose | planner / policy / executor / extract | ⚠️ Implicit from span name |
| → Retry count | Was this a retry | ❌ Not tracked |
| → Cost | Computed from model + tokens | ❌ Not tracked |

### LLM Call Sources

| Source | Module | Method | Controllable |
|--------|--------|--------|-------------|
| Planner | `planner.ts` | `agent.extract(prompt, schema)` | ✅ Our code |
| Policy | `policy.ts` | `agent.extract(prompt, schema)` | ✅ Our code |
| Executor (extract) | `executor.ts` | `agent.extract(prompt, schema)` | ✅ Our code |
| Executor (act) | `executor.ts` | `agent.act(instruction)` | ❌ magnitude-core internal |
| Single-shot task | `agent.ts` | `session.agent.act(prompt)` | ❌ magnitude-core internal |
| Single-shot explore | `agent.ts` | `session.agent.extract(prompt, schema)` | ❌ magnitude-core internal |
| Login detection | `login-detector.ts` | `page.evaluate()` | N/A (no LLM) |

**Controllable (our code):** 3 sources — can wrap with Langfuse generation spans immediately
**Uncontrollable (magnitude-core):** 3 sources — need HTTP-level interception or magnitude hooks

---

## Level 5: Agent Orchestration Graph

**What the user should see for any task:**

```
Task received
  ↓
[Strategy Selection] → single_shot / multi_step
  ↓
[Health Check] → pass / fail
  ↓
[Sanity Check] → pass / fail / soft_reset
  ↓
[Exec Lock] → acquired / busy
  ↓
[Login Check] → not_needed / detected → vault_lookup → inject → verify
  ↓
[Planner] → N intents (multi_step only)
  ↓
[Intent Loop]
  ├── [Perceive] → UI elements, URL, title
  ├── [Decide] → action (LLM or heuristic)
  ├── [Execute] → success / failure
  ├── [Verify Action] → passed / failed
  ├── [Evaluate Progress] → continue / retry / replan / escalate
  └── [Verify Intent] → completed / not_yet
  ↓
[Goal Confirmation] → achieved / incomplete
  ↓
[Exec Lock Release]
  ↓
Task complete
```

**Current tracking:** Partial. Individual steps are traced but the orchestration flow (which component called which, in what order, with what decision) is not captured as a connected graph.

**Target:** Every box in the diagram above should be a Langfuse span or event with input/output, and the parent-child relationships should form the exact graph.

---

## Implementation Priorities

### Phase 1: LLM Call Tracking (Our Code)

Wrap planner, policy, and executor `agent.extract()` calls with Langfuse generations that capture:
- Full prompt text
- Full response object
- Token counts (from magnitude-core's response if available)
- Duration
- Model name

**Effort:** 1-2 days
**Impact:** Covers 3/6 LLM call sources. Enables prompt debugging for planning and policy decisions.

### Phase 2: Session-Level Aggregation

Create a Langfuse session trace when the browser session starts. All task traces link to it via `sessionId`. Session trace updated on end with:
- Total tasks, navigations, LLM calls, tokens, cost
- End reason
- Health transitions

**Effort:** 1 day
**Impact:** Groups all tasks under one session. Enables session-level cost analysis.

### Phase 3: Magnitude-Core Interception

Options (pick one):
- **(a) HTTP proxy:** Intercept all outbound Anthropic API calls at the HTTP client level. Captures every LLM call regardless of source.
- **(b) Magnitude event hooks:** If magnitude-core emits LLM call events, subscribe and log them.
- **(c) Anthropic SDK instrumentation:** Langfuse has auto-instrumentation for the Anthropic SDK. If magnitude-core uses the standard SDK, this may work.

**Effort:** 2-3 days (depends on approach)
**Impact:** Covers remaining 3/6 LLM call sources. Full visibility into agent.act() internals.

### Phase 4: Orchestration Graph

Add spans for pre-task checks (health, sanity, login, exec lock) so the full orchestration flow is visible in Langfuse as a connected trace tree.

**Effort:** 1 day
**Impact:** Complete debugging visibility. Any failure traceable to exact orchestration step.

---

## Strict Schemas (Prevent Drift)

All observability payloads must conform to typed schemas. No free-form objects.

### Core Schema Definitions

```ts
// Every LLM call, regardless of source
interface LLMCall {
  callId: string;
  caller: 'planner' | 'policy' | 'executor' | 'magnitude_act' | 'magnitude_extract';
  model: string;
  request: {
    systemPrompt: string;
    messages: Array<{ role: string; content: string }>;
    tools?: unknown[];
    temperature?: number;
    maxTokens?: number;
  };
  response: {
    completion: string | Record<string, unknown>;
    finishReason: 'stop' | 'max_tokens' | 'tool_use' | 'error';
    tokensInput: number;
    tokensOutput: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  durationMs: number;
  costUsd: number;
  error?: string;
}

// Every action result, regardless of action type
interface ActionResult {
  actionType: 'click' | 'type' | 'extract' | 'navigate' | 'scroll' | 'submit' | 'select';
  elementId?: string;
  elementLabel?: string;
  success: boolean;
  error?: string;
  urlBefore: string;
  urlAfter: string;
  urlChanged: boolean;
  data?: unknown;           // for extract actions
  durationMs: number;
}

// Per-step state snapshot
interface StepSnapshot {
  stepNumber: number;
  url: string;
  pageTitle: string;
  domSnapshotHash: string;  // SHA-256 of serialized DOM structure (lightweight)
  screenshotRef?: string;   // S3/Redis key to screenshot (not inline)
  elementCount: number;
  visibleText?: string;     // first 500 chars of visible text (for search)
}

// Task-level cost aggregation
interface TaskCostSummary {
  llmCalls: number;
  tokensInput: number;
  tokensOutput: number;
  totalCostUsd: number;
  costByModule: {
    planner: number;
    policy: number;
    executor: number;
    magnitude: number;
  };
}

// Failure classification
type FailureCategory =
  | 'llm_error'          // LLM returned error or unexpected format
  | 'llm_timeout'        // LLM call timed out
  | 'element_not_found'  // Target element missing from DOM
  | 'navigation_failed'  // Page didn't load or wrong URL
  | 'auth_required'      // Login page detected, credentials missing
  | 'auth_failed'        // Credentials injected but login failed
  | 'browser_crashed'    // CDP connection lost
  | 'browser_hung'       // page.evaluate timed out
  | 'budget_exhausted'   // Max steps or time reached
  | 'stuck_loop'         // Agent repeated same action N times
  | 'schema_mismatch'    // LLM output didn't match Zod schema
  | 'unknown';           // Uncategorized

interface FailureRecord {
  category: FailureCategory;
  message: string;
  step?: number;
  intentId?: string;
  actionType?: string;
  recoverable: boolean;    // Did the system recover, or did the task fail?
}
```

### Schema Enforcement Rule

Every new span, event, or generation MUST use these schemas for input/output. No `Record<string, unknown>` in production traces. Violations caught by TypeScript at compile time.

---

## Sampling & Verbosity Controls

At scale, capturing everything is expensive. Control verbosity per level:

### Configuration

```ts
interface ObservabilityConfig {
  // Per-level verbosity
  session: { enabled: true };
  task: { enabled: true };
  step: {
    enabled: true;
    capturePerception: boolean;     // DOM snapshot hash + element list
    captureScreenshot: boolean;     // Store screenshot ref per step
    captureFullPrompt: boolean;     // Full LLM prompt text (large)
  };
  llmCall: {
    enabled: true;
    captureRequestBody: boolean;    // Full request (can be 10KB+)
    captureResponseBody: boolean;   // Full response
    sampleRate: number;             // 0.0-1.0, for high-volume calls
  };

  // Global controls
  maxEventsPerTask: number;         // Cap to prevent explosion (default: 200)
  maxSpansPerTask: number;          // Cap spans (default: 50)
}
```

### Environment Variables

```
OBSERVABILITY_LEVEL=full|standard|minimal
OBSERVABILITY_SAMPLE_RATE=1.0          # 1.0 = capture all, 0.1 = 10%
OBSERVABILITY_CAPTURE_PROMPTS=true     # Full LLM prompts
OBSERVABILITY_CAPTURE_SCREENSHOTS=false # Screenshot refs per step
OBSERVABILITY_MAX_EVENTS_PER_TASK=200
```

### Defaults by Environment

| Environment | Level | Sample Rate | Prompts | Screenshots |
|------------|-------|-------------|---------|-------------|
| Development | `full` | 1.0 | yes | no |
| Staging | `standard` | 1.0 | yes | no |
| Production | `standard` | 0.5 | no | no |
| Debug (ad-hoc) | `full` | 1.0 | yes | yes |

---

## Perception Artifacts

For root-cause debugging, we need to know exactly what the agent saw.

### DOM Snapshot Hash

Every perception step captures a lightweight fingerprint of the page:

```ts
// Capture: hash of visible DOM structure (not full HTML)
const domSnapshot = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const tags: string[] = [];
  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    if (el.offsetParent !== null) { // visible only
      tags.push(`${el.tagName}#${el.id || ''}.${el.className || ''}`);
    }
  }
  return tags.join('|');
});
const domHash = crypto.createHash('sha256').update(domSnapshot).digest('hex').slice(0, 12);
```

**Storage:** Hash stored in span metadata (12 chars). Full snapshot stored only when `OBSERVABILITY_CAPTURE_SCREENSHOTS=true`.

### Screenshot References

Screenshots are NOT stored inline in traces (too large). Instead:

```ts
// Store screenshot in Redis with a reference key
const screenshotKey = `debug:screenshot:${traceId}:step-${stepNum}`;
await redis.set(screenshotKey, base64Data, 'EX', 3600); // 1 hour TTL

// Store only the reference in the Langfuse span
span.metadata({ screenshotRef: screenshotKey });
```

Debugging workflow: find the span → read `screenshotRef` → fetch from Redis.

---

## Span Lifecycle Reliability

### Problem

If a span is opened but the code throws before `span.end()`, the span stays open forever in Langfuse — corrupting trace timing and nesting.

### Rule: Always Close in Finally

```ts
const span = trace?.span({ name: 'execute', input });
try {
  const result = await doWork();
  span?.end({ output: { success: true, ...result } });
} catch (err) {
  span?.end({ output: { success: false, error: err.message }, level: 'ERROR' });
  throw err;
} finally {
  // Watchdog: if span wasn't ended (neither try nor catch ran end)
  // This handles edge cases like process.exit, unhandled rejections
  if (span && !span._ended) {
    span.end({ output: { success: false, error: 'span_abandoned' }, level: 'WARNING' });
  }
}
```

### Watchdog Timer

For long-running spans (intent spans, task spans), set a max duration watchdog:

```ts
const SPAN_MAX_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const watchdog = setTimeout(() => {
  if (span && !span._ended) {
    span.end({ output: { error: 'watchdog_timeout' }, level: 'WARNING' });
  }
}, SPAN_MAX_DURATION_MS);

// Clear watchdog on normal completion
clearTimeout(watchdog);
```

---

## Failure Taxonomy

Every failure must be classified using `FailureCategory`. This enables:
- Aggregation: "30% of failures are `element_not_found`"
- Alerting: spike in `browser_crashed` → infrastructure issue
- Improvement: most `llm_error` failures → prompt needs tuning

### Classification Function

```ts
function classifyFailure(error: string, context: { actionType?: string; urlChanged?: boolean }): FailureCategory {
  if (error.includes('timeout') || error.includes('Timeout')) return 'llm_timeout';
  if (error.includes('API error') || error.includes('500')) return 'llm_error';
  if (error.includes('element') || error.includes('selector')) return 'element_not_found';
  if (error.includes('navigation') || error.includes('goto')) return 'navigation_failed';
  if (error.includes('login') || error.includes('auth')) return 'auth_required';
  if (error.includes('credential')) return 'auth_failed';
  if (error.includes('CDP') || error.includes('closed')) return 'browser_crashed';
  if (error.includes('hung') || error.includes('evaluate')) return 'browser_hung';
  if (error.includes('budget') || error.includes('exhausted')) return 'budget_exhausted';
  if (error.includes('stuck') || error.includes('repeated')) return 'stuck_loop';
  if (error.includes('parse') || error.includes('schema') || error.includes('Zod')) return 'schema_mismatch';
  return 'unknown';
}
```

### Failure Logging

Every `FailureRecord` is:
1. Attached to the relevant Langfuse span as metadata
2. Aggregated at task level in trace output
3. Queryable via `/api/observability/failures?category=llm_error&from=...&to=...`

---

## Cost & Token Aggregation

### Per-Task Aggregation

Every task trace must include a `TaskCostSummary` in its output:

```ts
trace.update({
  output: {
    success,
    stepsCompleted,
    strategy,
    durationMs,
    cost: {
      llmCalls: 4,
      tokensInput: 12500,
      tokensOutput: 890,
      totalCostUsd: 0.042,
      costByModule: {
        planner: 0.008,
        policy: 0.024,
        executor: 0.010,
        magnitude: 0.000,  // unknown until Phase 3
      },
    },
  },
});
```

### Per-Session Aggregation

Session-level totals accumulated from task summaries:

```ts
// Redis fields (updated after each task)
session:{agentId}.totalLlmCalls
session:{agentId}.totalTokensInput
session:{agentId}.totalTokensOutput
session:{agentId}.totalCostUsd
```

### Cost Model

```ts
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
};
```

---

## Dashboards & Queries (Design Upfront)

Observability is only as good as what you can aggregate. These are the queries and dashboards we must support:

### Dashboard 1: Agent Health Overview

| Metric | Query |
|--------|-------|
| Active sessions | `redis: ZCARD session:expiry` |
| Tasks today | Langfuse: `count(traces) WHERE timestamp > today` |
| Success rate | Langfuse: `count(success=true) / count(*)` |
| Avg latency | Langfuse: `avg(latency)` |
| Error rate by category | Langfuse: `group by failure_category` |
| Total cost today | Langfuse: `sum(output.cost.totalCostUsd)` |

### Dashboard 2: Task Drilldown

| Metric | Query |
|--------|-------|
| Strategy distribution | Langfuse: `group by metadata.strategy` |
| Avg steps per task | Langfuse: `avg(output.stepsCompleted)` |
| Replan rate | Langfuse: `count(output.replanCount > 0) / count(*)` |
| Top failure categories | Langfuse: `group by output.failures[].category` |
| Slowest tasks | Langfuse: `order by latency desc limit 10` |
| Most expensive tasks | Langfuse: `order by output.cost.totalCostUsd desc limit 10` |

### Dashboard 3: LLM Performance

| Metric | Query |
|--------|-------|
| Calls per task (avg) | Langfuse: `avg(output.cost.llmCalls)` |
| Tokens per task (avg) | Langfuse: `avg(output.cost.tokensInput + tokensOutput)` |
| Cost per module | Langfuse: `sum by costByModule.*` |
| Cache hit rate | Langfuse: `sum(cacheRead) / sum(tokensInput)` |
| Schema mismatch rate | Langfuse: `count(failure=schema_mismatch) / count(llm_calls)` |
| Avg latency by caller | Langfuse: `avg(duration) group by caller` |

### Dashboard 4: Session Lifecycle

| Metric | Query |
|--------|-------|
| Avg session duration | Redis/DB: `avg(endTime - createdAt)` |
| Avg tasks per session | Redis: `avg(taskCount)` |
| End reason distribution | DB: `group by endReason` |
| Health degradation events | Redis: `count(healthStatus transitions)` |
| Detach → reconnect rate | Redis: `count(detachedAt > 0 AND later reattach)` |

### Query API

New endpoint for dashboard queries:

```
GET /api/observability/query
  ?metric=success_rate|avg_latency|cost_by_module|failure_categories
  &from=2026-03-01
  &to=2026-03-18
  &agentId=...  (optional filter)
  &groupBy=day|week|strategy|agent
```

---

## Debugging Workflows

### "Why did this task fail?"

```
1. Open Langfuse → find trace by task content or time
2. Check trace output → success: false, error message
3. Drill into intent spans → which intent failed
4. Check execute spans → which action errored
5. Check policy generation → what prompt was sent, what LLM returned
6. [Phase 1+] Check full LLM request/response → was the prompt wrong or the model confused?
```

### "Why is this task slow?"

```
1. Check [DISPATCH] log → strategy + duration
2. If multi_step: check intent count → too many intents?
3. Check step count → agent stuck in retry loop?
4. [Phase 1+] Check per-LLM-call latency → which call is slow?
5. Check startup metrics → browser launch slow?
```

### "Why does the agent keep making wrong decisions?"

```
1. Query Langfuse for policy generations with heuristicOverride=true
2. Compare perception input → is the agent seeing the right elements?
3. Compare policy prompt → is the context sufficient?
4. [Phase 1+] Check full prompt → is the system prompt causing bias?
5. Check progress signals → is evaluateProgress triggering correctly?
```

### "How much does each agent cost?"

```
[Phase 2+]
1. GET /api/observability/agents → per-agent cost
2. Drill into session → per-session cost
3. Drill into task → per-task cost
4. Drill into LLM calls → which calls are expensive
```

---

## Current Signal Inventory

| Signal Type | Count | Storage | Retention |
|-------------|-------|---------|-----------|
| Langfuse traces | 5 root types | Langfuse DB | Configurable |
| Langfuse spans | 10+ per task | Langfuse DB | Configurable |
| Langfuse events | 2 types (thought, action) | Langfuse DB | Configurable |
| Langfuse generations | 2 per step (policy, planner) | Langfuse DB | Configurable |
| Redis session fields | 14 fields | Redis | Session TTL (35 min) |
| Console log prefixes | 25+ prefixes | stdout | Server restart |
| WebSocket messages | 28 types | Transient | Session TTL |
| Database tables | 13 tables | Supabase | Permanent |
| Startup metrics | 6-8 timing events | Client broadcast | Transient |

---

## Redis Quick Reference

```bash
# All active sessions
redis-cli zrange session:expiry 0 -1

# Session state
redis-cli hgetall session:{agentId}

# Port allocation
redis-cli keys browser:port:*

# Warm pool size
redis-cli scard browser:warm:pids

# Execution lock holder
redis-cli get session:lock:exec:{agentId}

# Session creation lock
redis-cli get lock:session:{agentId}
```

---

## Console Log Quick Reference

```bash
# Task execution
grep "\[DISPATCH\]" server.log

# Agent decisions
grep "\[POLICY\]\|\[PLANNER\]" server.log

# Login flow
grep "\[LOGIN" server.log

# Session lifecycle
grep "\[START\]\|\[REAP\]\|\[HEALTH\]" server.log

# Browser issues
grep "\[HEALTH\]\|\[NAV-DETECT\]" server.log

# Server lifecycle
grep "\[STARTUP\]\|\[SHUTDOWN\]" server.log
```
