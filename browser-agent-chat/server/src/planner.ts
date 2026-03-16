import Anthropic from '@anthropic-ai/sdk';
import { StrategyPlanSchema, type StrategyPlan } from './agent-types.js';

const SYSTEM_PROMPT = `You are a strategic planner for a browser automation agent. Decompose the user's goal into high-level intent steps. Each intent should describe WHAT to achieve, not HOW to click. Include success criteria for each intent.

Return your response as a JSON object matching this exact schema:
{
  "goal": "<the original goal>",
  "intents": [
    {
      "id": "<unique id like 'intent_1'>",
      "description": "<what to achieve>",
      "successCriteria": "<how to know it's done>",
      "status": "pending",
      "confidence": <0.0-1.0>
    }
  ]
}

Rules:
- If the goal is simple (e.g. "click Settings", "go to dashboard"), produce exactly 1 intent
- For complex multi-step goals, produce multiple intents in order
- Keep each intent focused on a single OUTCOME, not a UI action
- All intents start with status "pending"
- Return ONLY valid JSON — no markdown, no explanation`;

export async function planStrategy(
  goal: string,
  worldContext: string,
  currentUrl: string,
): Promise<StrategyPlan> {
  const contextParts: string[] = [
    `Goal: ${goal}`,
    `Current URL: ${currentUrl}`,
  ];

  if (worldContext) {
    contextParts.push(`Context: ${worldContext}`);
  }

  const userMessage = contextParts.join('\n');

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
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
    return StrategyPlanSchema.parse(parsed);
  } catch (error) {
    throw new Error(
      `Failed to plan strategy: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
