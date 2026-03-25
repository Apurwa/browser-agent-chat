import { createWorkflow } from '@mastra/core/workflows';
import { WorkflowInputSchema, TaskResultSchema } from '../schemas.js';
import { initializeStep } from '../steps/initialize.js';
import { executeSingleShotStep } from '../steps/execute-single-shot.js';
import { cleanupStep } from '../steps/cleanup.js';

// ---------------------------------------------------------------------------
// Single-shot workflow
//
// Flow: initialize -> execute-single-shot -> cleanup
//
// Simpler variant for one-off tasks where agent.act(goal) is sufficient.
// No planning, no loop, no verification cycle.
// ---------------------------------------------------------------------------

export const singleShotWorkflow = createWorkflow({
  id: 'agent-task-singleshot',
  inputSchema: WorkflowInputSchema,
  outputSchema: TaskResultSchema,
  steps: [initializeStep, executeSingleShotStep, cleanupStep],
})
  .then(initializeStep)
  .then(executeSingleShotStep)
  .then(cleanupStep)
  .commit();
