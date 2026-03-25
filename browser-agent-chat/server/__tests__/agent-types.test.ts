import { describe, it, expect } from 'vitest';
import {
  StrategyPlanSchema,
  AgentActionSchema,
  AgentBudgetSchema,
  FrontierItemSchema,
  SkillSchema,
  IntentSchema,
} from '../src/agent-types.js';

describe('StrategyPlanSchema', () => {
  it('validates a correct strategy plan', () => {
    const plan = {
      goal: 'Log into the application',
      intents: [
        {
          id: 'intent-1',
          description: 'Navigate to login page',
          successCriteria: 'Login form is visible',
          status: 'pending',
          confidence: 0.9,
        },
      ],
    };
    const result = StrategyPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });
});

describe('AgentActionSchema', () => {
  it('validates a click action', () => {
    const action = {
      type: 'click',
      elementId: 'btn-login',
      expectedOutcome: 'Form submits',
      intentId: 'intent-1',
    };
    const result = AgentActionSchema.safeParse(action);
    expect(result.success).toBe(true);
  });

  it('validates a navigate action', () => {
    const action = {
      type: 'navigate',
      value: 'https://example.com',
      expectedOutcome: 'Page loads',
      intentId: 'intent-1',
    };
    const result = AgentActionSchema.safeParse(action);
    expect(result.success).toBe(true);
  });

  it('rejects an invalid action type', () => {
    const action = {
      type: 'hover',
      expectedOutcome: 'Tooltip appears',
      intentId: 'intent-1',
    };
    const result = AgentActionSchema.safeParse(action);
    expect(result.success).toBe(false);
  });
});

describe('AgentBudgetSchema', () => {
  it('provides default values when given empty object', () => {
    const result = AgentBudgetSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxSteps).toBe(50);
      expect(result.data.maxStepsPerIntent).toBe(20);
      expect(result.data.maxTokens).toBe(100_000);
      expect(result.data.maxTimeMs).toBe(300_000);
      expect(result.data.maxCostUsd).toBe(0.5);
      expect(result.data.maxRetries).toBe(3);
      expect(result.data.maxReplanAttempts).toBe(3);
    }
  });

  it('accepts overridden values', () => {
    const result = AgentBudgetSchema.safeParse({ maxSteps: 100 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxSteps).toBe(100);
    }
  });
});

describe('FrontierItemSchema', () => {
  it('validates a frontier item with defaults', () => {
    const item = {
      id: 'frontier-1',
      pageId: 'page-home',
      elementLabel: 'Submit button',
      action: 'click',
      priority: 1,
      discoveredAtStep: 3,
      category: 'button',
    };
    const result = FrontierItemSchema.safeParse(item);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.explored).toBe(false);
      expect(result.data.persistent).toBe(false);
    }
  });

  it('rejects invalid category', () => {
    const item = {
      id: 'frontier-1',
      pageId: 'page-home',
      elementLabel: 'Submit button',
      action: 'click',
      priority: 1,
      discoveredAtStep: 3,
      category: 'unknown',
    };
    const result = FrontierItemSchema.safeParse(item);
    expect(result.success).toBe(false);
  });
});

describe('SkillSchema', () => {
  it('validates a skill with defaults', () => {
    const skill = {
      id: 'skill-login',
      appId: 'app-1',
      name: 'Login to App',
      intent: 'Authenticate the user',
      steps: ['click login button', 'fill credentials', 'submit'],
      anchors: [],
      preconditions: [],
      successCriteria: 'User is logged in',
      learnedFrom: 'auto',
    };
    const result = SkillSchema.safeParse(skill);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.successRate).toBe(1);
      expect(result.data.executionCount).toBe(0);
    }
  });

  it('rejects invalid learnedFrom value', () => {
    const skill = {
      id: 'skill-login',
      appId: 'app-1',
      name: 'Login to App',
      intent: 'Authenticate the user',
      steps: ['click login button'],
      anchors: [],
      preconditions: [],
      successCriteria: 'User is logged in',
      learnedFrom: 'magic',
    };
    const result = SkillSchema.safeParse(skill);
    expect(result.success).toBe(false);
  });
});

describe('IntentSchema', () => {
  it('validates a pending intent', () => {
    const intent = {
      id: 'intent-1',
      description: 'Fill login form',
      successCriteria: 'Redirected to dashboard',
      status: 'pending',
      confidence: 0.85,
    };
    const result = IntentSchema.safeParse(intent);
    expect(result.success).toBe(true);
  });

  it('rejects confidence out of range', () => {
    const intent = {
      id: 'intent-1',
      description: 'Fill login form',
      successCriteria: 'Redirected to dashboard',
      status: 'pending',
      confidence: 1.5,
    };
    const result = IntentSchema.safeParse(intent);
    expect(result.success).toBe(false);
  });
});
