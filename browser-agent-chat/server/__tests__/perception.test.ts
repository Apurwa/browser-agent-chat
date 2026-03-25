import { describe, it, expect, vi } from 'vitest';
import { PerceptionSchema, UIElementSchema } from '../src/agent-types.js';
import type { Intent } from '../src/agent-types.js';

/** Build a minimal mock Playwright page */
function makeMockPage(overrides: {
  evaluateResults?: unknown[];
  title?: string;
} = {}) {
  const evaluateResults = overrides.evaluateResults ?? [
    'https://example.com/dashboard',
    // UI elements returned from DOM scan
    [
      { id: 'el_0', role: 'button', label: 'Submit', type: undefined, interactable: true },
      { id: 'el_1', role: 'a', label: 'Home', type: undefined, interactable: true },
      { id: 'el_2', role: 'input', label: '', type: 'text', interactable: true },
    ],
  ];

  let callIndex = 0;
  const evaluate = vi.fn(async (_fn: unknown) => {
    return evaluateResults[callIndex++];
  });

  return {
    evaluate,
    title: vi.fn(async () => overrides.title ?? 'Dashboard'),
  };
}

describe('perceive', () => {
  it('returns a valid Perception object', async () => {
    const page = makeMockPage();
    const { perceive } = await import('../src/perception.js');

    const result = await perceive(page, null, '');

    const parsed = PerceptionSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('captures current URL from page.evaluate', async () => {
    const page = makeMockPage({ evaluateResults: ['https://example.com/settings', []] });
    const { perceive } = await import('../src/perception.js');

    const result = await perceive(page, null, '');
    expect(result.url).toBe('https://example.com/settings');
  });

  it('captures page title', async () => {
    const page = makeMockPage({ title: 'My App - Settings' });
    const { perceive } = await import('../src/perception.js');

    const result = await perceive(page, null, '');
    expect(result.pageTitle).toBe('My App - Settings');
  });

  it('extracts UI elements from the page', async () => {
    const page = makeMockPage({
      evaluateResults: [
        'https://example.com',
        [
          { id: 'el_0', role: 'button', label: 'Login', type: undefined, interactable: true },
          { id: 'el_1', role: 'input', label: '', type: 'email', interactable: true },
          { id: 'el_2', role: 'input', label: '', type: 'password', interactable: true },
        ],
      ],
    });
    const { perceive } = await import('../src/perception.js');

    const result = await perceive(page, null, '');
    expect(result.uiElements).toHaveLength(3);

    // All elements should conform to UIElementSchema
    for (const el of result.uiElements) {
      const parsed = UIElementSchema.safeParse(el);
      expect(parsed.success).toBe(true);
    }
  });

  it('sets activeIntent when provided', async () => {
    const page = makeMockPage();
    const activeIntent: Intent = {
      id: 'intent_1',
      description: 'Navigate to settings',
      successCriteria: 'Settings page visible',
      status: 'active',
      confidence: 0.9,
    };
    const { perceive } = await import('../src/perception.js');

    const result = await perceive(page, activeIntent, '');
    expect(result.activeIntent).toEqual(activeIntent);
  });

  it('sets activeIntent to null when none provided', async () => {
    const page = makeMockPage();
    const { perceive } = await import('../src/perception.js');

    const result = await perceive(page, null, '');
    expect(result.activeIntent).toBeNull();
  });

  it('stores memory context in relevantMemory', async () => {
    const page = makeMockPage();
    const { perceive } = await import('../src/perception.js');

    const result = await perceive(page, null, 'User prefers dark mode');
    expect(result.relevantMemory).toBe('User prefers dark mode');
  });

  it('returns empty uiElements array when DOM scan returns nothing', async () => {
    const page = makeMockPage({ evaluateResults: ['https://example.com', []] });
    const { perceive } = await import('../src/perception.js');

    const result = await perceive(page, null, '');
    expect(result.uiElements).toEqual([]);
  });

  it('handles page.evaluate failures gracefully', async () => {
    const page = {
      evaluate: vi.fn().mockRejectedValue(new Error('Page context destroyed')),
      title: vi.fn(async () => 'Error Page'),
    };
    const { perceive } = await import('../src/perception.js');

    // Should not throw — should return a perception with fallback values
    const result = await perceive(page, null, '');
    expect(result.url).toBeDefined();
    expect(result.uiElements).toBeDefined();
    expect(Array.isArray(result.uiElements)).toBe(true);
  });
});
