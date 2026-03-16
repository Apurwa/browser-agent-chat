import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  StrategyPlanSchema,
  PerceptionSchema,
  AgentActionSchema,
  ExecutionResultSchema,
  ActionVerificationSchema,
} from '../../agent-types.js';

// ---------------------------------------------------------------------------
// Shared workflow input schema
// ---------------------------------------------------------------------------

const WorkflowInputSchema = z.object({
  goal: z.string().describe('High-level user task description'),
  agentId: z.string().describe('Agent session identifier'),
});

// ---------------------------------------------------------------------------
// Step: plan-strategy
// Input: workflow input → Output: StrategyPlan + passthrough agentId
// ---------------------------------------------------------------------------

const PlanStrategyOutputSchema = StrategyPlanSchema.extend({
  agentId: z.string(),
});

export const planStrategyStep = createStep({
  id: 'plan-strategy',
  description: 'Decompose the user goal into a prioritised list of intents',
  inputSchema: WorkflowInputSchema,
  outputSchema: PlanStrategyOutputSchema,
  execute: async ({ inputData }) => {
    // Placeholder — Plan 2
    return {
      goal: inputData.goal,
      agentId: inputData.agentId,
      intents: [],
    };
  },
});

// ---------------------------------------------------------------------------
// Step: perceive
// Input: PlanStrategyOutput → Output: Perception snapshot
// ---------------------------------------------------------------------------

export const perceiveStep = createStep({
  id: 'perceive',
  description: 'Capture the current UI state and active intent context',
  inputSchema: PlanStrategyOutputSchema,
  outputSchema: PerceptionSchema,
  execute: async (_params) => {
    // Placeholder — Plan 2
    return {
      screenshot: undefined,
      uiElements: [],
      url: '',
      pageTitle: '',
      activeIntent: null,
      relevantMemory: '',
    };
  },
});

// ---------------------------------------------------------------------------
// Step: decide-action
// Input: Perception → Output: AgentAction to execute
// ---------------------------------------------------------------------------

export const decideActionStep = createStep({
  id: 'decide-action',
  description: 'Choose the next browser action to take given the current perception',
  inputSchema: PerceptionSchema,
  outputSchema: AgentActionSchema,
  execute: async (_params) => {
    // Placeholder — Plan 2
    return {
      type: 'navigate' as const,
      expectedOutcome: 'placeholder',
      intentId: '',
    };
  },
});

// ---------------------------------------------------------------------------
// Step: execute
// Input: AgentAction → Output: ExecutionResult
// ---------------------------------------------------------------------------

export const executeStep = createStep({
  id: 'execute',
  description: 'Execute the decided browser action via Magnitude',
  inputSchema: AgentActionSchema,
  outputSchema: ExecutionResultSchema,
  execute: async (_params) => {
    // Placeholder — Plan 2
    return {
      success: false,
    };
  },
});

// ---------------------------------------------------------------------------
// Step: verify-action
// Input: ExecutionResult → Output: ActionVerification
// ---------------------------------------------------------------------------

export const verifyActionStep = createStep({
  id: 'verify-action',
  description: 'Verify that the executed action produced the expected outcome',
  inputSchema: ExecutionResultSchema,
  outputSchema: ActionVerificationSchema,
  execute: async (_params) => {
    // Placeholder — Plan 2
    return {
      passed: false,
      confidence: 0,
      findings: [],
    };
  },
});

// ---------------------------------------------------------------------------
// Workflow assembly
// ---------------------------------------------------------------------------

export const agentTaskWorkflow = createWorkflow({
  id: 'agent-task',
  description: 'End-to-end agent loop: plan → perceive → decide → execute → verify',
  inputSchema: WorkflowInputSchema,
  outputSchema: ActionVerificationSchema,
  steps: [planStrategyStep, perceiveStep, decideActionStep, executeStep, verifyActionStep],
})
  .then(planStrategyStep)
  .then(perceiveStep)
  .then(decideActionStep)
  .then(executeStep)
  .then(verifyActionStep)
  .commit();
