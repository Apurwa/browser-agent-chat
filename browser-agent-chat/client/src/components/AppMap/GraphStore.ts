import { create } from 'zustand'
import type { AppNode, AppEdge } from './types'

type GraphEvent = {
  readonly type: string
  readonly version: number
  readonly payload: Record<string, unknown>
}

type GraphStoreState = {
  nodes: readonly AppNode[]
  edges: readonly AppEdge[]
  expandedNodeIds: Set<string>
  selectedNodeId: string | null
  mode: 'navigation' | 'capabilities'
  searchQuery: string
  lastEventVersion: number
}

type GraphStoreActions = {
  setGraph: (nodes: readonly AppNode[], edges: readonly AppEdge[]) => void
  toggleExpand: (nodeId: string) => void
  selectNode: (nodeId: string) => void
  setMode: (mode: 'navigation' | 'capabilities') => void
  setSearchQuery: (query: string) => void
  processEvent: (event: GraphEvent) => void
}

export const useGraphStore = create<GraphStoreState & GraphStoreActions>((set, get) => ({
  nodes: [],
  edges: [],
  expandedNodeIds: new Set<string>(),
  selectedNodeId: null,
  mode: 'navigation',
  searchQuery: '',
  lastEventVersion: 0,

  setGraph: (nodes, edges) => set({ nodes, edges }),

  toggleExpand: (nodeId) => set(state => {
    const next = new Set(state.expandedNodeIds)
    if (next.has(nodeId)) {
      next.delete(nodeId)
    } else {
      next.add(nodeId)
    }
    return { expandedNodeIds: next }
  }),

  selectNode: (nodeId) => set(state => ({
    selectedNodeId: state.selectedNodeId === nodeId ? null : nodeId,
  })),

  setMode: (mode) => set({ mode }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  processEvent: (event) => {
    const { lastEventVersion } = get()
    if (event.version <= lastEventVersion) return
    set({ lastEventVersion: event.version })
  },
}))
