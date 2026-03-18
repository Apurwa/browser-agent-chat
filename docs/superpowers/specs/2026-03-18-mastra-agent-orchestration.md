# Mastra Agent Orchestration — Design Spec

## Overview

Move the entire agent execution pipeline — both single-shot and multi-step modes — into Mastra workflows. The current custom `agent-loop.ts` while-loop becomes a Mastra `.dountil()` cycle with typed steps. Live Playwright/Magnitude objects are accessed via a session registry. Credential requests use Mastra's `workflow.suspend()` / `workflow.resume()` for human-in-the-loop without blocking server resources.

## Problem

The agent loop is hand-rolled in `agent-loop.ts` — a 578-line while-loop that directly calls perceive, decide, execute, verify, and evaluate functions. This works but:

1. **No step-level observability** — Langfuse traces are manual, inconsistent across the loop
2. **No suspension** — credential_needed holds a Promise open, blocking server memory
3. **No retry policies** — execution failures are caught/logged but not retried at the framework level
4. **No evals integration** — task completion scoring is disconnected from the execution pipeline
5. **Two orchestration paths** — Mastra exists in the codebase but isn't used; the real loop runs alongside it

## Design Principles

1. **Every step is a Mastra step** — typed input/output schemas, automatic telemetry
2. **The loop is a `.dountil()`** — not a hand-rolled while-loop
3. **Live objects stay outside Mastra** — session registry holds Playwright/Magnitude; steps look them up by ID
4. **Suspend, don't block** — credential_needed uses workflow suspension
5. **Same behavior, new structure** — no changes to what the agent does, only how it's orchestrated

## Architecture

```
WebSocket handler (index.ts)
        ↓
  dispatchTask() / dispatchExplore()
        ↓
  mastra.getWorkflow('agent-task').start(input)
        ↓
  ┌─── Mastra Workflow ────────────────────────────────┐
  │                                                      │
  │  initializeStep                                      │
  │    ↓                                                 │
  │  planStrategyStep                                    │
  │    ↓                                                 │
  │  .dountil(agentCycleStep, taskComplete || budgetOut) │
  │    │                                                 │
  │    │  agentCycleStep (one iteration):                │
  │    │    perceive → decide → execute → verify         │
  │    │    → evaluate progress → update memory          │
  │    │    → [suspend if credential_needed]              │
  │    │                                                 │
  │  confirmGoalStep                                     │
  │    ↓                                                 │
  │  cleanupStep                                         │
  │                                                      │
  └──────────────────────────────────────────────────────┘
```

### Single-Shot Mode

Single-shot tasks also run through Mastra, as a simplified workflow:

```
initializeStep → executeSingleShotStep → cleanupStep
```

No loop, no planning. The `executeSingleShotStep` calls `agent.act(prompt)` directly. This gives single-shot tasks the same observability and suspension support as multi-step.

## Session Registry

Live objects (Playwright page, Magnitude agent, CDP session, BudgetTracker, broadcast callback) cannot be serialized into Mastra step schemas. They live in a registry outside the workflow.

```ts
// server/src/session-registry.ts

interface SessionContext {
  session: AgentSession       // Playwright page, Magnitude agent, CDP, etc.
  budget: BudgetTracker       // Mutable budget state (time + step tracking)
  broadcast: BroadcastFn      // WebSocket broadcast callback
}

const sessions = new Map<string, SessionContext>();

export function registerSession(sessionId: string, ctx: SessionContext): void {
  sessions.set(sessionId, ctx);
}

export function getSessionContext(sessionId: string): SessionContext {
  const ctx = sessions.get(sessionId);
  if (!ctx) throw new Error(`Session ${sessionId} not found in registry`);
  return ctx;
}

export function removeSession(sessionId: string): void {
  sessions.delete(sessionId);
}
```

Every Mastra step receives `sessionId` in its input schema and calls `getSessionContext(sessionId)` to access live objects. The registry is a plain Map — same process, same memory space, no serialization.

