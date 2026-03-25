# Vault UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Vault UI for visual polish and information hierarchy — health indicators, credential rows with three-zone layout, accordion detail view with resolution preview, credential locking, and agent-first onboarding.

**Architecture:** Server-side adds `enabled` column, audit log table, and three new endpoints (toggle, audit, resolution). Client-side replaces VaultPage with extracted components (CredentialRow, VaultHealthBar, VaultDetail) and new CSS using the Delphi Tools theme. ChatPanel's inline credential form is replaced with a vault-linking prompt.

**Tech Stack:** React 19, TypeScript, Vite, Express, Supabase (PostgreSQL), CSS custom properties

**Spec:** `docs/superpowers/specs/2026-03-16-vault-ui-redesign.md`

---

## File Structure

All paths relative to `browser-agent-chat/`.

### New Files

| File | Responsibility |
|------|---------------|
| `server/migrations/008_vault_audit_log.sql` | Adds `enabled` column + `credential_audit_log` table |
| `server/__tests__/vault-toggle.test.ts` | Tests for toggle, audit, resolution endpoints |
| `client/src/components/Vault/VaultHealthBar.tsx` | Health summary bar with waterfall computation |
| `client/src/components/Vault/CredentialRow.tsx` | Single credential row with three-zone layout + hover actions |
| `client/src/components/Vault/VaultDetail.tsx` | Accordion detail view: identity, domains, resolution, bindings, security, usage |

### Modified Files

| File | Changes |
|------|---------|
| `server/src/types.ts` | Add `enabled: boolean` to `VaultEntry` |
| `server/src/vault.ts` | Add `enabled` to `VAULT_METADATA_COLS`, filter disabled in `getCredentialForAgent`, add audit log helper |
| `server/src/routes/vault.ts` | Add toggle, audit, resolution endpoints; enrich list with bindings |
| `client/src/types/assistant.ts` | Add `enabled: boolean` and `bindings` to `VaultEntry` |
| `client/src/components/Vault/VaultPage.tsx` | Replace list with CredentialRow, add VaultHealthBar, filter chips, accordion |
| `client/src/components/Vault/VaultForm.tsx` | Accept `prefillDomain` prop for agent-triggered creation |
| `client/src/components/Vault/Vault.css` | New styles for health bar, credential rows, detail accordion, domain pills |
| `client/src/hooks/useVault.ts` | Handle enriched response with bindings |
| `client/src/lib/vaultApi.ts` | Add toggle, audit, resolution API calls |
| `client/src/components/ChatPanel.tsx` | Replace inline credential form with vault-linking prompt |

---

## Chunk 1: Server — Migration, Types, and Core Logic

### Task 1: Database migration

**Files:**
- Create: `server/migrations/008_vault_audit_log.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 008_vault_audit_log.sql
-- Adds credential locking (enabled field) and audit logging

-- 1. Add enabled column to credentials_vault
ALTER TABLE credentials_vault
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

-- 2. Create audit log table
CREATE TABLE IF NOT EXISTS credential_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES credentials_vault(id),
  agent_id uuid REFERENCES agents(id),   -- NULL for user-initiated actions
  session_id text,                        -- NULL for user-initiated actions
  action text NOT NULL,                   -- 'decrypt', 'rotate', 'bind', 'unbind', 'enable', 'disable'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_credential ON credential_audit_log(credential_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON credential_audit_log(created_at);

-- 3. RLS: users can only see audit logs for their own credentials
ALTER TABLE credential_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select ON credential_audit_log
  FOR SELECT USING (
    credential_id IN (
      SELECT id FROM credentials_vault WHERE user_id = auth.uid()
    )
  );

CREATE POLICY audit_log_insert ON credential_audit_log
  FOR INSERT WITH CHECK (
    credential_id IN (
      SELECT id FROM credentials_vault WHERE user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Commit**

```bash
git add server/migrations/008_vault_audit_log.sql && git commit -m "feat(vault): add enabled column and audit log migration"
```

---

### Task 2: Update types

**Files:**
- Modify: `server/src/types.ts`
- Modify: `client/src/types/assistant.ts`

- [ ] **Step 1: Add `enabled` to server VaultEntry**

In `server/src/types.ts`, find the `VaultEntry` interface and add `enabled: boolean` after `updated_at`.

- [ ] **Step 2: Add `enabled` and `bindings` to client VaultEntry**

In `client/src/types/assistant.ts`, find the `VaultEntry` interface and add:
```ts
enabled: boolean
bindings?: Array<{ agentId: string; agentName: string }>
```

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts client/src/types/assistant.ts && git commit -m "feat(vault): add enabled and bindings fields to VaultEntry type"
```

