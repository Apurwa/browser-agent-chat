import { describe, it, expect } from 'vitest';
import { normalizeUrl, serializeGraph } from '../src/nav-graph.js';
import type { NavGraph } from '../src/types.js';

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
});
