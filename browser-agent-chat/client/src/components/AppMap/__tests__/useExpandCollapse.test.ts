import { describe, it, expect } from 'vitest'
import { filterVisibleNodes, filterVisibleEdges } from '../useExpandCollapse'
import type { AppNode, AppEdge } from '../types'

const NODES: AppNode[] = [
  { id: 'root', type: 'root', label: 'Login', state: { exploration: 'explored', validation: 'untested' }, childIds: ['s1', 's2'] },
  { id: 's1', type: 'section', label: 'Dashboard', parent: 'root', state: { exploration: 'explored', validation: 'untested' }, childIds: ['f1', 'f2'] },
  { id: 's2', type: 'section', label: 'Users', parent: 'root', state: { exploration: 'unknown', validation: 'untested' }, childIds: [] },
  { id: 'f1', type: 'feature', label: 'Charts', parent: 's1', state: { exploration: 'explored', validation: 'untested' }, childIds: [] },
  { id: 'f2', type: 'feature', label: 'Activity', parent: 's1', state: { exploration: 'explored', validation: 'untested' }, childIds: [] },
]

const EDGES: AppEdge[] = [
  { id: 'e1', source: 'root', target: 's1', type: 'navigation', label: 'submit' },
  { id: 'e2', source: 'root', target: 's2', type: 'navigation', label: 'click' },
  { id: 'e3', source: 's1', target: 'f1', type: 'navigation' },
  { id: 'e4', source: 's1', target: 'f2', type: 'navigation' },
]

describe('filterVisibleNodes', () => {
  it('shows only root when nothing is expanded', () => {
    const visible = filterVisibleNodes(NODES, new Set())
    expect(visible.map(n => n.id)).toEqual(['root'])
  })

  it('shows root + children when root is expanded', () => {
    const visible = filterVisibleNodes(NODES, new Set(['root']))
    expect(visible.map(n => n.id)).toEqual(['root', 's1', 's2'])
  })

  it('shows grandchildren when both root and section are expanded', () => {
    const visible = filterVisibleNodes(NODES, new Set(['root', 's1']))
    expect(visible.map(n => n.id)).toEqual(['root', 's1', 's2', 'f1', 'f2'])
  })

  it('root is always visible even with empty expandedIds', () => {
    const visible = filterVisibleNodes(NODES, new Set())
    expect(visible.some(n => n.id === 'root')).toBe(true)
  })
})

describe('filterVisibleEdges', () => {
  it('only includes edges where both endpoints are visible', () => {
    const visibleIds = new Set(['root', 's1', 's2'])
    const visible = filterVisibleEdges(EDGES, visibleIds)
    expect(visible.map(e => e.id)).toEqual(['e1', 'e2'])
  })

  it('returns empty for no visible nodes', () => {
    const visible = filterVisibleEdges(EDGES, new Set(['root']))
    expect(visible).toHaveLength(0)
  })
})
