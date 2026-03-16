import { z } from 'zod';
import type { AgentAction, ExecutionResult, UIElement } from './agent-types.js';

type BrowserAgent = {
  act: (instruction: string) => Promise<void>;
  extract: (prompt: string, schema: unknown) => Promise<unknown>;
};

type PlaywrightPage = {
  goto: (url: string) => Promise<unknown>;
  evaluate: (fn: unknown) => Promise<unknown>;
};

/**
 * Resolve the label for an element from the UI elements list.
 * Falls back to the elementId when the element is not found.
 */
function resolveElementLabel(elementId: string | undefined, uiElements: UIElement[]): string {
  if (!elementId) return '';
  const el = uiElements.find((e) => e.id === elementId);
  return el?.label || elementId;
}

/**
 * Attempt to capture the current URL from the page after an action.
 * Returns undefined if the page context is unavailable.
 */
async function captureUrl(page: PlaywrightPage): Promise<string | undefined> {
  try {
    return (await page.evaluate('location.href')) as string;
  } catch {
    return undefined;
  }
}

export async function executeAction(
  agent: BrowserAgent,
  page: PlaywrightPage,
  action: AgentAction,
  uiElements: UIElement[],
): Promise<ExecutionResult> {
  try {
    const elementLabel = resolveElementLabel(action.elementId, uiElements);

    switch (action.type) {
      case 'click': {
        const label = elementLabel || action.elementId || 'element';
        await agent.act(`click on '${label}'`);
        break;
      }

      case 'type': {
        const label = elementLabel || action.elementId || 'field';
        await agent.act(`type '${action.value ?? ''}' into '${label}'`);
        break;
      }

      case 'scroll': {
        await agent.act('scroll down');
        break;
      }

      case 'navigate': {
        const url = action.value ?? '';
        await page.goto(url);
        const newUrl = await captureUrl(page);
        return { success: true, newUrl };
      }

      case 'submit': {
        await agent.act('click the submit button');
        break;
      }

      case 'select': {
        const label = elementLabel || action.elementId || 'dropdown';
        await agent.act(`select '${action.value ?? ''}' from '${label}'`);
        break;
      }

      case 'extract': {
        const extractSchema = z.object({
          summary: z.string().describe('A summary of what was found on the page'),
          items: z.array(z.string()).describe('List of features, elements, or information found'),
        });
        const data = await agent.extract(
          action.value ?? action.expectedOutcome,
          extractSchema,
        );
        const newUrl = await captureUrl(page);
        return { success: true, data, newUrl };
      }

      default: {
        throw new Error(`Unknown action type: ${(action as AgentAction).type}`);
      }
    }

    const newUrl = await captureUrl(page);
    return { success: true, newUrl };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
