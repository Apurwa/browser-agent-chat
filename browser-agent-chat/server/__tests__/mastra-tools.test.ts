import { describe, it, expect } from 'vitest';

describe('Mastra tool skeletons', () => {
  it('exports all tools from the barrel index', async () => {
    const tools = await import('../src/mastra/tools/index.js');
    expect(tools).toBeDefined();
    expect(typeof tools).toBe('object');
  });

  describe('magnitude-act tool', () => {
    it('has required properties', async () => {
      const { magnitudeActTool } = await import('../src/mastra/tools/magnitude-act.js');
      expect(magnitudeActTool.id).toBeDefined();
      expect(typeof magnitudeActTool.id).toBe('string');
      expect(magnitudeActTool.description).toBeDefined();
      expect(typeof magnitudeActTool.description).toBe('string');
      expect(magnitudeActTool.inputSchema).toBeDefined();
      expect(typeof magnitudeActTool.execute).toBe('function');
    });

    it('execute throws when agentRef/pageRef not provided in context', async () => {
      const { magnitudeActTool } = await import('../src/mastra/tools/magnitude-act.js');
      await expect(magnitudeActTool.execute!({ instruction: 'click button' }, undefined as any))
        .rejects.toThrow();
    });
  });

  describe('magnitude-extract tool', () => {
    it('has required properties', async () => {
      const { magnitudeExtractTool } = await import('../src/mastra/tools/magnitude-extract.js');
      expect(magnitudeExtractTool.id).toBeDefined();
      expect(typeof magnitudeExtractTool.id).toBe('string');
      expect(magnitudeExtractTool.description).toBeDefined();
      expect(magnitudeExtractTool.inputSchema).toBeDefined();
      expect(typeof magnitudeExtractTool.execute).toBe('function');
    });

    it('execute throws when agentRef not provided in context', async () => {
      const { magnitudeExtractTool } = await import('../src/mastra/tools/magnitude-extract.js');
      await expect(magnitudeExtractTool.execute!({ prompt: 'get title', schemaDescription: 'string' }, undefined as any))
        .rejects.toThrow();
    });
  });

  describe('perception tool', () => {
    it('has required properties', async () => {
      const { perceptionTool } = await import('../src/mastra/tools/perception.js');
      expect(perceptionTool.id).toBeDefined();
      expect(typeof perceptionTool.id).toBe('string');
      expect(perceptionTool.description).toBeDefined();
      expect(perceptionTool.inputSchema).toBeDefined();
      expect(typeof perceptionTool.execute).toBe('function');
    });

    it('execute throws when pageRef not provided in context', async () => {
      const { perceptionTool } = await import('../src/mastra/tools/perception.js');
      await expect(perceptionTool.execute!({ agentId: 'agent-1' }, undefined as any))
        .rejects.toThrow();
    });
  });

  describe('world-model tools', () => {
    it('worldModelReadTool has required properties', async () => {
      const { worldModelReadTool } = await import('../src/mastra/tools/world-model.js');
      expect(worldModelReadTool.id).toBeDefined();
      expect(worldModelReadTool.description).toBeDefined();
      expect(worldModelReadTool.inputSchema).toBeDefined();
      expect(typeof worldModelReadTool.execute).toBe('function');
    });

    it('worldModelUpdateTool has required properties', async () => {
      const { worldModelUpdateTool } = await import('../src/mastra/tools/world-model.js');
      expect(worldModelUpdateTool.id).toBeDefined();
      expect(worldModelUpdateTool.description).toBeDefined();
      expect(worldModelUpdateTool.inputSchema).toBeDefined();
      expect(typeof worldModelUpdateTool.execute).toBe('function');
    });

    it('worldModelReadTool execute throws Not implemented', async () => {
      const { worldModelReadTool } = await import('../src/mastra/tools/world-model.js');
      await expect(worldModelReadTool.execute!({ agentId: 'agent-1' }, undefined as any))
        .rejects.toThrow('Not implemented');
    });

    it('worldModelUpdateTool execute throws Not implemented', async () => {
      const { worldModelUpdateTool } = await import('../src/mastra/tools/world-model.js');
      await expect(worldModelUpdateTool.execute!({ agentId: 'agent-1', updates: {} }, undefined as any))
        .rejects.toThrow('Not implemented');
    });
  });

  describe('frontier tool', () => {
    it('has required properties', async () => {
      const { frontierTool } = await import('../src/mastra/tools/frontier.js');
      expect(frontierTool.id).toBeDefined();
      expect(typeof frontierTool.id).toBe('string');
      expect(frontierTool.description).toBeDefined();
      expect(frontierTool.inputSchema).toBeDefined();
      expect(typeof frontierTool.execute).toBe('function');
    });

    it('execute throws Not implemented', async () => {
      const { frontierTool } = await import('../src/mastra/tools/frontier.js');
      await expect(frontierTool.execute!({ agentId: 'agent-1' }, undefined as any))
        .rejects.toThrow('Not implemented');
    });
  });

  describe('broadcast tool', () => {
    it('has required properties', async () => {
      const { broadcastTool } = await import('../src/mastra/tools/broadcast.js');
      expect(broadcastTool.id).toBeDefined();
      expect(typeof broadcastTool.id).toBe('string');
      expect(broadcastTool.description).toBeDefined();
      expect(broadcastTool.inputSchema).toBeDefined();
      expect(typeof broadcastTool.execute).toBe('function');
    });

    it('execute throws Not implemented', async () => {
      const { broadcastTool } = await import('../src/mastra/tools/broadcast.js');
      await expect(broadcastTool.execute!({ type: 'message', content: 'hello' }, undefined as any))
        .rejects.toThrow('Not implemented');
    });
  });
});
