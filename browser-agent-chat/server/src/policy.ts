import { z } from 'zod';
import { AgentActionSchema, type AgentAction, type Perception, type UIElement } from './agent-types.js';

// Schema passed to agent.extract() — must be BAML-compatible (no nullable/transform)
const LLMOutputSchema = z.object({
  type: z.enum(['click', 'type', 'scroll', 'select', 'submit', 'extract', 'navigate']),
  elementId: z.string().optional(),
  value: z.string().optional(),
  expectedOutcome: z.string(),
  intentId: z.string(),
});

/** Progress context computed by the agent loop and passed to the policy. */
export interface ProgressContext {
  pageAlreadyExtracted: boolean;
  progressDelta: number;          // 0 = no new info, >0 = new items discovered
  urlChanged: boolean;
  visitedUrls: string[];
  unexplored: {
    navigation: UIElement[];
    actions: UIElement[];
    other: UIElement[];
  };
}

/** Categorize UI elements into semantic buckets for the prompt. */
function categorizeElements(elements: UIElement[], clickedIds: Set<string>): ProgressContext['unexplored'] {
  const unexplored = elements.filter(el => !clickedIds.has(el.id));

  const navigation: UIElement[] = [];
  const actions: UIElement[] = [];
  const other: UIElement[] = [];

  for (const el of unexplored) {
    const label = el.label.toLowerCase();
    const role = el.role.toLowerCase();
    if (role === 'a' || role === 'link' || label.includes('nav') || role === 'tab' || role === 'menuitem') {
      navigation.push(el);
    } else if (role === 'button' || role === 'submit') {
      actions.push(el);
    } else {
      other.push(el);
    }
  }

  return { navigation, actions, other };
}

function formatElementList(elements: UIElement[], max = 10): string {
  if (elements.length === 0) return '  (none)';
  return elements.slice(0, max)
    .map(el => `  - id=${el.id} "${el.label}"`)
    .join('\n');
}

function buildPrompt(
  perception: Perception,
  stepHistory: AgentAction[],
  progress: ProgressContext,
): string {
  const intentId = perception.activeIntent?.id ?? 'unknown';

  const uiSummary = perception.uiElements
    .map(el => `  - id=${el.id} role=${el.role} label="${el.label}" type=${el.type ?? 'N/A'}`)
    .join('\n');

  const historyLines = stepHistory.length > 0
    ? stepHistory.slice(-5).map((a, i) =>
        `  ${i + 1}. ${a.type}${a.elementId ? ' → ' + a.elementId : ''}${a.value ? ' "' + a.value + '"' : ''}`
      ).join('\n')
    : '  (none)';

  const visitedList = progress.visitedUrls.length > 0
    ? progress.visitedUrls.join(', ')
    : '(none)';

  // Compressed progress signal on one line
  const progressLine = `Page extracted: ${progress.pageAlreadyExtracted} | Progress: ${progress.progressDelta} new items | URL changed: ${progress.urlChanged}`;

  return `You are a browser automation agent. Choose ONE action that maximizes discovery of NEW information or functionality.

PRIORITY:
- Prefer actions that lead to NEW pages or UI states
- Avoid repeating actions that produced no new information

RULES:
- Do not extract from a page that was already extracted unless content changed
- If last action produced 0 new information, choose a DIFFERENT action type
- Prefer clicking unexplored navigation over staying on the same page

CURRENT STATE
Intent (id=${intentId}): ${perception.activeIntent?.description ?? '(none)'}
Success Criteria: ${perception.activeIntent?.successCriteria ?? '(none)'}
URL: ${perception.url} | Title: ${perception.pageTitle}
${progressLine}

VISITED PAGES: ${visitedList}

UNEXPLORED OPPORTUNITIES
Navigation:
${formatElementList(progress.unexplored.navigation)}
Actions:
${formatElementList(progress.unexplored.actions)}

UI ELEMENTS:
${uiSummary || '  (none visible)'}

RECENT HISTORY:
${historyLines}

Return JSON: { type, elementId, value, expectedOutcome, intentId }
Action types: click, type, scroll, select, submit, extract, navigate`;
}

export async function decideNextAction(
  agent: { extract: (prompt: string, schema: z.ZodType) => Promise<unknown> },
  perception: Perception,
  stepHistory: AgentAction[],
  progress?: ProgressContext,
): Promise<{ action: AgentAction; prompt: string }> {
  const intentId = perception.activeIntent?.id ?? 'unknown';

  // Default progress context if not provided (backward compat)
  const ctx: ProgressContext = progress ?? {
    pageAlreadyExtracted: false,
    progressDelta: 0,
    urlChanged: false,
    visitedUrls: [],
    unexplored: categorizeElements(perception.uiElements, new Set()),
  };

  const prompt = buildPrompt(perception, stepHistory, ctx);

  try {
    const result = await agent.extract(prompt, LLMOutputSchema) as Record<string, unknown>;
    console.log('[POLICY] Raw LLM result:', JSON.stringify(result));
    const cleaned = {
      type: result.type,
      elementId: result.elementId ?? undefined,
      value: result.value ?? undefined,
      expectedOutcome: result.expectedOutcome,
      intentId: result.intentId || intentId,
    };
    const action = AgentActionSchema.parse(cleaned);
    return { action, prompt };
  } catch (error) {
    console.error('[POLICY] LLM decision failed, falling back to extract:', error instanceof Error ? error.message : error);
    const action: AgentAction = {
      type: 'extract',
      expectedOutcome: 'Gather information about the current page',
      intentId,
    };
    return { action, prompt };
  }
}

export { categorizeElements };
