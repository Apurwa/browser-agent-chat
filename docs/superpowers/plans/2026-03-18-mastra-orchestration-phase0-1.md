# Mastra Agent Orchestration — Phase 0 + 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the codebase for Mastra orchestration (Phase 0: verify Mastra APIs, refactor mutable code to pure functions) and build the foundation (Phase 1: session registry, step schemas, step implementations).

**Architecture:** Phase 0 verifies Mastra `.dountil()` and `suspend()` behaviors via integration tests, then refactors `evaluateProgress()` to be pure and extracts helper functions from `agent-loop.ts`. Phase 1 creates the session registry, defines Zod schemas for step I/O, and implements all Mastra steps that call the existing decision modules. No production behavior changes — the current agent-loop.ts continues to run in production until Phase 2 wires the workflows.

**Tech Stack:** @mastra/core, TypeScript, Zod, vitest

**Spec:** `docs/superpowers/specs/2026-03-18-mastra-agent-orchestration.md`

---

## File Structure

All paths relative to `browser-agent-chat/server/`.

### New Files

| File | Responsibility |
|------|---------------|
| `__tests__/mastra-dountil.test.ts` | Integration test: verify `.dountil()` condition receives step output |
| `__tests__/mastra-suspend-loop.test.ts` | Integration test: verify `suspend()` inside `.dountil()` + double-suspend |
| `__tests__/evaluate-progress-pure.test.ts` | Unit tests for refactored pure `evaluateProgress` |
| `__tests__/session-registry.test.ts` | Unit tests for session registry |
| `__tests__/mastra-schemas.test.ts` | Schema chain validation tests |
| `src/session-registry.ts` | Map of live SessionContext objects |
| `src/mastra/schemas.ts` | All Zod schemas for workflow step I/O |
| `src/mastra/steps/initialize.ts` | Initialize step |
| `src/mastra/steps/plan-strategy.ts` | Planning step |
| `src/mastra/steps/agent-cycle.ts` | Loop body step |
| `src/mastra/steps/execute-single-shot.ts` | Single-shot step |
| `src/mastra/steps/confirm-goal.ts` | Goal confirmation step |
| `src/mastra/steps/cleanup.ts` | Cleanup + broadcast step |

### Modified Files

| File | Changes |
|------|---------|
| `src/evaluate-progress.ts` | Remove in-place mutation of `taskMemory.stuckSignals`. Return new `TaskMemory` from a new `updateTaskMemory()` function. |
| `src/agent-loop.ts` | Extract `advanceIntent()`, `getCurrentIntent()`, `checkHeuristicOverride()` as exported pure functions. No changes to the loop itself — it still runs in production. |

---

## Chunk 1: Phase 0 — Verify Mastra APIs + Refactor

### Task 1: Verify `.dountil()` condition function behavior

**Files:**
- Create: `__tests__/mastra-dountil.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
// __tests__/mastra-dountil.test.ts
import { describe, it, expect } from 'vitest'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'

const CounterSchema = z.object({
  count: z.number(),
  done: z.boolean(),
})

const incrementStep = createStep({
  id: 'increment',
  inputSchema: CounterSchema,
  outputSchema: CounterSchema,
  execute: async ({ inputData }) => ({
    count: inputData.count + 1,
    done: inputData.count + 1 >= 3,
  }),
})

describe('Mastra .dountil() behavior', () => {
  it('condition function receives step OUTPUT (not input)', async () => {
    const conditionCalls: Array<{ inputData: unknown; iterationCount: number }> = []

    const workflow = createWorkflow({
      id: 'test-dountil',
      inputSchema: CounterSchema,
      outputSchema: CounterSchema,
      steps: [incrementStep],
    })
      .dountil(incrementStep, async (params) => {
        conditionCalls.push({
          inputData: params.inputData,
          iterationCount: params.iterationCount,
        })
        return (params.inputData as { done: boolean }).done
      })
      .commit()

    const run = workflow.createRun()
    const result = await run.start({ inputData: { count: 0, done: false } })

    // Verify the condition was called with step output
    expect(conditionCalls.length).toBeGreaterThan(0)
    // The first condition call should see count=1 (output of first increment)
    expect((conditionCalls[0].inputData as any).count).toBe(1)
    // Loop should have run 3 times (count goes 0→1→2→3, done=true at 3)
    expect(conditionCalls[conditionCalls.length - 1].iterationCount).toBe(3)
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd browser-agent-chat/server && npx vitest run __tests__/mastra-dountil.test.ts
```

