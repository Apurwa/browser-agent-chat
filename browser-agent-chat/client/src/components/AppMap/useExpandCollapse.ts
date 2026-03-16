import { useMemo } from 'react'
import { useGraphStore } from './GraphStore'
import type { AppNode, AppEdge } from './types'
import { MAX_VISIBLE_NODES } from './types'

export function filterVisibleNodes(
  nodes: readonly AppNode[],
  expandedNodeIds: Set<string>,
): AppNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  function isVisible(node: AppNode): boolean {
    if (!node.parent) return true
    if (!expandedNodeIds.has(node.parent)) return false
    const parent = nodeMap.get(node.parent)
    return parent ? isVisible(parent) : true
  }

  return nodes.filter(n => isVisible(n))
}

export function filterVisibleEdges(
  edges: readonly AppEdge[],
  visibleNodeIds: Set<string>,
): AppEdge[] {
  return edges.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
}

export function useExpandCollapse() {
  const nodes = useGraphStore(s => s.nodes)
  const edges = useGraphStore(s => s.edges)
  const expandedNodeIds = useGraphStore(s => s.expandedNodeIds)

  const visibleNodes = useMemo(() => {
    const visible = filterVisibleNodes(nodes, expandedNodeIds)
    if (visible.length > MAX_VISIBLE_NODES) {
      return visible.slice(0, MAX_VISIBLE_NODES)
    }
    return visible
  }, [nodes, expandedNodeIds])

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map(n => n.id)),
    [visibleNodes],
  )

  const visibleEdges = useMemo(
    () => filterVisibleEdges(edges, visibleNodeIds),
    [edges, visibleNodeIds],
  )

  return { visibleNodes, visibleEdges, visibleNodeIds }
}
