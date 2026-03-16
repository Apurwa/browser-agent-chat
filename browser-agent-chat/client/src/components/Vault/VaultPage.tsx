import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useVault } from '../../hooks/useVault';
import * as vaultApi from '../../lib/vaultApi';
import VaultForm from './VaultForm';
import VaultHealthBar from './VaultHealthBar';
import CredentialRow from './CredentialRow';
import VaultDetail from './VaultDetail';
import './Vault.css';

export default function VaultPage() {
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();
  const { credentials, loading, error, createCredential, updateCredential, deleteCredential, refresh } = useVault();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<typeof credentials[0] | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = credentials;
    if (typeFilter !== 'all') {
      result = result.filter(c => c.credential_type === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c => {
        const matchesLabel = c.label.toLowerCase().includes(q);
        const matchesUsername = (c.metadata?.username as string || '').toLowerCase().includes(q);
        const matchesDomain = c.domains.some(d => d.includes(q));
        const bindings = (c as Record<string, unknown>).bindings as Array<{ agentName: string }> | undefined ?? [];
        const matchesBinding = bindings.some((b) => b.agentName.toLowerCase().includes(q));
        return matchesLabel || matchesUsername || matchesDomain || matchesBinding;
      });
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
    setActionError(null);
    try {
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
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to save credential');
    }
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
    setActionError(null);
    try {
      await deleteCredential(id);
      setConfirmDelete(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete credential');
      setConfirmDelete(null);
    }
  };

  if (loading) return (
    <div className="vault-page"><div className="vault-empty">Loading credentials...</div></div>
  );
  if (error) return (
    <div className="vault-page"><div className="vault-empty">Error: {error}</div></div>
  );

  return (
    <div className="vault-page">
      <div className="vault-header">
        <div className="vault-header-left">
          <button className="vault-back-btn" onClick={() => navigate('/')} title="Back to Home">
            <ArrowLeft size={18} />
          </button>
          <h1 className="vault-title">
            Vault
            <span className="vault-count">{credentials.length}</span>
          </h1>
        </div>
        <button className="vault-add-btn" onClick={() => { setEditing(null); setShowForm(true); setActionError(null); }}>+ Add Credential</button>
      </div>

      <VaultHealthBar credentials={credentials} />

      {actionError && (
        <div className="vault-action-error" style={{ color: '#ef4444', fontSize: '0.875rem', padding: '0.5rem 0', marginBottom: '0.5rem' }}>
          {actionError}
        </div>
      )}

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
        <div className="vault-filter-chips">
          <button
            className={`vault-filter-chip ${typeFilter === 'all' ? 'vault-filter-chip--active' : ''}`}
            onClick={() => setTypeFilter('all')}
          >
            All
          </button>
          <button
            className={`vault-filter-chip ${typeFilter === 'username_password' ? 'vault-filter-chip--active' : ''}`}
            onClick={() => setTypeFilter('username_password')}
          >
            {'🔑'} Password
          </button>
          <button
            className={`vault-filter-chip ${typeFilter === 'api_key' ? 'vault-filter-chip--active' : ''}`}
            onClick={() => setTypeFilter('api_key')}
          >
            {'</>'} API Key
          </button>
        </div>
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
            <div key={cred.id}>
              <CredentialRow
                credential={cred}
                isExpanded={expandedId === cred.id}
                onToggleExpand={() => setExpandedId(prev => prev === cred.id ? null : cred.id)}
              />
              {expandedId === cred.id && (
                <VaultDetail
                  credential={cred}
                  onRefresh={refresh}
                  onSendTask={() => {}}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
