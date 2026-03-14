# Credential Vault Design Spec

## Goal

Build a user-level credential vault that securely stores, manages, and injects login credentials into browser sessions — ensuring the LLM never sees plaintext secrets.

## Architecture Overview

The system has six layers:

1. **Vault** — encrypted credential storage (Supabase, AES-256-GCM)
2. **Agent Bindings** — agents reference credentials, never own them
3. **Login Detector** — DOM heuristic with confidence scoring
4. **Login Strategy Engine** — handles different login flows
5. **Runtime Injection** — Playwright fills fields directly, credentials never enter LLM context
6. **Muscle Memory** — records successful login patterns for replay

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Credential scope | User-level vault | Reusable across agents, single update point |
| Agent relationship | Reference via bindings | Agents stateless, vault centralized |
| Vault backend | Supabase-native | Existing AES-256-GCM crypto.ts, RLS for isolation, no new infrastructure |
| Credential types | `username_password` MVP, `api_key` schema-ready | Covers 95% of login scenarios |
| Login detection | DOM heuristic with confidence scoring | No LLM involvement, low false positives |
| Login strategy | `standard_form` MVP | `two_step`, `redirect` documented as extension points |
| Injection method | Direct Playwright `page.fill()` | LLM never sees secrets |
| Audit | Lightweight (`use_count`, `last_used_at`) | Full audit table deferred |
| Deletion | Soft delete (`deleted_at`) | Never hard-delete secrets |

## Non-Goals (MVP)

