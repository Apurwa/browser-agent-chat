import { useMemo, useCallback } from 'react'
import { useGraphStore } from './GraphStore'
import type { AppNode } from './types'

const EXPLORATION_ICONS: Record<string, string> = {
  explored: '\u25CF', unknown: '\u25CB', exploring: '\u27F3', failed: '\u26A0',
}

interface GraphTreePanelProps {
  onCenterNode: (nodeId: string) => void
}

interface TreeNode {
  readonly node: AppNode
  readonly children: readonly TreeNode[]
}

function buildTree(nodes: readonly AppNode[]): readonly TreeNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const childrenMap = new Map<string, TreeNode[]>()

  // Initialize children lists
  for (const n of nodes) {
    childrenMap.set(n.id, [])
  }

  // Populate children
  for (const n of nodes) {
    if (n.parent && childrenMap.has(n.parent)) {
      const parentChildren = childrenMap.get(n.parent)!
      parentChildren.push({ node: n, children: [] })
    }
  }

  // Build tree recursively
  function resolveChildren(nodeId: string): readonly TreeNode[] {
    const raw = childrenMap.get(nodeId) ?? []
    return raw.map(child => ({
      ...child,
      children: resolveChildren(child.node.id),
    }))
  }

  // Root nodes have no parent
  const roots = nodes.filter(n => !n.parent || !nodeMap.has(n.parent))
  return roots.map(n => ({
    node: n,
    children: resolveChildren(n.id),
  }))
}

/** Collect IDs of nodes matching the search and their ancestors. */
function getSearchVisibleIds(
  nodes: readonly AppNode[],
  query: string,
): Set<string> {
  const lowerQuery = query.toLowerCase()
  const visibleIds = new Set<string>()
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  function addAncestors(nodeId: string): void {
    let current = nodeMap.get(nodeId)
    while (current) {
      if (visibleIds.has(current.id)) break
      visibleIds.add(current.id)
      current = current.parent ? nodeMap.get(current.parent) : undefined
    }
  }

  for (const n of nodes) {
    const matchesLabel = n.label.toLowerCase().includes(lowerQuery)
    const matchesUrl = (n.urlPattern ?? '').toLowerCase().includes(lowerQuery)
    if (matchesLabel || matchesUrl) {
      addAncestors(n.id)
    }
  }

  return visibleIds
}

/** Filter a tree to only show nodes in the allowed set. */
function filterTree(
  tree: readonly TreeNode[],
  allowedIds: Set<string>,
): readonly TreeNode[] {
  const result: TreeNode[] = []
  for (const treeNode of tree) {
    if (!allowedIds.has(treeNode.node.id)) continue
    const filteredChildren = filterTree(treeNode.children, allowedIds)
    result.push({ ...treeNode, children: filteredChildren })
  }
  return result
}

