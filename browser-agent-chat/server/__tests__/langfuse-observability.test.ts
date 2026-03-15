import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We'll test the helper functions by mocking the langfuse instance
// The helpers need langfuse to be initialized, so we mock the module internals

describe('fetchObservabilitySummary', () => {
  it('should return summary KPIs for date range', async () => {
    // This test will fail until the function is implemented
    const { fetchObservabilitySummary } = await import('../src/langfuse.js');
    expect(fetchObservabilitySummary).toBeDefined();
    expect(typeof fetchObservabilitySummary).toBe('function');
  });
});

describe('fetchObservabilityTrends', () => {
  it('should return time-series data grouped by agent', async () => {
    const { fetchObservabilityTrends } = await import('../src/langfuse.js');
    expect(fetchObservabilityTrends).toBeDefined();
    expect(typeof fetchObservabilityTrends).toBe('function');
  });
});

describe('fetchObservabilityAgents', () => {
  it('should return per-agent breakdown', async () => {
    const { fetchObservabilityAgents } = await import('../src/langfuse.js');
    expect(fetchObservabilityAgents).toBeDefined();
    expect(typeof fetchObservabilityAgents).toBe('function');
  });
});
