import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — use vi.hoisted() so mockFrom is available in the factory
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock('../src/supabase.js', () => ({
  isSupabaseEnabled: vi.fn().mockReturnValue(true),
  supabase: { from: mockFrom },
}));
vi.mock('../src/db.js', () => ({
  listFeatures: vi.fn().mockResolvedValue([]),
}));

// Single merged import
import { normalizeUrl, serializeGraph, upsertNode, upsertEdge, linkFeatureToNode, getGraph, recordNavigation } from '../src/nav-graph.js';
import type { NavGraph } from '../src/types.js';
import { loadMemoryContext } from '../src/memory-engine.js';

describe('normalizeUrl', () => {
  it('strips query parameters', () => {
    expect(normalizeUrl('https://app.com/settings?tab=general')).toBe('/settings');
  });

  it('strips hash fragments', () => {
    expect(normalizeUrl('https://app.com/docs#section-2')).toBe('/docs');
  });

  it('collapses numeric path segments to :id', () => {
    expect(normalizeUrl('https://app.com/users/123')).toBe('/users/:id');
    expect(normalizeUrl('https://app.com/users/456/posts/789')).toBe('/users/:id/posts/:id');
  });

  it('collapses UUID path segments to :id', () => {
    expect(normalizeUrl('https://app.com/orders/a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('/orders/:id');
  });

  it('preserves meaningful path structure', () => {
    expect(normalizeUrl('https://app.com/settings/billing')).toBe('/settings/billing');
    expect(normalizeUrl('https://app.com/admin/users')).toBe('/admin/users');
  });

  it('handles root URL', () => {
    expect(normalizeUrl('https://app.com/')).toBe('/');
    expect(normalizeUrl('https://app.com')).toBe('/');
  });

  it('handles relative paths', () => {
    expect(normalizeUrl('/users/123?page=2')).toBe('/users/:id');
  });

  it('removes trailing slashes except root', () => {
    expect(normalizeUrl('https://app.com/settings/')).toBe('/settings');
  });

  it('handles both query params and hash together', () => {
    expect(normalizeUrl('https://app.com/page?q=search#results')).toBe('/page');
  });

  it('handles mixed numeric and text segments', () => {
    expect(normalizeUrl('https://app.com/projects/42/settings')).toBe('/projects/:id/settings');
  });
});

describe('serializeGraph', () => {
  it('returns empty string for empty graph', () => {
    expect(serializeGraph({ nodes: [], edges: [] })).toBe('');
  });

  it('serializes nodes with titles', () => {
    const graph: NavGraph = {
      nodes: [{
        id: 'n1', projectId: 'p1', urlPattern: '/dashboard',
        pageTitle: 'Dashboard', description: '', firstSeenAt: '', lastSeenAt: '',
        features: [],
      }],
      edges: [],
    };
    const result = serializeGraph(graph);
    expect(result).toContain('SITE MAP:');
    expect(result).toContain('/dashboard');
    expect(result).toContain('Dashboard');
  });

  it('includes feature names in brackets', () => {
    const graph: NavGraph = {
      nodes: [{
        id: 'n1', projectId: 'p1', urlPattern: '/dashboard',
        pageTitle: 'Dashboard', description: '', firstSeenAt: '', lastSeenAt: '',
        features: ['Analytics Overview', 'Quick Actions'],
      }],
      edges: [],
    };
    const result = serializeGraph(graph);
    expect(result).toContain('[features: Analytics Overview, Quick Actions]');
  });

  it('serializes edges as indented transitions under source node', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/dashboard', pageTitle: 'Dashboard', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n2', projectId: 'p1', urlPattern: '/settings', pageTitle: 'Settings', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [{
        id: 'e1', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'n2',
        actionLabel: 'click "Settings" in sidebar', selector: null, discoveredAt: '',
      }],
    };
    const result = serializeGraph(graph);
    expect(result).toContain('  → /settings (click "Settings" in sidebar)');
  });

  it('omits action label parenthetical when action is empty', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/a', pageTitle: 'A', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n2', projectId: 'p1', urlPattern: '/b', pageTitle: 'B', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [{
        id: 'e1', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'n2',
        actionLabel: '', selector: null, discoveredAt: '',
      }],
    };
    const result = serializeGraph(graph);
    expect(result).toContain('  → /b');
    expect(result).not.toContain('()');
  });

  it('respects maxNodes option', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`, projectId: 'p1', urlPattern: `/page-${i}`,
      pageTitle: `Page ${i}`, description: '', firstSeenAt: '', lastSeenAt: '',
      features: [],
    }));
    const graph: NavGraph = { nodes, edges: [] };
    const result = serializeGraph(graph, { maxNodes: 3 });
    expect(result.match(/\/page-/g)?.length).toBe(3);
  });

  it('maxNodes omits edges pointing to excluded nodes', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/a', pageTitle: 'A', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n2', projectId: 'p1', urlPattern: '/b', pageTitle: 'B', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n3', projectId: 'p1', urlPattern: '/c', pageTitle: 'C', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [
        { id: 'e1', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'n2', actionLabel: 'go to b', selector: null, discoveredAt: '' },
        { id: 'e2', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'n3', actionLabel: 'go to c', selector: null, discoveredAt: '' },
      ],
    };
    const result = serializeGraph(graph, { maxNodes: 2 });
    expect(result).toContain('→ /b (go to b)');
    expect(result).not.toContain('/c');
  });

  it('silently drops edges with dangling toNodeId', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/a', pageTitle: 'A', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [
        { id: 'e1', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'missing', actionLabel: 'broken', selector: null, discoveredAt: '' },
      ],
    };
    const result = serializeGraph(graph);
    expect(result).toContain('/a');
    expect(result).not.toContain('broken');
  });
});

describe('upsertNode', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('upserts a nav_node and returns mapped NavNode', async () => {
    const row = {
      id: 'n1', project_id: 'p1', url_pattern: '/users/:id',
      page_title: 'Users', description: '',
      first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z',
    };
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
    });

    const result = await upsertNode('p1', 'https://app.com/users/123', 'Users');

    expect(mockFrom).toHaveBeenCalledWith('nav_nodes');
    expect(result).toEqual(expect.objectContaining({
      id: 'n1', projectId: 'p1', urlPattern: '/users/:id', pageTitle: 'Users',
    }));
  });

  it('returns null when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);
    const result = await upsertNode('p1', 'https://app.com/page');
    expect(result).toBeNull();
  });

  it('returns null on supabase error', async () => {
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
        }),
      }),
    });
    const result = await upsertNode('p1', 'https://app.com/page');
    expect(result).toBeNull();
  });
});

describe('upsertEdge', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('upserts a nav_edge and returns mapped NavEdge', async () => {
    const row = {
      id: 'e1', project_id: 'p1', from_node_id: 'n1', to_node_id: 'n2',
      action_label: 'click: Settings', selector: null,
      discovered_at: '2026-01-01T00:00:00Z',
    };
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
    });

    const result = await upsertEdge('p1', 'n1', 'n2', 'click: Settings');

    expect(mockFrom).toHaveBeenCalledWith('nav_edges');
    expect(result).toEqual(expect.objectContaining({
      id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', actionLabel: 'click: Settings',
    }));
  });
});

describe('linkFeatureToNode', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('inserts into nav_node_features', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await linkFeatureToNode('n1', 'f1');

    expect(mockFrom).toHaveBeenCalledWith('nav_node_features');
    expect(mockUpsert).toHaveBeenCalledWith(
      { nav_node_id: 'n1', feature_id: 'f1' },
      { onConflict: 'nav_node_id,feature_id', ignoreDuplicates: true }
    );
  });
});

describe('getGraph', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('loads nodes, edges, and feature names', async () => {
    const nodeRows = [
      { id: 'n1', project_id: 'p1', url_pattern: '/dashboard', page_title: 'Dashboard', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' },
    ];
    const edgeRows = [
      { id: 'e1', project_id: 'p1', from_node_id: 'n1', to_node_id: 'n2', action_label: 'click', selector: null, discovered_at: '2026-01-01' },
    ];
    const featureLinks = [
      { nav_node_id: 'n1', memory_features: { name: 'Search' } },
    ];

    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: nodeRows, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: edgeRows, error: null }),
        }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: featureLinks, error: null }),
        }),
      });

    const graph = await getGraph('p1');

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].features).toEqual(['Search']);
    expect(graph.edges).toHaveLength(1);
  });

  it('returns empty graph when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as any).mockReturnValueOnce(false);
    const graph = await getGraph('p1');
    expect(graph).toEqual({ nodes: [], edges: [] });
  });

  it('returns empty graph when node fetch fails', async () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'node fail' } }),
        }),
      }),
    });
    const graph = await getGraph('p1');
    expect(graph).toEqual({ nodes: [], edges: [] });
  });

  it('returns empty graph when edge fetch fails', async () => {
    const nodeRows = [
      { id: 'n1', project_id: 'p1', url_pattern: '/a', page_title: 'A', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' },
    ];
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: nodeRows, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'edge fail' } }),
        }),
      });
    const graph = await getGraph('p1');
    expect(graph).toEqual({ nodes: [], edges: [] });
  });
});

describe('recordNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts to-node and creates edge from from-node', async () => {
    const toNodeRow = { id: 'n2', project_id: 'p1', url_pattern: '/settings', page_title: '', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' };
    const fromNodeRow = { id: 'n1', project_id: 'p1', url_pattern: '/dashboard', page_title: '', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' };
    const edgeRow = { id: 'e1', project_id: 'p1', from_node_id: 'n1', to_node_id: 'n2', action_label: 'click: Settings', selector: null, discovered_at: '2026-01-01' };

    const mockUpsertChain = (row: any) => ({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
    });

    mockFrom
      .mockReturnValueOnce(mockUpsertChain(toNodeRow))   // upsertNode(toUrl)
      .mockReturnValueOnce(mockUpsertChain(fromNodeRow)) // upsertNode(fromUrl)
      .mockReturnValueOnce(mockUpsertChain(edgeRow));    // upsertEdge

    await recordNavigation('p1', 'https://app.com/dashboard', 'https://app.com/settings', 'click: Settings');

    expect(mockFrom).toHaveBeenCalledTimes(3);
  });

  it('upserts only to-node when fromUrl is null', async () => {
    const toNodeRow = { id: 'n1', project_id: 'p1', url_pattern: '/home', page_title: '', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' };

    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: toNodeRow, error: null }),
        }),
      }),
    });

    await recordNavigation('p1', null, 'https://app.com/home');

    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('does not create edge when from and to normalize to same pattern', async () => {
    const nodeRow = { id: 'n1', project_id: 'p1', url_pattern: '/users/:id', page_title: '', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' };

    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: nodeRow, error: null }),
        }),
      }),
    });

    await recordNavigation('p1', 'https://app.com/users/1', 'https://app.com/users/2');

    // Two upsertNode calls (both return same node), no edge call
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('returns early when toNode upsert fails', async () => {
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
        }),
      }),
    });

    await recordNavigation('p1', 'https://app.com/from', 'https://app.com/to');

    // Only 1 call for toNode — fromNode never attempted
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('swallows errors without throwing', async () => {
    mockFrom.mockImplementation(() => { throw new Error('DB down'); });

    await expect(recordNavigation('p1', null, 'https://app.com/page')).resolves.toBeUndefined();
  });
});

describe('loadMemoryContext — graph integration', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('includes SITE MAP block when graph has nodes', async () => {
    const nodeRows = [
      { id: 'n1', project_id: 'p1', url_pattern: '/dashboard', page_title: 'Dashboard', description: '', first_seen_at: '2026-01-01', last_seen_at: '2026-01-01' },
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
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const result = await loadMemoryContext('p1');

    expect(result).toContain('SITE MAP:');
    expect(result).toContain('/dashboard');
  });

  it('omits SITE MAP block when graph is empty', async () => {
    // nodes query (empty)
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
    // edges query (empty, no nodeIds so no feature-links query)
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const result = await loadMemoryContext('p1');

    expect(result).not.toContain('SITE MAP:');
  });
});