---

### Task 3: Update vault.ts — enabled filter, audit logging, VAULT_METADATA_COLS

**Files:**
- Modify: `server/src/vault.ts`

- [ ] **Step 1: Add `enabled` to VAULT_METADATA_COLS**

Change line 15 from:
```ts
const VAULT_METADATA_COLS = 'id, user_id, label, credential_type, metadata, domains, scope, version, use_count, last_used_at, last_used_by_agent, created_by_agent, created_at, updated_at';
```
to:
```ts
const VAULT_METADATA_COLS = 'id, user_id, label, credential_type, metadata, domains, scope, version, use_count, last_used_at, last_used_by_agent, created_by_agent, created_at, updated_at, enabled';
```

- [ ] **Step 2: Add enabled filter to getCredentialForAgent**

In `getCredentialForAgent()` (around line 182-186), after `if (cred.deleted_at) continue;`, add:
```ts
if (!cred.enabled) continue;
```

- [ ] **Step 3: Add audit log helper**

Add at the bottom of the file:
```ts
export async function insertAuditLog(
  credentialId: string,
  action: string,
  agentId?: string,
  sessionId?: string,
): Promise<void> {
  if (!isSupabaseEnabled()) return;
  const { error } = await supabase!
    .from('credential_audit_log')
    .insert({
      credential_id: credentialId,
      agent_id: agentId ?? null,
      session_id: sessionId ?? null,
      action,
    });
  if (error) console.error('[VAULT] Audit log insert error:', error);
}

export async function getAuditLog(
  credentialId: string,
  limit = 10,
): Promise<Array<{ id: string; action: string; agent_id: string | null; session_id: string | null; created_at: string }>> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('credential_audit_log')
    .select('id, action, agent_id, session_id, created_at')
    .eq('credential_id', credentialId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[VAULT] Audit log fetch error:', error); return []; }
  return data ?? [];
}

export async function toggleCredential(
  id: string,
  userId: string,
  enabled: boolean,
): Promise<VaultEntry | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('credentials_vault')
    .update({ enabled })
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .select(VAULT_METADATA_COLS)
    .single();
  if (error) { console.error('[VAULT] Toggle error:', error); return null; }
  await insertAuditLog(id, enabled ? 'enable' : 'disable');
  return data as VaultEntry;
}

export async function getResolution(
  credentialId: string,
  userId: string,
): Promise<{ resolved: string[]; unresolved: string[] }> {
  if (!isSupabaseEnabled()) return { resolved: [], unresolved: [] };

  // Get credential domains
  const cred = await getCredential(credentialId, userId);
  if (!cred) return { resolved: [], unresolved: [] };
  const credDomains = new Set(cred.domains);

  // Get all nav_nodes for user's agents
  const { data: agents } = await supabase!
    .from('agents')
    .select('id')
    .eq('user_id', userId);
  if (!agents || agents.length === 0) return { resolved: [], unresolved: [] };

  const agentIds = agents.map((a: any) => a.id);
  const { data: nodes } = await supabase!
    .from('nav_nodes')
    .select('url_pattern')
    .in('agent_id', agentIds);
  if (!nodes) return { resolved: [], unresolved: [] };

  // Extract unique hostnames from URL patterns
  const knownDomains = new Set<string>();
  for (const node of nodes as any[]) {
    const pattern = node.url_pattern as string;
    try {
      // URL patterns are paths like /dashboard — extract from agent's base URLs
      // For now, use the domain from the pattern if it includes a host
      const hostname = normalizeDomain(pattern);
      if (hostname && hostname !== '/') knownDomains.add(hostname);
    } catch { /* skip invalid patterns */ }
  }

  const resolved: string[] = [];
  const unresolved: string[] = [];
  for (const domain of knownDomains) {
    if (credDomains.has(domain)) {
      resolved.push(domain);
    } else {
      unresolved.push(domain);
    }
  }

  return { resolved, unresolved };
}
```

- [ ] **Step 4: Add audit logging to decryptForInjection**

In `decryptForInjection()`, after the `increment_vault_use` RPC call, add:
```ts
await insertAuditLog(id, 'decrypt', agentId);
```

You'll need to pass `agentId` to `decryptForInjection`. Read the function signature and add it as a parameter if not already present.

- [ ] **Step 5: Commit**

```bash
git add server/src/vault.ts && git commit -m "feat(vault): add enabled filter, audit logging, toggle, and resolution"
```

