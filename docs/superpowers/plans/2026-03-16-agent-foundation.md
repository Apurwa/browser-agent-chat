# Agent Architecture — Plan 1: Foundation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Mastra, define all agent types, create DB migrations, set up workflow skeleton with tools — so Plans 2/3/4 can build the core loop, world model, and skills in parallel.

**Architecture:** Mastra as workflow runtime orchestrating a three-layer agent (Planner → Policy → Executor). Types and tools defined here; logic implemented in Plans 2-4. Existing tables (nav_nodes, nav_edges, learned_patterns) extended rather than replaced.

**Tech Stack:** Mastra (`@mastra/core`), Zod, Supabase (existing), Langfuse (existing), Magnitude (existing)

**Spec:** `docs/specs/agent-architecture.md`

---

## Chunk 1: Package Installation & Mastra Setup

### Task 1: Install Mastra Dependencies

**Files:**
- Modify: `browser-agent-chat/server/package.json`

- [ ] **Step 1: Install packages**

```bash
cd browser-agent-chat && npm install @mastra/core @mastra/langfuse -w server
```

- [ ] **Step 2: Verify installation**

```bash
cd browser-agent-chat/server && node -e "const m = require('@mastra/core'); console.log('mastra ok')"
```

Expected: `mastra ok` (or ESM equivalent — may need `npx tsx -e "import '@mastra/core'"`)

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/server/package.json browser-agent-chat/server/package-lock.json
git commit -m "chore: install @mastra/core and @mastra/langfuse"
```

### Task 2: Create Mastra Instance with Langfuse

**Files:**
- Create: `browser-agent-chat/server/src/mastra/index.ts`

- [ ] **Step 1: Write test**

Create: `browser-agent-chat/server/__tests__/mastra-setup.test.ts`

```typescript
import { describe, it, expect } from 'vitest';

