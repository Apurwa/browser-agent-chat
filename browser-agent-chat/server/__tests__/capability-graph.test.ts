import { describe, it, expect } from 'vitest'
import { buildCapabilityClusters } from '../src/capability-graph.js'

describe('buildCapabilityClusters', () => {
  it('groups pages by first URL path segment', () => {
    const nodes = [
      { id: 'n1', urlPattern: '/admin/users', pageTitle: 'Users', features: [{ name: 'Invite' }] },
      { id: 'n2', urlPattern: '/admin/users/:id', pageTitle: 'User Detail', features: [{ name: 'Edit' }] },
      { id: 'n3', urlPattern: '/settings', pageTitle: 'Settings', features: [{ name: 'Theme' }] },
    ]
    const clusters = buildCapabilityClusters(nodes as any, [])
    expect(clusters).toHaveLength(2)
    const adminCluster = clusters.find(c => c.sourcePageIds.includes('n1'))
    expect(adminCluster?.sourcePageIds).toContain('n2')
  })

  it('splits clusters with > 6 pages by second segment', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => ({
      id: `n${i}`,
      urlPattern: `/settings/${['security', 'billing', 'team', 'api', 'webhooks', 'logs', 'sso', 'notifications'][i]}`,
      pageTitle: `Settings ${i}`,
      features: [],
    }))
    const clusters = buildCapabilityClusters(nodes as any, [])
    expect(clusters.length).toBeGreaterThan(1)
  })

  it('infers dependencies from cross-cluster edges', () => {
    const nodes = [
      { id: 'n1', urlPattern: '/users', pageTitle: 'Users', features: [] },
      { id: 'n2', urlPattern: '/roles', pageTitle: 'Roles', features: [] },
    ]
    const edges = [{ id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', actionLabel: 'click' }]
    const clusters = buildCapabilityClusters(nodes as any, edges as any)
    const userCluster = clusters.find(c => c.sourcePageIds.includes('n1'))
    const roleCluster = clusters.find(c => c.sourcePageIds.includes('n2'))
    expect(userCluster?.dependencies).toContain(roleCluster?.id)
  })

  it('returns empty for empty input', () => {
    expect(buildCapabilityClusters([], [])).toEqual([])
  })
})