**BudgetTracker lives here, not in Mastra schemas.** The `BudgetTracker` is a closure-based mutable object (tracks time elapsed, steps used, replans). Steps call `ctx.budget.recordStep()` and `ctx.budget.exhausted()` directly. Only a serializable snapshot (`{ stepsUsed, stepsRemaining, exhausted, warning }`) flows through step output schemas for the `.dountil()` condition to evaluate.

**Lifecycle:** The registry integrates with the existing `sessionManager.ts`. When `sessionManager.createSession()` succeeds, it also calls `registerSession()`. When `sessionManager.reap()` cleans up, it calls `removeSession()`. No parallel lifecycle — the registry is a lookup layer on top of session manager.

**Testing:** Steps can be tested by registering mock sessions (with mock page, mock agent, mock budget) before running the workflow.

## Workflow Definition

### Schema Chain

Each step's output extends the previous step's output. Fields accumulate through the chain:

```ts
// Level 0: Workflow input
const WorkflowInputSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  goal: z.string(),
  taskType: z.enum(['task', 'explore']),
  mode: z.enum(['single_shot', 'multi_step']),
});

// Level 1: After initializeStep
const InitializedContextSchema = WorkflowInputSchema.extend({
  currentUrl: z.string(),
  worldContext: z.string(),
});

// Level 2: After planStrategyStep
const PlannedContextSchema = InitializedContextSchema.extend({
  intents: z.array(IntentSchema),
  taskMemory: TaskMemorySchema,       // serializable subset (no stuckSignals — those live in registry)
  budgetSnapshot: BudgetSnapshotSchema, // { stepsUsed, stepsRemaining, exhausted, warning }
  taskComplete: z.boolean(),
  escalated: z.boolean(),
});

// Level 3: agentCycleStep input AND output (same schema — loop feeds back)
const CycleSchema = PlannedContextSchema;

// Level 4: After confirmGoalStep
const TaskResultSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  goal: z.string(),
  taskType: z.enum(['task', 'explore']),
  success: z.boolean(),
  stepsCompleted: z.number(),
});
```

**Key:** `sessionId`, `agentId`, `goal`, and `taskType` flow through every level so `confirmGoalStep` and `cleanupStep` can access them without needing `getInitData()`.

### Workflow Assembly

```ts
// Multi-step workflow
const multiStepWorkflow = createWorkflow({
  id: 'agent-task-multistep',
  inputSchema: WorkflowInputSchema,
  outputSchema: TaskResultSchema,
  steps: [initializeStep, planStrategyStep, agentCycleStep, confirmGoalStep, cleanupStep],
})
  .then(initializeStep)
  .then(planStrategyStep)
  .dountil(
    agentCycleStep,
    async ({ inputData, iterationCount }) => {
      // NOTE: The exact shape of `inputData` in the condition function needs
      // verification via integration test (Phase 1, Task 0). Mastra's LoopConditionFunction
      // receives ConditionFunctionParams which may expose step output or accumulated state.
      // The condition also checks the registry's BudgetTracker for time-based exhaustion.
      const ctx = getSessionContext(inputData.sessionId);
      return inputData.taskComplete
        || inputData.escalated
        || ctx.budget.exhausted()
        || iterationCount >= 50; // hard safety cap
    },
  )
  .then(confirmGoalStep)
  .then(cleanupStep)
  .commit();

// Single-shot workflow
const singleShotWorkflow = createWorkflow({
  id: 'agent-task-singleshot',
  inputSchema: WorkflowInputSchema,
  outputSchema: TaskResultSchema,
  steps: [initializeStep, executeSingleShotStep, cleanupStep],
})
  .then(initializeStep)
  .then(executeSingleShotStep)
  .then(cleanupStep)
  .commit();
```

## Step Definitions

### initializeStep

Loads world context, waits for background login to complete, broadcasts `working` status, sets starting URL.