Expected: PASS — this confirms the condition receives step output, not input. If it fails, adjust the schema chain in the spec accordingly.

- [ ] **Step 3: Commit**

```bash
git add __tests__/mastra-dountil.test.ts && git commit -m "test: verify Mastra .dountil() condition receives step output"
```

---

### Task 2: Verify `suspend()` inside `.dountil()` loop

**Files:**
- Create: `__tests__/mastra-suspend-loop.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
// __tests__/mastra-suspend-loop.test.ts
import { describe, it, expect } from 'vitest'
import { Mastra } from '@mastra/core'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'

const StateSchema = z.object({
  iteration: z.number(),
  suspendedAt: z.array(z.number()),
  done: z.boolean(),
})

const loopStep = createStep({
  id: 'loop-with-suspend',
  inputSchema: StateSchema,
  outputSchema: StateSchema,
  execute: async ({ inputData, suspend }) => {
    const nextIteration = inputData.iteration + 1

    // Suspend on iteration 2 and 4 (double-suspend test)
    if (nextIteration === 2 || nextIteration === 4) {
      await suspend({ reason: `suspend-at-${nextIteration}` })
    }

    return {
      iteration: nextIteration,
      suspendedAt: [...inputData.suspendedAt, ...(nextIteration === 2 || nextIteration === 4 ? [nextIteration] : [])],
      done: nextIteration >= 5,
    }
  },
})

describe('Mastra suspend inside .dountil()', () => {
  it('suspends and resumes correctly within a loop', async () => {
    const workflow = createWorkflow({
      id: 'test-suspend-loop',
      inputSchema: StateSchema,
      outputSchema: StateSchema,
      steps: [loopStep],
    })
      .dountil(loopStep, async ({ inputData }) => (inputData as any).done)
      .commit()

    const mastra = new Mastra({ workflows: { 'test-suspend-loop': workflow } })
    const wf = mastra.getWorkflow('test-suspend-loop')
    const run = wf.createRun()
    let result = await run.start({ inputData: { iteration: 0, suspendedAt: [], done: false } })

    // Should be suspended at iteration 2
    expect(result.status).toBe('suspended')

    // Resume
    result = await run.resume({ step: loopStep, resumeData: {} })

    // Should continue and suspend again at iteration 4
    if (result.status === 'suspended') {
      result = await run.resume({ step: loopStep, resumeData: {} })
    }

    // Should be completed now
    expect(result.status).toBe('completed')
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd browser-agent-chat/server && npx vitest run __tests__/mastra-suspend-loop.test.ts
```

Expected: PASS. If it fails, document the failure mode and check Mastra version. If the suspend-in-loop bug is not fixed in the installed version, upgrade `@mastra/core`.

- [ ] **Step 3: Commit**

```bash
git add __tests__/mastra-suspend-loop.test.ts && git commit -m "test: verify Mastra suspend/resume inside .dountil() loop"
```

---

### Task 3: Refactor `evaluateProgress()` to pure function

**Files:**
- Modify: `src/evaluate-progress.ts`
- Create: `__tests__/evaluate-progress-pure.test.ts`

- [ ] **Step 1: Write tests for the pure refactored version**

