import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrategyPlanSchema } from '../src/agent-types.js';
import { planStrategy } from '../src/planner.js';

function mockAgent(returnValue: unknown) {
  return { extract: vi.fn().mockResolvedValue(returnValue) };
}

describe('planStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid StrategyPlan for a simple goal', async () => {
    const agent = mockAgent({
      goal: 'click Settings',
      intents: [{
        id: 'intent_1',
        description: 'Click the Settings button',
        successCriteria: 'Settings page is visible',
        status: 'pending',
        confidence: 0,
      }],
    });

    const { plan, prompt } = await planStrategy(agent, 'click Settings', '', 'https://example.com');

    const parsed = StrategyPlanSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    expect(plan.goal).toBe('click Settings');
    expect(plan.intents).toHaveLength(1);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('returns multiple intents for a complex goal', async () => {
    const agent = mockAgent({
      goal: 'Log in and export report',
      intents: [
        { id: 'intent_1', description: 'Log in', successCriteria: 'Dashboard visible', status: 'pending', confidence: 0 },
        { id: 'intent_2', description: 'Export report', successCriteria: 'Download started', status: 'pending', confidence: 0 },
      ],
    });

    const { plan } = await planStrategy(agent, 'Log in and export report', '', 'https://example.com');
    expect(plan.intents.length).toBeGreaterThan(1);
  });

  it('passes goal and context to agent.extract', async () => {
    const agent = mockAgent({
      goal: 'test goal',
      intents: [{ id: 'i1', description: 'Do it', successCriteria: 'Done', status: 'pending', confidence: 0 }],
    });

    await planStrategy(agent, 'test goal', 'some context', 'https://app.com/page');

    expect(agent.extract).toHaveBeenCalledTimes(1);
    const prompt = agent.extract.mock.calls[0][0];
    expect(prompt).toContain('test goal');
    expect(prompt).toContain('some context');
    expect(prompt).toContain('https://app.com/page');
  });

  it('falls back to single intent on extract failure', async () => {
    const agent = { extract: vi.fn().mockRejectedValue(new Error('LLM failed')) };

    const { plan } = await planStrategy(agent, 'test goal', '', 'https://example.com');

    // Should not throw — falls back gracefully
    expect(plan.goal).toBe('test goal');
    expect(plan.intents).toHaveLength(1);
    expect(plan.intents[0].description).toBe('test goal');
  });

  it('all returned intents have status "pending"', async () => {
    const agent = mockAgent({
      goal: 'do tasks',
      intents: [
        { id: 'i1', description: 'Task 1', successCriteria: 'Done', status: 'pending', confidence: 0 },
        { id: 'i2', description: 'Task 2', successCriteria: 'Done', status: 'pending', confidence: 0 },
      ],
    });

    const { plan } = await planStrategy(agent, 'do tasks', '', 'https://example.com');
    for (const intent of plan.intents) {
      expect(intent.status).toBe('pending');
    }
  });

  it('truncates intents to maxIntents', async () => {
    const agent = mockAgent({
      goal: 'explore everything',
      intents: [
        { id: 'i1', description: 'Step 1', successCriteria: 'Done', status: 'pending', confidence: 0 },
        { id: 'i2', description: 'Step 2', successCriteria: 'Done', status: 'pending', confidence: 0 },
        { id: 'i3', description: 'Step 3', successCriteria: 'Done', status: 'pending', confidence: 0 },
        { id: 'i4', description: 'Step 4', successCriteria: 'Done', status: 'pending', confidence: 0 },
        { id: 'i5', description: 'Step 5', successCriteria: 'Done', status: 'pending', confidence: 0 },
      ],
    });

    const { plan } = await planStrategy(agent, 'explore everything', '', 'https://example.com', 3);
    expect(plan.intents).toHaveLength(3);
    expect(plan.intents[0].id).toBe('i1');
    expect(plan.intents[2].id).toBe('i3');
  });

  it('includes maxIntents value in the prompt', async () => {
    const agent = mockAgent({
      goal: 'test',
      intents: [{ id: 'i1', description: 'Do it', successCriteria: 'Done', status: 'pending', confidence: 0 }],
    });

    await planStrategy(agent, 'test', '', 'https://example.com', 4);

    const prompt = agent.extract.mock.calls[0][0];
    expect(prompt).toContain('4');
    expect(prompt).toContain('high-level intents');
  });

  it('uses default max of 7 when maxIntents is not provided', async () => {
    const manyIntents = Array.from({ length: 10 }, (_, i) => ({
      id: `i${i + 1}`,
      description: `Step ${i + 1}`,
      successCriteria: 'Done',
      status: 'pending' as const,
      confidence: 0,
    }));
    const agent = mockAgent({ goal: 'big task', intents: manyIntents });

    const { plan } = await planStrategy(agent, 'big task', '', 'https://example.com');
    expect(plan.intents).toHaveLength(7);
  });

  it('returns the prompt string used for the LLM call', async () => {
    const agent = mockAgent({
      goal: 'test',
      intents: [{ id: 'i1', description: 'Do it', successCriteria: 'Done', status: 'pending', confidence: 0 }],
    });

    const { prompt } = await planStrategy(agent, 'test', '', 'https://example.com');
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('strategic planner');
  });
});
