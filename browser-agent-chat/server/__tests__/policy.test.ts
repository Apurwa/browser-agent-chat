import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentActionSchema } from '../src/agent-types.js';
import type { Perception, AgentAction } from '../src/agent-types.js';
import { decideNextAction } from '../src/policy.js';

function mockAgent(returnValue: unknown) {
  return { extract: vi.fn().mockResolvedValue(returnValue) };
}

const samplePerception: Perception = {
  url: 'https://example.com/login',
  pageTitle: 'Login',
  uiElements: [
    { id: 'el_0', role: 'input', label: '', type: 'email', interactable: true },
    { id: 'el_1', role: 'input', label: '', type: 'password', interactable: true },
    { id: 'el_2', role: 'button', label: 'Sign In', type: 'submit', interactable: true },
  ],
  activeIntent: {
    id: 'intent_1',
    description: 'Log in to the application',
    successCriteria: 'Dashboard is visible',
    status: 'active',
    confidence: 0.9,
  },
  relevantMemory: '',
};

describe('decideNextAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid AgentAction', async () => {
    const agent = mockAgent({
      type: 'click',
      elementId: 'el_2',
      expectedOutcome: 'Login form submitted',
      intentId: 'intent_1',
    });

    const result = await decideNextAction(agent, samplePerception, []);

    const parsed = AgentActionSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.type).toBe('click');
  });

  it('passes perception data to agent.extract', async () => {
    const agent = mockAgent({
      type: 'type',
      elementId: 'el_0',
      value: 'user@example.com',
      expectedOutcome: 'Email entered',
      intentId: 'intent_1',
    });

    await decideNextAction(agent, samplePerception, []);

    expect(agent.extract).toHaveBeenCalledTimes(1);
    const prompt = agent.extract.mock.calls[0][0];
    expect(prompt).toContain('https://example.com/login');
    expect(prompt).toContain('el_0');
    expect(prompt).toContain('Log in to the application');
  });

  it('includes step history in the prompt', async () => {
    const stepHistory: AgentAction[] = [{
      type: 'type',
      elementId: 'el_0',
      value: 'user@example.com',
      expectedOutcome: 'Email entered',
      intentId: 'intent_1',
    }];

    const agent = mockAgent({
      type: 'click',
      elementId: 'el_2',
      expectedOutcome: 'Submitted',
      intentId: 'intent_1',
    });

    await decideNextAction(agent, samplePerception, stepHistory);

    const prompt = agent.extract.mock.calls[0][0];
    expect(prompt).toContain('type');
  });

  it('falls back to extract action on failure', async () => {
    const agent = { extract: vi.fn().mockRejectedValue(new Error('LLM failed')) };

    const result = await decideNextAction(agent, samplePerception, []);

    // Should not throw — falls back to extract
    expect(result.type).toBe('extract');
  });

  it('returns action with valid type enum', async () => {
    const agent = mockAgent({
      type: 'navigate',
      value: 'https://example.com/dashboard',
      expectedOutcome: 'Navigated',
      intentId: 'intent_1',
    });

    const result = await decideNextAction(agent, samplePerception, []);
    expect(['click', 'type', 'scroll', 'select', 'submit', 'extract', 'navigate']).toContain(result.type);
  });
});
