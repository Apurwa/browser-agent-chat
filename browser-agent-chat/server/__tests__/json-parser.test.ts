import { describe, it, expect } from 'vitest';
import { extractJsonBlocks } from '../src/json-parser.js';

describe('extractJsonBlocks', () => {
  it('extracts simple JSON after prefix', () => {
    const text = 'some text MEMORY_JSON:{"action":"create_feature","data":{"name":"Login"}}';
    const blocks = extractJsonBlocks(text, 'MEMORY_JSON:');
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0])).toEqual({ action: 'create_feature', data: { name: 'Login' } });
  });

  it('extracts multiple JSON blocks', () => {
    const text = `Found MEMORY_JSON:{"action":"create_feature","data":{"name":"Login"}} also MEMORY_JSON:{"action":"add_behavior","data":{"feature_name":"Login","behavior":"validates"}}`;
    expect(extractJsonBlocks(text, 'MEMORY_JSON:')).toHaveLength(2);
  });

  it('handles nested arrays', () => {
    const text = 'MEMORY_JSON:{"action":"create_feature","data":{"name":"Login","expected_behaviors":["validates email","shows error"]}}';
    const blocks = extractJsonBlocks(text, 'MEMORY_JSON:');
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0]).data.expected_behaviors).toEqual(['validates email', 'shows error']);
  });

  it('handles deeply nested objects (flow steps/checkpoints)', () => {
    const text = 'MEMORY_JSON:{"action":"create_flow","data":{"steps":[{"order":1,"description":"click"}],"checkpoints":[{"description":"check","expected":"pass"}]}}';
    const blocks = extractJsonBlocks(text, 'MEMORY_JSON:');
    expect(blocks).toHaveLength(1);
    const parsed = JSON.parse(blocks[0]);
    expect(parsed.data.steps).toHaveLength(1);
    expect(parsed.data.checkpoints).toHaveLength(1);
  });

  it('handles escaped quotes in strings', () => {
    const text = 'MEMORY_JSON:{"data":{"name":"Login \\"Beta\\""}}';
    const blocks = extractJsonBlocks(text, 'MEMORY_JSON:');
    expect(blocks).toHaveLength(1);
  });

  it('returns empty array when no prefix found', () => {
    expect(extractJsonBlocks('regular text', 'MEMORY_JSON:')).toHaveLength(0);
  });

  it('skips when no opening brace after prefix', () => {
    expect(extractJsonBlocks('MEMORY_JSON: not json', 'MEMORY_JSON:')).toHaveLength(0);
  });

  it('works with FINDING_JSON prefix', () => {
    const text = 'FINDING_JSON:{"title":"Bug","type":"functional","severity":"high"}';
    expect(extractJsonBlocks(text, 'FINDING_JSON:')).toHaveLength(1);
  });
});
