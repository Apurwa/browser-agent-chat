import { useState } from 'react';
import type { Suggestion, FeatureSuggestionData, FlowSuggestionData, BehaviorSuggestionData } from '../types';

interface SuggestionCardProps {
  suggestion: Suggestion;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onEdit: (id: string, data: Suggestion['data']) => void;
}

export default function SuggestionCard({ suggestion, onAccept, onDismiss, onEdit }: SuggestionCardProps) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(JSON.stringify(suggestion.data, null, 2));

  const handleSaveEdit = () => {
    try {
      const parsed = JSON.parse(editData);
      onEdit(suggestion.id, parsed);
      setEditing(false);
    } catch {
      // Invalid JSON
    }
  };

  const typeBadge = {
    feature: <span className="severity-badge" style={{ background: '#7c5cff22', color: '#7c5cff' }}>NEW FEATURE</span>,
    flow: <span className="severity-badge" style={{ background: '#00b89422', color: '#00b894' }}>NEW FLOW</span>,
    behavior: <span className="severity-badge" style={{ background: '#74b9ff22', color: '#74b9ff' }}>ADD BEHAVIOR</span>,
  }[suggestion.type];

  if (editing) {
    return (
      <div className="memory-item" style={{ padding: '1rem' }}>
        <textarea
          value={editData}
          onChange={e => setEditData(e.target.value)}
          rows={8}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem', background: '#1a1a2e', color: '#ccc', border: '1px solid #2a2a2e', borderRadius: '4px', padding: '0.5rem' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button className="btn-add" onClick={handleSaveEdit}>Save</button>
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  const d = suggestion.data;

  return (
    <div className="memory-item" style={{ padding: '0.8rem' }}>
      <div className="memory-item-header">
        {suggestion.type === 'feature' && (
          <>
            <span className="memory-item-name">{(d as FeatureSuggestionData).name}</span>
            <span className={`severity-badge severity-${(d as FeatureSuggestionData).criticality}`}>
              {(d as FeatureSuggestionData).criticality.toUpperCase()}
            </span>
          </>
        )}
        {suggestion.type === 'flow' && (
          <>
            <span className="memory-item-name">
              {(d as FlowSuggestionData).feature_name} → {(d as FlowSuggestionData).name}
            </span>
            <span className={`severity-badge severity-${(d as FlowSuggestionData).criticality}`}>
              {(d as FlowSuggestionData).criticality.toUpperCase()}
            </span>
          </>
        )}
        {suggestion.type === 'behavior' && (
          <span className="memory-item-name">{(d as BehaviorSuggestionData).feature_name}</span>
        )}
        {typeBadge}
      </div>
      <div className="memory-item-meta" style={{ marginTop: '0.3rem' }}>
        {suggestion.type === 'feature' && (d as FeatureSuggestionData).description}
        {suggestion.type === 'flow' && (d as FlowSuggestionData).steps.map(s => s.description).join(' → ')}
        {suggestion.type === 'behavior' && (d as BehaviorSuggestionData).behavior}
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
        <button className="btn-add" onClick={() => onAccept(suggestion.id)} title="Accept">✓ Accept</button>
        <button onClick={() => setEditing(true)} title="Edit">✏️ Edit</button>
        <button onClick={() => onDismiss(suggestion.id)} title="Dismiss" style={{ color: '#da3633' }}>✕ Dismiss</button>
      </div>
    </div>
  );
}
