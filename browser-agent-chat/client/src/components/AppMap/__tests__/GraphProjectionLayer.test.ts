import { describe, it, expect } from 'vitest'
import { projectNavigation } from '../GraphProjectionLayer'
import type { CanonicalGraph } from '../types'

const CANONICAL: CanonicalGraph = {
  entities: [
    { id: 'n1', kind: 'page', metadata: { urlPattern: '/login', pageTitle: 'Login', firstSeenAt: '2026-01-01T00:00:00Z', pendingSuggestions: [] } },
    { id: 'n2', kind: 'page', metadata: { urlPattern: '/dashboard', pageTitle: 'Dashboard', firstSeenAt: '2026-01-01T00:01:00Z', pendingSuggestions: [] } },
    { id: 'n3', kind: 'page', metadata: { urlPattern: '/users', pageTitle: 'Users', firstSeenAt: '2026-01-01T00:02:00Z', pendingSuggestions: [] } },
    { id: 'f1', kind: 'feature', sourceIds: ['n2'], metadata: { name: 'Charts', criticality: 'high', pageId: 'n2' } },
    { id: 'f2', kind: 'feature', sourceIds: ['n2'], metadata: { name: 'Activity', criticality: 'medium', pageId: 'n2' } },
  ],
  relations: [
    { id: 'e1', from: 'n1', to: 'n2', type: 'navigation', metadata: { actionLabel: 'submit form' } },
    { id: 'e2', from: 'n2', to: 'n3', type: 'navigation', metadata: { actionLabel: 'click sidebar' } },
  ],
}

describe('projectNavigation', () => {
  it('identifies root as earliest page by firstSeenAt', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const root = nodes.find(n => n.type === 'root')
    expect(root?.id).toBe('n1')
  })

  it('assigns section type to depth-1 pages', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const dashboard = nodes.find(n => n.id === 'n2')
    expect(dashboard?.type).toBe('section')
  })

  it('computes childIds from navigation edges', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const root = nodes.find(n => n.id === 'n1')
    expect(root?.childIds).toContain('n2')
  })

  it('counts features per page', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const dashboard = nodes.find(n => n.id === 'n2')
    expect(dashboard?.featureCount).toBe(2)
  })

  it('computes highest criticality from features', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const dashboard = nodes.find(n => n.id === 'n2')
    expect(dashboard?.criticality).toBe('high')
  })

  it('sets exploration state based on feature presence', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const login = nodes.find(n => n.id === 'n1')
    const dashboard = nodes.find(n => n.id === 'n2')
    expect(login?.state.exploration).toBe('unknown')
    expect(dashboard?.state.exploration).toBe('explored')
  })

  it('creates navigation edges', () => {
    const { edges } = projectNavigation(CANONICAL)
    expect(edges).toHaveLength(2)
    expect(edges[0]).toMatchObject({ source: 'n1', target: 'n2', type: 'navigation' })
  })

  it('sets parent for child nodes', () => {
    const { nodes } = projectNavigation(CANONICAL)
    const dashboard = nodes.find(n => n.id === 'n2')
    expect(dashboard?.parent).toBe('n1')
  })

  it('sets exploring state when currentUrl matches', () => {
    const { nodes } = projectNavigation(CANONICAL, '/users')
    const users = nodes.find(n => n.id === 'n3')
    expect(users?.state.exploration).toBe('exploring')
  })
})
