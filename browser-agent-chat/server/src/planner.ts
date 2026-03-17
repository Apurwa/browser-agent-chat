import { z } from 'zod';
import { StrategyPlanSchema, type StrategyPlan } from './agent-types.js';

const PlannerOutputSchema = z.object({
  goal: z.string(),
  intents: z.array(z.object({
    id: z.string(),
    description: z.string(),
    successCriteria: z.string(),
    status: z.enum(['pending', 'active', 'completed', 'failed']),
    confidence: z.number(),
  })),
});

export async function planStrategy(
  agent: { extract: (prompt: string, schema: z.ZodType) => Promise<unknown> },
  goal: string,
  worldContext: string,
  currentUrl: string,
  maxIntents?: number,
): Promise<StrategyPlan> {
  const contextParts: string[] = [
    `Goal: ${goal}`,
    `Current URL: ${currentUrl}`,
  ];

  if (worldContext) {
    contextParts.push(`Known app context:\n${worldContext}`);
  }

  const effectiveMax = maxIntents ?? 7;

  const prompt = `You are a strategic planner for a browser automation agent. Decompose the following goal into high-level intent steps.

${contextParts.join('\n')}

Rules:
- If the goal is simple (e.g. "click Settings"), produce exactly 1 intent
- For complex multi-step goals, produce multiple intents in order
- Each intent describes WHAT to achieve, not HOW to click
- Include success criteria (how to know the intent is done)
- All intents start with status "pending" and confidence 0
- Generate at most ${effectiveMax} high-level intents. Each intent takes approximately 3 actions to complete. Focus on the most important areas first.`;

  try {
    const result = await agent.extract(prompt, PlannerOutputSchema);
    console.log('[PLANNER] Raw LLM result:', JSON.stringify(result));
    const plan = StrategyPlanSchema.parse(result);
    return {
      ...plan,
      intents: plan.intents.slice(0, effectiveMax),
    };
  } catch (error) {
    // Fallback: create a single intent from the goal
    console.error('[PLANNER] LLM planning failed, using single-intent fallback:', error);
    return {
      goal,
      intents: [{
        id: 'intent_1',
        description: goal,
        successCriteria: 'Task completed successfully',
        status: 'pending',
        confidence: 0,
      }],
    };
  }
}