describe('Mastra setup', () => {
  it('exports a configured Mastra instance', async () => {
    const { mastra } = await import('../src/mastra/index.js');
    expect(mastra).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run __tests__/mastra-setup.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create Mastra instance**

Create `browser-agent-chat/server/src/mastra/index.ts`:

```typescript
import { Mastra } from '@mastra/core';
import { LangfuseExporter } from '@mastra/langfuse';

export const mastra = new Mastra({
  telemetry: {
    serviceName: 'browser-agent-chat',
    enabled: !!process.env.LANGFUSE_PUBLIC_KEY,
    export: {
      type: 'custom',
      exporter: new LangfuseExporter({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL,
      }),
    },
  },
});
```

Note: Check Mastra docs for exact config shape — the API may differ from research. Adapt as needed.

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run __tests__/mastra-setup.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/mastra/index.ts browser-agent-chat/server/__tests__/mastra-setup.test.ts
git commit -m "feat: add Mastra instance with Langfuse observability"
```

---

## Chunk 2: Agent Type Definitions

### Task 3: Define Core Agent Types

**Files:**
- Create: `browser-agent-chat/server/src/agent-types.ts`
- Test: `browser-agent-chat/server/__tests__/agent-types.test.ts`

- [ ] **Step 1: Write type validation test**

```typescript
import { describe, it, expect } from 'vitest';
import { StrategyPlanSchema, AgentActionSchema, PerceptionSchema, AgentBudgetSchema } from '../src/agent-types.js';

describe('Agent types — Zod schemas', () => {
  it('validates a StrategyPlan', () => {
    const plan = {
      goal: 'Create webhook',
      intents: [{
        id: 'open_settings',
        description: 'Open settings page',
        successCriteria: 'Settings heading visible',
        status: 'pending',
        confidence: 0,
      }],
    };
    expect(StrategyPlanSchema.parse(plan)).toEqual(plan);
  });

  it('validates an AgentAction', () => {
    const action = {
      type: 'click',
      elementId: 'btn_settings',
      expectedOutcome: 'Navigate to settings',
      intentId: 'open_settings',
    };
    expect(AgentActionSchema.parse(action)).toEqual(action);
  });

  it('rejects invalid action type', () => {
    expect(() => AgentActionSchema.parse({
      type: 'hover',
      expectedOutcome: 'x',
      intentId: 'x',
    })).toThrow();
  });

  it('validates AgentBudget with defaults', () => {
    const budget = AgentBudgetSchema.parse({});
    expect(budget.maxSteps).toBe(50);
    expect(budget.maxReplanAttempts).toBe(3);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run __tests__/agent-types.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement agent types with Zod schemas**

Create `browser-agent-chat/server/src/agent-types.ts`:

```typescript
import { z } from 'zod';

// --- Planner Types ---

export const IntentSchema = z.object({
  id: z.string(),
  description: z.string(),
  successCriteria: z.string(),
  status: z.enum(['pending', 'active', 'completed', 'failed']),
  confidence: z.number().min(0).max(1),
});
export type Intent = z.infer<typeof IntentSchema>;

export const StrategyPlanSchema = z.object({
  goal: z.string(),
  intents: z.array(IntentSchema),
});
export type StrategyPlan = z.infer<typeof StrategyPlanSchema>;

// --- Policy Types ---

export const AgentActionSchema = z.object({
  type: z.enum(['click', 'type', 'scroll', 'select', 'submit', 'extract', 'navigate']),
  elementId: z.string().optional(),
  value: z.string().optional(),
  expectedOutcome: z.string(),
  intentId: z.string(),
});
export type AgentAction = z.infer<typeof AgentActionSchema>;

// --- Perception Types ---

export const UIElementSchema = z.object({
  id: z.string(),
  role: z.string(),
  label: z.string(),
  type: z.string().optional(),
  interactable: z.boolean(),
});
export type UIElement = z.infer<typeof UIElementSchema>;

export const PerceptionSchema = z.object({
  screenshot: z.string().optional(),
  uiElements: z.array(UIElementSchema),
  url: z.string(),
  pageTitle: z.string(),
  activeIntent: IntentSchema.nullable(),
  relevantMemory: z.string(),
});
export type Perception = z.infer<typeof PerceptionSchema>;

// --- Execution Types ---

export const ExecutionResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  newUrl: z.string().optional(),
  error: z.string().optional(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

// --- Verification Types ---

export const ActionVerificationSchema = z.object({
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  findings: z.array(z.object({
    title: z.string(),
    description: z.string(),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
  })),
});
export type ActionVerification = z.infer<typeof ActionVerificationSchema>;

export const IntentVerificationSchema = z.object({
  intentId: z.string(),
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type IntentVerification = z.infer<typeof IntentVerificationSchema>;

export const GoalConfirmationSchema = z.object({
  achieved: z.boolean(),
  remainingWork: z.string().optional(),
});
export type GoalConfirmation = z.infer<typeof GoalConfirmationSchema>;

// --- Budget Types ---

export const AgentBudgetSchema = z.object({
  maxSteps: z.number().default(50),
  maxStepsPerIntent: z.number().default(20),
  maxTokens: z.number().default(100_000),
  maxTimeMs: z.number().default(300_000),
  maxCostUsd: z.number().default(0.50),
  maxRetries: z.number().default(3),
  maxReplanAttempts: z.number().default(3),
});
export type AgentBudget = z.infer<typeof AgentBudgetSchema>;

// --- Task Memory Types ---

export const StuckSignalsSchema = z.object({
  repeatedActionCount: z.number().default(0),
  samePageCount: z.number().default(0),
  failedExecutionCount: z.number().default(0),
  stepsSinceProgress: z.number().default(0),
});
export type StuckSignals = z.infer<typeof StuckSignalsSchema>;

export const TaskMemorySchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  intents: z.array(IntentSchema),
  visitedPages: z.array(z.string()),
  actionsAttempted: z.array(AgentActionSchema),
  failedActions: z.array(AgentActionSchema),
  replanCount: z.number().default(0),
  progressScore: z.number().default(0),
  stuckSignals: StuckSignalsSchema,
});
export type TaskMemory = z.infer<typeof TaskMemorySchema>;

// --- Frontier Types ---

export const FrontierItemSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  targetUrlHash: z.string().optional(),
  elementLabel: z.string(),
  action: AgentActionSchema,
  priority: z.number(),
  intentRelevance: z.number().optional(),
  discoveredAtStep: z.number(),
  explored: z.boolean().default(false),
  persistent: z.boolean().default(false),
  category: z.enum(['navigation', 'form', 'modal', 'button', 'link']),
});
export type FrontierItem = z.infer<typeof FrontierItemSchema>;

// --- Skill Types ---

export const UIAnchorSchema = z.object({
  type: z.enum(['label', 'role', 'selector', 'placeholder']),
  value: z.string(),
  pageUrl: z.string(),
});
export type UIAnchor = z.infer<typeof UIAnchorSchema>;

export const ConditionSchema = z.object({
  type: z.enum(['ui_state', 'data_state']),
  expression: z.string(),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const SkillSchema = z.object({
  id: z.string(),
  appId: z.string(),
  name: z.string(),
  intent: z.string(),
  steps: z.array(AgentActionSchema),
  anchors: z.array(UIAnchorSchema),
  preconditions: z.array(ConditionSchema),
  successCriteria: z.string(),
  successRate: z.number().default(1),
  executionCount: z.number().default(0),
  lastUsed: z.string().optional(),
  learnedFrom: z.enum(['auto', 'user']),
});
export type Skill = z.infer<typeof SkillSchema>;

// --- Progress Scoring ---

export const PROGRESS_WEIGHTS = {
  goalProgress: 5,
  newPage: 3,
  newElements: 1,
  flowStep: 2,
  formPresence: 2,
  modalTrigger: 2,
} as const;

// --- Evaluate Progress Output ---

export type EvaluateProgressDecision =
  | 'continue'
  | 'retry_action'
  | 'replan'
  | 'done'
  | 'escalate_to_user';
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run __tests__/agent-types.test.ts
```

Expected: PASS

- [ ] **Step 5: TypeScript check**

```bash
cd browser-agent-chat/server && npx tsc --noEmit
```

Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/server/src/agent-types.ts browser-agent-chat/server/__tests__/agent-types.test.ts
git commit -m "feat: define agent architecture types with Zod schemas"
```

---

## Chunk 3: Database Migration

### Task 4: Create Migration for Frontier Items Table

**Files:**
- Create: `browser-agent-chat/server/migrations/008_agent_architecture.sql`

- [ ] **Step 1: Write migration**

```sql
-- Migration 008: Agent Architecture — frontier items + world model extensions

-- 1. Frontier items table (exploration queue)
CREATE TABLE frontier_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  page_id UUID REFERENCES nav_nodes(id) ON DELETE SET NULL,
  target_url_hash TEXT,
  element_label TEXT NOT NULL,
  action JSONB NOT NULL,
  priority NUMERIC NOT NULL DEFAULT 0,
  intent_relevance NUMERIC,
  discovered_at_step INTEGER NOT NULL DEFAULT 0,
  explored BOOLEAN NOT NULL DEFAULT false,
  persistent BOOLEAN NOT NULL DEFAULT false,
  category TEXT NOT NULL CHECK (category IN ('navigation', 'form', 'modal', 'button', 'link')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE frontier_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage frontier for own agents"
  ON frontier_items FOR ALL
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE INDEX idx_frontier_agent_explored ON frontier_items(agent_id, explored);
CREATE INDEX idx_frontier_priority ON frontier_items(agent_id, priority DESC) WHERE NOT explored;
CREATE INDEX idx_frontier_dedup ON frontier_items(agent_id, target_url_hash) WHERE target_url_hash IS NOT NULL;

-- 2. Extend nav_nodes with world model fields
ALTER TABLE nav_nodes ADD COLUMN IF NOT EXISTS purpose TEXT;
ALTER TABLE nav_nodes ADD COLUMN IF NOT EXISTS available_actions JSONB DEFAULT '[]';
ALTER TABLE nav_nodes ADD COLUMN IF NOT EXISTS visited BOOLEAN DEFAULT false;

-- 3. Extend learned_patterns with skill fields
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS intent TEXT;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS anchors JSONB DEFAULT '[]';
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS preconditions JSONB DEFAULT '[]';
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS success_criteria TEXT;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS learned_from TEXT DEFAULT 'auto'
  CHECK (learned_from IN ('auto', 'user'));
```

- [ ] **Step 2: Apply migration to Supabase**

Use the Supabase MCP tool or SQL editor to run the migration.

- [ ] **Step 3: Verify tables exist**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'frontier_items' ORDER BY ordinal_position;
```

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/server/migrations/008_agent_architecture.sql
git commit -m "feat: add frontier_items table and world model extensions"
```

---

## Chunk 4: Mastra Tool Skeletons

### Task 5: Define Mastra Tools

**Files:**
- Create: `browser-agent-chat/server/src/mastra/tools/magnitude-act.ts`
- Create: `browser-agent-chat/server/src/mastra/tools/magnitude-extract.ts`
- Create: `browser-agent-chat/server/src/mastra/tools/perception.ts`
- Create: `browser-agent-chat/server/src/mastra/tools/world-model.ts`
- Create: `browser-agent-chat/server/src/mastra/tools/frontier.ts`
- Create: `browser-agent-chat/server/src/mastra/tools/broadcast.ts`
- Create: `browser-agent-chat/server/src/mastra/tools/index.ts`
- Test: `browser-agent-chat/server/__tests__/mastra-tools.test.ts`

- [ ] **Step 1: Write tool schema validation tests**

```typescript
import { describe, it, expect } from 'vitest';
import { magnitudeActTool, magnitudeExtractTool, perceptionTool, worldModelReadTool, worldModelUpdateTool, frontierNextTool, broadcastTool } from '../src/mastra/tools/index.js';

describe('Mastra tool definitions', () => {
  const tools = [
    magnitudeActTool,
    magnitudeExtractTool,
    perceptionTool,
    worldModelReadTool,
    worldModelUpdateTool,
    frontierNextTool,
    broadcastTool,
  ];

  it('all tools have id and description', () => {
    for (const tool of tools) {
      expect(tool.id).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });

  it('all tools have inputSchema and execute', () => {
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.execute).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Create tool files**

Each tool is a skeleton — input/output schemas defined, execute is a placeholder that throws `'Not implemented'`. Plans 2-4 will implement the logic.

Create `browser-agent-chat/server/src/mastra/tools/magnitude-act.ts`:

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const magnitudeActTool = createTool({
  id: 'magnitude-act',
  description: 'Execute a browser action via Magnitude agent',
  inputSchema: z.object({
    instruction: z.string().describe('Natural language instruction for the browser agent'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    newUrl: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    throw new Error('Not implemented — will be wired in Plan 2');
  },
});
```

Create similar skeletons for each tool: `magnitude-extract.ts`, `perception.ts`, `world-model.ts`, `frontier.ts`, `broadcast.ts`. Each with appropriate Zod schemas from the spec's type definitions.

Create `browser-agent-chat/server/src/mastra/tools/index.ts` re-exporting all tools.

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/mastra/tools/
git commit -m "feat: add Mastra tool skeletons for agent architecture"
```

---

## Chunk 5: Workflow Skeleton

### Task 6: Define Agent Workflow

**Files:**
- Create: `browser-agent-chat/server/src/mastra/workflows/agent-task.ts`
- Modify: `browser-agent-chat/server/src/mastra/index.ts` (register workflow)
- Test: `browser-agent-chat/server/__tests__/mastra-workflow.test.ts`

- [ ] **Step 1: Write workflow structure test**

```typescript
import { describe, it, expect } from 'vitest';

describe('Agent task workflow', () => {
  it('exports a committed workflow with correct id', async () => {
    const { agentTaskWorkflow } = await import('../src/mastra/workflows/agent-task.js');
    expect(agentTaskWorkflow).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Create workflow with step placeholders**

Create `browser-agent-chat/server/src/mastra/workflows/agent-task.ts`:

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { StrategyPlanSchema, PerceptionSchema, AgentActionSchema, ExecutionResultSchema, ActionVerificationSchema } from '../../agent-types.js';

// --- Step definitions (logic implemented in Plans 2-4) ---

export const planStrategyStep = createStep({
  id: 'plan-strategy',
  inputSchema: z.object({
    goal: z.string(),
    worldContext: z.string(),
    currentUrl: z.string(),
  }),
  outputSchema: StrategyPlanSchema,
  execute: async ({ inputData }) => {
    // Plan 2 implements this
    return { goal: inputData.goal, intents: [] };
  },
});

export const perceiveStep = createStep({
  id: 'perceive',
  inputSchema: z.object({
    agentId: z.string(),
    sessionId: z.string(),
  }),
  outputSchema: PerceptionSchema,
  execute: async ({ inputData }) => {
    // Plan 2 implements this
    return {
      uiElements: [],
      url: '',
      pageTitle: '',
      activeIntent: null,
      relevantMemory: '',
    };
  },
});

export const decideActionStep = createStep({
  id: 'decide-action',
  inputSchema: PerceptionSchema,
  outputSchema: AgentActionSchema,
  execute: async ({ inputData }) => {
    // Plan 2 implements this
    return {
      type: 'extract',
      expectedOutcome: 'placeholder',
      intentId: 'placeholder',
    };
  },
});

export const executeStep = createStep({
  id: 'execute',
  inputSchema: AgentActionSchema,
  outputSchema: ExecutionResultSchema,
  execute: async ({ inputData }) => {
    // Plan 2 implements this
    return { success: false, error: 'Not implemented' };
  },
});

export const verifyActionStep = createStep({
  id: 'verify-action',
  inputSchema: ExecutionResultSchema,
  outputSchema: ActionVerificationSchema,
  execute: async ({ inputData }) => {
    // Plan 4 implements this
    return { passed: false, confidence: 0, findings: [] };
  },
});

// --- Workflow composition ---

export const agentTaskWorkflow = createWorkflow({
  id: 'agent-task',
  inputSchema: z.object({
    agentId: z.string(),
    sessionId: z.string(),
    goal: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    stepsCompleted: z.number(),
  }),
})
  .then(planStrategyStep)
  .then(perceiveStep)
  .then(decideActionStep)
  .then(executeStep)
  .then(verifyActionStep)
  .commit();
```

Note: This is a linear skeleton. Plans 2-4 will add the looping/branching logic. Mastra workflow composition may require adapting the `.then()` chain to use `.branch()` or custom loop constructs.

- [ ] **Step 4: Register workflow in Mastra instance**

Update `browser-agent-chat/server/src/mastra/index.ts` to import and register the workflow.

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: TypeScript check**

```bash
cd browser-agent-chat/server && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add browser-agent-chat/server/src/mastra/workflows/ browser-agent-chat/server/src/mastra/index.ts browser-agent-chat/server/__tests__/mastra-workflow.test.ts
git commit -m "feat: add agent-task workflow skeleton with step placeholders"
```

---

## Chunk 6: Budget Module

### Task 7: Budget Tracking Module

**Files:**
- Create: `browser-agent-chat/server/src/budget.ts`
- Test: `browser-agent-chat/server/__tests__/budget.test.ts`

- [ ] **Step 1: Write budget tests**

```typescript
import { describe, it, expect } from 'vitest';
import { createBudgetTracker } from '../src/budget.js';

describe('Budget tracker', () => {
  it('starts with full budget', () => {
    const budget = createBudgetTracker({ maxSteps: 50 });
    expect(budget.remaining().steps).toBe(50);
    expect(budget.exhausted()).toBe(false);
  });

  it('decrements steps', () => {
    const budget = createBudgetTracker({ maxSteps: 3 });
    budget.recordStep();
    budget.recordStep();
    expect(budget.remaining().steps).toBe(1);
    expect(budget.exhausted()).toBe(false);
  });

  it('reports exhausted when steps reach 0', () => {
    const budget = createBudgetTracker({ maxSteps: 1 });
    budget.recordStep();
    expect(budget.exhausted()).toBe(true);
  });

  it('reports warning at 80% usage', () => {
    const budget = createBudgetTracker({ maxSteps: 10 });
    for (let i = 0; i < 8; i++) budget.recordStep();
    expect(budget.warning()).toBe(true);
  });

  it('tracks time budget', () => {
    const budget = createBudgetTracker({ maxTimeMs: 100 });
    // Can't easily test time without mocking, just verify it doesn't throw
    expect(budget.exhausted()).toBe(false);
  });

  it('tracks replan attempts', () => {
    const budget = createBudgetTracker({ maxReplanAttempts: 3 });
    budget.recordReplan();
    budget.recordReplan();
    budget.recordReplan();
    expect(budget.canReplan()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement budget tracker**

Create `browser-agent-chat/server/src/budget.ts`:

```typescript
import { AgentBudgetSchema, type AgentBudget } from './agent-types.js';

export interface BudgetTracker {
  recordStep(): void;
  recordReplan(): void;
  remaining(): { steps: number; timeMs: number };
  exhausted(): boolean;
  warning(): boolean;
  canReplan(): boolean;
  snapshot(): BudgetSnapshot;
}

interface BudgetSnapshot {
  stepsUsed: number;
  stepsRemaining: number;
  replansUsed: number;
  elapsedMs: number;
  exhausted: boolean;
  warning: boolean;
}

export function createBudgetTracker(
  overrides: Partial<AgentBudget> = {}
): BudgetTracker {
  const config = AgentBudgetSchema.parse(overrides);
  const startTime = Date.now();
  let stepsUsed = 0;
  let replansUsed = 0;

  const elapsedMs = () => Date.now() - startTime;

  const isExhausted = () =>
    stepsUsed >= config.maxSteps ||
    elapsedMs() >= config.maxTimeMs;

  const isWarning = () =>
    stepsUsed >= config.maxSteps * 0.8 ||
    elapsedMs() >= config.maxTimeMs * 0.8;

  return {
    recordStep: () => { stepsUsed++; },
    recordReplan: () => { replansUsed++; },
    remaining: () => ({
      steps: Math.max(0, config.maxSteps - stepsUsed),
      timeMs: Math.max(0, config.maxTimeMs - elapsedMs()),
    }),
    exhausted: isExhausted,
    warning: isWarning,
    canReplan: () => replansUsed < config.maxReplanAttempts,
    snapshot: () => ({
      stepsUsed,
      stepsRemaining: Math.max(0, config.maxSteps - stepsUsed),
      replansUsed,
      elapsedMs: elapsedMs(),
      exhausted: isExhausted(),
      warning: isWarning(),
    }),
  };
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run __tests__/budget.test.ts
```

Expected: PASS

- [ ] **Step 5: TypeScript check**

```bash
cd browser-agent-chat/server && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/server/src/budget.ts browser-agent-chat/server/__tests__/budget.test.ts
git commit -m "feat: add budget tracking module for agent step/time/replan limits"
```

---

## Chunk 7: Final Verification

### Task 8: Full Test Suite & Type Check

- [ ] **Step 1: Run full test suite**

```bash
cd browser-agent-chat/server && npx vitest run
```

Expected: All new tests pass. Pre-existing tests unaffected.

- [ ] **Step 2: TypeScript check**

```bash
cd browser-agent-chat/server && npx tsc --noEmit
```

Expected: exit 0

- [ ] **Step 3: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: resolve any Plan 1 integration issues"
```

---

## Files Created/Modified Summary

| Action | File |
|--------|------|
| Create | `server/src/mastra/index.ts` — Mastra instance |
| Create | `server/src/agent-types.ts` — All Zod schemas and types |
| Create | `server/src/budget.ts` — Budget tracker |
| Create | `server/src/mastra/tools/*.ts` — 7 tool skeletons |
| Create | `server/src/mastra/workflows/agent-task.ts` — Workflow skeleton |
| Create | `server/migrations/008_agent_architecture.sql` — DB migration |
| Create | `server/__tests__/mastra-setup.test.ts` |
| Create | `server/__tests__/agent-types.test.ts` |
| Create | `server/__tests__/mastra-tools.test.ts` |
| Create | `server/__tests__/mastra-workflow.test.ts` |
| Create | `server/__tests__/budget.test.ts` |
| Modify | `server/package.json` — add Mastra dependencies |

## What This Enables

After Plan 1, parallel sub-agents can work on:
- **Plan 2 (Core Loop):** Implement `planStrategyStep`, `perceiveStep`, `decideActionStep`, `executeStep` logic
- **Plan 3 (World Model & Frontier):** Implement `worldModelReadTool`, `worldModelUpdateTool`, `frontierNextTool` + frontier CRUD
- **Plan 4 (Skills & Verification):** Implement `verifyActionStep`, `verifyIntentStep`, skill matching/learning
