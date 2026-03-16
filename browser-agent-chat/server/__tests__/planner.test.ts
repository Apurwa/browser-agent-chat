import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrategyPlanSchema } from '../src/agent-types.js';

const mockCreate = vi.fn();

// Mock the Anthropic SDK — must use a function constructor so `new Anthropic()` works
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

describe('planStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid StrategyPlan for a simple goal', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            goal: 'click Settings',
            intents: [
              {
                id: 'intent_1',
                description: 'Click the Settings button',
                successCriteria: 'Settings page is visible',
                status: 'pending',
                confidence: 0.95,
              },
            ],
          }),
        },
      ],
    });

    const { planStrategy } = await import('../src/planner.js');
    const result = await planStrategy('click Settings', '', 'https://example.com');

    const parsed = StrategyPlanSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.goal).toBe('click Settings');
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0].description).toContain('Settings');
  });

  it('returns multiple intents for a complex goal', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            goal: 'Log in and navigate to the dashboard then export a report',
            intents: [
              {
                id: 'intent_1',
                description: 'Log in to the application',
                successCriteria: 'User is authenticated and dashboard is visible',
                status: 'pending',
                confidence: 0.9,
              },
              {
                id: 'intent_2',
                description: 'Navigate to the Reports section',
                successCriteria: 'Reports page is visible',
                status: 'pending',
                confidence: 0.85,
              },
              {
                id: 'intent_3',
                description: 'Export the report',
                successCriteria: 'Report file download has started',
                status: 'pending',
                confidence: 0.8,
              },
            ],
          }),
        },
      ],
    });

    const { planStrategy } = await import('../src/planner.js');
    const result = await planStrategy(
      'Log in and navigate to the dashboard then export a report',
      'User is on the homepage',
      'https://example.com',
    );

    const parsed = StrategyPlanSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.intents.length).toBeGreaterThan(1);
  });

  it('calls the LLM with the goal included in the prompt', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            goal: 'test goal',
            intents: [
              {
                id: 'intent_1',
                description: 'Do something',
                successCriteria: 'Something is done',
                status: 'pending',
                confidence: 0.9,
              },
            ],
          }),
        },
      ],
    });

    const { planStrategy } = await import('../src/planner.js');
    await planStrategy('test goal', 'some context', 'https://app.com/page');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    // System message should be about strategic planning
    expect(callArgs.system).toContain('strategic planner');
    // User message should include the goal
    const userMessage = callArgs.messages[0].content;
    expect(userMessage).toContain('test goal');
  });

  it('includes worldContext and currentUrl in the prompt when provided', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            goal: 'navigate',
            intents: [
              {
                id: 'intent_1',
                description: 'Navigate somewhere',
                successCriteria: 'Navigation complete',
                status: 'pending',
                confidence: 0.9,
              },
            ],
          }),
        },
      ],
    });

    const { planStrategy } = await import('../src/planner.js');
    await planStrategy('navigate', 'Current page shows login form', 'https://app.com/login');

    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content;
    expect(userMessage).toContain('https://app.com/login');
    expect(userMessage).toContain('Current page shows login form');
  });

  it('all returned intents have status "pending" initially', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            goal: 'do tasks',
            intents: [
              {
                id: 'intent_1',
                description: 'Task 1',
                successCriteria: 'Task 1 done',
                status: 'pending',
                confidence: 0.9,
              },
              {
                id: 'intent_2',
                description: 'Task 2',
                successCriteria: 'Task 2 done',
                status: 'pending',
                confidence: 0.85,
              },
            ],
          }),
        },
      ],
    });

    const { planStrategy } = await import('../src/planner.js');
    const result = await planStrategy('do tasks', '', 'https://example.com');

    for (const intent of result.intents) {
      expect(intent.status).toBe('pending');
    }
  });

  it('throws a descriptive error when LLM call fails', async () => {
    mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

    const { planStrategy } = await import('../src/planner.js');
    await expect(planStrategy('test', '', 'https://example.com')).rejects.toThrow(
      'Failed to plan strategy',
    );
  });
});