```ts
// __tests__/evaluate-progress-pure.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateProgress, updateTaskMemory } from '../src/evaluate-progress.js'
import { createBudgetTracker } from '../src/budget.js'
import type { TaskMemory, AgentAction, ActionVerification } from '../src/agent-types.js'

const makeMemory = (overrides: Partial<TaskMemory> = {}): TaskMemory => ({
  taskId: 'test',
  goal: 'test goal',
  intents: [],
  visitedPages: [],
  actionsAttempted: [],
  failedActions: [],
  replanCount: 0,
  progressScore: 0,
  stuckSignals: { repeatedActionCount: 0, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 0 },
  ...overrides,
})

const passedVerification: ActionVerification = { passed: true, confidence: 0.8, findings: [] }
const failedVerification: ActionVerification = { passed: false, confidence: 0.2, findings: [{ title: 'fail', description: 'action failed', severity: 'high' }] }

describe('updateTaskMemory (pure)', () => {
  it('returns a new object without mutating input', () => {
    const memory = makeMemory()
    const action: AgentAction = { type: 'click', expectedOutcome: 'test', intentId: '1' }
    const result = updateTaskMemory(memory, action, passedVerification, '/page1', '/page2')
    expect(result).not.toBe(memory)
    expect(memory.stuckSignals.stepsSinceProgress).toBe(0) // original unchanged
  })

  it('appends action to actionsAttempted', () => {
    const action: AgentAction = { type: 'click', expectedOutcome: 'test', intentId: '1' }
    const result = updateTaskMemory(makeMemory(), action, passedVerification, '/a', '/b')
    expect(result.actionsAttempted).toHaveLength(1)
  })

  it('adds to visitedPages when URL changes', () => {
    const action: AgentAction = { type: 'navigate', expectedOutcome: 'test', intentId: '1' }
    const result = updateTaskMemory(makeMemory(), action, passedVerification, '/a', '/b')
    expect(result.visitedPages).toContain('/b')
  })

  it('resets stepsSinceProgress when URL changes', () => {
    const memory = makeMemory({ stuckSignals: { repeatedActionCount: 0, samePageCount: 5, failedExecutionCount: 0, stepsSinceProgress: 10 } })
    const action: AgentAction = { type: 'click', expectedOutcome: 'test', intentId: '1' }
    const result = updateTaskMemory(memory, action, passedVerification, '/a', '/b')
    expect(result.stuckSignals.stepsSinceProgress).toBe(0)
  })
})

describe('evaluateProgress (no mutation)', () => {
  it('returns continue when not stuck', () => {
    const memory = makeMemory()
    const budget = createBudgetTracker({ maxSteps: 50 })
    const { decision } = evaluateProgress(memory, budget, passedVerification, '/a', '/a')
    expect(decision).toBe('continue')
  })

  it('does NOT mutate taskMemory.stuckSignals', () => {
    const memory = makeMemory()
    const original = { ...memory.stuckSignals }
    const budget = createBudgetTracker({ maxSteps: 50 })
    evaluateProgress(memory, budget, failedVerification, '/a', '/a')
    expect(memory.stuckSignals).toEqual(original)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail (evaluateProgress currently mutates)**

```bash
cd browser-agent-chat/server && npx vitest run __tests__/evaluate-progress-pure.test.ts
```

Expected: The "does NOT mutate" test fails.

- [ ] **Step 3: Refactor `evaluate-progress.ts`**

Remove the mutation on line 50 (`taskMemory.stuckSignals = signals;`). The function should compute and return `signals` but NOT write them back. Add a new exported `updateTaskMemory()` pure function:

```ts
export function updateTaskMemory(
  memory: TaskMemory,
  action: AgentAction,
  verification: ActionVerification,
  urlBefore: string,
  urlAfter: string,
): TaskMemory {
  const urlChanged = urlBefore !== urlAfter
  const signals = updateStuckSignals(
    memory.stuckSignals, [...memory.actionsAttempted, action], verification, urlBefore, urlAfter,
  )
  return {
    ...memory,
    actionsAttempted: [...memory.actionsAttempted, action],
    failedActions: verification.passed ? memory.failedActions : [...memory.failedActions, action],
    visitedPages: urlChanged ? [...memory.visitedPages, urlAfter] : memory.visitedPages,
    stuckSignals: signals,
  }
}
```

Update `evaluateProgress()` signature to accept `StuckSignals` directly instead of the full `TaskMemory`:

```ts
export function evaluateProgress(
  memory: TaskMemory, // read-only — function does NOT mutate
  budget: BudgetTracker,
  lastVerification: ActionVerification,
  urlBefore: string,
  urlAfter: string,
): { decision: EvaluateProgressDecision; reason: string } {
  // Compute signals without mutating memory
  const signals = updateStuckSignals(
    memory.stuckSignals, memory.actionsAttempted, lastVerification, urlBefore, urlAfter,
  )
  // ... rest of decision logic using `signals` instead of `taskMemory.stuckSignals`
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd browser-agent-chat/server && npx vitest run __tests__/evaluate-progress-pure.test.ts
```

Expected: All pass.

- [ ] **Step 5: Run full test suite to check nothing breaks**

```bash
cd browser-agent-chat/server && npx vitest run
```

Expected: All existing tests pass (the current agent-loop.ts callers still work because `evaluateProgress` returns the same decisions).

- [ ] **Step 6: Commit**

```bash
git add src/evaluate-progress.ts __tests__/evaluate-progress-pure.test.ts && git commit -m "refactor: make evaluateProgress pure — no more taskMemory mutation, add updateTaskMemory()"
```

---

### Task 4: Extract helper functions from agent-loop.ts

**Files:**
- Modify: `src/agent-loop.ts`

- [ ] **Step 1: Extract `getCurrentIntent()`, `advanceIntent()`, `checkHeuristicOverride()`**

Read `agent-loop.ts` and find:
- The logic that finds the current active intent (first intent with `status !== 'completed'`)
- The logic that marks the current intent as 'completed' and activates the next one
- The heuristic override logic (lines ~237-280) that forces a click after 3 stuck iterations

Extract each as an exported pure function:

```ts
// At the top of agent-loop.ts or in a new file (agent-loop-helpers.ts)

export function getCurrentIntent(intents: Intent[]): Intent | null {
  return intents.find(i => i.status === 'active') ?? intents.find(i => i.status === 'pending') ?? null
}

export function advanceIntent(intents: Intent[]): Intent[] {
  return intents.map((intent, idx) => {
    if (intent.status === 'active') return { ...intent, status: 'completed' as const, confidence: 1 }
    if (intent.status === 'pending' && intents.slice(0, idx).every(i => i.status === 'completed' || i.status === 'failed')) {
      return { ...intent, status: 'active' as const }
    }
    return intent
  })
}

export function checkHeuristicOverride(
  taskMemory: TaskMemory,
  perception: Perception,
): { action: AgentAction } | null {
  const { stuckSignals } = taskMemory
  if (stuckSignals.repeatedActionCount < 3 || stuckSignals.stepsSinceProgress < 3) return null
  // Find first unexplored navigation element
  const navElement = perception.uiElements.find(el => el.role === 'link' && el.interactable)
  if (!navElement) return null
  return {
    action: {
      type: 'click',
      elementId: navElement.id,
      expectedOutcome: 'Navigate to a new page to break stuck loop',
      intentId: getCurrentIntent(taskMemory.intents)?.id ?? '',
    },
  }
}
```

The existing while-loop should call these extracted functions instead of inline logic. This keeps the loop working while making the functions available to Mastra steps.

- [ ] **Step 2: Verify build + tests**

```bash
cd browser-agent-chat/server && npx tsc --noEmit && npx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add src/agent-loop.ts && git commit -m "refactor: extract getCurrentIntent, advanceIntent, checkHeuristicOverride as pure functions"
```

---

## Chunk 2: Phase 1 — Session Registry + Schemas + Steps

### Task 5: Session Registry

**Files:**
- Create: `src/session-registry.ts`
- Create: `__tests__/session-registry.test.ts`

- [ ] **Step 1: Write tests**

```ts
// __tests__/session-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { registerSession, getSessionContext, removeSession } from '../src/session-registry.js'

const mockCtx = {
  session: { agent: {}, loginDone: Promise.resolve() } as any,
  budget: { exhausted: () => false, snapshot: () => ({}) } as any,
  broadcast: () => {},
}

describe('session-registry', () => {
  beforeEach(() => {
    removeSession('test-1')
  })

  it('registers and retrieves a session', () => {
    registerSession('test-1', mockCtx)
    expect(getSessionContext('test-1')).toBe(mockCtx)
  })

  it('throws on missing session', () => {
    expect(() => getSessionContext('nonexistent')).toThrow('not found')
  })

  it('removes a session', () => {
    registerSession('test-1', mockCtx)
    removeSession('test-1')
    expect(() => getSessionContext('test-1')).toThrow()
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/session-registry.ts
import type { BudgetTracker } from './budget.js'

export interface SessionContext {
  session: any  // AgentSession — typed loosely to avoid circular imports
  budget: BudgetTracker
  broadcast: (msg: Record<string, unknown>) => void
}

const sessions = new Map<string, SessionContext>()

export function registerSession(sessionId: string, ctx: SessionContext): void {
  sessions.set(sessionId, ctx)
}

export function getSessionContext(sessionId: string): SessionContext {
  const ctx = sessions.get(sessionId)
  if (!ctx) throw new Error(`Session ${sessionId} not found in registry`)
  return ctx
}

export function removeSession(sessionId: string): void {
  sessions.delete(sessionId)
}
```

- [ ] **Step 3: Run tests**

```bash
cd browser-agent-chat/server && npx vitest run __tests__/session-registry.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/session-registry.ts __tests__/session-registry.test.ts && git commit -m "feat: session registry for Mastra workflow live object access"
```

---

### Task 6: Define Mastra step schemas

**Files:**
- Create: `src/mastra/schemas.ts`
- Create: `__tests__/mastra-schemas.test.ts`

- [ ] **Step 1: Write schema chain tests**

```ts
// __tests__/mastra-schemas.test.ts
import { describe, it, expect } from 'vitest'
import {
  WorkflowInputSchema, InitializedContextSchema, PlannedContextSchema,
  CycleSchema, TaskResultSchema, BudgetSnapshotSchema,
} from '../src/mastra/schemas.js'

describe('Mastra schema chain', () => {
  const workflowInput = {
    sessionId: 's1', agentId: 'a1', goal: 'test', taskType: 'task' as const, mode: 'multi_step' as const,
  }

  it('WorkflowInputSchema parses valid input', () => {
    expect(WorkflowInputSchema.parse(workflowInput)).toMatchObject(workflowInput)
  })

  it('InitializedContextSchema extends WorkflowInput', () => {
    const data = { ...workflowInput, currentUrl: 'http://test.com', worldContext: 'context' }
    expect(InitializedContextSchema.parse(data)).toMatchObject(data)
  })

  it('PlannedContextSchema extends InitializedContext', () => {
    const data = {
      ...workflowInput, currentUrl: 'http://test.com', worldContext: 'ctx',
      intents: [], taskMemory: { taskId: 't1', goal: 'g', intents: [], visitedPages: [], actionsAttempted: [], failedActions: [], replanCount: 0, progressScore: 0, stuckSignals: { repeatedActionCount: 0, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 0 } },
      budgetSnapshot: { stepsUsed: 0, stepsRemaining: 50, replansUsed: 0, elapsedMs: 0, exhausted: false, warning: false },
      taskComplete: false, escalated: false,
    }
    expect(PlannedContextSchema.parse(data)).toMatchObject({ taskComplete: false })
  })

  it('CycleSchema is same as PlannedContextSchema (loop feeds back)', () => {
    expect(CycleSchema).toBe(PlannedContextSchema)
  })

  it('TaskResultSchema has sessionId for cleanup', () => {
    const data = { sessionId: 's1', agentId: 'a1', goal: 'g', taskType: 'task' as const, success: true, stepsCompleted: 5 }
    expect(TaskResultSchema.parse(data)).toMatchObject({ success: true })
  })
})
```

- [ ] **Step 2: Implement schemas**

```ts
// src/mastra/schemas.ts
import { z } from 'zod'
import { IntentSchema, TaskMemorySchema } from '../agent-types.js'

export const BudgetSnapshotSchema = z.object({
  stepsUsed: z.number(),
  stepsRemaining: z.number(),
  replansUsed: z.number(),
  elapsedMs: z.number(),
  exhausted: z.boolean(),
  warning: z.boolean(),
})

export const WorkflowInputSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  goal: z.string(),
  taskType: z.enum(['task', 'explore']),
  mode: z.enum(['single_shot', 'multi_step']),
})

export const InitializedContextSchema = WorkflowInputSchema.extend({
  currentUrl: z.string(),
  worldContext: z.string(),
})

export const PlannedContextSchema = InitializedContextSchema.extend({
  intents: z.array(IntentSchema),
  taskMemory: TaskMemorySchema,
  budgetSnapshot: BudgetSnapshotSchema,
  taskComplete: z.boolean(),
  escalated: z.boolean(),
})

// Cycle input and output are the same schema — the loop feeds its output back as input
export const CycleSchema = PlannedContextSchema

export const TaskResultSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  goal: z.string(),
  taskType: z.enum(['task', 'explore']),
  success: z.boolean(),
  stepsCompleted: z.number(),
})
```

- [ ] **Step 3: Run tests**

```bash
cd browser-agent-chat/server && npx vitest run __tests__/mastra-schemas.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/mastra/schemas.ts __tests__/mastra-schemas.test.ts && git commit -m "feat: Mastra workflow step schemas with full chain validation"
```

---

### Task 7: Implement Mastra steps

**Files:**
- Create: `src/mastra/steps/initialize.ts`
- Create: `src/mastra/steps/plan-strategy.ts`
- Create: `src/mastra/steps/agent-cycle.ts`
- Create: `src/mastra/steps/execute-single-shot.ts`
- Create: `src/mastra/steps/confirm-goal.ts`
- Create: `src/mastra/steps/cleanup.ts`

- [ ] **Step 1: Create initialize step**

```ts
// src/mastra/steps/initialize.ts
import { createStep } from '@mastra/core/workflows'
import { WorkflowInputSchema, InitializedContextSchema } from '../schemas.js'
import { getSessionContext } from '../../session-registry.js'
import { loadWorldContext } from '../../world-model.js'

export const initializeStep = createStep({
  id: 'initialize',
  inputSchema: WorkflowInputSchema,
  outputSchema: InitializedContextSchema,
  execute: async ({ inputData }) => {
    const ctx = getSessionContext(inputData.sessionId)
    await ctx.session.loginDone
    ctx.broadcast({ type: 'status', status: 'working' })
    const currentUrl = await ctx.session.agent.page.evaluate(() => location.href)
    const worldContext = await loadWorldContext(inputData.agentId)
    return { ...inputData, currentUrl, worldContext }
  },
})
```

- [ ] **Step 2: Create plan-strategy step**

```ts
// src/mastra/steps/plan-strategy.ts
import { createStep } from '@mastra/core/workflows'
import { InitializedContextSchema, PlannedContextSchema } from '../schemas.js'
import { getSessionContext } from '../../session-registry.js'
import { planStrategy } from '../../planner.js'
import type { TaskMemory } from '../../agent-types.js'
import { v4 as uuid } from 'crypto'

export const planStrategyStep = createStep({
  id: 'plan-strategy',
  inputSchema: InitializedContextSchema,
  outputSchema: PlannedContextSchema,
  execute: async ({ inputData }) => {
    const ctx = getSessionContext(inputData.sessionId)
    const { plan } = await planStrategy(
      ctx.session.agent, inputData.goal, inputData.worldContext, inputData.currentUrl,
    )
    const taskMemory: TaskMemory = {
      taskId: crypto.randomUUID(),
      goal: inputData.goal,
      intents: plan.intents,
      visitedPages: [inputData.currentUrl],
      actionsAttempted: [],
      failedActions: [],
      replanCount: 0,
      progressScore: 0,
      stuckSignals: { repeatedActionCount: 0, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 0 },
    }
    return {
      ...inputData,
      intents: plan.intents,
      taskMemory,
      budgetSnapshot: ctx.budget.snapshot(),
      taskComplete: false,
      escalated: false,
    }
  },
})
```

- [ ] **Step 3: Create agent-cycle step**

This is the largest step — implements the full loop body as described in the spec. Read the spec's `agentCycleStep` section for the complete implementation. The step calls `perceive()`, `checkHeuristicOverride()`, `decideNextAction()`, `executeAction()`, `verifyAction()`, `updateTaskMemory()`, `evaluateProgress()`, then handles all 5 decisions.

Key imports: `getSessionContext`, `perceive`, `decideNextAction`, `executeAction`, `verifyAction`, `updateTaskMemory`, `evaluateProgress`, `verifyIntent`, `getCurrentIntent`, `advanceIntent`, `checkHeuristicOverride`, `planStrategy`, `recordNavigation`, `detectLoginPage`.

The step uses `suspend()` when `detectLoginPage()` returns true.

- [ ] **Step 4: Create execute-single-shot step**

```ts
// src/mastra/steps/execute-single-shot.ts
import { createStep } from '@mastra/core/workflows'
import { InitializedContextSchema, TaskResultSchema } from '../schemas.js'
import { getSessionContext } from '../../session-registry.js'

export const executeSingleShotStep = createStep({
  id: 'execute-single-shot',
  inputSchema: InitializedContextSchema,
  outputSchema: TaskResultSchema,
  execute: async ({ inputData }) => {
    const ctx = getSessionContext(inputData.sessionId)
    await ctx.session.agent.act(inputData.goal)
    return {
      sessionId: inputData.sessionId,
      agentId: inputData.agentId,
      goal: inputData.goal,
      taskType: inputData.taskType,
      success: true,
      stepsCompleted: 1,
    }
  },
})
```

- [ ] **Step 5: Create confirm-goal step**

```ts
// src/mastra/steps/confirm-goal.ts
import { createStep } from '@mastra/core/workflows'
import { CycleSchema, TaskResultSchema } from '../schemas.js'
import { confirmGoalCompletion } from '../../planner-confirm.js'

export const confirmGoalStep = createStep({
  id: 'confirm-goal',
  inputSchema: CycleSchema,
  outputSchema: TaskResultSchema,
  execute: async ({ inputData }) => {
    const confirmation = confirmGoalCompletion(inputData.goal, inputData.intents, inputData.taskType)
    return {
      sessionId: inputData.sessionId,
      agentId: inputData.agentId,
      goal: inputData.goal,
      taskType: inputData.taskType,
      success: confirmation.achieved,
      stepsCompleted: inputData.budgetSnapshot.stepsUsed,
    }
  },
})
```

- [ ] **Step 6: Create cleanup step**

```ts
// src/mastra/steps/cleanup.ts
import { createStep } from '@mastra/core/workflows'
import { TaskResultSchema } from '../schemas.js'
import { getSessionContext } from '../../session-registry.js'

export const cleanupStep = createStep({
  id: 'cleanup',
  inputSchema: TaskResultSchema,
  outputSchema: TaskResultSchema,
  execute: async ({ inputData }) => {
    const ctx = getSessionContext(inputData.sessionId)
    ctx.broadcast({ type: 'taskComplete', success: inputData.success })
    ctx.broadcast({ type: 'status', status: 'idle' })
    return inputData
  },
})
```

- [ ] **Step 7: Verify build**

```bash
cd browser-agent-chat/server && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add src/mastra/steps/ && git commit -m "feat: all Mastra step implementations — initialize, plan, cycle, single-shot, confirm, cleanup"
```

---

### Task 8: Final build + test

- [ ] **Step 1: Run full build**

```bash
cd browser-agent-chat && npm run build
```

- [ ] **Step 2: Run all server tests**

```bash
cd browser-agent-chat/server && npx vitest run
```

- [ ] **Step 3: Commit if cleanup needed**

```bash
git add -A && git commit -m "chore: Mastra orchestration Phase 0+1 complete — prerequisites + foundations"
```

---

## What's Next (Phase 2 — separate plan)

Phase 2 wires the workflows into production:
- Create `src/mastra/workflows/multi-step.ts` and `single-shot.ts` using `.dountil()` + the steps from Phase 1
- Modify `agent-dispatch.ts` to call `mastra.getWorkflow().start()` instead of `executeAgentLoop()`
- Feature-flag the switch so both paths can run during testing
- Remove `agent-loop.ts` after verification
