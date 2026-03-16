# Vault UI Redesign — Design Spec

## Overview

Redesign the Credential Vault UI for visual polish and information hierarchy. The core encryption and credential resolution workflow remain unchanged. Minor data model additions (an `enabled` column and an audit log table) and new API endpoints are documented below. The focus is on making the vault feel like a **diagnostic tool for agent credential resolution** rather than a generic password list.

## Problem

The current Vault UI is functional but visually generic. Credential rows have flat hierarchy with too many elements competing for attention. There are no health indicators, no resolution feedback, and no agent-first entry points. Users cannot answer the key question: "Will the agent reliably find and use this credential?"

## Design Principles

1. **Agent-first** — the vault exists to serve browser agents, not as a standalone password manager
2. **Diagnostic, not decorative** — every visual element answers a question about credential readiness
3. **Calm density** — show more information per row, but with clear hierarchy so eyes know where to land
4. **Delphi Tools aesthetic** — warm, earthy, handmade feel using the existing CSS variable theme

## Layout

Keep the current **single-column layout** at 900px max-width. This matches Notion/Linear/Raycast productivity tools and fits our user profile (5-30 credentials, not hundreds).

The page structure:

```
┌─────────────────────────────────────┐
│ Header: ← Vault (3 credentials) [+]│
├─────────────────────────────────────┤
│ Health Summary Bar                  │
│ 4 healthy · 1 needs rotation · 1…  │
├─────────────────────────────────────┤
│ Search + Filter Chips               │
├─────────────────────────────────────┤
│ Credential Row                      │
│ Credential Row                      │
│ Credential Row                      │
│ ...                                 │
└─────────────────────────────────────┘
```

## Vault Health Summary Bar

A single-line overview below the header showing credential health distribution.

```
4 healthy · 1 needs rotation · 1 missing domains
```

**Health states:**

| Status | Color | Meaning |
|--------|-------|---------|
| Healthy | Green (`--brand`) | Used recently + has domains + has agent bindings |
| Needs attention | Amber (`--accent`) | Stale (not rotated in 90+ days) OR no agent bindings |
| Not configured | Blue (`#5B8DB8`) | No domains set — agent cannot auto-resolve |
| Unused | Gray (`--text-dim`) | Never used by any agent |
| Disabled | Gray with strikethrough | User has disabled this credential for agents |

**Why blue instead of red for "not configured":** Red implies security risk. Missing domains is an informational gap, not a danger signal. Blue communicates "action needed" without alarm.

**Computation:** Health is derived client-side from `VaultEntry` fields using an **exclusive priority waterfall** — the first matching rule wins:

```ts
function computeHealth(cred: VaultEntry): HealthState {
  if (!cred.enabled) return 'disabled'        // 1. Disabled trumps everything
  if (cred.domains.length === 0) return 'not_configured'  // 2. No domains = can't resolve
  if (daysSince(cred.updated_at) >= 90) return 'needs_attention'  // 3. Stale
  if (cred.use_count === 0) return 'unused'   // 4. Never used
  return 'healthy'                             // 5. Default: everything looks good
}
```

The health summary bar counts disabled credentials separately: "4 healthy · 1 needs rotation · 1 disabled"

## Credential Row Design

Each row has a clear three-zone hierarchy:

```
[icon]  Label                              health dot
        username · primary-domain           last used
        domain-pill  domain-pill  +N
```

### Zones

**Left: Type icon** (36px square, `--bg-hover` background, rounded)
- `🔑` for `username_password`
- `</>` for `api_key`

**Center: Identity + domains**
- **Line 1:** Label (bold, 13px) — the credential name
- **Line 2:** Username + primary domain (muted, 10px). For API keys: "API Key · no domains" or "API Key · github.com"
- **Line 3:** Domain pills — max 2 visible, overflow as `+N` pill

**Right: Status**
- Health dot (colored circle, 8px)
- "Updated 3w ago" or "never used" (10px, colored by staleness)

### Rules
- Max 2 domain pills visible. Overflow → `+N` pill that expands on click.
- Domain pills use subtle accent background: `rgba(212,135,77,0.12)` with `--accent` text.
- Health dot uses the health color from the summary bar table.
- "Updated X ago" shows time since `updated_at`. Amber color if > 90 days.

