import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetGraph, mockListFeatures, mockListPendingSuggestions } = vi.hoisted(() => ({
  mockGetGraph: vi.fn(),
  mockListFeatures: vi.fn(),
  mockListPendingSuggestions: vi.fn(),
}));

vi.mock('../src/nav-graph.js', () => ({
  getGraph: mockGetGraph,
  normalizeUrl: vi.fn((url: string) => {
    try { return new URL(url).pathname; } catch { return url; }
  }),
}));

vi.mock('../src/db.js', () => ({
  listFeatures: mockListFeatures,
  listPendingSuggestions: mockListPendingSuggestions,
}));

vi.mock('../src/supabase.js', () => ({
  isSupabaseEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock('../src/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('express', () => {
  const router = { get: vi.fn() };
  return { Router: vi.fn(() => router) };
});

import { buildAppMapResponse } from '../src/routes/map.js';

describe('buildAppMapResponse', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns empty graph when no nav data exists', async () => {
    mockGetGraph.mockResolvedValue({ nodes: [], edges: [] });
    mockListFeatures.mockResolvedValue([]);
    mockListPendingSuggestions.mockResolvedValue([]);

    const result = await buildAppMapResponse('proj-1');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.unlinkedSuggestions).toEqual([]);
  });

  it('attaches full feature objects to nodes by matching feature names', async () => {
    mockGetGraph.mockResolvedValue({
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/dashboard', pageTitle: 'Dashboard',
          description: '', firstSeenAt: '2026-01-01', lastSeenAt: '2026-01-01',
          features: ['Overview', 'Search'] },
      ],
      edges: [],
    });
    mockListFeatures.mockResolvedValue([
      { id: 'f1', project_id: 'p1', name: 'Overview', description: 'Main view',
        criticality: 'critical', expected_behaviors: ['shows metrics'], flows: [] },
      { id: 'f2', project_id: 'p1', name: 'Search', description: 'Global search',
        criticality: 'low', expected_behaviors: [], flows: [] },
      { id: 'f3', project_id: 'p1', name: 'Unlinked Feature', description: null,
        criticality: 'medium', expected_behaviors: [], flows: [] },
    ]);
    mockListPendingSuggestions.mockResolvedValue([]);

    const result = await buildAppMapResponse('p1');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].features).toHaveLength(2);
    expect(result.nodes[0].features[0].name).toBe('Overview');
    expect(result.nodes[0].features[1].name).toBe('Search');
  });

  it('attaches feature suggestions to nodes by discovered_at_url', async () => {
    mockGetGraph.mockResolvedValue({
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/settings', pageTitle: 'Settings',
          description: '', firstSeenAt: '2026-01-01', lastSeenAt: '2026-01-01',
          features: [] },
      ],
      edges: [],
    });
    mockListFeatures.mockResolvedValue([]);
    mockListPendingSuggestions.mockResolvedValue([
      { id: 's1', project_id: 'p1', type: 'feature', status: 'pending',
        data: { name: 'Preferences', description: 'User prefs', criticality: 'medium',
                expected_behaviors: [], discovered_at_url: 'https://app.com/settings' },
        source_session: null, created_at: '2026-01-01', resolved_at: null },
    ]);

    const result = await buildAppMapResponse('p1');
    expect(result.nodes[0].pendingSuggestions).toHaveLength(1);
    expect(result.nodes[0].pendingSuggestions[0].id).toBe('s1');
    expect(result.unlinkedSuggestions).toHaveLength(0);
  });

  it('attaches flow suggestions to nodes via feature_name lookup', async () => {
    mockGetGraph.mockResolvedValue({
      nodes: [
        { id: 'n1', projectId: 'p1', urlPattern: '/dashboard', pageTitle: 'Dashboard',
          description: '', firstSeenAt: '2026-01-01', lastSeenAt: '2026-01-01',
          features: ['Overview'] },
      ],
      edges: [],
    });
    mockListFeatures.mockResolvedValue([
      { id: 'f1', project_id: 'p1', name: 'Overview', description: null,
        criticality: 'critical', expected_behaviors: [], flows: [] },
    ]);
    mockListPendingSuggestions.mockResolvedValue([
      { id: 's2', project_id: 'p1', type: 'flow', status: 'pending',
        data: { feature_name: 'Overview', name: 'Drill-down Flow',
                steps: [], checkpoints: [], criticality: 'high' },
        source_session: null, created_at: '2026-01-01', resolved_at: null },
    ]);

    const result = await buildAppMapResponse('p1');
    expect(result.nodes[0].pendingSuggestions).toHaveLength(1);
    expect(result.nodes[0].pendingSuggestions[0].id).toBe('s2');
  });

  it('puts unmatched suggestions in unlinkedSuggestions', async () => {
    mockGetGraph.mockResolvedValue({ nodes: [], edges: [] });
    mockListFeatures.mockResolvedValue([]);
    mockListPendingSuggestions.mockResolvedValue([
      { id: 's3', project_id: 'p1', type: 'feature', status: 'pending',
        data: { name: 'Orphan', description: '', criticality: 'low',
                expected_behaviors: [] },
        source_session: null, created_at: '2026-01-01', resolved_at: null },
    ]);

    const result = await buildAppMapResponse('p1');
    expect(result.unlinkedSuggestions).toHaveLength(1);
    expect(result.unlinkedSuggestions[0].id).toBe('s3');
  });
});
