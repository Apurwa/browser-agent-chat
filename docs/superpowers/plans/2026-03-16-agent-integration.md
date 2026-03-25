# Agent Architecture — Plan 5: Integration

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Wire the new agent architecture into the existing server, replacing executeExplore/executeTask with the Mastra-based agent loop. Connect WebSocket events. Add basic evals.

**Architecture:** New `executeAgentTask` function runs the full Planner → Policy Loop → Confirm pipeline. index.ts dispatches to it instead of the old functions. Old functions kept but deprecated for rollback safety.

**Tech Stack:** Existing server (Express + WebSocket), Mastra workflow, all modules from Plans 1-4

---

### Task 1: Create the Agent Loop Runner

**Files:**
- Create: `server/src/agent-loop.ts`
- Test: `server/__tests__/agent-loop.test.ts`

This is the main orchestrator that ties everything together:

```typescript
export async function executeAgentLoop(
  session: AgentSession,
  goal: string,
  taskType: 'task' | 'explore',
  broadcast: (msg: ServerMessage) => void,
): Promise<{ success: boolean; stepsCompleted: number }>
```

Flow:
1. Create BudgetTracker (explore: maxSteps=50, task: maxSteps=20)
2. Create TaskMemory (initialize with goal, empty arrays)
3. Call `planStrategy(goal, worldContext, currentUrl)` → get intents
4. Set first intent as active
5. **Policy loop** (while not done):
   a. `perceive(page, activeIntent, memoryContext)` → Perception
   b. Check skill match: `findSkillForIntent(agentId, activeIntent.description)`
   c. If skill → execute skill, else → `decideNextAction(perception, stepHistory)` → AgentAction
   d. `executeAction(agent, page, action)` → ExecutionResult
   e. `verifyAction(action, result, urlBefore, urlAfter)` → ActionVerification
   f. Update world model (recordNavigation if URL changed, update frontier)
   g. `evaluateProgress(taskMemory, budget, verification, urlBefore, urlAfter)` → decision
   h. If decision === 'continue' → loop
   i. If decision === 'replan' → call planStrategy again, budget.recordReplan()
   j. If decision === 'done' → break
   k. If decision === 'escalate_to_user' → broadcast escalation message, break
   l. If decision === 'retry_action' → loop (same action will be retried)
   m. At intent boundary: `verifyIntent(intent, currentUrl, pageTitle)` → advance or replan
6. When all intents done: `confirmGoalCompletion(goal, intents)` → broadcast result
7. Broadcast throughout: thoughts, actions, status updates via broadcast function

Broadcast integration:
- On plan created → broadcast thought: "Planning strategy: N intents"
- On each action → broadcast action type + target
- On verification fail → broadcast thought: finding description
- On intent complete → broadcast thought: "Completed: {intent.description}"
- On replan → broadcast thought: "Replanning..."
- On escalate → broadcast error with context
- On done → broadcast taskComplete

Test: Mock all dependencies (planner, perception, policy, executor, verification). Verify the loop runs through a simple 2-intent plan and completes. Verify budget exhaustion stops the loop. Verify stuck detection triggers replan.

### Task 2: Wire into WebSocket Server

**Files:**
- Modify: `server/src/index.ts`
- Create: `server/src/agent-dispatch.ts`

Create a dispatch layer that decides whether to use old or new agent:

```typescript
// server/src/agent-dispatch.ts
export async function dispatchTask(
  session: AgentSession,
  task: string,
  broadcast: (msg: ServerMessage) => void,
): Promise<void> {
  // Feature flag: use new agent loop
  const useNewAgent = process.env.USE_NEW_AGENT === 'true';

  if (useNewAgent) {
    await executeAgentLoop(session, task, 'task', broadcast);
  } else {
    await executeTask(session, task, broadcast);
  }
}

export async function dispatchExplore(
  session: AgentSession,
  context: string | null,
  broadcast: (msg: ServerMessage) => void,
): Promise<void> {
  const useNewAgent = process.env.USE_NEW_AGENT === 'true';

  if (useNewAgent) {
    const goal = context
      ? `Explore this application and discover its features. Context: ${context}`
      : 'Explore this application and discover all features, pages, and flows.';
    await executeAgentLoop(session, goal, 'explore', broadcast);
  } else {
    await executeExplore(session, context, broadcast);
  }
}
```

In `index.ts`:
- Replace `executeTask(agentSession, msg.content, taskBroadcast)` with `dispatchTask(agentSession, msg.content, taskBroadcast)`
- Replace `executeExplore(agentSession, ...)` with `dispatchExplore(agentSession, ...)`
- Import from agent-dispatch.ts

This allows rollback via env var `USE_NEW_AGENT=false`.

Test: Verify feature flag routing works.

### Task 3: Basic Eval Definitions

**Files:**
- Create: `server/src/mastra/evals/task-completion.ts`
- Create: `server/src/mastra/evals/budget-efficiency.ts`
- Test: `server/__tests__/evals.basic.test.ts`

Simple eval functions that can be run after a task:

```typescript
// task-completion.ts
export function evalTaskCompletion(
  goalConfirmation: GoalConfirmation,
  intents: Intent[],
): { score: number; details: string }
// score = completed intents / total intents

// budget-efficiency.ts
export function evalBudgetEfficiency(
  budgetSnapshot: BudgetSnapshot,
  intentsCompleted: number,
): { score: number; details: string }
// score = intentsCompleted / stepsUsed (higher = more efficient)
```

Test: Verify scoring math.

### Task 4: Final Verification

- Run full test suite: `npx vitest run`
- TypeScript check: `npx tsc --noEmit`
- Verify the server starts: `npm run dev:server` (check for import errors)
- Commit all changes
