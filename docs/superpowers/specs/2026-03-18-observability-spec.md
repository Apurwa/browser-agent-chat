# Observability Specification (Living Document)

**Date:** 2026-03-18
**Status:** Active — updated as new signals are added
**Last Updated:** 2026-03-18

## Purpose

This document captures every observability signal in the QA Agent platform — what's collected, where it's stored, and how to use it for debugging and agent improvement. It serves as the single source of truth for anyone debugging a failed task, analyzing agent performance, or building new observability features.

---

## Architecture

```
Browser Agent → Server → Three observability layers:

1. Langfuse (structured traces)     → debugging individual tasks
2. Redis (live session state)        → monitoring active sessions
3. Console logs (structured prefix)  → server-side debugging

Client receives real-time signals via WebSocket.
Historical data queryable via REST API + Langfuse UI.
```

---

## 1. Langfuse Traces (Primary Debugging Tool)

**UI:** http://localhost:3100 (`admin@local.dev` / `admin123`)
**API:** http://localhost:3001/api/agents/:id/traces

### Trace Hierarchy

Every task produces a trace tree:

```
TRACE user-task
│ input: { task, strategy }
│ output: { success, stepsCompleted, strategy, durationMs }
│ tags: [agent:{agentId}]
│
├── SPAN intent-{id}                    (multi_step only)
│   │ input: { description, successCriteria }
│   │ output: { passed, confidence, stepsInIntent } OR { passed: false, reason }
│   │
│   ├── SPAN perception-{N}
│   │   input: { url, activeIntent }
│   │   output: { elementCount, pageTitle, categories }
│   │
│   ├── GENERATION policy-{N}
│   │   input: { activeIntent }
│   │   output: { action }
│   │   metadata: { prompt, heuristicOverride, progressDelta }
│   │
│   └── SPAN execute-{N}
│       input: { actionType, elementId, instruction }
│       output: { success, error?, urlChanged }
│       level: ERROR (on failure)
│
├── SPAN agent-act                      (single_shot only)
│   input: { prompt }
│   output: { success, steps } OR { success: false, error, steps }
│
├── EVENT thought                       (throughout)
│   input: { content }
│
└── EVENT action                        (throughout)
    input: { action, target }
    output: { step, completed }
```

### What Each Level Tells You

| Level | Question It Answers |
|-------|-------------------|
| **TRACE** | Did the task succeed? How long? Which strategy? |
| **SPAN intent** | Which intent failed? Where did the agent get stuck? |
| **SPAN perception** | What did the agent see on the page? |
| **GENERATION policy** | What did the LLM decide to do and why? |
| **SPAN execute** | Did the action work? What error? |
| **EVENT thought** | What was the agent reasoning? |
| **EVENT action** | What browser action was performed? |

### How to Debug a Failed Task

1. **Find the trace** in Langfuse → filter by `agent:{agentId}` tag
2. **Check trace output** → `success: false` + `error` message
3. **Find the failed intent** → look for `intent-*` span with `passed: false`
4. **Check the execution spans** → find `execute-*` with `level: ERROR`
5. **Read the policy decision** → `policy-*` generation shows what the LLM chose
6. **Check perception** → `perception-*` shows what UI elements were visible

### Trace Creation Points

| Path | Trace Name | Created In |
|------|-----------|------------|
| Single-shot task | `user-task` | `agent-dispatch.ts:dispatchTask` |
| Multi-step task | `user-task` | `agent-dispatch.ts:dispatchTask` |
| Explore | `explore` | `agent-dispatch.ts:dispatchExplore` |
| Old explore path | `explore` | `agent.ts:executeExplore` |

---

## 2. Execution Router Signals

Every task is classified and logged:

```
[DISPATCH] Task completed: strategy=single_shot success=true steps=1 duration=18835ms
```

| Field | Meaning |
|-------|---------|
| `strategy` | `single_shot` (fast, 1 LLM call) or `multi_step` (planner loop) |
| `success` | Task outcome |
| `steps` | Number of agent steps taken |
| `duration` | Wall-clock time in milliseconds |

### Strategy Selection Rules

| Goal Pattern | Strategy | Reason |
|-------------|----------|--------|
| Questions ("what", "how many", "describe") | `single_shot` | Extraction, no navigation needed |
| Actions ("click", "navigate", "create", "login") | `multi_step` | Requires browser interaction |
| Explore (any) | `multi_step` | Always needs navigation |
| Default | `single_shot` | Prefer fast path |

