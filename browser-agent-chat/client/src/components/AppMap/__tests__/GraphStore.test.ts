import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphStore } from '../GraphStore'
import type { AppNode } from '../types'

const MOCK_NODE: AppNode = {
  id: 'n1', type: 'section', label: 'Dashboard',
  state: { exploration: 'explored', validation: 'untested' },
  childIds: ['n2', 'n3'],
}

describe('useGraphStore', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [MOCK_NODE],
      edges: [],
      expandedNodeIds: new Set<string>(),
      selectedNodeId: null,
      mode: 'navigation',
      searchQuery: '',
      lastEventVersion: 0,
    })
  })

  it('initializes with empty state', () => {
    const state = useGraphStore.getState()
    expect(state.expandedNodeIds.size).toBe(0)
    expect(state.selectedNodeId).toBeNull()
    expect(state.mode).toBe('navigation')
  })

  it('toggleExpand adds nodeId to expandedNodeIds', () => {
    useGraphStore.getState().toggleExpand('n1')
    expect(useGraphStore.getState().expandedNodeIds.has('n1')).toBe(true)
  })

  it('toggleExpand removes nodeId if already expanded', () => {
    useGraphStore.getState().toggleExpand('n1')
    useGraphStore.getState().toggleExpand('n1')
    expect(useGraphStore.getState().expandedNodeIds.has('n1')).toBe(false)
  })

  it('selectNode sets selectedNodeId', () => {
    useGraphStore.getState().selectNode('n1')
    expect(useGraphStore.getState().selectedNodeId).toBe('n1')
  })

  it('selectNode with same id deselects', () => {
    useGraphStore.getState().selectNode('n1')
    useGraphStore.getState().selectNode('n1')
    expect(useGraphStore.getState().selectedNodeId).toBeNull()
  })

  it('setMode changes mode', () => {
    useGraphStore.getState().setMode('capabilities')
    expect(useGraphStore.getState().mode).toBe('capabilities')
  })

  it('setSearchQuery updates query', () => {
    useGraphStore.getState().setSearchQuery('users')
    expect(useGraphStore.getState().searchQuery).toBe('users')
  })

  it('processEvent ignores stale versions', () => {
    useGraphStore.setState({ lastEventVersion: 10 })
    useGraphStore.getState().processEvent({ type: 'node:discovered', version: 5, payload: {} })
    expect(useGraphStore.getState().lastEventVersion).toBe(10)
  })

  it('processEvent accepts newer versions', () => {
    useGraphStore.setState({ lastEventVersion: 5 })
    useGraphStore.getState().processEvent({ type: 'node:discovered', version: 10, payload: {} })
    expect(useGraphStore.getState().lastEventVersion).toBe(10)
  })

  it('setGraph replaces nodes and edges', () => {
    const newNode = { ...MOCK_NODE, id: 'n2', label: 'Users' }
    useGraphStore.getState().setGraph([newNode], [])
    expect(useGraphStore.getState().nodes).toHaveLength(1)
    expect(useGraphStore.getState().nodes[0].id).toBe('n2')
  })
})