```ts
createStep({
  id: 'initialize',
  inputSchema: WorkflowInputSchema,
  outputSchema: InitializedContextSchema,
  execute: async ({ inputData }) => {
    const ctx = getSessionContext(inputData.sessionId);
    // Wait for background login to finish (existing pattern)
    await ctx.session.loginDone;
    // Broadcast working status
    ctx.broadcast({ type: 'status', status: 'working' });
    const url = await ctx.session.agent.page.evaluate(() => location.href);
    const worldContext = await loadWorldContext(inputData.agentId);
    return {
      ...inputData,
      currentUrl: url,
      worldContext,
    };
  },
});
```

**Note:** The dispatch-level Langfuse trace creation moves here — `initializeStep` creates the trace, `cleanupStep` closes it. The current double `taskComplete` broadcast (once in agent-loop, once in dispatch) is fixed by having ONLY `cleanupStep` broadcast it.

### planStrategyStep

Calls the existing `planStrategy()` function. Produces intent list.

```ts
createStep({
  id: 'plan-strategy',
  inputSchema: InitializedContextSchema,
  outputSchema: PlannedContextSchema,
  execute: async ({ inputData }) => {
    const session = getSession(inputData.sessionId);
    const { plan } = await planStrategy(
      session.agent, inputData.goal, inputData.worldContext, inputData.currentUrl,
    );
    const maxSteps = inputData.taskType === 'explore' ? 50 : 20;
    return {
      ...inputData,
      intents: plan.intents,
      taskMemory: createTaskMemory(inputData.goal, plan.intents),
      budget: { maxSteps, currentStep: 0 },
      taskComplete: false,
      budgetExhausted: false,
      escalated: false,
    };
  },
});
```

### agentCycleStep (the loop body)

One iteration of: perceive → decide → execute → verify → evaluate. This is where the current while-loop body moves. Each sub-operation is a function call within the step, not a separate Mastra step — keeping the inner cycle fast (no per-sub-step Mastra overhead) while the outer `.dountil()` gives framework-level control.

```ts
createStep({
  id: 'agent-cycle',
  inputSchema: CycleSchema,
  outputSchema: CycleSchema,
  execute: async ({ inputData, suspend }) => {
    const ctx = getSessionContext(inputData.sessionId);
    const { session } = ctx;
    const { agent } = session;
    const page = agent.page;

    // 0. Check for login page (proactive credential detection)
    if (await detectLoginPage(page)) {
      await suspend({ reason: 'credential_needed', domain: inputData.currentUrl });
      // After resume: credential has been injected by the WebSocket handler
    }

    // 1. Perceive
    const perception = await perceive(page, inputData.intents);

    // 2. Heuristic override: force click unexplored nav after 3 stuck iterations
    // (preserves existing behavior from agent-loop.ts lines 237-280)
    const heuristicAction = checkHeuristicOverride(inputData.taskMemory, perception);

    // 3. Decide
    const { action } = heuristicAction
      ?? await decideNextAction(agent, perception, inputData.taskMemory.actionsAttempted.slice(-5));

    // 4. Execute
    const result = await executeAction(agent, page, action, perception.uiElements);

    // 5. Verify
    const urlAfter = await page.evaluate(() => location.href);
    const verification = verifyAction(action, result, inputData.currentUrl, urlAfter);

    // 6. Update task memory (pure function — returns new object, no mutation)
    const updatedMemory = updateTaskMemory(inputData.taskMemory, action, verification, urlAfter);

    // 7. Record step in budget (mutable — lives in registry)
    ctx.budget.recordStep();

    // 8. Evaluate progress
    const { decision } = evaluateProgress(updatedMemory, ctx.budget, verification);

    // 9. Handle ALL five decisions
    let intents = inputData.intents;
    let taskComplete = false;
    let escalated = false;

    switch (decision) {
      case 'continue': {
        const intentCheck = verifyIntent(getCurrentIntent(intents), urlAfter, perception.pageTitle);
        if (intentCheck.passed) {
          intents = advanceIntent(intents);
          taskComplete = intents.every(i => i.status === 'completed');
        }
        break;
      }
      case 'retry_action':
        // Loop continues naturally — next iteration re-perceives
        break;
      case 'replan': {
        const { plan } = await planStrategy(agent, inputData.goal, inputData.worldContext, urlAfter);
        intents = plan.intents;
        ctx.budget.recordReplan();
        break;
      }
      case 'done':
        taskComplete = true;
        break;
      case 'escalate_to_user':
        ctx.broadcast({ type: 'error', message: 'Agent is stuck and needs help' });
        escalated = true;
        break;
    }

    // 10. Record navigation
    if (urlAfter !== inputData.currentUrl) {
      ctx.broadcast({ type: 'nav', url: urlAfter });
      await recordNavigation(inputData.agentId, inputData.currentUrl, urlAfter, action.type);
    }

    return {
      ...inputData,
      currentUrl: urlAfter,
      intents,
      taskMemory: updatedMemory,
      budgetSnapshot: ctx.budget.snapshot(),
      taskComplete,
      escalated,
    };
  },
});
```

