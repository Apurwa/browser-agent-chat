import { z } from 'zod';
import { IntentSchema, TaskMemorySchema } from '../agent-types.js';

// ---------------------------------------------------------------------------
// Budget Snapshot — serializable view of the mutable BudgetTracker
// ---------------------------------------------------------------------------

export const BudgetSnapshotSchema = z.object({
  stepsUsed: z.number(),
  stepsRemaining: z.number(),
  replansUsed: z.number(),
  elapsedMs: z.number(),
  exhausted: z.boolean(),
  warning: z.boolean(),
});

export type BudgetSnapshotData = z.infer<typeof BudgetSnapshotSchema>;

// ---------------------------------------------------------------------------
// Level 0: Workflow input
// ---------------------------------------------------------------------------

export const WorkflowInputSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  goal: z.string(),
  taskType: z.enum(['task', 'explore']),
  mode: z.enum(['single_shot', 'multi_step']),
});

export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

// ---------------------------------------------------------------------------
// Level 1: After initializeStep
// ---------------------------------------------------------------------------

export const InitializedContextSchema = WorkflowInputSchema.extend({
  currentUrl: z.string(),
  worldContext: z.string(),
});

export type InitializedContext = z.infer<typeof InitializedContextSchema>;

// ---------------------------------------------------------------------------
// Level 2: After planStrategyStep
// ---------------------------------------------------------------------------

export const PlannedContextSchema = InitializedContextSchema.extend({
  intents: z.array(IntentSchema),
  taskMemory: TaskMemorySchema,
  budgetSnapshot: BudgetSnapshotSchema,
  taskComplete: z.boolean(),
  escalated: z.boolean(),
});

export type PlannedContext = z.infer<typeof PlannedContextSchema>;

// ---------------------------------------------------------------------------
// Level 3: agentCycleStep input AND output (same schema — loop feeds back)
// ---------------------------------------------------------------------------

export const CycleSchema = PlannedContextSchema;

export type CycleData = z.infer<typeof CycleSchema>;

// ---------------------------------------------------------------------------
// Level 4: After confirmGoalStep / cleanupStep
// ---------------------------------------------------------------------------

export const TaskResultSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  goal: z.string(),
  taskType: z.enum(['task', 'explore']),
  success: z.boolean(),
  stepsCompleted: z.number(),
});

export type TaskResult = z.infer<typeof TaskResultSchema>;
