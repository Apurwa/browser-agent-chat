import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

function NavEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const d = data as Record<string, unknown> | undefined;
  const isUnexplored = d?.isUnexplored === true;
  const isCrossLink = d?.edgeType === 'cross-link';
  const actionLabel = d?.actionLabel as string | undefined;

  // Cross-links use bezier curves; navigation edges use smooth-step
  const [edgePath, labelX, labelY] = isCrossLink
    ? getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
    : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8 });

  // Truncate label to 24 chars
  const label = actionLabel && actionLabel.length > 24
    ? actionLabel.substring(0, 22) + '...'
    : actionLabel;

  const edgeStyle = isCrossLink
    ? {
        stroke: 'var(--accent, #D4874D)',
        strokeWidth: 1.2,
        strokeDasharray: '6 3',
        opacity: 0.6,
      }
    : {
        stroke: 'var(--border-secondary, #443E35)',
        strokeWidth: 1.5,
        strokeDasharray: isUnexplored ? '4' : 'none',
      };

  return (
    <>
      <BaseEdge
        {...props}
        path={edgePath}
        style={edgeStyle}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="app-graph-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(NavEdge);
