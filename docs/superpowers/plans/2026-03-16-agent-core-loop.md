# Agent Architecture — Plan 2: Core Loop

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Implement the Planner, PERCEIVE, DECIDE, and EXECUTE steps — the core agent loop that replaces executeExplore/executeTask.

**Architecture:** Planner produces intent steps at task start. Policy loop runs PERCEIVE → DECIDE → EXECUTE per step. Magnitude is the browser execution layer.

**Tech Stack:** Mastra workflows, Magnitude (magnitude-core), Zod, existing agent types from Plan 1

---

### Task 1: Implement Planner (plan-strategy step)

**Files:**
- Modify: `server/src/mastra/workflows/agent-task.ts` (planStrategyStep.execute)
- Create: `server/src/planner.ts`
- Test: `server/__tests__/planner.test.ts`

Planner receives: user goal + world context (serialized pages/features) + current URL.
Planner calls LLM (via Magnitude's agent.extract with StrategyPlanSchema) to decompose goal into intent steps.
Each intent has: id, description, successCriteria, status='pending', confidence=0.

Test: mock the LLM call, verify output matches StrategyPlanSchema.

### Task 2: Implement PERCEIVE step

**Files:**
- Modify: `server/src/mastra/tools/perception.ts` (implement execute)
- Create: `server/src/perception.ts`
- Test: `server/__tests__/perception.test.ts`

PERCEIVE captures: screenshot (base64 from Magnitude), accessibility tree summary (page.evaluate to extract visible elements as UIElement[]), current URL, page title.
It also loads the active intent from task memory and relevant memory (filtered by domain).
Output matches PerceptionSchema from agent-types.ts.

Test: mock page object, verify UIElement extraction.

### Task 3: Implement DECIDE step

**Files:**
- Modify: `server/src/mastra/workflows/agent-task.ts` (decideActionStep.execute)
- Create: `server/src/policy.ts`
- Test: `server/__tests__/policy.test.ts`

DECIDE receives Perception + active intent. Calls LLM to select ONE structured AgentAction from the UI element tree.
Decision hierarchy: 1) skill match → execute skill, 2) explore → select from frontier, 3) user task → select action from UI.
Output matches AgentActionSchema.

Test: mock LLM, verify structured action output.

### Task 4: Implement EXECUTE step

**Files:**
- Modify: `server/src/mastra/tools/magnitude-act.ts` (implement execute)
- Modify: `server/src/mastra/tools/magnitude-extract.ts` (implement execute)
- Modify: `server/src/mastra/workflows/agent-task.ts` (executeStep.execute)
- Create: `server/src/executor.ts`
- Test: `server/__tests__/executor.test.ts`

EXECUTE translates AgentAction into Magnitude calls:
- click → agent.act("click element X")
- type → agent.act("type 'value' into element X")
- extract → agent.extract(prompt, schema)
- navigate → agent.act("navigate to URL")
Includes login interception (existing handleLoginDetection).
Output matches ExecutionResultSchema.

Test: mock Magnitude agent, verify action translation.

### Task 5: Wire workflow loop

**Files:**
- Modify: `server/src/mastra/workflows/agent-task.ts`

Replace the linear `.then()` chain with a loop:
plan-strategy → [perceive → decide → execute → verify-action → update-state → evaluate-progress] (loop).
Use Mastra's workflow branching/looping API. Check actual API from node_modules.
