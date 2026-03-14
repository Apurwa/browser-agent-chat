import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { MapFeature, MapSuggestion } from './useAppMap';

export interface PageNodeData {
  pageTitle: string;
  urlPattern: string;
  features: MapFeature[];
  pendingSuggestions: MapSuggestion[];
  isNew?: boolean;
  isSelected?: boolean;
  [key: string]: unknown;
}

const CRITICALITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

const CRITICALITY_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f59e0b', medium: '#a78bfa', low: '#334155',
};

function getHighestCriticality(features: Array<{ criticality: string }>): string {
  if (features.length === 0) return 'low';
  return features.reduce((highest, f) => {
    return (CRITICALITY_ORDER[f.criticality] ?? 3) < (CRITICALITY_ORDER[highest] ?? 3)
      ? f.criticality : highest;
  }, 'low' as string);
}

function PageNode({ data }: NodeProps) {
  const d = data as PageNodeData;
  const featureCount = d.features.length;
  const radius = Math.max(20, Math.min(40, 20 + featureCount * 4));
  const borderColor = CRITICALITY_COLORS[getHighestCriticality(d.features)] || '#334155';
  const pendingCount = d.pendingSuggestions.length;
  const isUnexplored = featureCount === 0 && pendingCount === 0;

  return (
    <div className={`page-node ${d.isNew ? 'page-node--new' : ''} ${d.isSelected ? 'page-node--selected' : ''} ${isUnexplored ? 'page-node--unexplored' : ''}`}>
      <Handle type="target" position={Position.Top} className="page-node-handle" />
      <svg width={radius * 2 + 16} height={radius * 2 + 16} viewBox={`0 0 ${radius * 2 + 16} ${radius * 2 + 16}`}>
        {d.isSelected && (
          <>
            <circle cx={radius + 8} cy={radius + 8} r={radius + 6} fill="none" stroke={borderColor} strokeWidth={1} opacity={0.3} />
            <circle cx={radius + 8} cy={radius + 8} r={radius + 10} fill="none" stroke={borderColor} strokeWidth={0.5} opacity={0.15} />
          </>
        )}
        <circle cx={radius + 8} cy={radius + 8} r={radius} fill="#0f172a" stroke={borderColor}
          strokeWidth={isUnexplored ? 1 : 2} strokeDasharray={isUnexplored ? '4' : 'none'} />
        <text x={radius + 8} y={radius + 5} textAnchor="middle" fill="#e2e8f0" fontSize={featureCount > 3 ? 9 : 10} fontWeight={d.isSelected ? 'bold' : 'normal'}>
          {d.pageTitle || 'Untitled'}
        </text>
        <text x={radius + 8} y={radius + 17} textAnchor="middle" fill="#64748b" fontSize={7}>
          {d.urlPattern}
        </text>
        {featureCount > 0 && (
          <>
            <circle cx={radius * 2 - 2} cy={12} r={9} fill={borderColor} />
            <text x={radius * 2 - 2} y={16} textAnchor="middle" fill="white" fontSize={9} fontWeight="bold">
              {featureCount}
            </text>
          </>
        )}
        {isUnexplored && (
          <text x={radius + 8} y={radius + 28} textAnchor="middle" fill="#475569" fontSize={7}>
            unexplored
          </text>
        )}
      </svg>
      {pendingCount > 0 && (
        <div className="page-node-pending" title={`${pendingCount} pending suggestion(s)`}>
          {pendingCount}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="page-node-handle" />
    </div>
  );
}

export default memo(PageNode);
