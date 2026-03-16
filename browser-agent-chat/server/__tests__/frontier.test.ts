import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock('../src/supabase.js', () => ({
  isSupabaseEnabled: vi.fn().mockReturnValue(true),
  supabase: { from: mockFrom },
}));

import {
  addFrontierItems,
  getNextFrontier,
  markExplored,
  getFrontierStats,
} from '../src/frontier.js';
import type { FrontierItem } from '../src/agent-types.js';

// Helper to create a minimal FrontierItem without id
const makeItem = (overrides: Partial<Omit<FrontierItem, 'id'>> = {}): Omit<FrontierItem, 'id'> => ({
  pageId: 'page-1',
  targetUrlHash: 'hash-abc',
  elementLabel: 'Login button',
  action: 'click',
  priority: 5,
  discoveredAtStep: 0,
  explored: false,
  persistent: false,
  category: 'button',
  ...overrides,
});

describe('addFrontierItems', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('inserts items into frontier_items table', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    const items = [makeItem(), makeItem({ targetUrlHash: 'hash-def', elementLabel: 'Sign up' })];
    await addFrontierItems('agent-1', items);

    expect(mockFrom).toHaveBeenCalledWith('frontier_items');
    expect(mockUpsert).toHaveBeenCalled();
    const callArg = mockUpsert.mock.calls[0][0];
    expect(callArg).toHaveLength(2);
    expect(callArg[0]).toMatchObject({ agent_id: 'agent-1', element_label: 'Login button' });
  });

  it('does nothing when items array is empty', async () => {
    await addFrontierItems('agent-1', []);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does nothing when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);

    await addFrontierItems('agent-1', [makeItem()]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('deduplicates by targetUrlHash using ON CONFLICT ignore', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await addFrontierItems('agent-1', [makeItem()]);

    // Should pass ignoreDuplicates: true or onConflict with ignoreDuplicates
    const upsertOptions = mockUpsert.mock.calls[0][1];
    expect(upsertOptions).toBeDefined();
    expect(upsertOptions.ignoreDuplicates).toBe(true);
  });

  it('logs error but does not throw on supabase error', async () => {
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: { message: 'insert failed' } }),
    });

    await expect(addFrontierItems('agent-1', [makeItem()])).resolves.toBeUndefined();
  });
});

describe('getNextFrontier', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns highest-priority unexplored item', async () => {
    const row = {
      id: 'fi-1', agent_id: 'agent-1', page_id: 'page-1',
      target_url_hash: 'hash-abc', element_label: 'Login',
      action: 'click', priority: 8, intent_relevance: null,
      discovered_at_step: 0, explored: false, persistent: false,
      category: 'button',
    };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: row, error: null }),
              }),
            }),
          }),
        }),
      }),
    });

    const result = await getNextFrontier('agent-1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('fi-1');
    expect(result!.elementLabel).toBe('Login');
    expect(result!.priority).toBe(8);
    expect(result!.explored).toBe(false);
  });

  it('returns null when frontier is empty', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
              }),
            }),
          }),
        }),
      }),
    });

    const result = await getNextFrontier('agent-1');
    expect(result).toBeNull();
  });

  it('returns null when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);

    const result = await getNextFrontier('agent-1');
    expect(result).toBeNull();
  });

  it('maps snake_case DB row to camelCase FrontierItem', async () => {
    const row = {
      id: 'fi-2', agent_id: 'agent-1', page_id: 'page-2',
      target_url_hash: 'hash-xyz', element_label: 'Submit form',
      action: 'submit', priority: 6, intent_relevance: 0.8,
      discovered_at_step: 2, explored: false, persistent: true,
      category: 'form',
    };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: row, error: null }),
              }),
            }),
          }),
        }),
      }),
    });

    const result = await getNextFrontier('agent-1');

    expect(result).toMatchObject({
      id: 'fi-2',
      pageId: 'page-2',
      targetUrlHash: 'hash-xyz',
      elementLabel: 'Submit form',
      action: 'submit',
      priority: 6,
      intentRelevance: 0.8,
      discoveredAtStep: 2,
      explored: false,
      persistent: true,
      category: 'form',
    });
  });
});

describe('markExplored', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates explored = true for the given item id', async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });

    await markExplored('fi-1');

    expect(mockFrom).toHaveBeenCalledWith('frontier_items');
    expect(mockUpdate).toHaveBeenCalledWith({ explored: true });
    expect(mockEq).toHaveBeenCalledWith('id', 'fi-1');
  });

  it('does nothing when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);

    await markExplored('fi-1');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('logs error but does not throw on supabase error', async () => {
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: 'update failed' } }),
      }),
    });

    await expect(markExplored('fi-1')).resolves.toBeUndefined();
  });
});

describe('getFrontierStats', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns total, explored, and remaining counts', async () => {
    // First query: total count
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [1, 2, 3, 4, 5], error: null, count: 5 }),
      }),
    });
    // Second query: explored count
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [1, 2], error: null, count: 2 }),
        }),
      }),
    });

    const stats = await getFrontierStats('agent-1');

    expect(stats.total).toBe(5);
    expect(stats.explored).toBe(2);
    expect(stats.remaining).toBe(3);
  });

  it('returns zeros when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);

    const stats = await getFrontierStats('agent-1');
    expect(stats).toEqual({ total: 0, explored: 0, remaining: 0 });
  });

  it('returns zeros on DB error', async () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
      }),
    });
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
        }),
      }),
    });

    const stats = await getFrontierStats('agent-1');
    expect(stats).toEqual({ total: 0, explored: 0, remaining: 0 });
  });
});
