import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { Feature, Criticality } from '../types';
import {
  Trash2,
  Plus,
  X,
  CircleDot,
  Route,
  ListChecks,
  Diamond,
  ArrowRight,
} from 'lucide-react';

interface FeatureDetailProps {
  feature: Feature;
  agentId: string;
  onUpdate: (featureId: string, updates: Partial<Feature>) => void;
  onDelete: (featureId: string) => void;
  onReload: () => void;
}

export default function FeatureDetail({ feature, agentId, onUpdate, onDelete, onReload }: FeatureDetailProps) {
  const { getAccessToken } = useAuth();
  const [newBehavior, setNewBehavior] = useState('');
  const [newFlowName, setNewFlowName] = useState('');
  const [newFlowCriticality, setNewFlowCriticality] = useState<Criticality>('medium');
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    await fetch(`/api/agents/${agentId}/memory/features/${feature.id}/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newFlowName, steps: [], criticality: newFlowCriticality }),
    });
    setNewFlowName('');
    onReload();
  };

  const deleteFlow = async (flowId: string) => {
    const token = await getAccessToken();
    await fetch(`/api/agents/${agentId}/memory/flows/${flowId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    onReload();
  };

  return (
    <div className="mv-detail">
      {/* Header */}
      <div className="mv-detail-head">
        <div className="mv-detail-head-left">
          <h2 className="mv-detail-title">{feature.name}</h2>
          <span className={`mv-crit-label mv-crit-label--${feature.criticality}`}>
            {feature.criticality}
          </span>
        </div>
        {!confirmDelete ? (
          <button
            className="mv-btn mv-btn-dismiss mv-btn-sm"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={12} /> Delete
          </button>
        ) : (
          <div className="mv-detail-confirm-delete">
            <span>Delete this feature?</span>
            <button className="mv-btn mv-btn-dismiss mv-btn-sm" onClick={() => onDelete(feature.id)}>Yes, delete</button>
            <button className="mv-btn mv-btn-ghost mv-btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        )}
      </div>

      {feature.description && (
        <p className="mv-detail-desc">{feature.description}</p>
      )}

      {/* Expected Behaviors */}
      <section className="mv-section">
        <h3 className="mv-section-title">
          <ListChecks size={13} /> Expected Behaviors
        </h3>
        <div className="mv-behaviors">
          {feature.expected_behaviors.map((b, i) => (
            <div key={i} className="mv-behavior">
              <CircleDot size={10} className="mv-behavior-icon" />
              <span className="mv-behavior-text">{b}</span>
              <button className="mv-behavior-remove" onClick={() => removeBehavior(i)} title="Remove">
                <X size={14} />
              </button>
            </div>
          ))}
          {feature.expected_behaviors.length === 0 && (
            <p className="mv-muted">No behaviors defined yet.</p>
          )}
        </div>
        <div className="mv-inline-add">
          <input
            className="mv-input"
            placeholder="Add expected behavior..."
            value={newBehavior}
            onChange={e => setNewBehavior(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addBehavior()}
          />
          <button className="mv-btn mv-btn-outline" onClick={addBehavior}>
            <Plus size={13} /> Add
          </button>
        </div>
      </section>

      {/* Flows */}
      <section className="mv-section">
        <h3 className="mv-section-title">
          <Route size={13} /> Flows
        </h3>
        <div className="mv-flows">
          {feature.flows?.map(flow => (
            <div key={flow.id} className="mv-flow">
              <div className="mv-flow-head">
                <span className="mv-flow-name">{flow.name}</span>
                <span className={`mv-crit-label mv-crit-label--${flow.criticality}`}>
                  {flow.criticality}
                </span>
                <button className="mv-behavior-remove" onClick={() => deleteFlow(flow.id)} title="Delete flow">
                  <X size={14} />
                </button>
              </div>
              {flow.steps.length > 0 && (
                <div className="mv-flow-steps">
                  {flow.steps.map((s, i) => (
                    <span key={i} className="mv-flow-step">
                      {i > 0 && <ArrowRight size={10} className="mv-flow-arrow-icon" />}
                      {s.description}
                    </span>
                  ))}
                </div>
              )}
              {flow.checkpoints.length > 0 && (
                <div className="mv-flow-checkpoints">
                  {flow.checkpoints.map((cp, i) => (
                    <div key={i} className="mv-checkpoint">
                      <Diamond size={8} className="mv-checkpoint-icon" />
                      <span>{cp.description}</span>
                      <span className="mv-checkpoint-expected">expect: {cp.expected}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {(!feature.flows || feature.flows.length === 0) && (
            <p className="mv-muted">No flows defined yet.</p>
          )}
        </div>
        <div className="mv-inline-add">
          <input
            className="mv-input"
            placeholder="Flow name"
            value={newFlowName}
            onChange={e => setNewFlowName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addFlow()}
          />
          <select
            className="mv-select"
            value={newFlowCriticality}
            onChange={e => setNewFlowCriticality(e.target.value as Criticality)}
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button className="mv-btn mv-btn-outline" onClick={addFlow}>
            <Plus size={13} /> Add Flow
          </button>
        </div>
      </section>
    </div>
  );
}
