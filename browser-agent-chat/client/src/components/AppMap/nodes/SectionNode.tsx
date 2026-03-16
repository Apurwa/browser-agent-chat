import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useGraphStore } from '../GraphStore'

function SectionNode({ data, id }: NodeProps) {
  const d = data as Record<string, unknown>
  const toggleExpand = useGraphStore(s => s.toggleExpand)
  const expandedNodeIds = useGraphStore(s => s.expandedNodeIds)
  const isExpanded = expandedNodeIds.has(id)
  const hasChildren = ((d.childIds as string[]) ?? []).length > 0

  const handleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    toggleExpand(id)
  }, [id, toggleExpand])

  return (
    <div className={`graph-node graph-node--section ${isExpanded ? 'graph-node--expanded' : ''}`}
         aria-label={`Section: ${d.label}`}>
      <Handle type="target" position={Position.Top} className="graph-node-handle" />
      <div className="graph-node-card">
        <span className="graph-node-status" aria-label={d.explorationLabel as string}>
          {d.explorationIcon as string}
        </span>
        <span className="graph-node-title">{d.label as string}</span>
        {(d.featureCount as number) > 0 && (
          <span className="graph-node-badge">{d.featureCount as number}</span>
        )}
      </div>
      <span className="graph-node-url">{d.urlPattern as string}</span>
      {hasChildren && (
        <button className="graph-node-expand" onClick={handleExpand}
                aria-label={isExpanded ? `Collapse ${d.label}` : `Expand ${d.label}`}>
          {isExpanded ? '\u25B4' : '\u25BE'}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="graph-node-handle" />
    </div>
  )
}

export default memo(SectionNode)
