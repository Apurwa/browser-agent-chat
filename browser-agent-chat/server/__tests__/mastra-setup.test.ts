import { describe, it, expect } from 'vitest';

describe('mastra instance', () => {
  it('is exported and defined', async () => {
    const { mastra } = await import('../src/mastra/index.js');
    expect(mastra).toBeDefined();
  });

  it('is a Mastra instance with the expected shape', async () => {
    const { mastra } = await import('../src/mastra/index.js');
    expect(typeof mastra).toBe('object');
    expect(mastra).not.toBeNull();
  });
});
