import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import type { VaultEntry } from '../../types/assistant';

interface VaultFormProps {
  editing?: VaultEntry | null;
  prefillDomain?: string;
  onSave: (data: {
    label: string;
    credential_type: string;
    secret?: { password?: string; apiKey?: string };
    metadata: Record<string, unknown>;
    domains: string[];
  }) => Promise<void>;
  onCancel: () => void;
}

function normalizeDomain(d: string): string {
  return d.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase().trim();
}

export default function VaultForm({ editing, prefillDomain, onSave, onCancel }: VaultFormProps) {
  const labelRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(editing?.label ?? '');
  const [credType, setCredType] = useState(editing?.credential_type ?? 'username_password');
  const [username, setUsername] = useState((editing?.metadata?.username as string) ?? '');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showPasswordField, setShowPasswordField] = useState(!editing);
  const [domains, setDomains] = useState<string[]>(
    editing?.domains ?? (prefillDomain ? [prefillDomain] : [])
  );
  const [domainInput, setDomainInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (prefillDomain && labelRef.current) {
      labelRef.current.focus();
    }
  }, [prefillDomain]);

  const addDomain = useCallback(() => {
    const normalized = normalizeDomain(domainInput);
    if (normalized && !domains.includes(normalized)) {
      setDomains(prev => [...prev, normalized]);
    }
    setDomainInput('');
  }, [domainInput, domains]);

  const removeDomain = useCallback((d: string) => {
    setDomains(prev => prev.filter(x => x !== d));
  }, []);

  const handleDomainKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addDomain();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const data: Parameters<VaultFormProps['onSave']>[0] = {
        label,
        credential_type: credType,
        metadata: credType === 'username_password' ? { username } : {},
        domains,
      };
      // Only include secret if creating or changing password (and non-empty)
      const secretValue = credType === 'username_password' ? password.trim() : apiKey.trim();
      if ((!editing || showPasswordField) && secretValue) {
        data.secret = credType === 'username_password' ? { password } : { apiKey };
      }
      await onSave(data);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save credential');
    } finally {
      setSaving(false);
    }
  };

  // On create: require non-empty secret. On edit: require non-empty secret only if changing it.
  const hasValidSecret = credType === 'username_password' ? password.trim() : apiKey.trim();
  const canSave = label.trim() && (editing ? (!showPasswordField || hasValidSecret) : hasValidSecret);

  return (
    <div className="vault-form">
      <div className="vault-form-title">{editing ? 'Edit Credential' : 'Add Credential'}</div>

      <div className="vault-form-row">
        <label>Type</label>
        <select value={credType} onChange={e => setCredType(e.target.value)} disabled={!!editing}>
          <option value="username_password">Username / Password</option>
          <option value="api_key">API Key</option>
        </select>
      </div>

      <div className="vault-form-row">
        <label>Label</label>
        <input ref={labelRef} type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g., Github Work" />
      </div>

      {credType === 'username_password' && (
        <>
          <div className="vault-form-row">
            <label>Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin@company.com" autoComplete="off" />
          </div>
          <div className="vault-form-row">
            <label>Password</label>
            {editing && !showPasswordField ? (
              <button className="vault-change-pw-btn" onClick={() => setShowPasswordField(true)}>Change password</button>
            ) : (
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" autoComplete="new-password" />
            )}
          </div>
        </>
      )}

      {credType === 'api_key' && (
        <div className="vault-form-row">
          <label>API Key</label>
          {editing && !showPasswordField ? (
            <button className="vault-change-pw-btn" onClick={() => setShowPasswordField(true)}>Change API key</button>
          ) : (
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." autoComplete="new-password" />
          )}
        </div>
      )}

      <div className="vault-form-row">
        <label>Domains</label>
        <div className="vault-domain-input">
          {domains.map(d => (
            <span key={d} className="vault-domain-tag">
              {d}
              <button onClick={() => removeDomain(d)}>{'\u00D7'}</button>
            </span>
          ))}
          <input
            type="text"
            value={domainInput}
            onChange={e => setDomainInput(e.target.value)}
            onKeyDown={handleDomainKeyDown}
            onBlur={addDomain}
            placeholder="example.com"
          />
        </div>
      </div>

      {saveError && (
        <div className="vault-form-error" style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
          {saveError}
        </div>
      )}
      <div className="vault-form-actions">
        <button className="vault-form-cancel" onClick={onCancel}>Cancel</button>
        <button className="vault-form-save" onClick={handleSave} disabled={!canSave || saving}>
          {saving ? 'Saving...' : editing ? 'Update' : 'Save'}
        </button>
      </div>
    </div>
  );
}
