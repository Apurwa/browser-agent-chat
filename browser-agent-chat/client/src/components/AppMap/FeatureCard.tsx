import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { apiAuthFetch } from '../../lib/api';
import type { MapFeature } from './useAppMap';

const CRITICALITY_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#D4874D', medium: '#3D6B4F', low: '#443E35',
};

interface FeatureCardProps {
  feature: MapFeature;
  projectId: string;
  pageTitle: string;
  urlPattern: string;
  onSendTask: (task: string) => void;
  onRefresh: () => void;
}

export default function FeatureCard({
  feature, projectId, pageTitle, urlPattern, onSendTask, onRefresh,
}: FeatureCardProps) {
  const { getAccessToken } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const borderColor = CRITICALITY_COLORS[feature.criticality] || '#334155';

  const handleTest = () => {
    const behaviors = feature.expected_behaviors.length > 0
      ? ` Verify: ${feature.expected_behaviors.join(', ')}`
      : '';
    onSendTask(`Test the ${feature.name} feature on ${pageTitle} (${urlPattern}).${behaviors}`);
  };

  const handleRemove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    try {
      const token = await getAccessToken();
      await apiAuthFetch(`/api/agents/${projectId}/memory/features/${feature.id}`, token, {
        method: 'DELETE',
      });
      onRefresh();
    } catch (err) {
      console.error('Failed to delete feature:', err);
    }
  };

  return (
    <div className="feature-card" style={{ borderLeft: `3px solid ${borderColor}` }}>
      <div className="feature-card-header">
        <span className="feature-card-name">{feature.name}</span>
        <div className="feature-card-actions">
          <button className="feature-action feature-action--test" onClick={handleTest} title="Send test task to agent">
            test
          </button>
          <button
            className={`feature-action ${confirmDelete ? 'feature-action--confirm' : 'feature-action--remove'}`}
            onClick={handleRemove}
            title={confirmDelete ? 'Click again to confirm' : 'Remove feature'}
            onBlur={() => setConfirmDelete(false)}
          >
            {confirmDelete ? 'confirm?' : '\u2717'}
          </button>
        </div>
      </div>
      {feature.description && (
        <div className="feature-card-desc">{feature.description}</div>
      )}
      {feature.expected_behaviors.length > 0 && (
        <div className="feature-card-behaviors">
          {feature.expected_behaviors.map((b, i) => (
            <span key={i} className="behavior-chip">{'\u2713'} {b}</span>
          ))}
        </div>
      )}
      {feature.flows && feature.flows.length > 0 && (
        <div className="feature-card-flows">
          {feature.flows.map(f => (
            <span key={f.id} className="flow-chip">
              {'\u21B3'} {f.name} ({f.steps.length} steps)
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
