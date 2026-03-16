import { z } from 'zod';
import { AgentActionSchema, type AgentAction, type Perception } from './agent-types.js';

const PolicyOutputSchema = z.object({
  type: z.enum(['click', 'type', 'scroll', 'select', 'submit', 'extract', 'navigate']),
  elementId: z.string().nullish().transform(v => v ?? undefined),
  value: z.string().nullish().transform(v => v ?? undefined),
  expectedOutcome: z.string(),
  intentId: z.string(),
});

export async function decideNextAction(
  agent: { extract: (prompt: string, schema: z.ZodType) => Promise<unknown> },
  perception: Perception,
  stepHistory: AgentAction[],
): Promise<AgentAction> {
  const uiElementsSummary = perception.uiElements
    .map((el) => `  - id=${el.id} role=${el.role} label="${el.label}" type=${el.type ?? 'N/A'}`)
    .join('\n');

  const historyLines =
    stepHistory.length > 0
      ? stepHistory
          .slice(-5)
          .map(
            (a, i) =>
              `  ${i + 1}. type=${a.type} elementId=${a.elementId ?? 'N/A'} value="${a.value ?? ''}"`,
          )
          .join('\n')
      : '  (none)';

  const intentDescription = perception.activeIntent
    ? `${perception.activeIntent.description}\nSuccess criteria: ${perception.activeIntent.successCriteria}`
    : '(no active intent)';

  const intentId = perception.activeIntent?.id ?? 'unknown';

  const prompt = `You are a browser automation agent. Given the current UI state and active intent, select ONE action to take next.

Current URL: ${perception.url}
Page title: ${perception.pageTitle}
Active intent (id=${intentId}): ${intentDescription}

Available UI elements:
${uiElementsSummary || '  (none visible)'}

Recent action history:
${historyLines}

Available action types: click, type, scroll, select, submit, extract, navigate
- For click: set elementId to the target element's id
- For type: set elementId and value
- For navigate: set value to URL, omit elementId
- For scroll: omit elementId and value

Pick the MOST EFFECTIVE single action toward the active intent.`;

  try {
    const result = await agent.extract(prompt, PolicyOutputSchema);
    console.log('[POLICY] Raw LLM result:', JSON.stringify(result));
    const parsed = PolicyOutputSchema.parse(result);
    return AgentActionSchema.parse({ ...parsed, intentId: parsed.intentId || intentId });
  } catch (error) {
    console.error('[POLICY] LLM decision failed, falling back to extract:', error instanceof Error ? error.message : error);
    // Fallback: use Magnitude's native act() to observe the page
    return {
      type: 'extract',
      expectedOutcome: 'Gather information about the current page',
      intentId,
    };
  }
}
