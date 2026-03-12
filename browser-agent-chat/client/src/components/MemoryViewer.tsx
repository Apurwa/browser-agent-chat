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

  // Re-fetch suggestions when new ones arrive via WebSocket
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

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="memory-content">
        {suggestions.length > 0 && (
          <div className="memory-suggestions-pending" style={{ marginBottom: '1rem', borderLeft: '3px solid #fdcb6e' }}>
            <div className="memory-list-header">
              <h2 style={{ color: '#fdcb6e' }}>
                ⏳ Pending Suggestions <span className="count">({suggestions.length})</span>
              </h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-add" onClick={handleAcceptAll}>Accept All</button>
                <button onClick={handleDismissAll}>Dismiss All</button>
              </div>
            </div>
            <div className="memory-items">
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
        <div className="memory-list">
          <div className="memory-list-header">
            <h2>Features <span className="count">({features.length})</span></h2>
            <button className="btn-add" onClick={() => setShowAdd(true)}>+ Add</button>
          </div>
          {showAdd && (
            <div className="memory-add-form">
              <input placeholder="Feature name" value={newName} onChange={e => setNewName(e.target.value)} />
              <select value={newCriticality} onChange={e => setNewCriticality(e.target.value as Criticality)}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <button onClick={handleAddFeature}>Add</button>
              <button onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          )}
          <div className="memory-items">
            {features.map(f => (
              <div
                key={f.id}
                className={`memory-item ${selected?.id === f.id ? 'active' : ''}`}
                onClick={() => setSelected(f)}
              >
                <div className="memory-item-header">
                  <span className="memory-item-name">{f.name}</span>
                  <span className={`severity-badge severity-${f.criticality}`}>{f.criticality.toUpperCase()}</span>
                </div>
                <div className="memory-item-meta">
                  {f.flows?.length ?? 0} flows · {f.expected_behaviors.length} behaviors
                </div>
              </div>
            ))}
          </div>
        </div>
        {selected && (
          <FeatureDetail
            feature={selected}
            projectId={id!}
            onUpdate={handleUpdateFeature}
            onDelete={handleDeleteFeature}
            onReload={loadFeatures}
          />
        )}
      </div>
    </div>
  );
}
