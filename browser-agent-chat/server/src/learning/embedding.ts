import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const anthropic = new Anthropic();

/**
 * Embed text using OpenAI text-embedding-3-small (1536 dimensions).
 * Returns null if the API call fails.
 */
export async function embedText(text: string): Promise<number[] | null> {
  if (!openai) {
    console.warn('[EMBEDDING] OPENAI_API_KEY not set — skipping embedding');
    return null;
  }
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  } catch (err) {
    console.error('[EMBEDDING] Failed to embed text:', err);
    return null;
  }
}

/**
 * Embed multiple texts in a single batch request.
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  if (!openai) return texts.map(() => null);
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });
    return response.data.map(d => d.embedding);
  } catch (err) {
    console.error('[EMBEDDING] Batch embed failed:', err);
    return texts.map(() => null);
  }
}

/**
 * Generate a clean one-sentence task summary using Claude Haiku.
 * Falls back to the raw prompt if the call fails.
 */
export async function summarizeTask(taskPrompt: string): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Summarize this browser automation task in one concise sentence. Only output the summary, nothing else.\n\nTask: ${taskPrompt}`,
      }],
    });
    const block = response.content[0];
    if (block.type === 'text') return block.text.trim();
    return taskPrompt;
  } catch (err) {
    console.error('[EMBEDDING] Task summarization failed, using raw prompt:', err);
    return taskPrompt;
  }
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
