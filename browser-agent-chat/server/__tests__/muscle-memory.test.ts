import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock('../src/supabase.js', () => ({
  isSupabaseEnabled: vi.fn().mockReturnValue(true),
  supabase: { from: mockFrom, rpc: mockRpc },
}));
vi.mock('../src/nav-graph.js', () => ({
  getGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  normalizeUrl: vi.fn((url: string) => {
    try { return new URL(url).pathname; } catch { return url; }
  }),
}));

import { loadPatterns, markStale, markSuccess } from '../src/muscle-memory.js';

describe('loadPatterns', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns active patterns for a project', async () => {
    const rows = [{
      id: 'p1', project_id: 'proj1', pattern_type: 'login',
      trigger: { type: 'login', url_pattern: '/login' },
      steps: [{ action: 'fill', selector: 'input[type="email"]', value: '{{username}}' }],
      consecutive_failures: 0, status: 'active', use_count: 5,
      last_used_at: null, created_at: '2026-01-01', updated_at: '2026-01-01',
    }];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    });

    const result = await loadPatterns('proj1');
    expect(result).toHaveLength(1);
    expect(result[0].pattern_type).toBe('login');
    expect(mockFrom).toHaveBeenCalledWith('learned_patterns');
  });

  it('returns empty array when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);
    const result = await loadPatterns('proj1');
    expect(result).toEqual([]);
  });
});

describe('markStale', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sets status to stale for a pattern', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    await markStale('pattern-1');

    expect(mockFrom).toHaveBeenCalledWith('learned_patterns');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'stale',
    }));
  });
});

describe('markSuccess', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('resets failures and updates timestamps', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({
      update: mockUpdate,
      rpc: vi.fn().mockResolvedValue({ error: null }),
    });

    await markSuccess('pattern-1');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      consecutive_failures: 0,
    }));
  });
});