### executeSingleShotStep

For single-shot mode. Calls `agent.act(prompt)` directly.

```ts
createStep({
  id: 'execute-single-shot',
  inputSchema: InitializedContextSchema,
  outputSchema: TaskResultSchema,
  execute: async ({ inputData, suspend }) => {
    const session = getSession(inputData.sessionId);
    try {
      await session.agent.act(inputData.goal);
    } catch (err) {
      if (isCredentialNeeded(err)) {
        await suspend({ reason: 'credential_needed' });
        await session.agent.act(inputData.goal);
      } else {
        throw err;
      }
    }
    return { success: true, stepsCompleted: 1 };
  },
});
```

### confirmGoalStep

Evaluates whether all intents were completed.

```ts
createStep({
  id: 'confirm-goal',
  inputSchema: CycleOutputSchema,
  outputSchema: TaskResultSchema,
  execute: async ({ inputData }) => {
    const confirmation = confirmGoalCompletion(
      inputData.goal, inputData.intents, inputData.taskType,
    );
    return {
      success: confirmation.achieved,
      stepsCompleted: inputData.budget.currentStep,
    };
  },
});
```

### cleanupStep

Records final metrics, flushes Langfuse, broadcasts task completion.

```ts
createStep({
  id: 'cleanup',
  inputSchema: TaskResultSchema,
  outputSchema: TaskResultSchema,
  execute: async ({ inputData }) => {
    const ctx = getSessionContext(inputData.sessionId);
    // Broadcast taskComplete + idle status (single source — no double broadcast)
    ctx.broadcast({ type: 'taskComplete', success: inputData.success });
    ctx.broadcast({ type: 'status', status: 'idle' });
    return inputData;
  },
});
```

## Credential Suspension Flow