### Hover behavior
- Row background shifts to `--bg-hover`
- Two actions appear on the right: **copy username** (clipboard icon) and **open detail** (chevron)
- No edit/delete/rotate on hover — those live in the detail view

### Left border
- 3px left border colored by health state (matches the health dot)
- Provides a scannable "health stripe" down the left edge of the list

## Search & Filtering

**Search input:** Single text input searching across:
- `label`
- `metadata.username`
- `domains[]`
- Agent binding names (if a credential is bound to "Langfuse Agent", searching "langfuse" surfaces it)

**Agent binding search requires API change:** The `GET /api/vault` endpoint must be extended to include a `bindings` array on each credential (joining `agent_credential_bindings` + `agents` table to include agent names). This is a lightweight join — the existing query already filters by `user_id`, so adding binding data is a single additional query per list fetch. The `VaultEntry` type gains an optional `bindings?: Array<{ agentId: string; agentName: string }>` field.

**Filter chips** (replace the dropdown):
- `All` | `🔑 Password` | `</> API Key`
- Active chip uses `--accent` border + text
- Inactive chips use `--border-primary` border + `--text-dim` text

## Detail View

Clicking a credential row opens an **inline expanded detail** below the row (accordion style, not a separate page or modal). This keeps context — the user sees where the credential sits in the list.

### Sections

**Identity**
- Label (editable inline)
- Credential type (read-only badge)
- Username (editable inline, with copy button)
- Password: shield icon + "Encrypted — decrypted only during agent login"

**Domains**
- Editable chip/tag input (current implementation)
- Auto-suggest from agent NavNode URLs (pages the agent has visited)
- Warning banner if no domains: "No domains configured — agent cannot auto-resolve this credential"

**Resolution Preview**
Shows which domains this credential will resolve for:
```
Resolution

✓ stripe.com
✓ dashboard.stripe.com
✗ api.stripe.com (not in domains list)
```

Requires a new server endpoint: `GET /api/vault/:id/resolution` that:
1. Loads the credential's `domains` array
2. Queries `nav_nodes` across all of the user's agents for URL patterns
3. For each known domain/URL, checks if `credential.domains` would match via the same `findByDomain` normalization logic
4. Returns `{ resolved: string[], unresolved: string[] }`

This answers the key question: "Will the agent find this credential?"

**Agent Bindings**
- List of agents using this credential (from `agent_credential_bindings`)
- Each shows: agent name + priority + usage context
- "Link to agent" button to add new binding
- Priority ordering: up/down arrow buttons (no drag-to-reorder — avoids library dependency for a minor feature)

**Security**
- Last rotated: relative timestamp ("3 weeks ago")
- Domains configured: count
- Agents using: count
- "Rotate Password" button → modal with single password input
- **Enable for agents** toggle — allows temporarily disabling the credential without deleting it

**Usage**
- Total uses: `use_count`
- Last used by: agent name + relative timestamp
- Lightweight timeline of last 10 usage events (requires `credential_audit_log` table — see Data Changes)

**Actions** (bottom of detail)
- Delete credential (with confirmation)

## Credential Locking

New boolean field `enabled` on `credentials_vault` (default `true`).

When disabled:
- Row shows a muted/dimmed appearance with a "Disabled" badge
- Agent resolution skips this credential (server-side check in `getCredentialForAgent`)
- The toggle in the detail view reads "Enable for agents" / "Disabled for agents"

**Use case:** User's agent is accidentally breaking a production login. They can instantly disable the credential without deleting it or its bindings.

**Agent behavior when credential is disabled:** If `getCredentialForAgent` finds a matching credential but it's disabled, the agent broadcasts a chat message: "Found credential for {domain} but it is currently disabled. Enable it in the Vault to proceed." The agent then falls through to the `credential_needed` prompt flow.

## Agent-First Onboarding

### Empty vault state
Current: "No credentials stored yet. Add one to get started."

Proposed:
```
[Shield icon illustration]

Your vault is empty

Add a credential so agents can log in to websites on your behalf.
Credentials are encrypted and only decrypted during agent login.

[+ Add Credential]
```

