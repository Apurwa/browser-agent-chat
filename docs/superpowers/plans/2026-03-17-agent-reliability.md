# Agent Reliability — Critical Fixes Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Fix the three critical issues preventing production readiness: page-closed race condition, planner over-generation, task never completing.

**Evidence:** 5 E2E runs — 0% task completion, 60% page-closed errors, 9-15 intents per explore (budget allows ~5).

**Priority order:** Fix 1 (page ownership) → Fix 2 (planner budget) → Fix 3 (task completion)

**Principle:** You don't fix race conditions by coordination — you fix them by eliminating competing actors.

---

## Fix 1: Single Page Owner (CRITICAL)

### Root Cause

Two independent control loops read/write the same Playwright page:
- **Loop A (new):** Policy loop → `perceive()` → `page.evaluate()`, `executeAction()` → `agent.act()`
- **Loop B (legacy):** Event handlers in `createAgent()` → `actionDone` fires → `getLivePageUrl()` → `page.evaluate()`, `recordNavigation()`, `detectLoginPage()`

Magnitude temporarily invalidates the execution context during its internal action cycle (screenshot → mutate → re-render → emit actionDone). The legacy handler fires during this transition → crash.

This is a **temporal consistency violation** — not just concurrency.

### Solution: Mutually Exclusive Execution Modes

**Do not conditionally disable handlers. Eliminate them from the execution path entirely.**

```
if (USE_NEW_AGENT) {
  createNewAgent()    // NO legacy handlers registered
} else {
  createLegacyAgent() // current behavior
}
```

Two completely separate agent creation functions. No shared handler registration. No guards. No possibility of someone adding a handler later and forgetting the check.

### Architecture: Single Owner Model

```
Browser Page
   ↑
   │
   └── Agent Loop (ONLY authority)
         ├── perceive()
         ├── decide()
         ├── act()
         └── broadcast events → WebSocket / Analytics / UI
```

Everything else consumes from agent loop events. Nothing else touches `page.*` APIs.

### Tasks

#### Task 1: Audit all page.evaluate callers

