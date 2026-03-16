import Anthropic from '@anthropic-ai/sdk';
import { AgentActionSchema, type AgentAction, type Perception } from './agent-types.js';

const SYSTEM_PROMPT = `You are a browser automation agent's decision engine. Given the current UI state and active intent, select ONE action to take next.

Available action types: click, type, scroll, select, submit, extract, navigate

Return your response as a JSON object matching this exact schema:
{
  "type": "<action type>",
  "elementId": "<element id from the UI elements list, optional>",
  "value": "<value to type/navigate to/select, optional>",
  "expectedOutcome": "<what should happen after this action>",
  "intentId": "<id of the intent this action serves>"
}

Rules:
- Pick the MOST EFFECTIVE single action toward the active intent
- Reference element IDs from the provided UI elements list
- For navigate, set value to the target URL and omit elementId
- For type, set value to the text to enter
- For scroll, omit elementId and value
- Return ONLY valid JSON — no markdown, no explanation`;

export async function decideNextAction(
  perception: Perception,
  stepHistory: AgentAction[],
): Promise<AgentAction> {
  const uiElementsSummary = perception.uiElements
    .map((el) => `  - id=${el.id} role=${el.role} label="${el.label}" type=${el.type ?? 'N/A'}`)
    .join('\n');

  const historyLines =
    stepHistory.length > 0
      ? stepHistory
          .slice(-5) // Only show the last 5 actions
          .map(
            (a, i) =>
              `  ${i + 1}. type=${a.type} elementId=${a.elementId ?? 'N/A'} value="${a.value ?? ''}" outcome="${a.expectedOutcome}"`,
          )
          .join('\n')
      : '  (none)';

  const intentDescription = perception.activeIntent
    ? `${perception.activeIntent.description}\nSuccess criteria: ${perception.activeIntent.successCriteria}`
    : '(no active intent)';

  const intentId = perception.activeIntent?.id ?? '';

  const userMessage = [
    `Current URL: ${perception.url}`,
    `Page title: ${perception.pageTitle}`,
    `Active intent (id=${intentId}): ${intentDescription}`,
    '',
    'Available UI elements:',
    uiElementsSummary || '  (none)',
    '',
    'Recent action history:',
    historyLines,
    '',
    'Decide the single best action to take next toward completing the active intent.',
  ].join('\n');

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text content in LLM response');
    }

    const parsed = JSON.parse(textBlock.text);
    return AgentActionSchema.parse(parsed);
  } catch (error) {
    throw new Error(
      `Failed to decide action: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
