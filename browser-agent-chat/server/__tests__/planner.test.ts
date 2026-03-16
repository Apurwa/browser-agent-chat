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

    const result = await planStrategy(agent, 'click Settings', '', 'https://example.com');

    const parsed = StrategyPlanSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.goal).toBe('click Settings');
    expect(result.intents).toHaveLength(1);
  });

  it('returns multiple intents for a complex goal', async () => {
    const agent = mockAgent({
      goal: 'Log in and export report',
      intents: [
        { id: 'intent_1', description: 'Log in', successCriteria: 'Dashboard visible', status: 'pending', confidence: 0 },
        { id: 'intent_2', description: 'Export report', successCriteria: 'Download started', status: 'pending', confidence: 0 },
      ],
    });

    const result = await planStrategy(agent, 'Log in and export report', '', 'https://example.com');
    expect(result.intents.length).toBeGreaterThan(1);
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

    const result = await planStrategy(agent, 'test goal', '', 'https://example.com');

    // Should not throw — falls back gracefully
    expect(result.goal).toBe('test goal');
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0].description).toBe('test goal');
  });

  it('all returned intents have status "pending"', async () => {
    const agent = mockAgent({
      goal: 'do tasks',
      intents: [
        { id: 'i1', description: 'Task 1', successCriteria: 'Done', status: 'pending', confidence: 0 },
        { id: 'i2', description: 'Task 2', successCriteria: 'Done', status: 'pending', confidence: 0 },
      ],
    });

    const result = await planStrategy(agent, 'do tasks', '', 'https://example.com');
    for (const intent of result.intents) {
      expect(intent.status).toBe('pending');
    }
  });
});
