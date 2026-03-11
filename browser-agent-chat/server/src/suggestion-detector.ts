import { extractJsonBlocks } from './json-parser.js';
import type { Suggestion, FlowStep, Checkpoint } from './types.js';

interface ParsedUpdate {
  action: string;
  type: Suggestion['type'];
  data: Suggestion['data'];
}

const ACTION_TO_TYPE: Record<string, Suggestion['type']> = {
  create_feature: 'feature',
  create_flow: 'flow',
  add_behavior: 'behavior',
};

/**
 * Transform agent-emitted flow data (string arrays) into structured FlowStep[]/Checkpoint[].
 * Passes through already-structured objects unchanged.
 */
export function transformFlowData(
  steps: (string | FlowStep)[],
  checkpoints: (string | Checkpoint)[]
): { steps: FlowStep[]; checkpoints: Checkpoint[] } {
  return {
    steps: steps.map((s, i) => typeof s === 'string' ? { order: i + 1, description: s } : s),
    checkpoints: checkpoints.map(c => typeof c === 'string' ? { description: c, expected: c } : c),
  };
}

/**
 * Parse MEMORY_JSON blocks from agent thought text.
 * Returns typed suggestion data ready for createSuggestion().
 */
export function parseMemoryUpdates(text: string): ParsedUpdate[] {
  const blocks = extractJsonBlocks(text, 'MEMORY_JSON:');
  const updates: ParsedUpdate[] = [];

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block);
      if (!parsed.action || !parsed.data) continue;

      const type = ACTION_TO_TYPE[parsed.action];
      if (!type) continue;

      let data = parsed.data;
      if (type === 'flow' && data.steps && data.checkpoints) {
        const transformed = transformFlowData(data.steps, data.checkpoints);
        data = { ...data, ...transformed };
      }

      updates.push({ action: parsed.action, type, data });
    } catch {
      // Skip malformed JSON
    }
  }

  return updates;
}