---

### Task 4: Add server routes

**Files:**
- Modify: `server/src/routes/vault.ts`

- [ ] **Step 1: Add toggle endpoint**

```ts
// Toggle credential enabled/disabled
router.put('/:id/toggle', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    const result = await toggleCredential(req.params.id, userId, enabled);
    if (!result) { res.status(404).json({ error: 'Credential not found' }); return; }
    res.json(result);
  } catch (err) {
    console.error('[VAULT] Toggle error:', err);
    res.status(500).json({ error: 'Failed to toggle credential' });
  }
});
```

- [ ] **Step 2: Add audit endpoint**

```ts
// Get audit log for a credential
router.get('/:id/audit', requireAuth, async (req, res) => {
  try {
    const log = await getAuditLog(req.params.id);
    res.json({ entries: log });
  } catch (err) {
    console.error('[VAULT] Audit error:', err);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});
```

- [ ] **Step 3: Add resolution endpoint**

```ts
// Get resolution preview for a credential
router.get('/:id/resolution', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const result = await getResolution(req.params.id, userId);
    res.json(result);
  } catch (err) {
    console.error('[VAULT] Resolution error:', err);
    res.status(500).json({ error: 'Failed to compute resolution' });
  }
});
```

- [ ] **Step 4: Enrich list endpoint with bindings**

In the existing `GET /` handler, after fetching credentials, add a query to join bindings:

```ts
// After: const credentials = ...
// Enrich with agent binding names
const credIds = credentials.map((c: any) => c.id);
let bindingsMap: Record<string, Array<{ agentId: string; agentName: string }>> = {};
if (credIds.length > 0) {
  const { data: bindings } = await supabase!
    .from('agent_credential_bindings')
    .select('credential_id, agents!inner(id, name)')
    .in('credential_id', credIds);
  if (bindings) {
    for (const b of bindings as any[]) {
      const cid = b.credential_id;
      if (!bindingsMap[cid]) bindingsMap[cid] = [];
      bindingsMap[cid].push({ agentId: b.agents.id, agentName: b.agents.name });
    }
  }
}
const enriched = credentials.map((c: any) => ({
  ...c,
  bindings: bindingsMap[c.id] ?? [],
}));
res.json(enriched);
```

