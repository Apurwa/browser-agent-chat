import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

const CRITICALITY_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#D4874D', medium: '#3D6B4F', low: '#443E35',
}

function FeatureNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>
  const borderColor = CRITICALITY_COLORS[(d.criticality as string) ?? 'low'] ?? 'var(--border-primary)'
  return (
    <div className="graph-node graph-node--feature" aria-label={`Feature: ${d.label}`}>
      <Handle type="target" position={Position.Top} className="graph-node-handle" />
      <div className="graph-node-card" style={{ borderLeftColor: borderColor }}>
        <span className="graph-node-title">{d.label as string}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="graph-node-handle" />
    </div>
  )
}

export default memo(FeatureNode)
