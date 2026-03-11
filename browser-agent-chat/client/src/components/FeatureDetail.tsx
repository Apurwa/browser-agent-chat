import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { Feature, Criticality } from '../types';

interface FeatureDetailProps {
  feature: Feature;
  projectId: string;
  onUpdate: (featureId: string, updates: Partial<Feature>) => void;
  onDelete: (featureId: string) => void;
  onReload: () => void;
}

export default function FeatureDetail({ feature, projectId, onUpdate, onDelete, onReload }: FeatureDetailProps) {
  const { getAccessToken } = useAuth();
  const [newBehavior, setNewBehavior] = useState('');
  const [newFlowName, setNewFlowName] = useState('');
  const [newFlowCriticality, setNewFlowCriticality] = useState<Criticality>('medium');

  const addBehavior = () => {
    if (!newBehavior) return;
    onUpdate(feature.id, {
      expected_behaviors: [...feature.expected_behaviors, newBehavior],
    });
    setNewBehavior('');
  };

  const removeBehavior = (index: number) => {
    onUpdate(feature.id, {
      expected_behaviors: feature.expected_behaviors.filter((_, i) => i !== index),
    });
  };

  const addFlow = async () => {
    if (!newFlowName) return;
    const token = await getAccessToken();
    await fetch(`/api/projects/${projectId}/memory/features/${feature.id}/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newFlowName, steps: [], criticality: newFlowCriticality }),
    });
    setNewFlowName('');
    onReload();
  };

  const deleteFlow = async (flowId: string) => {
    const token = await getAccessToken();
    await fetch(`/api/projects/${projectId}/memory/flows/${flowId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    onReload();
  };

  return (
    <div className="feature-detail">
      <div className="feature-detail-header">
        <h2>{feature.name}</h2>
        <span className={`severity-badge severity-${feature.criticality}`}>{feature.criticality.toUpperCase()}</span>
        <button className="btn-danger btn-sm" onClick={() => onDelete(feature.id)}>Delete</button>
      </div>
      {feature.description && <p className="feature-description">{feature.description}</p>}

      <section className="feature-section">
        <h3>Expected Behaviors</h3>
        <div className="behavior-list">
          {feature.expected_behaviors.map((b, i) => (
            <div key={i} className="behavior-item">
              <span>{b}</span>
              <button className="btn-icon" onClick={() => removeBehavior(i)}>x</button>
            </div>
          ))}
        </div>
        <div className="behavior-add">
          <input
            placeholder="Add expected behavior..."
            value={newBehavior}
            onChange={e => setNewBehavior(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addBehavior()}
          />
          <button onClick={addBehavior}>Add</button>
        </div>
      </section>

      <section className="feature-section">
        <h3>Flows</h3>
        {feature.flows?.map(flow => (
          <div key={flow.id} className="flow-card">
            <div className="flow-card-header">
              <span className="flow-name">{flow.name}</span>
              <span className={`severity-badge severity-${flow.criticality}`}>{flow.criticality.toUpperCase()}</span>
              <button className="btn-icon" onClick={() => deleteFlow(flow.id)}>x</button>
            </div>
            {flow.steps.length > 0 && (
              <div className="flow-steps">
                {flow.steps.map((s, i) => (
                  <span key={i} className="flow-step-pill">
                    {i > 0 && <span className="flow-arrow">-></span>}
                    {s.description}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="flow-add">
          <input placeholder="Flow name" value={newFlowName} onChange={e => setNewFlowName(e.target.value)} />
          <select value={newFlowCriticality} onChange={e => setNewFlowCriticality(e.target.value as Criticality)}>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button onClick={addFlow}>Add Flow</button>
        </div>
      </section>
    </div>
  );
}
