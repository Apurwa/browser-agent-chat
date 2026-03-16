import { useState } from 'react'
import { Copy, ChevronDown, ChevronRight } from 'lucide-react'
import type { VaultEntry } from '../../types/assistant'
import { computeHealth, type HealthState } from './VaultHealthBar'

const MAX_VISIBLE_DOMAINS = 2

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

function typeIcon(credType: string): string {
  return credType === 'api_key' ? '</>' : '\u{1F511}'
}

interface CredentialRowProps {
  credential: VaultEntry
  isExpanded: boolean
  onToggleExpand: () => void
}

export default function CredentialRow({ credential, isExpanded, onToggleExpand }: CredentialRowProps) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const health: HealthState = computeHealth(credential)
  const isDisabled = !credential.enabled

  const visibleDomains = credential.domains.slice(0, MAX_VISIBLE_DOMAINS)
  const overflowCount = credential.domains.length - MAX_VISIBLE_DOMAINS

  const handleCopyUsername = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const username = credential.metadata?.username
    if (!username) return
    try {
      await navigator.clipboard.writeText(username)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard may not be available
    }
  }

  const statusText = credential.use_count === 0
    ? 'never used'
    : `Updated ${timeAgo(credential.updated_at)}`

  return (
    <div
      className={`vault-row vault-row-border--${health}${isDisabled ? ' vault-row--disabled' : ''}${isExpanded ? ' vault-row--expanded' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onToggleExpand}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onToggleExpand() }}
    >
      <div className="vault-row-icon">{typeIcon(credential.credential_type)}</div>

      <div className="vault-row-center">
        <div className="vault-row-label">
          {credential.label}
          {isDisabled && <span className="vault-row-disabled-badge">Disabled</span>}
        </div>
        <div className="vault-row-meta">
          {credential.credential_type === 'username_password'
            ? (credential.metadata?.username ?? 'No username')
            : 'API Key'}
        </div>
        {credential.domains.length > 0 && (
          <div className="vault-row-domains">
            {visibleDomains.map(d => (
              <span key={d} className="vault-domain-pill">{d}</span>
            ))}
            {overflowCount > 0 && (
              <span className="vault-domain-overflow">+{overflowCount}</span>
            )}
          </div>
        )}
      </div>

      <div className="vault-row-status">
        <span className="vault-health-dot" style={{ backgroundColor: `var(--health-${health})` }} />
        <span>{statusText}</span>
      </div>

      {hovered && (
        <div className="vault-row-hover-actions">
          {credential.metadata?.username && (
            <button
              className="vault-row-copy-btn"
              onClick={handleCopyUsername}
              title={copied ? 'Copied!' : 'Copy username'}
            >
              <Copy size={14} />
            </button>
          )}
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      )}
    </div>
  )
}
