import { describe, it, expect } from 'vitest';

describe('agent-task workflow skeleton', () => {
  it('exports agentTaskWorkflow', async () => {
    const { agentTaskWorkflow } = await import('../src/mastra/workflows/agent-task.js');
    expect(agentTaskWorkflow).toBeDefined();
  });

  it('has the correct workflow id', async () => {
    const { agentTaskWorkflow } = await import('../src/mastra/workflows/agent-task.js');
    expect(agentTaskWorkflow.id).toBe('agent-task');
  });

  it('has inputSchema defined', async () => {
    const { agentTaskWorkflow } = await import('../src/mastra/workflows/agent-task.js');
    expect(agentTaskWorkflow.inputSchema).toBeDefined();
  });

  it('has outputSchema defined', async () => {
    const { agentTaskWorkflow } = await import('../src/mastra/workflows/agent-task.js');
    expect(agentTaskWorkflow.outputSchema).toBeDefined();
  });

  it('exports all step definitions', async () => {
    const { planStrategyStep, perceiveStep, decideActionStep, executeStep, verifyActionStep } =
      await import('../src/mastra/workflows/agent-task.js');
    expect(planStrategyStep).toBeDefined();
    expect(planStrategyStep.id).toBe('plan-strategy');
    expect(perceiveStep).toBeDefined();
    expect(perceiveStep.id).toBe('perceive');
    expect(decideActionStep).toBeDefined();
    expect(decideActionStep.id).toBe('decide-action');
    expect(executeStep).toBeDefined();
    expect(executeStep.id).toBe('execute');
    expect(verifyActionStep).toBeDefined();
    expect(verifyActionStep.id).toBe('verify-action');
  });
});
