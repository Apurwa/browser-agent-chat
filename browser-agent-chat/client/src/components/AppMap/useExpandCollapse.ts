import { useMemo } from 'react'
import { useGraphStore } from './GraphStore'
import type { AppNode, AppEdge } from './types'
import { MAX_VISIBLE_NODES, MAX_CROSS_LINKS_PER_NODE } from './types'

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
  return edges.filter(
    e => e.type !== 'cross-link' &&
    visibleNodeIds.has(e.source) &&
    visibleNodeIds.has(e.target),
  )
}

export function filterCrossLinks(
  edges: readonly AppEdge[],
  visibleNodeIds: Set<string>,
): AppEdge[] {
  // Only include cross-links where both endpoints are visible
  const visible = edges.filter(
    e => e.type === 'cross-link' &&
    visibleNodeIds.has(e.source) &&
    visibleNodeIds.has(e.target),
  )

  // Limit to MAX_CROSS_LINKS_PER_NODE per node
  const countByNode = new Map<string, number>()
  return visible.filter(e => {
    const sourceCount = countByNode.get(e.source) ?? 0
    const targetCount = countByNode.get(e.target) ?? 0
    if (sourceCount >= MAX_CROSS_LINKS_PER_NODE || targetCount >= MAX_CROSS_LINKS_PER_NODE) {
      return false
    }
    countByNode.set(e.source, sourceCount + 1)
    countByNode.set(e.target, targetCount + 1)
    return true
  })
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

  const visibleEdges = useMemo(() => {
    const navEdges = filterVisibleEdges(edges, visibleNodeIds)
    const crossLinks = filterCrossLinks(edges, visibleNodeIds)
    return [...navEdges, ...crossLinks]
  }, [edges, visibleNodeIds])

  return { visibleNodes, visibleEdges, visibleNodeIds }
}
