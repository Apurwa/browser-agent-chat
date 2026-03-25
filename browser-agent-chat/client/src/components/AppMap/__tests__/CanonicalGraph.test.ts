import { describe, it, expect } from 'vitest'
import { buildCanonicalGraph } from '../CanonicalGraph'

const API_RESPONSE = {
  nodes: [
    {
      id: 'n1', urlPattern: '/login', pageTitle: 'Login',
      firstSeenAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-01T00:00:00Z',
      features: [
        { id: 'f1', name: 'Auth Form', description: 'Login form', criticality: 'critical', expected_behaviors: [] }
      ],
      pendingSuggestions: [],
    },
    {
      id: 'n2', urlPattern: '/dashboard', pageTitle: 'Dashboard',
      firstSeenAt: '2026-01-01T00:01:00Z', lastSeenAt: '2026-01-01T00:01:00Z',
      features: [],
      pendingSuggestions: [{ id: 's1', type: 'feature', status: 'pending', data: {}, agent_id: 'a1', source_session: null, created_at: '', resolved_at: null }],
    },
  ],
  edges: [
    { id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', actionLabel: 'submit form' },
  ],
  unlinkedSuggestions: [],
}

describe('buildCanonicalGraph', () => {
  it('creates page entities from API nodes', () => {
    const graph = buildCanonicalGraph(API_RESPONSE)
    const pages = graph.entities.filter(e => e.kind === 'page')
    expect(pages).toHaveLength(2)
    expect(pages[0].metadata).toMatchObject({ urlPattern: '/login', pageTitle: 'Login' })
  })

  it('creates feature entities from node features', () => {
    const graph = buildCanonicalGraph(API_RESPONSE)
    const features = graph.entities.filter(e => e.kind === 'feature')
    expect(features).toHaveLength(1)
    expect(features[0].metadata).toMatchObject({ name: 'Auth Form', criticality: 'critical' })
  })

  it('creates navigation relations from API edges', () => {
    const graph = buildCanonicalGraph(API_RESPONSE)
    const navRelations = graph.relations.filter(r => r.type === 'navigation')
    expect(navRelations).toHaveLength(1)
    expect(navRelations[0]).toMatchObject({ from: 'n1', to: 'n2' })
    expect(navRelations[0].metadata).toMatchObject({ actionLabel: 'submit form' })
  })

  it('preserves pending suggestions in page metadata', () => {
    const graph = buildCanonicalGraph(API_RESPONSE)
    const dashboard = graph.entities.find(e => e.id === 'n2')
    expect((dashboard?.metadata.pendingSuggestions as unknown[])?.length).toBe(1)
  })

  it('returns empty graph for empty API response', () => {
    const graph = buildCanonicalGraph({ nodes: [], edges: [], unlinkedSuggestions: [] })
    expect(graph.entities).toHaveLength(0)
    expect(graph.relations).toHaveLength(0)
  })
})