Add the necessary imports at the top: `import { toggleCredential, getAuditLog, getResolution } from '../vault.js';`

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/vault.ts && git commit -m "feat(vault): add toggle, audit, resolution endpoints and enriched list"
```

---

## Chunk 2: Client — Health Bar, Credential Row, Vault API

### Task 5: Update client vault API and hook

**Files:**
- Modify: `client/src/lib/vaultApi.ts`
- Modify: `client/src/hooks/useVault.ts`

- [ ] **Step 1: Add new API calls to vaultApi.ts**

Read `client/src/lib/vaultApi.ts` and add:

```ts
export async function toggleCredential(token: string, id: string, enabled: boolean): Promise<VaultEntry> {
  const res = await fetch(`${API_BASE}/api/vault/${id}/toggle`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error('Failed to toggle credential');
  return res.json();
}

export async function fetchAuditLog(token: string, id: string): Promise<{ entries: Array<{ id: string; action: string; agent_id: string | null; created_at: string }> }> {
  const res = await fetch(`${API_BASE}/api/vault/${id}/audit`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch audit log');
  return res.json();
}

export async function fetchResolution(token: string, id: string): Promise<{ resolved: string[]; unresolved: string[] }> {
  const res = await fetch(`${API_BASE}/api/vault/${id}/resolution`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch resolution');
  return res.json();
}
```

(Use the same `API_BASE` pattern from the existing file.)

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/vaultApi.ts client/src/hooks/useVault.ts && git commit -m "feat(vault): add toggle, audit, resolution API calls"
```

---

### Task 6: VaultHealthBar component

**Files:**
- Create: `client/src/components/Vault/VaultHealthBar.tsx`

- [ ] **Step 1: Implement the health bar**

```tsx
import type { VaultEntry } from '../../types/assistant'

type HealthState = 'disabled' | 'not_configured' | 'needs_attention' | 'unused' | 'healthy'

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
  for (const state of ['healthy', 'needs_attention', 'not_configured', 'unused', 'disabled'] as HealthState[]) {
    const count = counts.get(state) ?? 0
    if (count > 0) entries.push({ state, count })
  }

  if (entries.length === 0) return null

  return (
    <div className="vault-health-bar">
      {entries.map(({ state, count }) => (
        <span key={state} className="vault-health-item" style={{ color: HEALTH_COLORS[state] }}>
          <span className={`vault-health-dot ${state === 'not_configured' ? 'vault-health-dot--dashed' : ''}`}
                style={{ backgroundColor: state !== 'not_configured' ? HEALTH_COLORS[state] : 'transparent',
                         borderColor: HEALTH_COLORS[state] }} />
          {count} {HEALTH_LABELS[state]}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/Vault/VaultHealthBar.tsx && git commit -m "feat(vault): health summary bar with waterfall computation"
```

---

### Task 7: CredentialRow component

**Files:**
- Create: `client/src/components/Vault/CredentialRow.tsx`

- [ ] **Step 1: Implement the credential row**

Build `CredentialRow` with the three-zone layout from the spec:
- Left: type icon (36px, 🔑 or </>)
- Center: label (bold) + username/type + domain pills (max 2 + overflow `+N`)
- Right: health dot + "Updated Xd ago" or "never used"
- Hover: copy username + open detail chevron appear
- 3px left border colored by health state
- Disabled credentials: 50% opacity + "Disabled" badge

Props: `{ credential: VaultEntry; isExpanded: boolean; onToggleExpand: () => void }`

Use `computeHealth` from `VaultHealthBar.tsx` for health state. Use the existing `timeAgo` helper from `VaultPage.tsx`.

Component should be ~80-100 lines. All styles via CSS classes in `Vault.css`.

- [ ] **Step 2: Add CSS for credential rows**

Add to `Vault.css`:
- `.vault-row` — flex, align-items center, gap 12px, bg-card, border-primary, border-radius 8px, padding 12px 14px
- `.vault-row:hover` — bg-hover + show hover actions
- `.vault-row--disabled` — opacity 0.5
- `.vault-row-icon` — 36px square, bg-hover, border-radius 6px, flex center
- `.vault-row-center` — flex 1, min-width 0
- `.vault-row-label` — font-weight 600, 13px, text-primary
- `.vault-row-meta` — 10px, text-dim
- `.vault-row-domains` — flex, gap 4px, margin-top 4px
- `.vault-domain-pill` — rounded pill (border-radius 10px), accent-light bg, accent text, 9px
- `.vault-domain-overflow` — same pill style, text-dim
- `.vault-row-status` — text-align right, flex-shrink 0
- `.vault-health-dot` — 8px circle, inline-block
- `.vault-health-dot--dashed` — dashed border instead of filled
- `.vault-row-hover-actions` — hidden by default, visible on hover, flex gap 6px
- `.vault-row-border--healthy` etc — 3px left border colored by health state

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Vault/CredentialRow.tsx client/src/components/Vault/Vault.css && git commit -m "feat(vault): credential row with three-zone layout and hover actions"
```

---

### Task 8: VaultDetail accordion component

**Files:**
- Create: `client/src/components/Vault/VaultDetail.tsx`

- [ ] **Step 1: Implement the detail view**

Build `VaultDetail` with these sections (spec lines 129-183):

1. **Identity** — label, type badge, username with copy button, encrypted password indicator
2. **Domains** — reuse existing chip/tag input from VaultForm. Warning if no domains.
3. **Resolution Preview** — fetch from `GET /api/vault/:id/resolution`, show ✓/✗ lists
4. **Agent Bindings** — list agents, priority arrows, "Link to agent" button
5. **Security** — last updated (relative), domain count, agent count, "Rotate" button, enable/disable toggle
6. **Usage** — use_count, last agent + time, audit timeline (fetch from `/audit`)
7. **Actions** — Delete with confirmation

Props: `{ credential: VaultEntry; agentId?: string; onRefresh: () => void; onSendTask: (task: string) => void }`

The component should render below the CredentialRow when expanded (accordion). Use existing `FeatureCard` pattern for section layout. Keep it to ~150-200 lines — each section is a small div block.

Import `fetchAuditLog`, `fetchResolution`, `toggleCredential` from `vaultApi.ts`.

- [ ] **Step 2: Add CSS for detail accordion**

Add to `Vault.css`:
- `.vault-detail` — bg-card, border-primary (no top border — shares bottom border with row), padding 16px, border-bottom-radius 8px
- `.vault-detail-section` — margin-bottom 16px, padding-bottom 12px, border-bottom subtle
- `.vault-detail-label` — 10px, text-dim, uppercase, letter-spacing 1px
- `.vault-resolution-item` — flex, gap 6px, 11px
- `.vault-resolution-resolved` — color brand
- `.vault-resolution-unresolved` — color text-dimmer
- `.vault-audit-entry` — 11px, text-muted, padding 4px 0
- `.vault-toggle` — custom toggle switch using brand color
- `.vault-detail-actions` — flex, gap 8px, justify-content flex-end

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Vault/VaultDetail.tsx client/src/components/Vault/Vault.css && git commit -m "feat(vault): accordion detail view with resolution preview and audit trail"
```

---

## Chunk 3: Client — Page Assembly, Search, Onboarding

### Task 9: Redesign VaultPage with new components

**Files:**
- Modify: `client/src/components/Vault/VaultPage.tsx`

- [ ] **Step 1: Replace the credential list**

Rewrite `VaultPage.tsx` to use the new components:

1. Replace the header to show: `← Vault (N credentials) [+ Add]`
2. Add `<VaultHealthBar credentials={credentials} />` below the header
3. Replace the `<select>` type filter with filter chips: `All | 🔑 Password | </> API Key`
4. Replace the credential list `<div className="vault-list">` loop with `<CredentialRow>` + optional `<VaultDetail>` per credential
5. Track `expandedId: string | null` in state — clicking a row toggles it
6. Search: extend to also search `bindings` (agent names) from the enriched response

Keep the `VaultForm` integration as-is (it already works for create/edit).

- [ ] **Step 2: Update CSS — filter chips, health bar placement**

Add to `Vault.css`:
- `.vault-filter-chips` — flex, gap 6px
- `.vault-filter-chip` — padding 5px 12px, border-radius 6px, border 1px solid, font-size 11px, cursor pointer
- `.vault-filter-chip--active` — accent border + accent text
- `.vault-filter-chip--inactive` — border-primary border + text-dim
- `.vault-health-bar` — flex, gap 12px, padding 8px 0, border-bottom border-primary, font-size 11px, margin-bottom 12px

- [ ] **Step 3: Verify build**

```bash
cd browser-agent-chat && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Vault/VaultPage.tsx client/src/components/Vault/Vault.css && git commit -m "feat(vault): redesigned vault page with health bar, filter chips, and accordion rows"
```

---

### Task 10: Empty state and agent-triggered onboarding

**Files:**
- Modify: `client/src/components/Vault/VaultPage.tsx`
- Modify: `client/src/components/Vault/VaultForm.tsx`
- Modify: `client/src/components/ChatPanel.tsx`

- [ ] **Step 1: Improve empty state in VaultPage**

Replace the current empty state text with:
```tsx
<div className="vault-empty-state">
  <div className="vault-empty-icon">🛡️</div>
  <h2 className="vault-empty-title">Your vault is empty</h2>
  <p className="vault-empty-desc">
    Add a credential so agents can log in to websites on your behalf.
    Credentials are encrypted and only decrypted during agent login.
  </p>
  <button className="vault-add-btn" onClick={...}>+ Add Credential</button>
</div>
```

- [ ] **Step 2: Add prefillDomain prop to VaultForm**

In `VaultForm.tsx`, accept an optional `prefillDomain?: string` prop. When present:
- Pre-populate the domains chip input with that domain
- Auto-focus the label field

- [ ] **Step 3: Replace ChatPanel inline credential form**

Read `client/src/components/ChatPanel.tsx` and find the inline credential form that appears on `credential_needed`. Replace it with:

```tsx
<div className="chat-credential-prompt">
  <p>This site requires login.</p>
  <button onClick={() => navigate(`/vault?prefill=${encodeURIComponent(domain)}`)}>
    Add a credential for {domain}
  </button>
  <span>or select one from your vault</span>
</div>
```

The `VaultPage` should read the `prefill` query param and open the form pre-filled.

- [ ] **Step 4: Add empty state CSS**

Add to `Vault.css`:
- `.vault-empty-state` — text-align center, padding 60px 20px
- `.vault-empty-icon` — font-size 48px, margin-bottom 16px
- `.vault-empty-title` — font-size 18px, font-weight bold, text-primary
- `.vault-empty-desc` — font-size 13px, text-muted, max-width 400px, margin 8px auto 20px

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Vault/ client/src/components/ChatPanel.tsx && git commit -m "feat(vault): improved empty state and agent-triggered credential creation"
```

---

### Task 11: Final build and cleanup

- [ ] **Step 1: Run full build**

```bash
cd browser-agent-chat && npm run build
```

- [ ] **Step 2: Run all tests**

```bash
cd browser-agent-chat/client && npx vitest run && cd ../server && npx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: vault UI redesign — final integration"
```