- MFA support (TOTP, Okta push, Duo)
- `two_step` and `redirect` login strategies
- `workspace` / `organization` credential scoping
- Credential tags
- Full audit log table
- API key runtime injection (schema supports it, runtime doesn't)
- External vault backends (Infisical, HashiCorp Vault)

---

## Data Model

### `credentials_vault` table

```sql
CREATE TABLE credentials_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  label text NOT NULL,
  credential_type text NOT NULL DEFAULT 'username_password',
  encrypted_secret jsonb NOT NULL,    -- { iv, encrypted, tag } via AES-256-GCM
  metadata jsonb NOT NULL DEFAULT '{}', -- { username, notes } (non-sensitive)
  domains text[] NOT NULL DEFAULT '{}',
  scope text NOT NULL DEFAULT 'personal',
  version integer NOT NULL DEFAULT 1,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  last_used_by_agent uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_by_agent uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz              -- soft delete
);

-- RLS
ALTER TABLE credentials_vault ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own credentials"
  ON credentials_vault FOR ALL
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_credentials_vault_user_id ON credentials_vault(user_id);
CREATE INDEX idx_credentials_vault_domains ON credentials_vault USING GIN(domains);
```

### `agent_credential_bindings` table

```sql
CREATE TABLE agent_credential_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES credentials_vault(id) ON DELETE CASCADE,
  usage_context text,                 -- "admin login", "API access"
  priority integer NOT NULL DEFAULT 0, -- lower = preferred
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, credential_id)
);

-- RLS via join to credentials_vault.user_id
ALTER TABLE agent_credential_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own agent bindings"
  ON agent_credential_bindings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM credentials_vault cv
      WHERE cv.id = credential_id AND cv.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX idx_agent_cred_bindings_agent ON agent_credential_bindings(agent_id);
CREATE INDEX idx_agent_cred_bindings_cred ON agent_credential_bindings(credential_id);
```

### Migration from existing `agents.credentials`

1. For each agent with non-null `credentials`:
   - Decrypt using existing `decryptCredentials()`
   - Create a `credentials_vault` row (label = agent name, domains = agent URL domain)
   - Create an `agent_credential_bindings` row
   - Re-encrypt secret using vault format
2. Set `agents.credentials` to null
3. Drop `agents.credentials` column in follow-up migration

---

## Server Architecture

### New Files

#### `server/src/vault.ts` — Vault Service

Single responsibility: encrypted credential storage and retrieval.

```typescript
// Core CRUD
createCredential(userId, label, type, secret, metadata, domains): Promise<VaultEntry>
getCredential(id, userId): Promise<VaultEntry>          // metadata only, no secret
listCredentials(userId): Promise<VaultEntry[]>           // metadata only, no secrets
updateCredential(id, userId, updates): Promise<VaultEntry>
deleteCredential(id, userId): Promise<void>              // soft delete (sets deleted_at)
rotateCredential(id, userId, newSecret): Promise<void>   // re-encrypt, version++

// Binding management
bindToAgent(credentialId, agentId, context?, priority?): Promise<void>
unbindFromAgent(credentialId, agentId): Promise<void>
getAgentCredentials(agentId): Promise<BoundCredential[]> // metadata only

// Resolution
getCredentialForAgent(agentId, domain): Promise<VaultEntry | null>
  // 1. Check agent bindings
  // 2. Filter by domain (array containment)
  // 3. Sort by priority (lowest first)
  // 4. Return best candidate

findByDomain(userId, domain): Promise<VaultEntry[]>

// Injection (security-critical)
decryptForInjection(id, userId): Promise<PlaintextSecret>
  // 1. Decrypt secret
  // 2. Increment use_count
  // 3. Update last_used_at, last_used_by_agent
  // 4. Return plaintext — caller MUST use immediately and discard
```

#### `server/src/routes/vault.ts` — REST Endpoints

All routes behind `requireAuth` middleware.

```
GET    /api/vault                     — list user's credentials (metadata only)
GET    /api/vault/:id                 — get single credential (metadata only)
POST   /api/vault                     — create credential
PUT    /api/vault/:id                 — update label/domains/metadata
DELETE /api/vault/:id                 — soft delete
POST   /api/vault/:id/bind/:agentId  — bind credential to agent
DELETE /api/vault/:id/bind/:agentId  — unbind
GET    /api/agents/:id/credentials   — list agent's bound credentials
```

#### `server/src/login-detector.ts` — Login Page Detection

Multi-signal DOM heuristic with confidence scoring. Runs via `page.evaluate()` — pure DOM inspection, no LLM.

**Signals:**

| Signal | Weight |
|--------|--------|
| Visible `input[type=password]` | 5 |
| `form[action*=login]` or `form[action*=signin]` | 3 |
| Button text matching (sign in, log in, submit) | 2 |
| `input[name*=password]` or `input[name*=passwd]` | 2 |
| Username-like field nearby (`input[type=email]`, `input[name*=user]`) | 2 |

**Visibility check:** `element.offsetParent !== null` filters hidden forms.

**Threshold:** score >= 5 triggers login detection.

**Returns:**

```typescript
interface LoginDetectionResult {
  score: number;
  isLoginPage: boolean;           // score >= threshold
  selectors: {
    username: string | null;
    password: string | null;
    submit: string | null;
  };
  domain: string;
  strategy: 'standard_form' | 'two_step' | 'unknown';
}
```

#### `server/src/login-strategy.ts` — Login Strategy Engine

Orchestrates different login flows based on detected strategy type.

**MVP: `standard_form` only**

```typescript
interface LoginStrategy {
  type: 'standard_form' | 'two_step' | 'redirect';
  execute(page: Page, selectors: Selectors, credential: PlaintextSecret): Promise<LoginResult>;
}

interface LoginResult {
  success: boolean;
  error?: string;
}
```

**Standard form execution:**
1. Fill username field
2. Fill password field
3. Click submit
4. Verify login success

**Login success verification signals:**
- URL changed away from login page
- No visible `input[type=password]` anymore
- Dashboard/home selectors appear
- Cookie changes detected

**On failure:** retry once, then prompt user via WebSocket.

**Extension points (documented, not implemented):**
- `two_step`: username → next button → password → submit
- `redirect`: detect SSO redirect, follow it, then standard form

### Modified Files

#### `server/src/agent.ts` — Updated Login Flow

Remove plaintext password from `act()` calls. New flow:

```
1. Login detector runs on page
2. Score < 5 → continue normally
3. Score >= 5 → identify strategy + selectors
4. Check muscle memory for domain
5. Has pattern → verify domain match → replay with vault decrypt
6. No pattern → vault.getCredentialForAgent(agentId, domain)
7. Credential found → verify page.url.hostname in credential.domains
8. Domain mismatch → ABORT (exfiltration prevention)
9. Domain match → decryptForInjection() → strategy.execute()
10. No credential → WebSocket 'credential_needed' event
11. User provides → save to vault + bind + inject
12. Verify login success → record muscle memory
```

**Security hardening in injection:**
- Disable Playwright tracing around `page.fill()` calls
- Zero the plaintext variable immediately after injection: `password = null`
- Verify `page.url().hostname` matches `credential.domains` before injection
- Never log credential values (no console.log, no Langfuse span data)

#### `server/src/muscle-memory.ts` — Credential Reference

Updated pattern format:

```typescript
interface LoginPattern {
  domain: string;
  credential_id: string;            // reference, not plaintext
  strategy: 'standard_form';
  username_selector: string;
  password_selector: string;
  submit_selector: string;
}
```

On replay: the caller in `agent.ts` calls `vault.decryptForInjection(pattern.credential_id, userId)` and passes the decrypted values to a pure `injectCredentials()` function. `injectCredentials()` remains a synchronous, pure function — it receives already-decrypted values and fills Playwright fields. It does NOT gain a dependency on vault.ts. The vault lookup responsibility stays in `agent.ts`.

Existing patterns with plaintext values are cleared during migration.

#### `server/src/index.ts`

- Mount vault routes: `app.use('/api/vault', vaultRouter)`
- Add `credential_provided` WebSocket message handler: look up pending credential request by session ID, resolve the promise to unblock the login flow

#### `server/src/types.ts`

Add shared TypeScript types:
- `VaultEntry`, `BoundCredential` — vault data types (metadata only, no secrets)
- `PlaintextSecret` — replaces existing `PlaintextCredentials` interface. New shape: `{ password?: string; apiKey?: string }` (extensible by credential type). The existing `PlaintextCredentials` type (`{ username, password }`) is deprecated — `username` moves to `metadata` (non-sensitive). Update `crypto.ts` to export new `encryptSecret()`/`decryptSecret()` functions that work with `PlaintextSecret`. Keep old `encryptCredentials()`/`decryptCredentials()` during migration period only, then remove.
- `LoginDetectionResult`, `LoginPattern`, `LoginResult` — login detection types (including `LoginPattern` from muscle-memory)
- `credential_needed` / `credential_provided` variants added to `ServerMessage` / `ClientMessage` unions

---

## Client Architecture

### New Files

#### `client/src/components/Vault/VaultPage.tsx` — Vault Management

Route: `/vault` (user-level, not per-agent).

**Sidebar navigation:** The Sidebar's `navTo()` helper constructs agent-scoped paths (`/agents/:id/...`). The Vault link uses a separate click handler that navigates directly to `/vault` without an agent ID prefix, since credentials belong to the user, not the agent.

**List view columns:**

| Column | Content |
|--------|---------|
| Label | "Github Work" |
| Type | `username_password` |
| Username | from metadata |
| Domains | chip display |
| Used By | "3 agents" (count of bindings) |
| Last Used | relative time |
| Actions | Edit, Delete |

Password never shown — always masked.

**Features:**
- Search bar (filters by label, username, domain)
- Type filter dropdown
- Add credential button → opens VaultForm

#### `client/src/components/Vault/VaultForm.tsx` — Add/Edit Form

**Dynamic form based on credential type:**

For `username_password`:
- Label (text)
- Username (text)
- Password (password input, masked)
- Domains (chip/tag input with auto-normalization)
- Optional: bind to agent (dropdown)

For `api_key`:
- Label (text)
- API Key (password input, masked)
- Domains (chip/tag input)
- Optional: bind to agent (dropdown)

**Domain normalization:** strip protocol, strip trailing slash, lowercase. Domain matching is exact — `example.com` does NOT match `app.example.com`. Users must add each subdomain explicitly. This prevents accidental credential leakage to unexpected subdomains.

**Password editing:** never auto-fill. Show "Change password" button; only reveal input on click.

#### `client/src/components/Vault/Vault.css`

Themed with CSS custom properties from App.css. No hardcoded colors.

#### `client/src/hooks/useVault.ts`

State management hook:
- `credentials` — list of vault entries
- `loading`, `error` states
- `refresh()` — re-fetch
- `createCredential()`, `updateCredential()`, `deleteCredential()`
- `bindToAgent()`, `unbindFromAgent()`

#### `client/src/lib/vaultApi.ts`

API call layer in `lib/` directory (consistent with existing `lib/api.ts`):

```typescript
listCredentials(token): Promise<VaultEntry[]>
createCredential(token, data): Promise<VaultEntry>
updateCredential(token, id, data): Promise<VaultEntry>
deleteCredential(token, id): Promise<void>
bindToAgent(token, credentialId, agentId, context?, priority?): Promise<void>
unbindFromAgent(token, credentialId, agentId): Promise<void>
getAgentCredentials(token, agentId): Promise<BoundCredential[]>
```

### Modified Files

#### `client/src/App.tsx`

Add `/vault` route.

#### `client/src/components/Sidebar.tsx`

Add Vault nav item (Lucide `KeyRound` icon), positioned between Memory and Settings.

#### `client/src/components/AgentSettings.tsx`

New "Linked Credentials" section:
- Lists credentials bound to this agent (label, domains, priority, context)
- "Link Credential" button → picker from vault entries
- Domain compatibility warning if credential domains don't match agent's URL
- Priority reorder
- Unlink button per entry

#### `client/src/components/ChatPanel.tsx`

Updated inline credential flow:

1. Server sends `credential_needed` WebSocket event: `{ agentId, domain, strategy }`
2. `WebSocketContext.tsx` receives the event in its `handleMessage` switch, stores the credential request in context state (`pendingCredentialRequest: { agentId, domain, strategy } | null`)
3. ChatPanel reads `pendingCredentialRequest` from WebSocket context. When non-null, shows inline form with detected domain prominently displayed:
   - Username, Password, Label (pre-filled with domain). Credential type defaults to `username_password`.
4. On submit:
   - `POST /api/vault` → creates vault entry with encrypted secret
   - `POST /api/vault/:id/bind/:agentId` → binds to agent
   - Calls `ws.sendCredentialProvided(credentialId)` — a new method on the WebSocket context that sends `{ type: 'credential_provided', credentialId }` over the socket (never raw credentials)
   - Clears `pendingCredentialRequest` in context
5. Agent continues with injection

---

## WebSocket Events

### Server → Client

```typescript
// Login detected, no credential found
{ type: 'credential_needed', agentId: string, domain: string, strategy: string }
```

### Client → Server

```typescript
// User provided credential (already saved to vault via REST)
{ type: 'credential_provided', credentialId: string }
```

Raw credentials never travel over WebSocket.

### WebSocket Type Updates

Add to `server/src/types.ts` (`ServerMessage` union):
```typescript
{ type: 'credential_needed'; agentId: string; domain: string; strategy: string }
```

Add to `server/src/types.ts` (`ClientMessage` union):
```typescript
{ type: 'credential_provided'; credentialId: string }
```

Mirror `VaultEntry`, `BoundCredential`, and credential WebSocket event types in `client/src/types/assistant.ts` (the existing client-side type file).

### Server-Side Pause/Resume for Credential Flow

When the agent hits step 10 (no credential found), the login flow must pause and wait for the user to provide credentials via the ChatPanel inline form.

**Mechanism:** The login flow creates a `Promise` and stores its `resolve` callback keyed by session ID. When the `credential_provided` WebSocket message arrives in `index.ts`, it looks up the pending resolver and calls it with the `credentialId`. The login flow's `await` unblocks and continues with injection.

**Location:** `pendingCredentialRequests` lives in `server/src/vault.ts` as an exported map. Both `agent.ts` (writes pending requests) and `index.ts` (resolves them on WebSocket message) import it from the same module.

```typescript
// In vault.ts (exported)
export const pendingCredentialRequests = new Map<string, (credentialId: string) => void>();

// Step 10: no credential found
const credentialId = await new Promise<string>((resolve) => {
  pendingCredentialRequests.set(sessionId, resolve);
  ws.send(JSON.stringify({ type: 'credential_needed', agentId, domain, strategy }));
});
pendingCredentialRequests.delete(sessionId);

// In index.ts WebSocket handler
case 'credential_provided':
  const resolver = pendingCredentialRequests.get(sessionId);
  if (resolver) resolver(msg.credentialId);
  break;
```

**Timeout:** If no response within 5 minutes, reject the promise and skip login (agent continues without credentials).

---

## Server-Side Access Pattern

The server uses the Supabase service role key (which bypasses RLS). Therefore, the vault service **must manually enforce `user_id` checks in all queries** — every vault function accepts `userId` as a parameter and includes `WHERE user_id = $userId AND deleted_at IS NULL` in its queries.

RLS policies remain as a defense-in-depth layer (protects against direct DB access, Supabase dashboard queries, etc.) but are not the primary access control mechanism for server-side operations.

---

## `executeLogin` Migration

The existing `executeLogin()` function in `agent.ts` is **replaced entirely** by the new login detector + strategy engine flow:

1. **Remove** the current `executeLogin()` function that passes plaintext credentials to `agent.act()`
2. **Remove** the LLM-based login fallback (`agent.act("Log in with username X and password Y")`) — this path is eliminated, not kept as fallback
3. **Update** `replayLogin()` in `muscle-memory.ts` to accept a `credential_id` and resolve it via the vault before calling `injectCredentials()`. `injectCredentials()` itself remains pure — it continues to receive pre-decrypted values from its caller, not raw `{ username, password }` from the old format
4. **Replace** the call site in `index.ts`: remove the `decryptCredentials()` call, the `credentials` local variable, and the `if (agent.credentials)` guard that currently gates the login flow. Replace with the login detector entry point that runs automatically when the agent navigates to a page
5. **Clear** all existing muscle memory patterns that contain plaintext credential values during migration

---

## Security Model

### Encryption
- AES-256-GCM via existing `crypto.ts`
- Random IV per encryption (prevents replay)
- `CREDENTIALS_ENCRYPTION_KEY` env var (32-byte hex)
- Encryption/decryption happens server-side only

### Access Control
- Supabase RLS: `auth.uid() = user_id` on vault table
- Bindings RLS: join to vault's user_id
- `requireAuth` middleware on all REST endpoints
- JWT verification on WebSocket events

### Injection Security
- Domain verification: `page.url().hostname` must be in `credential.domains` before injection
- Playwright trace suppression during `page.fill()`
- Variable zeroing after injection
- No logging of credential values (console, Langfuse, or otherwise)
- LLM never receives plaintext credentials in prompts

### Data Lifecycle
- Soft delete only (set `deleted_at`, filter in queries)
- `rotateCredential()` increments version, re-encrypts
- Muscle memory stores `credential_id`, never plaintext values

---

## File Inventory

### New Server Files
| File | Purpose |
|------|---------|
| `server/src/vault.ts` | Vault service (CRUD, binding, decrypt) |
| `server/src/routes/vault.ts` | REST endpoints |
| `server/src/login-detector.ts` | DOM heuristic login detection |
| `server/src/login-strategy.ts` | Login flow orchestration |

### Modified Server Files
| File | Change |
|------|--------|
| `server/src/agent.ts` | Replace `executeLogin()` with detector → vault → inject flow |
| `server/src/muscle-memory.ts` | Store credential_id, not plaintext; update replay to decrypt from vault |
| `server/src/index.ts` | Mount vault routes + handle `credential_provided` WebSocket event |
| `server/src/types.ts` | Add vault types + WebSocket event types |
| `server/src/crypto.ts` | Add `encryptSecret()`/`decryptSecret()` for new `PlaintextSecret` type; deprecate old `encryptCredentials()`/`decryptCredentials()` (keep during migration) |

### New Client Files
| File | Purpose |
|------|---------|
| `client/src/components/Vault/VaultPage.tsx` | List + search/filter |
| `client/src/components/Vault/VaultForm.tsx` | Dynamic add/edit form |
| `client/src/components/Vault/Vault.css` | Themed styles |
| `client/src/hooks/useVault.ts` | State management |
| `client/src/lib/vaultApi.ts` | API calls (consistent with existing lib/api.ts) |

### Modified Client Files
| File | Change |
|------|--------|
| `client/src/App.tsx` | Add `/vault` route |
| `client/src/components/Sidebar.tsx` | Add Vault nav item |
| `client/src/components/AgentSettings.tsx` | Linked credentials section |
| `client/src/components/ChatPanel.tsx` | Read `pendingCredentialRequest` from context, show inline form |
| `client/src/contexts/WebSocketContext.tsx` | Handle `credential_needed` event in `handleMessage`, expose `pendingCredentialRequest` state and `sendCredentialProvided()` method |
| `client/src/types/assistant.ts` | Add `VaultEntry`, `BoundCredential`, credential WebSocket event types |

### Database
| Migration | Purpose |
|-----------|---------|
| New migration | `credentials_vault` + `agent_credential_bindings` + RLS + indexes |
| Data migration | Move `agents.credentials` → vault rows + bindings |
| Cleanup migration | Drop `agents.credentials` column |