**Files:** All server/src/*.ts

Before changing anything, answer: "Who in the entire codebase calls `page.evaluate`, `page.fill`, `page.click`, `page.goto`, `page.title`, `page.url`, `page.locator`, `page.waitFor*`?"

Result must be a complete list. After the fix, the answer must be: **ONLY agent-loop.ts (via perceive, executor, getPageUrl)** when USE_NEW_AGENT=true.

Also audit:
- Does CDP screencast call `page.evaluate()` internally? (Answer: No — it uses CDP protocol directly, not Playwright page API. Safe.)
- Does Magnitude's internal event system register additional listeners? (Check `agent.events` and `agent.browserAgentEvents` registrations in createAgent)

#### Task 2: Create `createNewAgent()` — clean agent without legacy handlers

**Files:**
- Modify: `server/src/agent.ts`

Create a new function `createNewAgent()` that:
- Starts Magnitude agent (same as current `createAgent`)
- Sets up CDP session for screencast (same — this is read-only, safe)
- Sets viewport (same)
- Navigates to URL if needed (same)
- **Does NOT register** `agent.events.on('thought', ...)` handler
- **Does NOT register** `agent.events.on('actionDone', ...)` handler
- **Does NOT register** `agent.browserAgentEvents.on('nav', ...)` handler
- Returns `AgentSession` with all the same fields

The new agent loop handles thoughts (via broadcast), navigation recording (via URL comparison), and login (via pre-task check). None of the old handlers are needed.

Note: The `thought` handler currently parses FINDING_JSON and MEMORY_JSON from agent thoughts. The new loop doesn't need this — it uses structured extraction, not thought parsing. If thought parsing is needed later, it should be wired into the agent loop, not as an event handler competing for the page.

#### Task 3: Wire `createNewAgent()` into session creation

**Files:**
- Modify: `server/src/sessionManager.ts`
- Modify: `server/src/index.ts`

In `sessionManager.createSession()`:
```typescript
const agentSession = USE_NEW_AGENT
  ? await createNewAgent(broadcastFn, browser.cdpEndpoint, dbSessionId, agentId, url, userId)
  : await createAgent(broadcastFn, browser.cdpEndpoint, dbSessionId, agentId, url, userId);
```

Same for `recoverSession()`.

In `index.ts` restart handler: same branching.

#### Task 4: Remove all conditional guards from old handlers

**Files:**
- Modify: `server/src/agent.ts`

Remove the `process.env.USE_NEW_AGENT !== 'true'` guards from the `actionDone` and `nav` handlers. They're now only registered by `createAgent()` (legacy path), never by `createNewAgent()`. No guards needed — the handlers simply don't exist in the new path.

#### Task 5: Add page access logging

**Files:**
- Modify: `server/src/perception.ts`
- Modify: `server/src/executor.ts`
- Modify: `server/src/agent-loop.ts`

Add `console.log('[PAGE_ACCESS]', { source: 'perceive' | 'executor' | 'agent_loop' })` to every `page.evaluate`, `page.title`, `page.url` call.

After deployment, verify with: `grep PAGE_ACCESS server.log | awk '{print $3}' | sort -u`

Expected result: ONLY `perceive`, `executor`, `agent_loop`. Never `actionDone`, `nav_handler`, `login_detector`.

---

## Fix 2: Planner Respects Budget (HIGH)

### Root Cause

Planner prompt doesn't know the step budget. Generates 9-15 intents for 20-step budget.

### Solution

Add `maxIntents` parameter to `planStrategy`:
- Compute: `maxIntents = Math.min(7, Math.floor(maxSteps / 3))`
- Add to prompt: `"Generate at most {{maxIntents}} intents. Focus on the most important areas."`
- Truncate array if LLM ignores constraint: `plan.intents = plan.intents.slice(0, maxIntents)`

### Tasks

#### Task 6: Add maxIntents to planner

**Files:**
- Modify: `server/src/planner.ts`
- Modify: `server/src/agent-loop.ts`
- Test: `server/__tests__/planner.test.ts`

---

## Fix 3: Task Completion (HIGH)

### Root Cause (three sub-issues)

**3a.** `verifyIntent` keyword matching too strict — "explore Tools section" doesn't match page title "Tools"
**3b.** `confirmGoalCompletion` requires ALL intents — partial explore = failure
**3c.** Stuck signals don't reset on intent advancement — new intent starts already "stuck"

### Solution

**3a.** Lower keyword match threshold to ≥40%. Check URL path segments as separate tokens.
**3b.** For explore: `success = completedIntents >= 1 AND pagesVisited >= 2`. For task: all intents required.
**3c.** Reset `stuckSignals` to zero when advancing to next intent.

### Tasks

#### Task 7: Improve intent verification

**Files:**
- Modify: `server/src/verify-intent.ts`
- Test: `server/__tests__/verify-intent.test.ts`

#### Task 8: Partial completion for explore

**Files:**
- Modify: `server/src/planner-confirm.ts`
- Modify: `server/src/agent-loop.ts`
- Test: `server/__tests__/planner-confirm.test.ts`

#### Task 9: Reset stuck signals on intent advancement

**Files:**
- Modify: `server/src/agent-loop.ts`

---

## Verification

#### Task 10: Run 5 E2E tests with assertions

**Assertions:**
- `pageClosedErrors === 0` across all 5 runs
- `pagesVisited >= 3` in at least 4/5 runs
- `taskResult === true` in at least 3/5 runs
- `actionTypes.size >= 2` in at least 4/5 runs
- `intents.length <= 7` in all runs
- `grep PAGE_ACCESS` shows only agent_loop/perceive/executor sources

---

## Success Criteria

| Metric | Before | After |
|--------|--------|-------|
| Page-closed errors | 60% of runs | **0%** |
| Page API callers (new mode) | 5+ (actionDone, nav, login, perceive, executor) | **3** (perceive, executor, agent_loop) |
| Intents per run | 9-15 | **3-7** |
| Task completion | 0% | **>60%** |
| Retries needed | N/A | **Zero** |
| Delays needed | N/A | **Zero** |
