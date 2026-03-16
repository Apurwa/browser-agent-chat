import { useState, useEffect, useCallback, type KeyboardEvent } from 'react'
import { Copy, AlertTriangle, Shield, Trash2 } from 'lucide-react'
import type { VaultEntry } from '../../types/assistant'
import { useAuth } from '../../hooks/useAuth'
import * as vaultApi from '../../lib/vaultApi'

function normalizeDomain(d: string): string {
  return d.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase().trim()
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

interface ResolutionItem {
  domain: string
  resolved: boolean
  agentId?: string
}

interface AuditEntry {
  action: string
  actor: string
  timestamp: string
  details?: Record<string, unknown>
}

interface VaultDetailProps {
  credential: VaultEntry
  agentId?: string
  onRefresh: () => void
  onSendTask: (task: string) => void
}

export default function VaultDetail({ credential, agentId, onRefresh, onSendTask }: VaultDetailProps) {
  const { getAccessToken } = useAuth()

  // Editable fields
  const [label, setLabel] = useState(credential.label)
  const [username, setUsername] = useState(credential.metadata?.username ?? '')
  const [domains, setDomains] = useState<string[]>(credential.domains)
  const [domainInput, setDomainInput] = useState('')
  const [labelDirty, setLabelDirty] = useState(false)
  const [usernameDirty, setUsernameDirty] = useState(false)
  const [domainsDirty, setDomainsDirty] = useState(false)

  // Resolution preview
  const [resolution, setResolution] = useState<ResolutionItem[]>([])
  const [resolutionLoading, setResolutionLoading] = useState(true)

  // Audit log
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(true)

  // Toggle state
  const [enabled, setEnabled] = useState(credential.enabled)
  const [toggling, setToggling] = useState(false)

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Saving
  const [saving, setSaving] = useState(false)

  // Copied feedback
  const [copied, setCopied] = useState(false)

  // Fetch resolution on mount
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const token = await getAccessToken()
        const data = await vaultApi.fetchResolution(token, credential.id)
        if (!cancelled) setResolution(data.items ?? [])
      } catch {
        // resolution may not be available
      } finally {
        if (!cancelled) setResolutionLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [credential.id, getAccessToken])

  // Fetch audit log on mount
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const token = await getAccessToken()
        const data = await vaultApi.fetchAuditLog(token, credential.id)
        if (!cancelled) setAuditLog(Array.isArray(data) ? data.slice(0, 10) : [])
      } catch {
        // audit may not be available
      } finally {
        if (!cancelled) setAuditLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [credential.id, getAccessToken])

  // Sync from parent when credential changes
  useEffect(() => {
    setLabel(credential.label)
    setUsername(credential.metadata?.username ?? '')
    setDomains(credential.domains)
    setEnabled(credential.enabled)
    setLabelDirty(false)
    setUsernameDirty(false)
    setDomainsDirty(false)
  }, [credential])

  const handleSaveField = useCallback(async () => {
    if (!labelDirty && !usernameDirty && !domainsDirty) return
    setSaving(true)
    try {
      const token = await getAccessToken()
      const updates: Record<string, unknown> = {}
      if (labelDirty) updates.label = label
      if (usernameDirty) updates.metadata = { ...credential.metadata, username }
      if (domainsDirty) updates.domains = domains
      await vaultApi.updateCredential(token, credential.id, updates)
      setLabelDirty(false)
      setUsernameDirty(false)
      setDomainsDirty(false)
      onRefresh()
    } catch {
      // save failed silently — field stays dirty
    } finally {
      setSaving(false)
    }
  }, [label, username, domains, labelDirty, usernameDirty, domainsDirty, credential, getAccessToken, onRefresh])

  const handleToggle = useCallback(async () => {
    setToggling(true)
    try {
      const token = await getAccessToken()
      const result = await vaultApi.toggleCredential(token, credential.id, !enabled)
      setEnabled(result.enabled)
      onRefresh()
    } catch {
      // toggle failed
    } finally {
      setToggling(false)
    }
  }, [enabled, credential.id, getAccessToken, onRefresh])

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      const token = await getAccessToken()
      await vaultApi.deleteCredential(token, credential.id)
      onRefresh()
    } catch {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }, [confirmDelete, credential.id, getAccessToken, onRefresh])

  const handleCopyUsername = useCallback(async () => {
    const user = credential.metadata?.username
    if (!user) return
    try {
      await navigator.clipboard.writeText(user)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard not available
    }
  }, [credential.metadata?.username])

  // Domain chip input handlers
  const addDomain = useCallback(() => {
    const normalized = normalizeDomain(domainInput)
    if (normalized && !domains.includes(normalized)) {
      setDomains(prev => [...prev, normalized])
      setDomainsDirty(true)
    }
    setDomainInput('')
  }, [domainInput, domains])

  const removeDomain = useCallback((d: string) => {
    setDomains(prev => prev.filter(x => x !== d))
    setDomainsDirty(true)
  }, [])

  const handleDomainKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addDomain()
    }
  }

  const handleRotate = useCallback(() => {
    onSendTask(`Rotate the password for credential "${credential.label}"`)
  }, [credential.label, onSendTask])

  const handleLinkAgent = useCallback(() => {
    const target = agentId ? `agent ${agentId}` : 'an agent'
    onSendTask(`Link credential "${credential.label}" to ${target}`)
  }, [credential.label, agentId, onSendTask])

  const bindings = credential.bindings ?? []

  return (
    <div className="vault-detail" onClick={e => e.stopPropagation()}>
      {/* Section: Identity */}
      <div className="vault-detail-section">
        <div className="vault-detail-label">Identity</div>

        <div className="vault-detail-field">
          <span className="vault-detail-field-label">Label</span>
          <input
            className="vault-detail-field-input"
            type="text"
            value={label}
            onChange={e => { setLabel(e.target.value); setLabelDirty(true) }}
            onBlur={handleSaveField}
          />
        </div>

        <div className="vault-detail-field">
          <span className="vault-detail-field-label">Type</span>
          <span className="vault-detail-type-badge">
            {credential.credential_type === 'username_password' ? 'Username / Password' : 'API Key'}
          </span>
        </div>

        {credential.credential_type === 'username_password' && (
          <div className="vault-detail-field">
            <span className="vault-detail-field-label">Username</span>
            <div className="vault-detail-field-with-action">
              <input
                className="vault-detail-field-input"
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value); setUsernameDirty(true) }}
                onBlur={handleSaveField}
              />
              <button className="vault-row-copy-btn" onClick={handleCopyUsername} title={copied ? 'Copied!' : 'Copy'}>
                <Copy size={12} />
              </button>
            </div>
          </div>
        )}

        <div className="vault-detail-field">
          <span className="vault-detail-field-label">Password</span>
          <span className="vault-detail-encrypted">
            <Shield size={12} /> Encrypted — decrypted only during agent login
          </span>
        </div>
      </div>

      {/* Section: Domains */}
      <div className="vault-detail-section">
        <div className="vault-detail-label">Domains</div>
        {domains.length === 0 && (
          <div className="vault-detail-warning">
            <AlertTriangle size={12} /> No domains configured — agent cannot match this credential
          </div>
        )}
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
            onBlur={() => { addDomain(); handleSaveField() }}
            placeholder="Add domain..."
          />
        </div>
      </div>

      {/* Section: Resolution Preview */}
      <div className="vault-detail-section">
        <div className="vault-detail-label">Resolution Preview</div>
        {resolutionLoading ? (
          <div className="vault-detail-loading">Loading...</div>
        ) : resolution.length === 0 ? (
          <div className="vault-detail-empty-hint">No resolution data available</div>
        ) : (
          <div className="vault-detail-resolution-list">
            {resolution.map(item => (
              <div key={item.domain} className={item.resolved ? 'vault-resolution-resolved' : 'vault-resolution-unresolved'}>
                {item.resolved ? '\u2713' : '\u2717'} {item.domain}
                {item.agentId && <span className="vault-detail-resolution-agent"> ({item.agentId})</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section: Agent Bindings */}
      <div className="vault-detail-section">
        <div className="vault-detail-label">Agent Bindings</div>
        {bindings.length === 0 ? (
          <div className="vault-detail-empty-hint">No agents linked</div>
        ) : (
          <div className="vault-detail-bindings-list">
            {bindings.map(b => (
              <div key={b.agentId} className="vault-detail-binding">
                <span className="vault-detail-binding-name">{b.agentName}</span>
              </div>
            ))}
          </div>
        )}
        <button className="link-cred-btn" onClick={handleLinkAgent}>Link to agent</button>
      </div>

      {/* Section: Security */}
      <div className="vault-detail-section">
        <div className="vault-detail-label">Security</div>

        <div className="vault-detail-field">
          <span className="vault-detail-field-label">Updated</span>
          <span>{timeAgo(credential.updated_at)}</span>
        </div>

        <div className="vault-detail-field">
          <span className="vault-detail-field-label">Domains</span>
          <span>{credential.domains.length} configured</span>
        </div>

        <div className="vault-detail-field">
          <span className="vault-detail-field-label">Agents</span>
          <span>{bindings.length} linked</span>
        </div>

        <div className="vault-detail-field">
          <span className="vault-detail-field-label">Rotate</span>
          <button className="vault-action-btn" onClick={handleRotate}>Rotate password</button>
        </div>

        <div className="vault-detail-field">
          <span className="vault-detail-field-label">Status</span>
          <button
            className={`vault-toggle ${enabled ? 'vault-toggle--on' : ''}`}
            onClick={handleToggle}
            disabled={toggling}
            aria-label={enabled ? 'Disable credential' : 'Enable credential'}
          >
            <span className="vault-toggle-knob" />
          </button>
        </div>
      </div>

      {/* Section: Usage */}
      <div className="vault-detail-section">
        <div className="vault-detail-label">Usage</div>

        <div className="vault-detail-field">
          <span className="vault-detail-field-label">Total uses</span>
          <span>{credential.use_count}</span>
        </div>

        <div className="vault-detail-field">
          <span className="vault-detail-field-label">Last used</span>
          <span>
            {credential.last_used_by_agent
              ? `by ${credential.last_used_by_agent} \u00B7 ${timeAgo(credential.last_used_at)}`
              : timeAgo(credential.last_used_at)}
          </span>
        </div>

        <div className="vault-detail-audit">
          <div className="vault-detail-field-label" style={{ marginBottom: 6 }}>Audit Timeline</div>
          {auditLoading ? (
            <div className="vault-detail-loading">Loading...</div>
          ) : auditLog.length === 0 ? (
            <div className="vault-detail-empty-hint">No audit entries</div>
          ) : (
            auditLog.map((entry, i) => (
              <div key={`${entry.timestamp}-${i}`} className="vault-audit-entry">
                <span className="vault-audit-action">{entry.action}</span>
                <span className="vault-audit-actor">{entry.actor}</span>
                <span className="vault-audit-time">{timeAgo(entry.timestamp)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Section: Actions */}
      <div className="vault-detail-section vault-detail-section--last">
        <button
          className="vault-action-btn vault-action-btn--danger vault-delete-btn"
          onClick={handleDelete}
          onBlur={() => setConfirmDelete(false)}
          disabled={deleting}
        >
          <Trash2 size={12} />
          {confirmDelete ? 'Confirm delete?' : 'Delete credential'}
        </button>
        {(labelDirty || usernameDirty || domainsDirty) && (
          <button
            className="vault-form-save vault-detail-save-btn"
            onClick={handleSaveField}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        )}
      </div>
    </div>
  )
}
