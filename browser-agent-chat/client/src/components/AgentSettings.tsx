import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useVault } from '../hooks/useVault';
import { useWS } from '../contexts/WebSocketContext';
import * as vaultApi from '../lib/vaultApi';
import type { BoundCredential } from '../types/assistant';
import Sidebar from './Sidebar';
import './Vault/Vault.css';

export default function AgentSettings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();
  const ws = useWS();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [context, setContext] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [linkedCreds, setLinkedCreds] = useState<BoundCredential[]>([]);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const { credentials: allCreds } = useVault();
  const availableCreds = allCreds.filter(c => !linkedCreds.some(l => l.id === c.id));

  useEffect(() => {
    loadAgent();
  }, [id]);

  useEffect(() => {
    const load = async () => {
      const token = await getAccessToken();
      const creds = await vaultApi.getAgentCredentials(token, id!);
      setLinkedCreds(creds);
    };
    load();
  }, [id, getAccessToken]);

  const loadAgent = async () => {
    const token = await getAccessToken();
    const res = await fetch(`/api/agents/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setName(data.name);
      setUrl(data.url);
      setContext(data.context ?? '');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const token = await getAccessToken();
    const body: Record<string, unknown> = { name, url, context };
    await fetch(`/api/agents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    setSaving(false);
  };

  const handleDelete = async () => {
    const token = await getAccessToken();
    await fetch(`/api/agents/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    navigate('/');
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="settings-page">
        <h1>Agent Settings</h1>

        <section className="settings-section">
          <h2>Details</h2>
          <label>Name <input type="text" value={name} onChange={e => setName(e.target.value)} /></label>
          <label>URL <input type="url" value={url} onChange={e => setUrl(e.target.value)} /></label>
          <label>Context <textarea value={context} onChange={e => setContext(e.target.value)} rows={3} /></label>
        </section>

        <section className="settings-section">
          <h2>Linked Credentials</h2>
          <p className="settings-hint">Credentials from your vault linked to this agent.</p>
          <div className="linked-credentials">
            {linkedCreds.map(cred => (
              <div key={cred.binding_id} className="linked-cred-item">
                <div>
                  <div className="linked-cred-label">{cred.label}</div>
                  <div className="linked-cred-domains">{cred.domains.join(', ') || 'No domains'}</div>
                </div>
                <button className="linked-cred-unlink" onClick={async () => {
                  const token = await getAccessToken();
                  await vaultApi.unbindFromAgent(token, cred.id, id!);
                  setLinkedCreds(prev => prev.filter(c => c.binding_id !== cred.binding_id));
                }}>Unlink</button>
              </div>
            ))}
            <button className="link-cred-btn" onClick={() => setShowLinkPicker(true)}>
              + Link a credential from vault
            </button>
          </div>
          {showLinkPicker && (
            <div className="vault-form">
              <div className="vault-form-title">Link Credential</div>
              {availableCreds.length === 0 ? (
                <p className="settings-hint">No credentials available. Add one in the Vault first.</p>
              ) : (
                availableCreds.map(cred => (
                  <div key={cred.id} className="linked-cred-item" style={{ cursor: 'pointer' }} onClick={async () => {
                    const token = await getAccessToken();
                    await vaultApi.bindToAgent(token, cred.id, id!);
                    const updated = await vaultApi.getAgentCredentials(token, id!);
                    setLinkedCreds(updated);
                    setShowLinkPicker(false);
                  }}>
                    <div>
                      <div className="linked-cred-label">{cred.label}</div>
                      <div className="linked-cred-domains">{cred.domains.join(', ')}</div>
                    </div>
                  </div>
                ))
              )}
              <button className="vault-form-cancel" onClick={() => setShowLinkPicker(false)}>Cancel</button>
            </div>
          )}
        </section>

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>

        <section className="settings-section">
          <h2>Session</h2>
          <p className="settings-hint">
            If the browser appears frozen or unresponsive, restart the agent session.
          </p>
          <button
            className="btn-secondary"
            onClick={() => {
              if (confirm('Restart the agent? This will end the current browser session.')) {
                ws.sendRestart(id!);
                navigate(`/testing/${id}`);
              }
            }}
          >
            Restart Agent
          </button>
        </section>

        <section className="settings-danger">
          <h2>Danger Zone</h2>
          {!showDelete ? (
            <button className="btn-danger" onClick={() => setShowDelete(true)}>Delete Agent</button>
          ) : (
            <div>
              <p>Are you sure? This deletes all findings, memory, and sessions.</p>
              <button className="btn-danger" onClick={handleDelete}>Confirm Delete</button>
              <button className="btn-secondary" onClick={() => setShowDelete(false)}>Cancel</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
