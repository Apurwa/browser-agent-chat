import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — use vi.hoisted() so mockFrom is available in the factory
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock('../src/supabase.js', () => ({
  isSupabaseEnabled: vi.fn().mockReturnValue(true),
  supabase: { from: mockFrom },
}));

import {
  loadWorldModel,
  updatePagePurpose,
  markPageVisited,
  getWorldContext,
} from '../src/world-model.js';

describe('loadWorldModel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns empty model when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);

    const result = await loadWorldModel('agent-1');

    expect(result.pages).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.features).toEqual([]);
    expect(result.discoveryStats.pagesDiscovered).toBe(0);
    expect(result.discoveryStats.flowsDiscovered).toBe(0);
    expect(result.discoveryStats.elementsIndexed).toBe(0);
  });

  it('loads pages, edges, and features from Supabase', async () => {
    const nodeRows = [
      {
        id: 'n1', agent_id: 'agent-1', url_pattern: '/dashboard',
        page_title: 'Dashboard', description: '',
        first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z',
        purpose: 'Show metrics', available_actions: [{ label: 'click stats' }],
        visited: true,
      },
    ];
    const edgeRows = [
      {
        id: 'e1', agent_id: 'agent-1', from_node_id: 'n1', to_node_id: 'n2',
        action_label: 'click settings', selector: null, raw_target: null,
        discovered_at: '2026-01-01T00:00:00Z',
      },
    ];
    const featureRows = [
      { id: 'f1', agent_id: 'agent-1', name: 'Analytics', description: 'Track metrics', criticality: 'high' },
    ];

    // nodes query
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: nodeRows, error: null }),
        }),
      }),
    });
    // edges query
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: edgeRows, error: null }),
      }),
    });
    // features query
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: featureRows, error: null }),
      }),
    });

    const result = await loadWorldModel('agent-1');

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].id).toBe('n1');
    expect(result.pages[0].purpose).toBe('Show metrics');
    expect(result.pages[0].visited).toBe(true);
    expect(result.edges).toHaveLength(1);
    expect(result.features).toHaveLength(1);
    expect(result.discoveryStats.pagesDiscovered).toBe(1);
    expect(result.discoveryStats.elementsIndexed).toBe(1); // 1 available action
  });

  it('returns empty arrays on node fetch error', async () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
        }),
      }),
    });

    const result = await loadWorldModel('agent-1');
    expect(result.pages).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});

describe('updatePagePurpose', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates purpose and available_actions in nav_nodes', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    const actions = [{ label: 'click login' }];
    await updatePagePurpose('n1', 'Login page for authentication', actions);

    expect(mockFrom).toHaveBeenCalledWith('nav_nodes');
    expect(mockUpdate).toHaveBeenCalledWith({
      purpose: 'Login page for authentication',
      available_actions: actions,
    });
  });

  it('does nothing when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);

    await updatePagePurpose('n1', 'some purpose', []);

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('logs error but does not throw on supabase error', async () => {
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: 'update failed' } }),
      }),
    });

    await expect(updatePagePurpose('n1', 'purpose', [])).resolves.toBeUndefined();
  });
});

describe('markPageVisited', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sets visited = true in nav_nodes', async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });

    await markPageVisited('n1');

    expect(mockFrom).toHaveBeenCalledWith('nav_nodes');
    expect(mockUpdate).toHaveBeenCalledWith({ visited: true });
    expect(mockEq).toHaveBeenCalledWith('id', 'n1');
  });

  it('does nothing when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);

    await markPageVisited('n1');

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('logs error but does not throw on supabase error', async () => {
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
      }),
    });

    await expect(markPageVisited('n1')).resolves.toBeUndefined();
  });
});

describe('getWorldContext', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns empty string when no pages exist', async () => {
    // nodes (empty)
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
    // edges (empty)
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });
    // features (empty)
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const ctx = await getWorldContext('agent-1');
    expect(ctx).toBe('');
  });

  it('returns human-readable text containing page URLs', async () => {
    const nodeRows = [
      {
        id: 'n1', agent_id: 'agent-1', url_pattern: '/home',
        page_title: 'Home', description: '',
        first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z',
        purpose: 'Main landing page', available_actions: [], visited: true,
      },
    ];

    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: nodeRows, error: null }),
        }),
      }),
    });
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const ctx = await getWorldContext('agent-1');

    expect(ctx).toContain('/home');
    expect(ctx).toContain('Home');
    expect(ctx).toContain('Main landing page');
  });

  it('includes visited/unvisited status in context', async () => {
    const nodeRows = [
      {
        id: 'n1', agent_id: 'agent-1', url_pattern: '/visited',
        page_title: 'Visited Page', description: '',
        first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z',
        purpose: null, available_actions: [], visited: true,
      },
      {
        id: 'n2', agent_id: 'agent-1', url_pattern: '/unexplored',
        page_title: 'Unexplored Page', description: '',
        first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z',
        purpose: null, available_actions: [], visited: false,
      },
    ];

    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: nodeRows, error: null }),
        }),
      }),
    });
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const ctx = await getWorldContext('agent-1');

    expect(ctx).toContain('[visited]');
    expect(ctx).toContain('[unvisited]');
  });

  it('includes features section when features exist', async () => {
    const nodeRows = [
      {
        id: 'n1', agent_id: 'agent-1', url_pattern: '/dashboard',
        page_title: 'Dashboard', description: '',
        first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z',
        purpose: null, available_actions: [], visited: false,
      },
    ];
    const featureRows = [
      { id: 'f1', agent_id: 'agent-1', name: 'User Management', description: 'Manage users', criticality: 'high' },
    ];

    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: nodeRows, error: null }),
        }),
      }),
    });
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: featureRows, error: null }),
      }),
    });

    const ctx = await getWorldContext('agent-1');

    expect(ctx).toContain('User Management');
    expect(ctx).toContain('FEATURES');
  });

  it('returns empty string when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);

    const ctx = await getWorldContext('agent-1');
    expect(ctx).toBe('');
  });
});
