import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentActionSchema } from '../src/agent-types.js';
import type { Perception, AgentAction } from '../src/agent-types.js';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  function Anthropic() {
    return {
      messages: {
        create: mockCreate,
      },
    };
  }
  return { default: Anthropic };
});

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
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            type: 'click',
            elementId: 'el_2',
            value: undefined,
            expectedOutcome: 'Login form submitted',
            intentId: 'intent_1',
          }),
        },
      ],
    });

    const { decideNextAction } = await import('../src/policy.js');
    const result = await decideNextAction(samplePerception, []);

    const parsed = AgentActionSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('calls LLM with the perception data in the prompt', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            type: 'type',
            elementId: 'el_0',
            value: 'user@example.com',
            expectedOutcome: 'Email entered',
            intentId: 'intent_1',
          }),
        },
      ],
    });

    const { decideNextAction } = await import('../src/policy.js');
    await decideNextAction(samplePerception, []);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content;

    // Should include the URL
    expect(userMessage).toContain('https://example.com/login');
    // Should include UI elements
    expect(userMessage).toContain('el_0');
  });

  it('includes the active intent in the prompt', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            type: 'click',
            elementId: 'el_2',
            expectedOutcome: 'Submitted',
            intentId: 'intent_1',
          }),
        },
      ],
    });

    const { decideNextAction } = await import('../src/policy.js');
    await decideNextAction(samplePerception, []);

    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content;
    expect(userMessage).toContain('Log in to the application');
  });

  it('includes step history in the prompt when provided', async () => {
    const stepHistory: AgentAction[] = [
      {
        type: 'type',
        elementId: 'el_0',
        value: 'user@example.com',
        expectedOutcome: 'Email entered',
        intentId: 'intent_1',
      },
    ];

    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            type: 'click',
            elementId: 'el_2',
            expectedOutcome: 'Submitted',
            intentId: 'intent_1',
          }),
        },
      ],
    });

    const { decideNextAction } = await import('../src/policy.js');
    await decideNextAction(samplePerception, stepHistory);

    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content;
    // History should be included somehow
    expect(userMessage).toContain('type');
  });

  it('returns action with valid type enum value', async () => {
    const actionTypes = ['click', 'type', 'scroll', 'select', 'submit', 'extract', 'navigate'];

    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            type: 'navigate',
            value: 'https://example.com/dashboard',
            expectedOutcome: 'Navigated to dashboard',
            intentId: 'intent_1',
          }),
        },
      ],
    });

    const { decideNextAction } = await import('../src/policy.js');
    const result = await decideNextAction(samplePerception, []);

    expect(actionTypes).toContain(result.type);
  });

  it('throws a descriptive error when LLM call fails', async () => {
    mockCreate.mockRejectedValue(new Error('Connection timeout'));

    const { decideNextAction } = await import('../src/policy.js');
    await expect(decideNextAction(samplePerception, [])).rejects.toThrow('Failed to decide action');
  });
});