---

## 3. Session State (Redis)

**Live monitoring:** `redis-cli hgetall session:{agentId}`

### Fields

| Field | Type | Debug Use |
|-------|------|-----------|
| `status` | idle/working/disconnected/crashed/interrupted/allocating | Current session state |
| `owner` | string | Which server owns this session |
| `browserPid` | number | Browser process to inspect/kill |
| `cdpPort` | number | CDP endpoint for manual inspection |
| `currentUrl` | string | Where the browser is right now |
| `taskCount` | number | How many tasks executed (limit: 20) |
| `navigationCount` | number | How many pages visited (limit: 50) |
| `healthStatus` | healthy/degraded/unhealthy | Browser health |
| `lastTask` | string | What was the last task sent |
| `detachedAt` | number | When client disconnected (0 = connected) |
| `createdAt` | number | Session start time |
| `lastActivityAt` | number | Last action timestamp |

### Distributed Locks

| Key | Purpose | TTL |
|-----|---------|-----|
| `lock:session:{agentId}` | Session creation lock | 20s |
| `session:lock:exec:{agentId}` | Task execution mutex | 20s (renewed every 7s) |
| `session:replenish` | Warm pool replenish mutex | 10s |

### Useful Redis Commands

```bash
# Check all active sessions
redis-cli zrange session:expiry 0 -1

# Check session state
redis-cli hgetall session:{agentId}

# Check port allocation
redis-cli keys browser:port:*

# Check warm pool
redis-cli scard browser:warm:pids

# Check execution lock
redis-cli get session:lock:exec:{agentId}
```

---

## 4. WebSocket Messages (Real-Time Client Signals)

### Task Lifecycle

```
status:working → thought → action → thought → action → taskComplete → status:idle
```

### Session Lifecycle

```
session_new → (tasks) → session_expiring → session_expired
                                         → session_terminated
                                         → session_evicted
```

### Key Messages for Debugging

| Message | When | What to Check |
|---------|------|--------------|
| `thought` | Agent reasoning | Is the agent making correct decisions? |
| `action` | Browser action | Is the action targeting the right element? |
| `taskComplete` | Task done | `success`, `stepCount`, `durationMs` |
| `error` | Something failed | Error message explains the failure |
| `credential_needed` | Login detected | Does the vault have credentials for this domain? |
| `session_expired` | TTL reached | Session ran for 30 minutes |
| `metrics` | Agent startup | Which step was slow? (CDP, screencast, navigation) |

---

## 5. Console Log Prefixes (Server-Side)

Filter server logs by prefix to isolate subsystems:

| Prefix | Subsystem | When to Check |
|--------|-----------|--------------|
| `[DISPATCH]` | Execution router | Task timing, strategy selection |
| `[PLANNER]` | Intent planning | What intents were created |
| `[POLICY]` | Action decisions | What the LLM chose, heuristic overrides |
| `[AGENT-LOOP]` | Execution loop | Action failures, navigation errors |
| `[START]` | Session creation | Lock contention, reattach logic |
| `[REAP]` | Session cleanup | Was cleanup complete? |
| `[HEALTH]` | Browser liveness | Unhealthy browser detected |
| `[LOGIN-DEBUG]` | Credential injection | Domain, strategy, selectors, vault lookup |
| `[LOGIN-INTERCEPT]` | Login detection | Score, timing, mid-task detection |
| `[LOGIN-STRATEGY]` | Form filling | Selector failures, fallback attempts |
| `[NAV-DETECT]` | URL changes | SPA navigation detection |
| `[EXPLORE]` | Exploration | Nav items found, sections explored |
| `[METRICS]` | Startup timing | Breakdown of agent creation steps |
| `[RECOVERY]` | Session recovery | After server restart |
| `[DEDUP]` | Suggestion dedup | Duplicate feature/flow filtering |
| `[MUSCLE-MEMORY]` | Pattern learning | Login patterns recorded/replayed |
| `[JOBS]` | Background jobs | Cluster merging, pattern consolidation |
| `[STARTUP]` / `[SHUTDOWN]` | Server lifecycle | Init order, graceful shutdown |

### Debugging Recipes

**"Task is stuck":**
```bash
grep "\[POLICY\]\|\\[AGENT-LOOP\]" /tmp/server.log | tail -20
```