function TreeItem({
  treeNode,
  depth,
  selectedNodeId,
  expandedNodeIds,
  matchingIds,
  onSelect,
  onToggle,
}: {
  treeNode: TreeNode
  depth: number
  selectedNodeId: string | null
  expandedNodeIds: Set<string>
  matchingIds: Set<string> | null
  onSelect: (nodeId: string) => void
  onToggle: (nodeId: string) => void
}) {
  const { node, children } = treeNode
  const isSelected = node.id === selectedNodeId
  const isExpanded = expandedNodeIds.has(node.id)
  const hasChildren = children.length > 0
  const icon = EXPLORATION_ICONS[node.state.exploration] ?? '\u25CB'
  const isMatch = matchingIds !== null && matchingIds.has(node.id)

  const handleClick = useCallback(() => {
    onSelect(node.id)
  }, [node.id, onSelect])

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onToggle(node.id)
  }, [node.id, onToggle])

  // When search is active, show children of matching ancestors regardless of expand state
  const showChildren = hasChildren && (matchingIds !== null || isExpanded)

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
      <div
        className={`graph-tree-item ${isSelected ? 'graph-tree-item--selected' : ''} ${isMatch ? 'graph-tree-item--match' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={handleClick}
      >
        {hasChildren && (
          <button className="graph-tree-toggle" onClick={handleToggle} aria-label={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? '\u25BE' : '\u25B8'}
          </button>
        )}
        {!hasChildren && <span className="graph-tree-toggle-spacer" />}
        <span className="graph-tree-status" aria-label={node.state.exploration}>{icon}</span>
        <span className="graph-tree-label">{node.label}</span>
        {(node.featureCount ?? 0) > 0 && (
          <span className="graph-tree-count">{node.featureCount}</span>
        )}
      </div>
      {showChildren && (
        <ul className="graph-tree-children" role="group">
          {children.map(child => (
            <TreeItem
              key={child.node.id}
              treeNode={child}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              expandedNodeIds={expandedNodeIds}
              matchingIds={matchingIds}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function GraphTreePanel({ onCenterNode }: GraphTreePanelProps) {
  const nodes = useGraphStore(s => s.nodes)
  const expandedNodeIds = useGraphStore(s => s.expandedNodeIds)
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const selectNode = useGraphStore(s => s.selectNode)
  const toggleExpand = useGraphStore(s => s.toggleExpand)
  const searchQuery = useGraphStore(s => s.searchQuery)

  const tree = useMemo(() => buildTree(nodes), [nodes])

  // Compute search-visible IDs and direct match IDs
  const { filteredTree, matchingIds } = useMemo(() => {
    const trimmed = searchQuery.trim()
    if (trimmed.length === 0) {
      return { filteredTree: tree, matchingIds: null }
    }
    const visibleIds = getSearchVisibleIds(nodes, trimmed)
    const lowerQuery = trimmed.toLowerCase()
    const directMatches = new Set<string>()
    for (const n of nodes) {
      if (
        n.label.toLowerCase().includes(lowerQuery) ||
        (n.urlPattern ?? '').toLowerCase().includes(lowerQuery)
      ) {
        directMatches.add(n.id)
      }
    }
    return {
      filteredTree: filterTree(tree, visibleIds),
      matchingIds: directMatches,
    }
  }, [tree, nodes, searchQuery])

  const handleSelect = useCallback((nodeId: string) => {
    selectNode(nodeId)
    onCenterNode(nodeId)
  }, [selectNode, onCenterNode])

  // Group nodes by exploration state for the activity section
  const activityGroups = useMemo(() => {
    const groups: Record<string, AppNode[]> = {
      exploring: [],
      failed: [],
      unknown: [],
      explored: [],
    }
    for (const n of nodes) {
      const state = n.state.exploration
      if (groups[state]) {
        groups[state].push(n)
      }
    }
    return groups
  }, [nodes])

  return (
    <div className="graph-tree-panel">
      <div className="graph-tree-header">Navigator</div>
      <div className="graph-tree-list">
        <ul role="tree">
          {filteredTree.map(treeNode => (
            <TreeItem
              key={treeNode.node.id}
              treeNode={treeNode}
              depth={0}
              selectedNodeId={selectedNodeId}
              expandedNodeIds={expandedNodeIds}
              matchingIds={matchingIds}
              onSelect={handleSelect}
              onToggle={toggleExpand}
            />
          ))}
        </ul>
      </div>
      <div className="graph-tree-activity">
        <div className="graph-tree-activity-header">Agent Activity</div>
        {activityGroups.exploring.length > 0 && (
          <div className="graph-tree-activity-group">
            <span className="graph-tree-activity-label">{'\u27F3'} Exploring</span>
            {activityGroups.exploring.map(n => (
              <button key={n.id} className="graph-tree-activity-item" onClick={() => handleSelect(n.id)}>
                {n.label}
              </button>
            ))}
          </div>
        )}
        {activityGroups.failed.length > 0 && (
          <div className="graph-tree-activity-group">
            <span className="graph-tree-activity-label">{'\u26A0'} Failed</span>
            {activityGroups.failed.map(n => (
              <button key={n.id} className="graph-tree-activity-item graph-tree-activity-item--failed" onClick={() => handleSelect(n.id)}>
                {n.label}
              </button>
            ))}
          </div>
        )}
        {activityGroups.unknown.length > 0 && (
          <div className="graph-tree-activity-group">
            <span className="graph-tree-activity-label">{'\u25CB'} Unexplored ({activityGroups.unknown.length})</span>
          </div>
        )}
      </div>
    </div>
  )
}
