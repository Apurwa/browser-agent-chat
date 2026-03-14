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

import { loadPatterns, markStale, markSuccess, injectCredentials, stripActionPrefix, findNodeByUrlOrTitle, findPath, incrementFailures } from '../src/muscle-memory.js';
import type { PlaywrightStep, NavGraph } from '../src/types.js';

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

describe('incrementFailures', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('increments consecutive_failures count', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    await incrementFailures('pattern-1', 1);

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      consecutive_failures: 2,
    }));
  });

  it('marks pattern stale when failures reach 3', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    await incrementFailures('pattern-1', 2);

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      consecutive_failures: 3,
      status: 'stale',
    }));
  });

  it('does not mark stale when failures below 3', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    await incrementFailures('pattern-1', 0);

    const updateArg = mockUpdate.mock.calls[0][0];
    expect(updateArg.consecutive_failures).toBe(1);
    expect(updateArg.status).toBeUndefined();
  });
});

describe('injectCredentials', () => {
  it('replaces {{username}} and {{password}} placeholders', () => {
    const steps: PlaywrightStep[] = [
      { action: 'fill', selector: 'input[type="email"]', value: '{{username}}' },
      { action: 'fill', selector: 'input[type="password"]', value: '{{password}}' },
      { action: 'click', selector: 'button[type="submit"]' },
    ];
    const result = injectCredentials(steps, { username: 'user@test.com', password: 's3cret' });
    expect(result[0].value).toBe('user@test.com');
    expect(result[1].value).toBe('s3cret');
    expect(result[2].value).toBeUndefined();
  });

  it('returns steps unchanged when no placeholders', () => {
    const steps: PlaywrightStep[] = [
      { action: 'click', selector: 'button' },
    ];
    const result = injectCredentials(steps, { username: 'u', password: 'p' });
    expect(result).toEqual(steps);
  });
});

describe('stripActionPrefix', () => {
  it('strips "click: " prefix', () => {
    expect(stripActionPrefix('click: Pipelines')).toBe('Pipelines');
  });

  it('strips "type: " prefix', () => {
    expect(stripActionPrefix('type: search query')).toBe('search query');
  });

  it('returns original string when no prefix', () => {
    expect(stripActionPrefix('Pipelines')).toBe('Pipelines');
  });

  it('handles empty string', () => {
    expect(stripActionPrefix('')).toBe('');
  });
});

describe('findNodeByUrlOrTitle', () => {
  const nodes = [
    { id: 'n1', projectId: 'p1', urlPattern: '/dashboard', pageTitle: 'Dashboard', description: '', firstSeenAt: '', lastSeenAt: '', features: [] as string[] },
    { id: 'n2', projectId: 'p1', urlPattern: '/ai-studio/pipelines', pageTitle: 'Pipelines', description: '', firstSeenAt: '', lastSeenAt: '', features: [] as string[] },
    { id: 'n3', projectId: 'p1', urlPattern: '/settings', pageTitle: 'Account Settings', description: '', firstSeenAt: '', lastSeenAt: '', features: [] as string[] },
  ];

  it('matches exact page title (case insensitive)', () => {
    const result = findNodeByUrlOrTitle(nodes, 'pipelines');
    expect(result?.id).toBe('n2');
  });

  it('matches by URL path segment', () => {
    const result = findNodeByUrlOrTitle(nodes, 'dashboard');
    expect(result?.id).toBe('n1');
  });

  it('returns null when no match', () => {
    const result = findNodeByUrlOrTitle(nodes, 'nonexistent');
    expect(result).toBeNull();
  });

  it('prefers exact title match over URL match', () => {
    const result = findNodeByUrlOrTitle(nodes, 'Account Settings');
    expect(result?.id).toBe('n3');
  });
});

describe('findPath', () => {
  it('finds direct edge between two nodes', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/a', pageTitle: 'A', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n2', projectId: 'p1', urlPattern: '/b', pageTitle: 'B', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [
        { id: 'e1', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'n2', actionLabel: 'click: B', selector: null, rawTarget: 'B', discoveredAt: '' },
      ],
    };
    const path = findPath(graph, 'n1', 'n2');
    expect(path).toHaveLength(1);
    expect(path[0].toNodeId).toBe('n2');
  });

  it('finds multi-hop path via BFS', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/a', pageTitle: 'A', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n2', projectId: 'p1', urlPattern: '/b', pageTitle: 'B', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n3', projectId: 'p1', urlPattern: '/c', pageTitle: 'C', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [
        { id: 'e1', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'n2', actionLabel: 'click: B', selector: null, rawTarget: 'B', discoveredAt: '' },
        { id: 'e2', projectId: 'p1', fromNodeId: 'n2', toNodeId: 'n3', actionLabel: 'click: C', selector: null, rawTarget: 'C', discoveredAt: '' },
      ],
    };
    const path = findPath(graph, 'n1', 'n3');
    expect(path).toHaveLength(2);
    expect(path[0].toNodeId).toBe('n2');
    expect(path[1].toNodeId).toBe('n3');
  });

  it('returns empty array when no path exists', () => {
    const graph: NavGraph = {
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/a', pageTitle: 'A', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
        { id: 'n2', projectId: 'p1', urlPattern: '/b', pageTitle: 'B', description: '', firstSeenAt: '', lastSeenAt: '', features: [] },
      ],
      edges: [],
    };
    const path = findPath(graph, 'n1', 'n2');
    expect(path).toEqual([]);
  });

  it('returns empty array when from equals to', () => {
    const graph: NavGraph = { nodes: [], edges: [] };
    const path = findPath(graph, 'n1', 'n1');
    expect(path).toEqual([]);
  });
});
