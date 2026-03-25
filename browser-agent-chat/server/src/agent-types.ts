import { z } from 'zod';

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export const IntentSchema = z.object({
  id: z.string(),
  description: z.string(),
  successCriteria: z.string(),
  status: z.enum(['pending', 'active', 'completed', 'failed']),
  confidence: z.number().min(0).max(1),
});

export type Intent = z.infer<typeof IntentSchema>;

// ---------------------------------------------------------------------------
// Strategy Plan
// ---------------------------------------------------------------------------

export const StrategyPlanSchema = z.object({
  goal: z.string(),
  intents: z.array(IntentSchema),
});

export type StrategyPlan = z.infer<typeof StrategyPlanSchema>;

// ---------------------------------------------------------------------------
// Agent Action
// ---------------------------------------------------------------------------

export const AgentActionSchema = z.object({
  type: z.enum(['click', 'type', 'scroll', 'select', 'submit', 'extract', 'navigate']),
  elementId: z.string().optional(),
  value: z.string().optional(),
  expectedOutcome: z.string(),
  intentId: z.string(),
});

export type AgentAction = z.infer<typeof AgentActionSchema>;

// ---------------------------------------------------------------------------
// UI Element
// ---------------------------------------------------------------------------

export const UIElementSchema = z.object({
  id: z.string(),
  role: z.string(),
  label: z.string(),
  type: z.string().optional(),
  interactable: z.boolean(),
});

export type UIElement = z.infer<typeof UIElementSchema>;

// ---------------------------------------------------------------------------
// Perception
// ---------------------------------------------------------------------------

export const PerceptionSchema = z.object({
  screenshot: z.string().optional(),
  uiElements: z.array(UIElementSchema),
  url: z.string(),
  pageTitle: z.string(),
  activeIntent: IntentSchema.nullable(),
  relevantMemory: z.string(),
});

export type Perception = z.infer<typeof PerceptionSchema>;

// ---------------------------------------------------------------------------
// Execution Result
// ---------------------------------------------------------------------------

export const ExecutionResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  newUrl: z.string().optional(),
  error: z.string().optional(),
});

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

// ---------------------------------------------------------------------------
// Action Verification
// ---------------------------------------------------------------------------

export const ActionVerificationSchema = z.object({
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  findings: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      severity: z.string(),
    })
  ),
});

export type ActionVerification = z.infer<typeof ActionVerificationSchema>;

// ---------------------------------------------------------------------------
// Intent Verification
// ---------------------------------------------------------------------------

export const IntentVerificationSchema = z.object({
  intentId: z.string(),
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type IntentVerification = z.infer<typeof IntentVerificationSchema>;

// ---------------------------------------------------------------------------
// Goal Confirmation
// ---------------------------------------------------------------------------

export const GoalConfirmationSchema = z.object({
  achieved: z.boolean(),
  remainingWork: z.string().optional(),
});

export type GoalConfirmation = z.infer<typeof GoalConfirmationSchema>;

// ---------------------------------------------------------------------------
// Agent Budget
// ---------------------------------------------------------------------------

export const AgentBudgetSchema = z.object({
  maxSteps: z.number().int().positive().default(50),
  maxStepsPerIntent: z.number().int().positive().default(20),
  maxTokens: z.number().int().positive().default(100_000),
  maxTimeMs: z.number().int().positive().default(300_000),
  maxCostUsd: z.number().positive().default(0.5),
  maxRetries: z.number().int().nonnegative().default(3),
  maxReplanAttempts: z.number().int().nonnegative().default(3),
});

export type AgentBudget = z.infer<typeof AgentBudgetSchema>;

// ---------------------------------------------------------------------------
// Stuck Signals
// ---------------------------------------------------------------------------

export const StuckSignalsSchema = z.object({
  repeatedActionCount: z.number().int().nonnegative().default(0),
  samePageCount: z.number().int().nonnegative().default(0),
  failedExecutionCount: z.number().int().nonnegative().default(0),
  stepsSinceProgress: z.number().int().nonnegative().default(0),
});

export type StuckSignals = z.infer<typeof StuckSignalsSchema>;

// ---------------------------------------------------------------------------
// Task Memory
// ---------------------------------------------------------------------------

export const TaskMemorySchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  intents: z.array(IntentSchema),
  visitedPages: z.array(z.string()),
  actionsAttempted: z.array(AgentActionSchema),
  failedActions: z.array(AgentActionSchema),
  replanCount: z.number().int().nonnegative(),
  progressScore: z.number().min(0).max(1),
  stuckSignals: StuckSignalsSchema,
});

export type TaskMemory = z.infer<typeof TaskMemorySchema>;

// ---------------------------------------------------------------------------
// Frontier Item
// ---------------------------------------------------------------------------

export const FrontierItemSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  targetUrlHash: z.string().optional(),
  elementLabel: z.string(),
  action: z.string(),
  priority: z.number(),
  intentRelevance: z.number().min(0).max(1).optional(),
  discoveredAtStep: z.number().int().nonnegative(),
  explored: z.boolean().default(false),
  persistent: z.boolean().default(false),
  category: z.enum(['navigation', 'form', 'modal', 'button', 'link']),
});

export type FrontierItem = z.infer<typeof FrontierItemSchema>;

// ---------------------------------------------------------------------------
// UI Anchor
// ---------------------------------------------------------------------------

export const UIAnchorSchema = z.object({
  type: z.enum(['label', 'role', 'selector', 'placeholder']),
  value: z.string(),
  pageUrl: z.string(),
});

export type UIAnchor = z.infer<typeof UIAnchorSchema>;

// ---------------------------------------------------------------------------
// Condition
// ---------------------------------------------------------------------------

export const ConditionSchema = z.object({
  type: z.enum(['ui_state', 'data_state']),
  expression: z.string(),
});

export type Condition = z.infer<typeof ConditionSchema>;

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export const SkillSchema = z.object({
  id: z.string(),
  appId: z.string(),
  name: z.string(),
  intent: z.string(),
  steps: z.array(z.string()),
  anchors: z.array(UIAnchorSchema),
  preconditions: z.array(ConditionSchema),
  successCriteria: z.string(),
  successRate: z.number().min(0).max(1).default(1),
  executionCount: z.number().int().nonnegative().default(0),
  lastUsed: z.string().datetime().optional(),
  learnedFrom: z.enum(['auto', 'user']),
});

export type Skill = z.infer<typeof SkillSchema>;

// ---------------------------------------------------------------------------
// Progress Weights (constant)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Trace Failure
// ---------------------------------------------------------------------------

export interface TraceFailure {
  errorType:
    | 'element_not_found'
    | 'element_not_interactable'
    | 'navigation_timeout'
    | 'llm_parse_error'
    | 'llm_hallucination'
    | 'page_context_lost'
    | 'login_required'
    | 'extraction_empty'
    | 'budget_exhausted'
    | 'stuck_loop'
    | 'unknown';
  errorMessage: string;
}

// ---------------------------------------------------------------------------
// Progress Weights (constant)
// ---------------------------------------------------------------------------

export const PROGRESS_WEIGHTS = {
  goalProgress: 5,
  newPage: 3,
  newElements: 1,
  flowStep: 2,
  formPresence: 2,
  modalTrigger: 2,
} as const;

// ---------------------------------------------------------------------------
// Evaluate Progress Decision
// ---------------------------------------------------------------------------

export type EvaluateProgressDecision =
  | 'continue'
  | 'retry_action'
  | 'replan'
  | 'done'
  | 'escalate_to_user';
