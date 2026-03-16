import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

function RootNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>
  return (
    <div className="graph-node graph-node--root" aria-label={`Root: ${d.label}`}>
      <Handle type="target" position={Position.Top} className="graph-node-handle" />
      <div className="graph-node-card">
        <span className="graph-node-status" aria-label={d.explorationLabel as string}>
          {d.explorationIcon as string}
        </span>
        <span className="graph-node-title">{d.label as string}</span>
      </div>
      <span className="graph-node-url">{d.urlPattern as string}</span>
      <Handle type="source" position={Position.Bottom} className="graph-node-handle" />
    </div>
  )
}

export default memo(RootNode)