**"Login failed":**
```bash
grep "\[LOGIN" /tmp/server.log | tail -20
```

**"Session won't start":**
```bash
grep "\[START\]" /tmp/server.log | tail -10
```

**"Browser crashed":**
```bash
grep "\[HEALTH\]\|\[REAP\]" /tmp/server.log | tail -10
```

---

## 6. Startup Metrics

Every agent session creation is timed:

```json
{
  "total": 5010,
  "steps": [
    {"name": "load_memory", "duration": 328},
    {"name": "load_patterns", "duration": 59},
    {"name": "acquire_browser", "duration": 0},
    {"name": "start_browser_agent", "duration": 2073},
    {"name": "initial_screenshot", "duration": 2550}
  ]
}
```

**Normal ranges:**
- `load_memory`: 100-500ms
- `start_browser_agent`: 1-3s (includes magnitude-core CDP connection)
- `initial_screenshot`: 500-3000ms (depends on page complexity)
- **Total under 5s** is healthy

---

## 7. REST API Observability Endpoints

| Endpoint | Data |
|----------|------|
| `GET /health` | Server status, component health, active session count |
| `GET /api/agents/:id/traces` | Langfuse trace list for agent |
| `GET /api/agents/:id/traces/:traceId` | Trace detail with all observations |
| `GET /api/observability/summary` | Total traces, cost, error rate, latency (p50/p95) |
| `GET /api/observability/trends` | Cost and trace trends over time, per agent |
| `GET /api/observability/agents` | Per-agent metrics table |
| `GET /api/agents/:id/feedback/stats` | Feedback statistics |
| `GET /openapi.json` | Full API spec |
| `/api-docs` | Interactive Scalar API documentation |

---

## 8. How to Use Observability for Agent Improvement

### Identifying Poor Agent Decisions

1. **Query Langfuse for failed traces:** filter by `output.success = false`
2. **Check the policy generation:** what did the LLM decide? Was the input (perception) correct?
3. **Look at stuck patterns:** `evaluateProgress` logs repeated actions, same-page counts
4. **Compare single_shot vs multi_step:** check `[DISPATCH]` logs for strategy + duration

### Identifying Slow Tasks

1. **Filter Langfuse traces** by latency > 60s
2. **Check strategy:** was it `multi_step` when `single_shot` would suffice?
3. **Check step count:** many steps = planner over-planned or agent got stuck
4. **Check startup metrics:** slow `start_browser_agent` = CDP connection issue

### Improving Login Success Rate

1. **Filter `[LOGIN-DEBUG]` logs** for `getCredentialForAgent result: null` = missing vault binding
2. **Filter `[LOGIN-STRATEGY]`** for selector failures = DOM structure changed
3. **Check muscle memory patterns:** are login patterns being recorded and replayed?

### Monitoring Session Health

1. **Redis `healthStatus` field:** `unhealthy` = browser needs restart
2. **`taskCount` approaching 20:** session nearing limit, will auto-terminate
3. **`detachedAt` > 0:** client disconnected, detach timer running

---

## 9. Gaps (What's Not Yet Observed)

| Gap | Impact | Priority |
|-----|--------|----------|
| No per-LLM-call token usage tracking | Can't optimize cost per task | Medium |
| No screenshot capture in traces | Can't see what the agent saw | Medium |
| No browser memory/CPU metrics | Can't detect resource leaks | Low |
| No client-side performance metrics | Don't know UI render times | Low |
| No A/B testing of strategies | Can't compare router effectiveness | Future |
| No automated anomaly detection | Must manually check for regressions | Future |

---

## 10. Signal Inventory Summary

| Signal Type | Count | Storage | Retention |
|-------------|-------|---------|-----------|
| Langfuse traces | 5 root types | Langfuse DB (Postgres) | Configurable |
| Langfuse spans | 10+ per task | Langfuse DB | Configurable |
| Langfuse events | 2 types | Langfuse DB | Configurable |
| Redis session fields | 14 fields | Redis | Session TTL (35 min) |
| Console log prefixes | 25+ prefixes | stdout/file | Server restart |
| WebSocket messages | 28 types | Transient (Redis for persistence) | Session TTL |
| Database tables | 13 tables | Supabase (Postgres) | Permanent |
| Startup metrics | 6-8 timing events | Broadcast to client | Transient |
