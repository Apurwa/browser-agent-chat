import { useState, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useVault } from '../../hooks/useVault';
import * as vaultApi from '../../lib/vaultApi';
import VaultForm from './VaultForm';
import './Vault.css';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function VaultPage() {
  const { getAccessToken } = useAuth();
  const { credentials, loading, error, createCredential, updateCredential, deleteCredential, refresh } = useVault();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<typeof credentials[0] | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = credentials;
    if (typeFilter !== 'all') {
      result = result.filter(c => c.credential_type === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.label.toLowerCase().includes(q) ||
        (c.metadata?.username as string || '').toLowerCase().includes(q) ||
        c.domains.some(d => d.includes(q))
      );
    }
    return result;
  }, [credentials, search, typeFilter]);

  const handleSave = async (data: {
    label: string;
    credential_type: string;
    secret?: { password?: string; apiKey?: string };
    metadata: Record<string, unknown>;
    domains: string[];
  }) => {
    if (editing) {
      await updateCredential(editing.id, {
        label: data.label,
        metadata: data.metadata,
        domains: data.domains,
      });
      // If secret was changed (password rotation), call rotate endpoint
      if (data.secret) {
        const token = await getAccessToken();
        await vaultApi.rotateCredential(token, editing.id, data.secret);
        await refresh(); // Refresh to show updated version number
      }
    } else if (data.secret) {
      await createCredential({ ...data, secret: data.secret });
    }
    setShowForm(false);
    setEditing(null);
  };

  const handleEdit = (cred: typeof credentials[0]) => {
    setEditing(cred);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    await deleteCredential(id);
    setConfirmDelete(null);
  };

  if (loading) return <div className="vault-page"><div className="vault-empty">Loading credentials...</div></div>;
  if (error) return <div className="vault-page"><div className="vault-empty">Error: {error}</div></div>;

  return (
    <div className="vault-page">
      <div className="vault-header">
        <h1 className="vault-title">Credential Vault</h1>
        <button className="vault-add-btn" onClick={() => { setEditing(null); setShowForm(true); }}>+ Add Credential</button>
      </div>

      {showForm && (
        <VaultForm
          editing={editing}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      <div className="vault-filters">
        <input
          className="vault-search"
          type="text"
          placeholder="Search credentials..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="vault-type-filter" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="username_password">Username/Password</option>
          <option value="api_key">API Key</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="vault-empty">
          {credentials.length === 0
            ? 'No credentials stored yet. Add one to get started.'
            : 'No credentials match your search.'}
        </div>
      ) : (
        <div className="vault-list">
          {filtered.map(cred => (
            <div key={cred.id} className="vault-item">
              <div className="vault-item-info">
                <div className="vault-item-label">{cred.label}</div>
                <div className="vault-item-meta">
                  {cred.credential_type === 'username_password' ? (cred.metadata?.username ?? 'No username') : 'API Key'}
                </div>
                {cred.domains.length > 0 && (
                  <div className="vault-item-domains">
                    {cred.domains.map(d => (
                      <span key={d} className="vault-domain-chip">{d}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="vault-item-stats">
                Used {cred.use_count} times<br />
                {timeAgo(cred.last_used_at)}
              </div>
              <div className="vault-item-actions">
                <button className="vault-action-btn" onClick={() => handleEdit(cred)}>Edit</button>
                <button
                  className={`vault-action-btn vault-action-btn--danger`}
                  onClick={() => handleDelete(cred.id)}
                  onBlur={() => setConfirmDelete(null)}
                >
                  {confirmDelete === cred.id ? 'Confirm?' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