The current credential model is **proactive** — `handleLoginDetection()` runs as a background task that detects login pages via `detectLoginPage()` and triggers credential resolution before the agent loop encounters a login wall. This is NOT error-driven (actions don't throw `CredentialNeeded`).

In the Mastra model, credential detection integrates as follows:

```
initializeStep:
  Start handleLoginDetection() as background task
  Wait for session.loginDone (existing pattern: await session.loginDone)
        ↓
agentCycleStep (during perceive):
  If detectLoginPage(page) returns true AND no credential resolved:
    await suspend({ reason: 'credential_needed', domain: currentUrl })
        ↓
  Mastra persists workflow state
  Server resources freed
        ↓
  ... user selects credential in UI ...
        ↓
  WebSocket handler receives 'credential_provided'
        ↓
  workflow.resume(runId, { credentialId })
        ↓
  agentCycleStep resumes: inject credential via vault, retry perceive
```

**Key difference from the error-catching model:** Suspension happens at the perception stage when a login page is detected, not when `executeAction()` throws. The `isCredentialNeeded()` function is replaced by `detectLoginPage()` which already exists in the codebase.

**The `initializeStep` also handles `await session.loginDone`** — this gates the workflow on the background login completing before the first cycle iteration, preserving the current dispatch-level behavior.

This replaces the current `pendingCredentialRequests` Map + Promise pattern.

## Broadcast Integration

The current loop broadcasts messages (thoughts, actions, screenshots, nav events) via a callback. In Mastra, the broadcast function is accessed through the session registry:

```ts
const session = getSession(inputData.sessionId);
session.broadcast({ type: 'thought', content: '...' });
```

Broadcasting happens inside step execution, not as separate Mastra steps. This keeps the inner cycle fast.

## Observability

Mastra automatically traces every step execution to Langfuse via `@mastra/langfuse`. Each workflow run produces:

```
Trace: agent-task-multistep
  ├─ Span: initialize (50ms)
  ├─ Span: plan-strategy (2.1s, tokens: 1200)
  ├─ Span: agent-cycle #1 (3.4s)
  ├─ Span: agent-cycle #2 (1.8s)
  ├─ Span: agent-cycle #3 (2.2s)
  ├─ ...
  ├─ Span: confirm-goal (0.1s)
  └─ Span: cleanup (0.05s)
```

No manual Langfuse instrumentation needed — Mastra handles it.

## Evals Integration

After each workflow run, Mastra can score the result:

```ts
const mastra = new Mastra({
  workflows: { multiStepWorkflow, singleShotWorkflow },
  evals: {
    taskCompletion: {
      scorer: async (result) => result.success ? 1.0 : 0.0,
    },
    budgetEfficiency: {
      scorer: async (result) => 1 - (result.stepsCompleted / maxSteps),
    },
  },
});
```

This replaces the disconnected eval functions in `server/__tests__/evals.basic.test.ts`.

## Migration Strategy

### Phase 0: Prerequisites — Verify Mastra APIs + Refactor Mutable Code
- **Task 0a:** Write a minimal integration test for Mastra `.dountil()` — verify what `inputData` contains in the condition function (step input vs step output vs accumulated state)
- **Task 0b:** Write a minimal integration test for `suspend()` inside `.dountil()` — verify resume works correctly, then test double-suspend (two suspends in the same loop run)
- **Task 0c:** Pin minimum `@mastra/core` version (must be post-suspend-in-loop bugfix)
- **Task 0d:** Refactor `evaluateProgress()` to return new `StuckSignals` instead of mutating. Create `updateTaskMemory()` pure function.
- **Task 0e:** Extract `advanceIntent()` and `getCurrentIntent()` as exported pure functions from `agent-loop.ts`
- **Task 0f:** Extract `checkHeuristicOverride()` as an exported pure function (preserves the stuck-detection + force-click logic from agent-loop.ts lines 237-280)

### Phase 1: Session Registry + Step Definitions
- Extract `session-registry.ts`
- Define all step schemas (input/output Zod types)
- Create step implementations that call existing functions
- **No behavioral changes** — same perceive/decide/execute/verify functions

### Phase 2: Wire Workflows
- Replace `executeAgentLoop()` call in `agent-dispatch.ts` with `mastra.getWorkflow('agent-task-multistep').start()`
- Replace `executeTask()` call with `mastra.getWorkflow('agent-task-singleshot').start()`
- Remove the while-loop from `agent-loop.ts`
- Keep `agent-loop.ts` as a reference, then delete after verification

### Phase 3: Credential Suspension
- Replace `pendingCredentialRequests` Map with `workflow.suspend()` / `workflow.resume()`
- Update WebSocket handler to call `workflow.resume(runId, payload)` on `credential_provided`
- Remove the Promise-based blocking pattern

### Phase 4: Evals + Observability
- Add eval scorers to Mastra config
- Remove manual Langfuse trace calls from agent-loop.ts (Mastra handles it)
- Verify step-level traces appear in Langfuse

## Files Affected

### New Files
| File | Responsibility |
|------|---------------|
| `server/src/session-registry.ts` | Map of live AgentSession objects, keyed by sessionId |
| `server/src/mastra/workflows/multi-step.ts` | Multi-step workflow definition with `.dountil()` loop |
| `server/src/mastra/workflows/single-shot.ts` | Single-shot workflow definition |
| `server/src/mastra/steps/initialize.ts` | Initialize step |
| `server/src/mastra/steps/plan-strategy.ts` | Planning step |
| `server/src/mastra/steps/agent-cycle.ts` | Loop body: perceive → decide → execute → verify → evaluate |
| `server/src/mastra/steps/execute-single-shot.ts` | Direct agent.act() step |
| `server/src/mastra/steps/confirm-goal.ts` | Goal confirmation step |
| `server/src/mastra/steps/cleanup.ts` | Metrics + broadcast step |
| `server/src/mastra/schemas.ts` | Shared Zod schemas for step inputs/outputs |

### Modified Files
| File | Changes |
|------|---------|
| `server/src/mastra/index.ts` | Register new workflows, add eval scorers |
| `server/src/agent-dispatch.ts` | Replace `executeAgentLoop()` / `executeTask()` with Mastra workflow starts |
| `server/src/index.ts` | WebSocket handler: `credential_provided` calls `workflow.resume()` instead of resolving a Promise |

### Deprecated (Phase 2 removal)
| File | Replaced By |
|------|-------------|
| `server/src/agent-loop.ts` | `mastra/workflows/multi-step.ts` + `mastra/steps/agent-cycle.ts` |
| `server/src/mastra/workflows/agent-task.ts` | `mastra/workflows/multi-step.ts` (old stubs replaced) |
| `server/src/mastra/tools/*` | Steps call functions directly, not via Mastra tools |

### Refactored (Phase 1 prerequisite)
| File | Change |
|------|--------|
| `server/src/evaluate-progress.ts` | Refactor to return new `StuckSignals` object instead of mutating `taskMemory.stuckSignals` in place. Add `updateTaskMemory()` pure function that returns a new `TaskMemory` with updated signals, actions, and visited pages. |
| `server/src/agent-loop.ts` | Extract `advanceToNextIntent()` as an exported pure function `advanceIntent(intents)` that returns a new intents array. Extract `getCurrentIntent(intents)` helper. |

### Unchanged
All other decision modules stay as-is — `planner.ts`, `perception.ts`, `policy.ts`, `executor.ts`, `verify-action.ts`, `verify-intent.ts`, `planner-confirm.ts`. The Mastra steps call these functions. No changes to their interfaces.

## Known Risks

### Suspend inside `.dountil()` loop — recently patched Mastra bug

Mastra had a bug where workflows with loops containing suspended steps would incorrectly reuse resume data across iterations, causing crashes or skipped suspend points. This was patched in a recent release.

**Mitigations:**
1. Pin minimum `@mastra/core` version to the post-fix release (verify exact version in Phase 1)
2. Phase 1 includes a dedicated integration test: suspend inside a `.dountil()` loop, resume, then loop again and suspend a second time — verifying no data reuse or crashes
3. If the bug resurfaces, fallback to Promise-based credential blocking within the step (same behavior as current code, just wrapped in a Mastra step)

### Multi-credential-suspend scenario

A single workflow run could hit `credential_needed` on iteration N, resume, then hit it again on iteration N+5 (different domain). Each suspend/resume cycle must be independent — the second suspend must not carry state from the first resume.

**Test plan:** E2E test with two sequential suspends in the same workflow run.

## Out of Scope

- Mastra Studio deployment (visual debugging — useful but not required for migration)
- Parallel step execution within the agent cycle (perceive and decide are sequential by nature)
- Mastra server adapters (auto-exposing workflows as HTTP endpoints — useful later)
- Mastra memory/RAG (current world-model.ts and memory-engine.ts stay as-is)
- Multi-agent supervisor pattern (single agent per workflow for now)
