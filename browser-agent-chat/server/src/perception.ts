import type { Intent, Perception, UIElement } from './agent-types.js';

/**
 * DOM script that scans for visible interactive elements.
 * Runs in the browser context via page.evaluate.
 */
const UI_ELEMENT_SCAN_SCRIPT = `
(function() {
  const elements = Array.from(document.querySelectorAll(
    'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"]'
  ))
    .filter(el => el.offsetParent !== null)
    .map((el, i) => ({
      id: 'el_' + i,
      role: el.tagName.toLowerCase(),
      label: (el.textContent || '').trim().slice(0, 50) ||
             el.getAttribute('aria-label') ||
             el.getAttribute('placeholder') ||
             '',
      type: el.getAttribute('type') || undefined,
      interactable: true,
    }));
  return elements;
})();
`;

export async function perceive(
  page: {
    evaluate: (fn: unknown) => Promise<unknown>;
    title: () => Promise<string>;
  },
  activeIntent: Intent | null,
  memoryContext: string,
): Promise<Perception> {
  let url = '';
  let uiElements: UIElement[] = [];
  let pageTitle = '';

  try {
    url = (await page.evaluate('location.href')) as string;
  } catch {
    url = '';
  }

  try {
    pageTitle = await page.title();
  } catch {
    pageTitle = '';
  }

  try {
    const rawElements = (await page.evaluate(UI_ELEMENT_SCAN_SCRIPT)) as Array<{
      id: string;
      role: string;
      label: string;
      type?: string;
      interactable: boolean;
    }>;

    uiElements = rawElements.map((el) => ({
      id: el.id,
      role: el.role,
      label: el.label ?? '',
      type: el.type ?? undefined,
      interactable: el.interactable,
    }));
  } catch {
    uiElements = [];
  }

  return {
    screenshot: undefined,
    uiElements,
    url,
    pageTitle,
    activeIntent,
    relevantMemory: memoryContext,
  };
}
