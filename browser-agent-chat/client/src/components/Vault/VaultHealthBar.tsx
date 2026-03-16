import type { VaultEntry } from '../../types/assistant'

export type HealthState = 'disabled' | 'not_configured' | 'needs_attention' | 'unused' | 'healthy'

const HEALTH_COLORS: Record<HealthState, string> = {
  healthy: 'var(--brand)',
  needs_attention: 'var(--accent)',
  not_configured: 'var(--text-dim)',
  unused: 'var(--text-dimmer)',
  disabled: 'var(--text-dimmest)',
}

const HEALTH_LABELS: Record<HealthState, string> = {
  healthy: 'healthy',
  needs_attention: 'needs rotation',
  not_configured: 'missing domains',
  unused: 'unused',
  disabled: 'disabled',
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

export function computeHealth(cred: VaultEntry): HealthState {
  if (!cred.enabled) return 'disabled'
  if (cred.domains.length === 0) return 'not_configured'
  if (daysSince(cred.updated_at) >= 90) return 'needs_attention'
  if (cred.use_count === 0) return 'unused'
  return 'healthy'
}

const HEALTH_ORDER: readonly HealthState[] = [
  'healthy',
  'needs_attention',
  'not_configured',
  'unused',
  'disabled',
] as const

interface VaultHealthBarProps {
  credentials: readonly VaultEntry[]
}

export default function VaultHealthBar({ credentials }: VaultHealthBarProps) {
  const counts = new Map<HealthState, number>()
  for (const cred of credentials) {
    const state = computeHealth(cred)
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }

  const entries: Array<{ state: HealthState; count: number }> = []
  for (const state of HEALTH_ORDER) {
    const count = counts.get(state) ?? 0
    if (count > 0) entries.push({ state, count })
  }

  if (entries.length === 0) return null

  return (
    <div className="vault-health-bar">
      {entries.map(({ state, count }) => (
        <span key={state} className="vault-health-item" style={{ color: HEALTH_COLORS[state] }}>
          <span
            className={`vault-health-dot ${state === 'not_configured' ? 'vault-health-dot--dashed' : ''}`}
            style={{
              backgroundColor: state !== 'not_configured' ? HEALTH_COLORS[state] : 'transparent',
              borderColor: HEALTH_COLORS[state],
            }}
          />
          {count} {HEALTH_LABELS[state]}
        </span>
      ))}
    </div>
  )
}
