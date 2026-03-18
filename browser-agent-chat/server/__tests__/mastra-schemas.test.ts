import { describe, it, expect } from 'vitest';
import {
  BudgetSnapshotSchema,
  WorkflowInputSchema,
  InitializedContextSchema,
  PlannedContextSchema,
  CycleSchema,
  TaskResultSchema,
} from '../src/mastra/schemas.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validBudgetSnapshot = {
  stepsUsed: 5,
  stepsRemaining: 15,
  replansUsed: 0,
  elapsedMs: 12000,
  exhausted: false,
  warning: false,
};

const validWorkflowInput = {
  sessionId: 'sess-001',
  agentId: 'agent-001',
  goal: 'Navigate to settings',
  taskType: 'task' as const,
  mode: 'multi_step' as const,
};

const validInitializedContext = {
  ...validWorkflowInput,
  currentUrl: 'https://example.com/dashboard',
  worldContext: 'WORLD MODEL — KNOWN PAGES:...',
};

const validIntent = {
  id: 'intent-1',
  description: 'Open the settings page',
  successCriteria: 'Settings page is visible',
  status: 'pending' as const,
  confidence: 0,
};

const validTaskMemory = {
  taskId: 'task-001',
  goal: 'Navigate to settings',
  intents: [validIntent],
  visitedPages: ['https://example.com/dashboard'],
  actionsAttempted: [],
  failedActions: [],
  replanCount: 0,
  progressScore: 0,
  stuckSignals: {
    repeatedActionCount: 0,
    samePageCount: 0,
    failedExecutionCount: 0,
    stepsSinceProgress: 0,
  },
};

const validPlannedContext = {
  ...validInitializedContext,
  intents: [validIntent],
  taskMemory: validTaskMemory,
  budgetSnapshot: validBudgetSnapshot,
  taskComplete: false,
  escalated: false,
};

const validTaskResult = {
  sessionId: 'sess-001',
  agentId: 'agent-001',
  goal: 'Navigate to settings',
  taskType: 'task' as const,
  success: true,
  stepsCompleted: 5,
};

// ---------------------------------------------------------------------------
// BudgetSnapshotSchema
// ---------------------------------------------------------------------------

describe('BudgetSnapshotSchema', () => {
  it('parses valid data', () => {
    const result = BudgetSnapshotSchema.parse(validBudgetSnapshot);
    expect(result).toEqual(validBudgetSnapshot);
  });

  it('rejects missing fields', () => {
    expect(() => BudgetSnapshotSchema.parse({ stepsUsed: 5 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WorkflowInputSchema
// ---------------------------------------------------------------------------

describe('WorkflowInputSchema', () => {
  it('parses valid data', () => {
    const result = WorkflowInputSchema.parse(validWorkflowInput);
    expect(result).toEqual(validWorkflowInput);
  });

  it('accepts explore taskType', () => {
    const input = { ...validWorkflowInput, taskType: 'explore' };
    const result = WorkflowInputSchema.parse(input);
    expect(result.taskType).toBe('explore');
  });

  it('accepts single_shot mode', () => {
    const input = { ...validWorkflowInput, mode: 'single_shot' };
    const result = WorkflowInputSchema.parse(input);
    expect(result.mode).toBe('single_shot');
  });

  it('rejects invalid taskType', () => {
    const input = { ...validWorkflowInput, taskType: 'unknown' };
    expect(() => WorkflowInputSchema.parse(input)).toThrow();
  });

  it('rejects invalid mode', () => {
    const input = { ...validWorkflowInput, mode: 'parallel' };
    expect(() => WorkflowInputSchema.parse(input)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// InitializedContextSchema
// ---------------------------------------------------------------------------

describe('InitializedContextSchema', () => {
  it('parses valid data extending WorkflowInput', () => {
    const result = InitializedContextSchema.parse(validInitializedContext);
    expect(result.currentUrl).toBe('https://example.com/dashboard');
    expect(result.sessionId).toBe('sess-001');
  });

  it('rejects when currentUrl is missing', () => {
    expect(() => InitializedContextSchema.parse(validWorkflowInput)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PlannedContextSchema
// ---------------------------------------------------------------------------

describe('PlannedContextSchema', () => {
  it('parses valid data extending InitializedContext', () => {
    const result = PlannedContextSchema.parse(validPlannedContext);
    expect(result.intents).toHaveLength(1);
    expect(result.taskComplete).toBe(false);
    expect(result.escalated).toBe(false);
    expect(result.budgetSnapshot.stepsUsed).toBe(5);
  });

  it('rejects when intents are missing', () => {
    const data = { ...validInitializedContext, taskComplete: false, escalated: false };
    expect(() => PlannedContextSchema.parse(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CycleSchema
// ---------------------------------------------------------------------------

describe('CycleSchema', () => {
  it('is the same schema as PlannedContextSchema (loop feeds back)', () => {
    const result = CycleSchema.parse(validPlannedContext);
    expect(result).toEqual(PlannedContextSchema.parse(validPlannedContext));
  });
});

// ---------------------------------------------------------------------------
// TaskResultSchema
// ---------------------------------------------------------------------------

describe('TaskResultSchema', () => {
  it('parses valid data', () => {
    const result = TaskResultSchema.parse(validTaskResult);
    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toBe(5);
  });

  it('rejects when success is missing', () => {
    const { success, ...partial } = validTaskResult;
    expect(() => TaskResultSchema.parse(partial)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Schema chain extends correctly
// ---------------------------------------------------------------------------

describe('schema chain extends correctly', () => {
  it('WorkflowInput fields are present in InitializedContext', () => {
    const result = InitializedContextSchema.parse(validInitializedContext);
    expect(result.sessionId).toBe('sess-001');
    expect(result.agentId).toBe('agent-001');
    expect(result.goal).toBe('Navigate to settings');
    expect(result.taskType).toBe('task');
    expect(result.mode).toBe('multi_step');
  });

  it('InitializedContext fields are present in PlannedContext', () => {
    const result = PlannedContextSchema.parse(validPlannedContext);
    expect(result.currentUrl).toBe('https://example.com/dashboard');
    expect(result.worldContext).toContain('WORLD MODEL');
  });

  it('all base fields survive through the full chain', () => {
    const result = CycleSchema.parse(validPlannedContext);
    // WorkflowInput fields
    expect(result.sessionId).toBeDefined();
    expect(result.agentId).toBeDefined();
    expect(result.goal).toBeDefined();
    // InitializedContext fields
    expect(result.currentUrl).toBeDefined();
    expect(result.worldContext).toBeDefined();
    // PlannedContext fields
    expect(result.intents).toBeDefined();
    expect(result.taskMemory).toBeDefined();
    expect(result.budgetSnapshot).toBeDefined();
  });
});
