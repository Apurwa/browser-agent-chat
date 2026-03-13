import { useState } from 'react';
import type { Suggestion, FeatureSuggestionData, FlowSuggestionData, BehaviorSuggestionData } from '../types';
import {
  Sparkles,
  GitBranch,
  ListChecks,
  Check,
  X,
  Pencil,
  Save,
} from 'lucide-react';

interface SuggestionCardProps {
  suggestion: Suggestion;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onEdit: (id: string, data: Suggestion['data']) => void;
}

const TYPE_META: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  feature:  { label: 'Feature',  className: 'mv-stype--feature',  icon: <Sparkles size={11} /> },
  flow:     { label: 'Flow',     className: 'mv-stype--flow',     icon: <GitBranch size={11} /> },
  behavior: { label: 'Behavior', className: 'mv-stype--behavior', icon: <ListChecks size={11} /> },
};

export default function SuggestionCard({ suggestion, onAccept, onDismiss, onEdit }: SuggestionCardProps) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(JSON.stringify(suggestion.data, null, 2));

  const handleSaveEdit = () => {
    try {
      const parsed = JSON.parse(editData);
      onEdit(suggestion.id, parsed);
      setEditing(false);
    } catch {
      // Invalid JSON — ignore
    }
  };

  const meta = TYPE_META[suggestion.type] ?? TYPE_META.feature;
  const d = suggestion.data;

  let name = '';
  let desc = '';
  if (suggestion.type === 'feature') {
    const fd = d as FeatureSuggestionData;
    name = fd.name;
    desc = fd.description || '';
  } else if (suggestion.type === 'flow') {
    const fd = d as FlowSuggestionData;
    name = fd.name;
    desc = `${fd.feature_name} \u2192 ${fd.steps.map(s => s.description).join(' \u2192 ')}`;
  } else {
    const bd = d as BehaviorSuggestionData;
    name = bd.feature_name;
    desc = bd.behavior;
  }

  if (editing) {
    return (
      <div className="mv-scard mv-scard--editing">
        <textarea
          className="mv-scard-editor"
          value={editData}
          onChange={e => setEditData(e.target.value)}
          rows={8}
        />
        <div className="mv-scard-actions">
          <button className="mv-btn mv-btn-accept" onClick={handleSaveEdit}>
            <Save size={12} /> Save
          </button>
          <button className="mv-btn mv-btn-ghost" onClick={() => setEditing(false)}>
            <X size={12} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mv-scard">
      <div className="mv-scard-top">
        <span className={`mv-stype ${meta.className}`}>
          {meta.icon} {meta.label}
        </span>
        <span className="mv-scard-name">{name}</span>
      </div>
      {desc && <p className="mv-scard-desc">{desc}</p>}
      <div className="mv-scard-actions">
        <button className="mv-btn mv-btn-accept" onClick={() => onAccept(suggestion.id)}>
          <Check size={12} /> Accept
        </button>
        <button className="mv-btn mv-btn-ghost" onClick={() => setEditing(true)}>
          <Pencil size={12} /> Edit
        </button>
        <button className="mv-btn mv-btn-dismiss" onClick={() => onDismiss(suggestion.id)}>
          <X size={12} /> Dismiss
        </button>
      </div>
    </div>
  );
}
