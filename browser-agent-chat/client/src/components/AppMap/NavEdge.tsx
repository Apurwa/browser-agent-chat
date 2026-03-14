import { memo } from 'react';
import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';

function NavEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, data } = props;
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const isUnexplored = (data as Record<string, unknown>)?.isUnexplored === true;

  return (
    <BaseEdge
      {...props}
      path={edgePath}
      style={{
        stroke: '#1e293b',
        strokeWidth: 1.5,
        strokeDasharray: isUnexplored ? '4' : 'none',
      }}
    />
  );
}

export default memo(NavEdge);
