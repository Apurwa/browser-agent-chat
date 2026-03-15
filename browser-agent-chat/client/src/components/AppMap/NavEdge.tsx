import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

function NavEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [edgePath] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8 });
  const isUnexplored = (data as Record<string, unknown>)?.isUnexplored === true;

  return (
    <BaseEdge
      {...props}
      path={edgePath}
      style={{
        stroke: 'var(--border-secondary, #443E35)',
        strokeWidth: 1.5,
        strokeDasharray: isUnexplored ? '4' : 'none',
      }}
    />
  );
}

export default memo(NavEdge);
