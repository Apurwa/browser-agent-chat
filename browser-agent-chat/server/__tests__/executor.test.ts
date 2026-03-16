import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionResultSchema } from '../src/agent-types.js';
import type { AgentAction } from '../src/agent-types.js';

/** Build a mock Magnitude BrowserAgent */
function makeMockAgent() {
  return {
    act: vi.fn(async (_instruction: string) => undefined),
    extract: vi.fn(async (_prompt: string, _schema: unknown) => ({ data: 'extracted' })),
  };
}

/** Build a mock Playwright page */
function makeMockPage(currentUrl = 'https://example.com/result') {
  return {
    goto: vi.fn(async (_url: string) => undefined),
    evaluate: vi.fn(async (_fn: unknown) => currentUrl),
  };
}

describe('executeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('translates click action to agent.act("click on ...")', async () => {
    const agent = makeMockAgent();
    const page = makeMockPage();

    const action: AgentAction = {
      type: 'click',
      elementId: 'el_2',
      expectedOutcome: 'Button clicked',
      intentId: 'intent_1',
    };

    // Need to peek at the uiElements to resolve labels — inject a perception fixture
    const perception = {
      uiElements: [
        { id: 'el_0', role: 'input', label: 'Email', type: 'email', interactable: true },
        { id: 'el_2', role: 'button', label: 'Submit', type: 'submit', interactable: true },
      ],
    };

    const { executeAction } = await import('../src/executor.js');
    const result = await executeAction(agent, page, action, perception.uiElements);

    expect(agent.act).toHaveBeenCalledWith(expect.stringContaining('Submit'));
    expect(result.success).toBe(true);
  });

  it('translates type action to agent.act("type ... into ...")', async () => {
    const agent = makeMockAgent();
    const page = makeMockPage();

    const action: AgentAction = {
      type: 'type',
      elementId: 'el_0',
      value: 'hello@example.com',
      expectedOutcome: 'Email typed',
      intentId: 'intent_1',
    };

    const uiElements = [
      { id: 'el_0', role: 'input', label: 'Email field', type: 'email', interactable: true },
    ];

    const { executeAction } = await import('../src/executor.js');
    const result = await executeAction(agent, page, action, uiElements);

    expect(agent.act).toHaveBeenCalledWith(expect.stringContaining('hello@example.com'));
    expect(agent.act).toHaveBeenCalledWith(expect.stringContaining('Email field'));
    expect(result.success).toBe(true);
  });

  it('translates scroll action to agent.act("scroll down")', async () => {
    const agent = makeMockAgent();
    const page = makeMockPage();

    const action: AgentAction = {
      type: 'scroll',
      expectedOutcome: 'Page scrolled',
      intentId: 'intent_1',
    };

    const { executeAction } = await import('../src/executor.js');
    await executeAction(agent, page, action, []);

    expect(agent.act).toHaveBeenCalledWith('scroll down');
  });

  it('translates navigate action to page.goto', async () => {
    const agent = makeMockAgent();
    const page = makeMockPage('https://example.com/dashboard');

    const action: AgentAction = {
      type: 'navigate',
      value: 'https://example.com/dashboard',
      expectedOutcome: 'Navigated to dashboard',
      intentId: 'intent_1',
    };

    const { executeAction } = await import('../src/executor.js');
    const result = await executeAction(agent, page, action, []);

    expect(page.goto).toHaveBeenCalledWith('https://example.com/dashboard');
    expect(result.success).toBe(true);
    expect(result.newUrl).toBe('https://example.com/dashboard');
  });

  it('translates submit action to agent.act("click the submit button")', async () => {
    const agent = makeMockAgent();
    const page = makeMockPage();

    const action: AgentAction = {
      type: 'submit',
      expectedOutcome: 'Form submitted',
      intentId: 'intent_1',
    };

    const { executeAction } = await import('../src/executor.js');
    await executeAction(agent, page, action, []);

    expect(agent.act).toHaveBeenCalledWith('click the submit button');
  });

  it('translates select action to agent.act("select ... from ...")', async () => {
    const agent = makeMockAgent();
    const page = makeMockPage();

    const action: AgentAction = {
      type: 'select',
      elementId: 'el_3',
      value: 'Option B',
      expectedOutcome: 'Option selected',
      intentId: 'intent_1',
    };

    const uiElements = [
      { id: 'el_3', role: 'select', label: 'Category dropdown', type: undefined, interactable: true },
    ];

    const { executeAction } = await import('../src/executor.js');
    const result = await executeAction(agent, page, action, uiElements);

    expect(agent.act).toHaveBeenCalledWith(expect.stringContaining('Option B'));
    expect(agent.act).toHaveBeenCalledWith(expect.stringContaining('Category dropdown'));
    expect(result.success).toBe(true);
  });

  it('returns newUrl after action via page.evaluate', async () => {
    const agent = makeMockAgent();
    const page = makeMockPage('https://example.com/after-click');

    const action: AgentAction = {
      type: 'click',
      elementId: 'el_0',
      expectedOutcome: 'Navigated',
      intentId: 'intent_1',
    };

    const uiElements = [
      { id: 'el_0', role: 'a', label: 'Next Page', type: undefined, interactable: true },
    ];

    const { executeAction } = await import('../src/executor.js');
    const result = await executeAction(agent, page, action, uiElements);

    expect(result.newUrl).toBe('https://example.com/after-click');
  });

  it('returns ExecutionResult with success=false on error', async () => {
    const agent = makeMockAgent();
    agent.act = vi.fn().mockRejectedValue(new Error('Element not found'));
    const page = makeMockPage();

    const action: AgentAction = {
      type: 'click',
      elementId: 'el_99',
      expectedOutcome: 'Clicked',
      intentId: 'intent_1',
    };

    const { executeAction } = await import('../src/executor.js');
    const result = await executeAction(agent, page, action, []);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Element not found');
  });

  it('result conforms to ExecutionResultSchema', async () => {
    const agent = makeMockAgent();
    const page = makeMockPage();

    const action: AgentAction = {
      type: 'scroll',
      expectedOutcome: 'Scrolled',
      intentId: 'intent_1',
    };

    const { executeAction } = await import('../src/executor.js');
    const result = await executeAction(agent, page, action, []);

    const parsed = ExecutionResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });
});
