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
  critical: '#ef4444', high: '#D4874D', medium: '#3D6B4F', low: '#443E35',
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
  const borderColor = CRITICALITY_COLORS[getHighestCriticality(d.features)] || 'var(--border-secondary)';
  const pendingCount = d.pendingSuggestions.length;
  const isUnexplored = featureCount === 0 && pendingCount === 0;

  return (
    <div className={`page-node ${d.isNew ? 'page-node--new' : ''} ${d.isSelected ? 'page-node--selected' : ''} ${isUnexplored ? 'page-node--unexplored' : ''}`}>
      <Handle type="target" position={Position.Top} className="page-node-handle" />

      <div className="page-node-card" style={{ borderLeftColor: borderColor }}>
        <div className="page-node-header">
          <span className="page-node-title" title={d.pageTitle || 'Untitled'}>
            {d.pageTitle || 'Untitled'}
          </span>
          {featureCount > 0 && (
            <span className="page-node-badge" style={{ background: borderColor }}>
              {featureCount}
            </span>
          )}
        </div>
        <span className="page-node-url" title={d.urlPattern}>
          {d.urlPattern}
        </span>
        {isUnexplored && (
          <span className="page-node-unexplored-label">unexplored</span>
        )}
      </div>

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
