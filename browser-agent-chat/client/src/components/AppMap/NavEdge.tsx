import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

function NavEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8 });
  const isUnexplored = (data as Record<string, unknown>)?.isUnexplored === true;
  const actionLabel = (data as Record<string, unknown>)?.actionLabel as string | undefined;

  // Truncate label to 24 chars
  const label = actionLabel && actionLabel.length > 24
    ? actionLabel.substring(0, 22) + '...'
    : actionLabel;

  return (
    <>
      <BaseEdge
        {...props}
        path={edgePath}
        style={{
          stroke: 'var(--border-secondary, #443E35)',
          strokeWidth: 1.5,
          strokeDasharray: isUnexplored ? '4' : 'none',
        }}
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
