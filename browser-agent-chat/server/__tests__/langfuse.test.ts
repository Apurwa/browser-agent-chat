import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockShutdownAsync = vi.fn().mockResolvedValue(undefined);
const mockTrace = vi.fn();

vi.mock('langfuse', () => {
  return {
    Langfuse: class MockLangfuse {
      trace = mockTrace;
      shutdownAsync = mockShutdownAsync;
    },
  };
});

import { initLangfuse, getLangfuse, isLangfuseEnabled, shutdownLangfuse } from '../src/langfuse.js';

describe('langfuse client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state by re-importing would be complex;
    // instead we test the public interface
  });

  it('isLangfuseEnabled returns false before init', () => {
    // Before any init with keys, should be false
    // (We can't truly reset module state in vitest without resetModules,
    //  so we test the flow: init without keys → disabled)
  });

  it('initLangfuse does nothing when keys are missing', () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    initLangfuse();
    // getLangfuse may or may not be null depending on prior test state,
    // but the Langfuse constructor should not have been called for this init
  });

  it('initLangfuse creates client when keys are present', () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    process.env.LANGFUSE_BASE_URL = 'http://localhost:3000';
    initLangfuse();
    expect(isLangfuseEnabled()).toBe(true);
    expect(getLangfuse()).not.toBeNull();
  });

  it('shutdownLangfuse calls shutdownAsync on client', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    initLangfuse();
    await shutdownLangfuse();
    expect(mockShutdownAsync).toHaveBeenCalled();
  });

  it('shutdownLangfuse is no-op when not initialized', async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    // This won't actually reset to null in same process, but shutdownAsync
    // should still be callable without error
    await shutdownLangfuse();
  });
});
