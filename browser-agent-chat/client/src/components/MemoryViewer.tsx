import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import FeatureDetail from './FeatureDetail';
import SuggestionCard from './SuggestionCard';
import { useAuth } from '../hooks/useAuth';
import { useWS } from '../contexts/WebSocketContext';
import type { Feature, Criticality, Suggestion } from '../types';
import {
  fetchPendingSuggestions,
  acceptSuggestionApi,
  dismissSuggestionApi,
  updateSuggestionApi,
  bulkAcceptSuggestionsApi,
  bulkDismissSuggestionsApi,
} from '../lib/api';

export default function MemoryViewer() {
  const { id } = useParams();
  const { getAccessToken } = useAuth();
  const { resetSuggestionCount, decrementSuggestionCount, pendingSuggestionCount } = useWS();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [selected, setSelected] = useState<Feature | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCriticality, setNewCriticality] = useState<Criticality>('medium');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => { loadFeatures(); }, [id]);
  useEffect(() => { loadSuggestions(); }, [id]);
  useEffect(() => { loadSuggestions(); }, [pendingSuggestionCount]);

  const loadSuggestions = async () => {
    if (!id) return;
    const token = await getAccessToken();
    try {
      const data = await fetchPendingSuggestions(id, token);
      setSuggestions(data);
    } catch (err) {
      console.error('Failed to load suggestions:', err);
    }
  };

  const handleAcceptSuggestion = async (suggestionId: string) => {
    const token = await getAccessToken();
    await acceptSuggestionApi(id!, suggestionId, token);
    setSuggestions(prev => prev.filter(s => s.id !== suggestionId));
    decrementSuggestionCount();
    await loadFeatures();
  };

  const handleDismissSuggestion = async (suggestionId: string) => {
    const token = await getAccessToken();
    await dismissSuggestionApi(id!, suggestionId, token);
    setSuggestions(prev => prev.filter(s => s.id !== suggestionId));
    decrementSuggestionCount();
  };

  const handleEditSuggestion = async (suggestionId: string, data: Suggestion['data']) => {
    const token = await getAccessToken();
    const updated = await updateSuggestionApi(id!, suggestionId, data, token);
    if (updated) {
      setSuggestions(prev => prev.map(s => s.id === suggestionId ? updated : s));
    }
  };

  const handleAcceptAll = async () => {
    const token = await getAccessToken();
    await bulkAcceptSuggestionsApi(id!, token);
    setSuggestions([]);
    resetSuggestionCount();
    await loadFeatures();
  };

  const handleDismissAll = async () => {
    const token = await getAccessToken();
    await bulkDismissSuggestionsApi(id!, token);
    setSuggestions([]);
    resetSuggestionCount();
  };

  const loadFeatures = async () => {
    const token = await getAccessToken();
    const res = await fetch(`/api/projects/${id}/memory/features`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setFeatures(data.features);
      if (!selected && data.features.length > 0) setSelected(data.features[0]);
    }
  };

  const handleAddFeature = async () => {
    if (!newName) return;
    const token = await getAccessToken();
    const res = await fetch(`/api/projects/${id}/memory/features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newName, criticality: newCriticality }),
    });
    if (res.ok) {
      setNewName('');
      setShowAdd(false);
      await loadFeatures();
    }
  };

  const handleUpdateFeature = async (featureId: string, updates: Partial<Feature>) => {
    const token = await getAccessToken();
    await fetch(`/api/projects/${id}/memory/features/${featureId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(updates),
    });
    await loadFeatures();
  };

  const handleDeleteFeature = async (featureId: string) => {
    const token = await getAccessToken();
    await fetch(`/api/projects/${id}/memory/features/${featureId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setSelected(null);
    await loadFeatures();
  };

  const critIcon = (c: Criticality) =>
    c === 'critical' ? '!!' : c === 'high' ? '!' : c === 'medium' ? '-' : '~';

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="mv">
        {/* Suggestions banner */}
        {suggestions.length > 0 && (
          <div className="mv-suggestions">
            <div className="mv-suggestions-bar">
              <div className="mv-suggestions-title">
                <span className="mv-pulse" />
                <span className="mv-suggestions-label">
                  {suggestions.length} pending suggestion{suggestions.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="mv-suggestions-btns">
                <button className="mv-btn mv-btn-accept" onClick={handleAcceptAll}>
                  Accept all
                </button>
                <button className="mv-btn mv-btn-ghost" onClick={handleDismissAll}>
                  Dismiss all
                </button>
              </div>
            </div>
            <div className="mv-suggestions-grid">
              {suggestions.map(s => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  onAccept={handleAcceptSuggestion}
                  onDismiss={handleDismissSuggestion}
                  onEdit={handleEditSuggestion}
                />
              ))}
            </div>
          </div>
        )}

        {/* Main content: feature list + detail */}
        <div className="mv-body">
          <div className="mv-list">
            <div className="mv-list-top">
              <h2 className="mv-list-title">
                Features
                <span className="mv-count">{features.length}</span>
              </h2>
              <button className="mv-btn mv-btn-outline" onClick={() => setShowAdd(true)}>
                + New
              </button>
            </div>

            {showAdd && (
              <div className="mv-add-form">
                <input
                  className="mv-input"
                  placeholder="Feature name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddFeature()}
                  autoFocus
                />
                <select
                  className="mv-select"
                  value={newCriticality}
                  onChange={e => setNewCriticality(e.target.value as Criticality)}
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <div className="mv-add-form-btns">
                  <button className="mv-btn mv-btn-accept" onClick={handleAddFeature}>Add</button>
                  <button className="mv-btn mv-btn-ghost" onClick={() => { setShowAdd(false); setNewName(''); }}>Cancel</button>
                </div>
              </div>
            )}

            <div className="mv-items">
              {features.length === 0 && (
                <div className="mv-empty">
                  <div className="mv-empty-icon">{ }</div>
                  <p>No features yet</p>
                  <span>Use Explore or add manually</span>
                </div>
              )}
              {features.map(f => (
                <button
                  key={f.id}
                  className={`mv-feature-row${selected?.id === f.id ? ' mv-feature-row--active' : ''}`}
                  onClick={() => setSelected(f)}
                >
                  <span className={`mv-crit mv-crit--${f.criticality}`}>
                    {critIcon(f.criticality)}
                  </span>
                  <div className="mv-feature-row-body">
                    <span className="mv-feature-row-name">{f.name}</span>
                    <span className="mv-feature-row-meta">
                      {f.flows?.length ?? 0} flow{(f.flows?.length ?? 0) !== 1 ? 's' : ''}
                      {' \u00B7 '}
                      {f.expected_behaviors.length} behavior{f.expected_behaviors.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <span className={`mv-crit-label mv-crit-label--${f.criticality}`}>
                    {f.criticality}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {selected ? (
            <FeatureDetail
              feature={selected}
              projectId={id!}
              onUpdate={handleUpdateFeature}
              onDelete={handleDeleteFeature}
              onReload={loadFeatures}
            />
          ) : features.length > 0 ? (
            <div className="mv-detail-empty">
              <p>Select a feature</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
