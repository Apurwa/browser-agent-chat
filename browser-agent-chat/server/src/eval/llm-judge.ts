import Anthropic from '@anthropic-ai/sdk';

export interface JudgeResult {
  verdict: 'pass' | 'fail';
  reasoning: string;
}

const client = new Anthropic();

export async function judgeWithLLM(
  screenshotBase64: string,
  criteria: string,
  taskPrompt: string,
  stepsDescription: string,
): Promise<JudgeResult> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: screenshotBase64,
            },
          },
          {
            type: 'text',
            text: `You are an evaluation judge for a browser automation agent.

The agent was given this task: "${taskPrompt}"

The agent took these steps:
${stepsDescription}

The screenshot shows the final browser state.

Evaluate whether the task was completed successfully based on this criteria:
${criteria}

Respond with EXACTLY this JSON format, no other text:
{"verdict": "pass" or "fail", "reasoning": "one sentence explanation"}`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const parsed = JSON.parse(text);
    return {
      verdict: parsed.verdict === 'pass' ? 'pass' : 'fail',
      reasoning: parsed.reasoning ?? 'No reasoning provided',
    };
  } catch {
    // If parsing fails, try to extract verdict from text
    const isPass = text.toLowerCase().includes('"verdict": "pass"') || text.toLowerCase().includes('"verdict":"pass"');
    return {
      verdict: isPass ? 'pass' : 'fail',
      reasoning: text.slice(0, 200),
    };
  }
}
