import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  StrategyPlanSchema,
  PerceptionSchema,
  AgentActionSchema,
  ExecutionResultSchema,
  ActionVerificationSchema,
} from '../../agent-types.js';
import { planStrategy } from '../../planner.js';
import { perceive } from '../../perception.js';
import { decideNextAction } from '../../policy.js';
import { executeAction } from '../../executor.js';

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
    const plan = await planStrategy(inputData.goal, '', '');
    return {
      ...plan,
      agentId: inputData.agentId,
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
  execute: async ({ inputData }) => {
    // page is not available in the Mastra workflow context — this step
    // is wired to accept a page via the runtime context when used inside
    // the full integration (Plan 5). For now, return a skeleton perception
    // that correctly picks up the first active intent.
    const activeIntent = inputData.intents.find((i) => i.status === 'pending') ?? null;
    return {
      screenshot: undefined,
      uiElements: [],
      url: '',
      pageTitle: '',
      activeIntent,
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
  execute: async ({ inputData }) => {
    const perception = inputData;
    return decideNextAction(perception, []);
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
  execute: async ({ inputData }) => {
    // agent and page are injected via runtime context in Plan 5 integration.
    // Until then, the step documents the contract and delegates to executeAction
    // with no-op stubs so the workflow chain can be type-checked.
    const noopAgent = {
      act: async (_: string) => {},
      extract: async (_prompt: string, _schema: unknown) => ({}),
    };
    const noopPage = {
      goto: async (_url: string) => {},
      evaluate: async (_fn: unknown) => '',
    };
    return executeAction(noopAgent, noopPage, inputData, []);
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
  execute: async ({ inputData }) => {
    // Verification logic is implemented in Plan 4.
    // For now, pass through based on execution success.
    return {
      passed: inputData.success,
      confidence: inputData.success ? 0.8 : 0.0,
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