### Agent-triggered credential creation

When the `credential_needed` WebSocket event fires and the agent needs credentials for a domain:

1. Chat shows an inline prompt: "This site requires login. **Add a credential for stripe.com** or select one from your vault."
2. Clicking "Add a credential for stripe.com" opens the vault form **pre-filled** with:
   - Domain: `stripe.com` (from the agent's current URL)
   - Focus on the label field
3. After saving, the credential is automatically bound to the requesting agent

This turns a blocking agent failure into a smooth onboarding moment.

**Existing ChatPanel inline form:** The current `ChatPanel.tsx` has an inline credential form that appears on `credential_needed`. This form should be **replaced** with the new flow described above — an inline prompt that links to the pre-filled vault form. The inline ChatPanel form should be removed because credentials entered there bypass the vault entirely and are not persisted or encrypted. All credential creation should go through the vault.

## Data Changes

### Modified table: `credentials_vault`
- Add column: `enabled boolean NOT NULL DEFAULT true`

### New table: `credential_audit_log`
```sql
CREATE TABLE credential_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES credentials_vault(id),
  agent_id uuid REFERENCES agents(id), -- NULL for user-initiated actions (rotate, enable, disable)
  session_id text,                     -- NULL for user-initiated actions
  action text NOT NULL, -- 'decrypt', 'rotate', 'bind', 'unbind', 'enable', 'disable'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_credential ON credential_audit_log(credential_id);
CREATE INDEX idx_audit_log_created ON credential_audit_log(created_at);
```

### Server changes
- `getCredentialForAgent()` in `vault.ts`: skip credentials where `enabled = false`
- `decryptForInjection()`: insert audit log entry with action `'decrypt'`
- `rotateCredential()`: insert audit log entry with action `'rotate'`
- New endpoint: `PUT /api/vault/:id/toggle` — sets `enabled` field, inserts audit log entry
- New endpoint: `GET /api/vault/:id/audit` — returns last 10 audit log entries
- New endpoint: `GET /api/vault/:id/resolution` — returns `{ resolved: string[], unresolved: string[] }` by matching credential domains against NavNode URLs across user's agents
- Modify `GET /api/vault` — include `bindings` array (agent names) per credential for search

## Files Affected

### Modified (client)
- `client/src/components/Vault/VaultPage.tsx` — redesigned list, health bar, search, filter chips, row layout
- `client/src/components/Vault/VaultForm.tsx` — pre-fill support for agent-triggered creation
- `client/src/components/Vault/Vault.css` — new styles for health bar, row design, detail accordion, domain pills
- `client/src/components/ChatPanel.tsx` — remove inline credential form, replace with vault-linking prompt
- `client/src/hooks/useVault.ts` — update to handle enriched list response (with bindings)
- `client/src/lib/vaultApi.ts` — add toggle, audit, and resolution API calls

### New (client)
- `client/src/components/Vault/VaultDetail.tsx` — accordion detail view with resolution preview, agent bindings, security section, audit timeline
- `client/src/components/Vault/VaultHealthBar.tsx` — health summary computation and display
- `client/src/components/Vault/CredentialRow.tsx` — extracted row component with hover actions

### Modified (shared types)
- `client/src/types/assistant.ts` — add `enabled: boolean` to `VaultEntry` interface
- `server/src/types.ts` — add `enabled: boolean` to `VaultEntry` interface

### Modified (server)
- `server/src/vault.ts` — add `enabled` to `VAULT_METADATA_COLS`, add `enabled` filter in `getCredentialForAgent`, add audit logging helpers
- `server/src/routes/vault.ts` — add toggle, audit, and resolution endpoints

### New (server)
- `server/migrations/008_vault_audit_log.sql` — adds `enabled` column and `credential_audit_log` table

## Out of Scope (Phase 2)

- Login success rate tracking (requires server-side instrumentation of login outcomes)
- Credential sharing between users (scope is currently `'personal'` only)
- Breach monitoring / password strength analysis
- Bulk import from other password managers
- TOTP / 2FA token support
- Full audit log search and export
