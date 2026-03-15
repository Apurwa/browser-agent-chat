# Credential Vault Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a user-level credential vault that securely stores, manages, and injects login credentials into browser sessions — ensuring the LLM never sees plaintext secrets.

**Architecture:** User-level vault in Supabase (AES-256-GCM encryption), agents reference credentials via bindings. DOM heuristic detects login pages, Playwright injects credentials directly. Muscle memory stores patterns with credential references, not plaintext.

**Tech Stack:** TypeScript, Express, Supabase (PostgreSQL + RLS), AES-256-GCM, React 19, Vite, Playwright (via magnitude-core)

**Spec:** `docs/superpowers/specs/2026-03-15-credential-vault-design.md`

---

## File Structure

### New Server Files
| File | Responsibility |
|------|---------------|
| `server/src/vault.ts` | Vault service: CRUD, bindings, credential resolution, decryptForInjection, pendingCredentialRequests map |
| `server/src/routes/vault.ts` | REST endpoints for vault CRUD + agent binding |
| `server/src/login-detector.ts` | DOM heuristic: multi-signal login page detection with confidence scoring |
| `server/src/login-strategy.ts` | Login flow orchestration: standard_form MVP, verification |

### Modified Server Files
| File | Change |
|------|--------|
| `server/src/types.ts` | Add VaultEntry, BoundCredential, PlaintextSecret, LoginDetectionResult, LoginPattern, LoginResult, WebSocket event types |
| `server/src/crypto.ts` | Add encryptSecret()/decryptSecret() for PlaintextSecret |
| `server/src/agent.ts` | Replace executeLogin() with detector → vault → strategy flow |
| `server/src/muscle-memory.ts` | Update replayLogin() to accept credential_id; injectCredentials() stays pure |
| `server/src/index.ts` | Mount vault routes, handle credential_provided WS event |

### New Client Files
| File | Responsibility |
|------|---------------|
| `client/src/lib/vaultApi.ts` | REST API calls for vault CRUD + bindings |
| `client/src/hooks/useVault.ts` | State management hook for vault operations |
| `client/src/components/Vault/VaultPage.tsx` | List view with search, filter, add/edit/delete |
| `client/src/components/Vault/VaultForm.tsx` | Dynamic add/edit form (type-dependent fields) |
| `client/src/components/Vault/Vault.css` | Themed styles using CSS custom properties |

### Modified Client Files
| File | Change |
|------|--------|
| `client/src/types/assistant.ts` | Add VaultEntry, BoundCredential, credential WS event types |
| `client/src/App.tsx` | Add /vault route |
| `client/src/components/Sidebar.tsx` | Add Vault nav item (KeyRound icon) |
| `client/src/components/AgentSettings.tsx` | Add "Linked Credentials" section |
| `client/src/contexts/WebSocketContext.tsx` | Handle credential_needed, expose pendingCredentialRequest + sendCredentialProvided() |
| `client/src/components/ChatPanel.tsx` | Read pendingCredentialRequest, show inline vault-saving form |

---

## Chunk 1: Foundation (Database + Types + Crypto + Vault Service)

### Task 1: Database Migration

**Files:**
- Create: `server/migrations/006_credential_vault.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration: Credential Vault tables
-- Run this in Supabase SQL Editor

-- 1. Credential Vault table
CREATE TABLE credentials_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  label text NOT NULL,
  credential_type text NOT NULL DEFAULT 'username_password',
  encrypted_secret jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  domains text[] NOT NULL DEFAULT '{}',
  scope text NOT NULL DEFAULT 'personal',
  version integer NOT NULL DEFAULT 1,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  last_used_by_agent uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_by_agent uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE credentials_vault ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own credentials"
  ON credentials_vault FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_credentials_vault_user_id ON credentials_vault(user_id);
CREATE INDEX idx_credentials_vault_domains ON credentials_vault USING GIN(domains);

-- 2. Agent-Credential Bindings table
CREATE TABLE agent_credential_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES credentials_vault(id) ON DELETE CASCADE,
  usage_context text,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, credential_id)
);

ALTER TABLE agent_credential_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own agent bindings"
  ON agent_credential_bindings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM credentials_vault cv
      WHERE cv.id = credential_id AND cv.user_id = auth.uid()
    )
  );

CREATE INDEX idx_agent_cred_bindings_agent ON agent_credential_bindings(agent_id);
CREATE INDEX idx_agent_cred_bindings_cred ON agent_credential_bindings(credential_id);

-- 3. RPC for atomic use_count increment
CREATE OR REPLACE FUNCTION increment_vault_use(vault_uuid UUID, agent_uuid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE credentials_vault
  SET use_count = use_count + 1,
      last_used_at = now(),
      last_used_by_agent = agent_uuid,
      updated_at = now()
  WHERE id = vault_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC for atomic version increment (used by rotateCredential)
CREATE OR REPLACE FUNCTION increment_vault_version(vault_uuid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE credentials_vault
  SET version = version + 1,
      updated_at = now()
  WHERE id = vault_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Add credential_id and domain columns to learned_patterns for vault integration
ALTER TABLE learned_patterns
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES credentials_vault(id) ON DELETE SET NULL;

-- Unique constraint for upsert in recordLoginPattern
CREATE UNIQUE INDEX IF NOT EXISTS idx_learned_patterns_agent_domain_type
  ON learned_patterns(agent_id, domain, pattern_type)
  WHERE domain IS NOT NULL;
```

- [ ] **Step 2: Run migration in Supabase SQL Editor**

Go to Supabase dashboard → SQL Editor → paste and run the migration.
Verify: tables `credentials_vault` and `agent_credential_bindings` exist with correct columns, RLS policies, and indexes.

- [ ] **Step 3: Commit**

```bash
git add server/migrations/006_credential_vault.sql
git commit -m "feat(db): add credentials_vault and agent_credential_bindings tables"
```

---

### Task 2: Server Type Definitions

**Files:**
- Modify: `server/src/types.ts`

- [ ] **Step 1: Add vault types to types.ts**

Add these types after the existing `EncryptedCredentials` interface:

```typescript
// --- Credential Vault Types ---

export interface PlaintextSecret {
  password?: string;
  apiKey?: string;
}

export interface VaultEntry {
  id: string;
  user_id: string;
  label: string;
  credential_type: string;
  metadata: { username?: string; notes?: string };
  domains: string[];
  scope: string;
  version: number;
  use_count: number;
  last_used_at: string | null;
  last_used_by_agent: string | null;
  created_by_agent: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoundCredential extends VaultEntry {
  usage_context: string | null;
  priority: number;
  binding_id: string;
}

export interface LoginDetectionResult {
  score: number;
  isLoginPage: boolean;
  selectors: {
    username: string | null;
    password: string | null;
    submit: string | null;
  };
  domain: string;
  strategy: 'standard_form' | 'two_step' | 'unknown';
}

export interface LoginPattern {
  domain: string;
  credential_id: string;
  strategy: 'standard_form';
  username_selector: string;
  password_selector: string;
  submit_selector: string;
}

export interface LoginResult {
  success: boolean;
  error?: string;
}
```

- [ ] **Step 1b: Extend LearnedPattern type with vault fields**

Add `credential_id` and `domain` to the existing `LearnedPattern` interface (both are optional for backward compatibility with existing patterns):

```typescript
// Add to existing LearnedPattern interface:
  domain?: string;
  credential_id?: string;  // Reference to credentials_vault.id
```

- [ ] **Step 2: Add credential WebSocket event types to ServerMessage union**

Add to the `ServerMessage` union:

```typescript
  | { type: 'credential_needed'; agentId: string; domain: string; strategy: string }
```

- [ ] **Step 3: Add credential WebSocket event types to ClientMessage union**

Add to the `ClientMessage` union:

```typescript
  | { type: 'credential_provided'; credentialId: string }
```

- [ ] **Step 4: Verify server compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p server/tsconfig.json`
Expected: No new errors (existing errors may exist)

- [ ] **Step 5: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(types): add credential vault, login detection, and WebSocket event types"
```

---

### Task 3: Crypto Updates

**Files:**
- Modify: `server/src/crypto.ts`
- Create: `server/__tests__/crypto.test.ts`

- [ ] **Step 1: Write tests for new encrypt/decrypt functions**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret } from '../src/crypto.js';
import type { PlaintextSecret } from '../src/types.js';

// getKey() reads CREDENTIALS_ENCRYPTION_KEY from env — must be a 32-byte hex string
beforeAll(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes in hex
});

describe('encryptSecret / decryptSecret', () => {
  it('encrypts and decrypts a password secret', () => {
    const secret: PlaintextSecret = { password: 'my-secure-pass' };
    const encrypted = encryptSecret(secret);

    expect(encrypted).toHaveProperty('iv');
    expect(encrypted).toHaveProperty('encrypted');
    expect(encrypted).toHaveProperty('tag');
    expect(encrypted.encrypted).not.toContain('my-secure-pass');

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toEqual(secret);
  });

  it('encrypts and decrypts an API key secret', () => {
    const secret: PlaintextSecret = { apiKey: 'sk-test-12345' };
    const encrypted = encryptSecret(secret);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toEqual(secret);
  });

  it('produces different ciphertexts for same input (random IV)', () => {
    const secret: PlaintextSecret = { password: 'same-pass' };
    const e1 = encryptSecret(secret);
    const e2 = encryptSecret(secret);
    expect(e1.iv).not.toEqual(e2.iv);
    expect(e1.encrypted).not.toEqual(e2.encrypted);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/crypto.test.ts`
Expected: FAIL — `encryptSecret` is not exported

- [ ] **Step 3: Implement encryptSecret and decryptSecret in crypto.ts**

Add after existing functions in `server/src/crypto.ts`:

```typescript
import type { PlaintextSecret } from './types.js';

export function encryptSecret(secret: PlaintextSecret): EncryptedCredentials {
  const json = JSON.stringify(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(json, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { iv: iv.toString('hex'), encrypted, tag };
}

export function decryptSecret(data: EncryptedCredentials): PlaintextSecret {
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(data.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
  let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted) as PlaintextSecret;
}
```

Note: Import `PlaintextSecret` from `./types.js`. The existing `encryptCredentials`/`decryptCredentials` functions remain unchanged for backward compatibility during migration.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/crypto.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/crypto.ts server/__tests__/crypto.test.ts
git commit -m "feat(crypto): add encryptSecret/decryptSecret for credential vault"
```

---

### Task 4: Vault Service

**Files:**
- Create: `server/src/vault.ts`
- Create: `server/__tests__/vault.test.ts`

- [ ] **Step 1: Write vault service tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
vi.mock('../src/supabase.js', () => {
  const mockFrom = vi.fn();
  return {
    supabase: { from: mockFrom, rpc: vi.fn() },
    isSupabaseEnabled: () => true,
  };
});

// Mock crypto
vi.mock('../src/crypto.js', () => ({
  encryptSecret: vi.fn((s) => ({ iv: 'iv', encrypted: 'enc', tag: 'tag' })),
  decryptSecret: vi.fn(() => ({ password: 'decrypted-pass' })),
}));

import { supabase } from '../src/supabase.js';
import {
  createCredential,
  getCredential,
  listCredentials,
  deleteCredential,
  bindToAgent,
  unbindFromAgent,
  getAgentCredentials,
  getCredentialForAgent,
  decryptForInjection,
} from '../src/vault.js';

describe('Vault Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createCredential encrypts and inserts', async () => {
    const mockChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'v1', label: 'Test', credential_type: 'username_password', metadata: { username: 'admin' }, domains: ['example.com'], use_count: 0 },
        error: null,
      }),
    };
    (supabase!.from as any).mockReturnValue(mockChain);

    const result = await createCredential('user1', 'Test', 'username_password', { password: 'pass' }, { username: 'admin' }, ['example.com']);
    expect(result).toBeTruthy();
    expect(result!.label).toBe('Test');
    expect(supabase!.from).toHaveBeenCalledWith('credentials_vault');
  });

  it('listCredentials filters deleted and returns metadata only', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: 'v1', label: 'Test' }],
        error: null,
      }),
    };
    (supabase!.from as any).mockReturnValue(mockChain);

    const result = await listCredentials('user1');
    expect(result).toHaveLength(1);
    expect(mockChain.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('deleteCredential soft-deletes by setting deleted_at', async () => {
    const mockChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      match: vi.fn().mockResolvedValue({ error: null }),
    };
    (supabase!.from as any).mockReturnValue(mockChain);

    await deleteCredential('v1', 'user1');
    expect(mockChain.update).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
  });

  it('getCredentialForAgent resolves by binding + domain priority', async () => {
    // Mock bindings query
    const bindingsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          { credential_id: 'v1', priority: 1, credentials_vault: { id: 'v1', domains: ['example.com'], deleted_at: null, label: 'Test' } },
          { credential_id: 'v2', priority: 0, credentials_vault: { id: 'v2', domains: ['other.com'], deleted_at: null, label: 'Other' } },
        ],
        error: null,
      }),
    };
    (supabase!.from as any).mockReturnValue(bindingsChain);

    const result = await getCredentialForAgent('agent1', 'example.com');
    expect(result).toBeTruthy();
    expect(result!.id).toBe('v1');
  });

  it('decryptForInjection decrypts and increments use_count', async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'v1', encrypted_secret: { iv: 'iv', encrypted: 'enc', tag: 'tag' }, user_id: 'user1' },
        error: null,
      }),
    };
    (supabase!.from as any).mockReturnValue(selectChain);
    (supabase!.rpc as any).mockResolvedValue({ error: null });

    const result = await decryptForInjection('v1', 'user1', 'agent1');
    expect(result).toEqual({ password: 'decrypted-pass' });
    expect(supabase!.rpc).toHaveBeenCalledWith('increment_vault_use', { vault_uuid: 'v1', agent_uuid: 'agent1' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/vault.test.ts`
Expected: FAIL — vault.ts does not exist

- [ ] **Step 3: Implement vault.ts**

```typescript
import { supabase, isSupabaseEnabled } from './supabase.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import type { EncryptedCredentials, PlaintextSecret, VaultEntry, BoundCredential } from './types.js';

// --- Pending credential requests (used by agent.ts and index.ts) ---
// NOTE: Spec says keyed by sessionId, but we key by agentId for simplicity
// since the WS handler maps ws→agentId. Each agent can have one pending request.
// If concurrent sessions per agent become a requirement, switch to sessionId.
export const pendingCredentialRequests = new Map<string, {
  resolve: (credentialId: string) => void;
  reject: (reason: Error) => void;
}>();

// Select columns for metadata-only queries (excludes encrypted_secret)
const VAULT_METADATA_COLS = 'id, user_id, label, credential_type, metadata, domains, scope, version, use_count, last_used_at, last_used_by_agent, created_by_agent, created_at, updated_at';

// --- Core CRUD ---

export async function createCredential(
  userId: string,
  label: string,
  type: string,
  secret: PlaintextSecret,
  metadata: Record<string, unknown>,
  domains: string[],
): Promise<VaultEntry | null> {
  if (!isSupabaseEnabled()) return null;
  const encrypted = encryptSecret(secret);
  const { data, error } = await supabase!
    .from('credentials_vault')
    .insert({
      user_id: userId,
      label,
      credential_type: type,
      encrypted_secret: encrypted,
      metadata,
      domains: domains.map(d => normalizeDomain(d)),
    })
    .select(VAULT_METADATA_COLS)
    .single();
  if (error) { console.error('createCredential error:', error); return null; }
  return data as VaultEntry;
}

export async function getCredential(id: string, userId: string): Promise<VaultEntry | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('credentials_vault')
    .select(VAULT_METADATA_COLS)
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single();
  if (error) return null;
  return data as VaultEntry;
}

export async function listCredentials(userId: string): Promise<VaultEntry[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('credentials_vault')
    .select(VAULT_METADATA_COLS)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) { console.error('listCredentials error:', error); return []; }
  return (data ?? []) as VaultEntry[];
}

export async function updateCredential(
  id: string,
  userId: string,
  updates: { label?: string; metadata?: Record<string, unknown>; domains?: string[] },
): Promise<VaultEntry | null> {
  if (!isSupabaseEnabled()) return null;
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.label !== undefined) payload.label = updates.label;
  if (updates.metadata !== undefined) payload.metadata = updates.metadata;
  if (updates.domains !== undefined) payload.domains = updates.domains.map(d => normalizeDomain(d));

  const { data, error } = await supabase!
    .from('credentials_vault')
    .update(payload)
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .select(VAULT_METADATA_COLS)
    .single();
  if (error) { console.error('updateCredential error:', error); return null; }
  return data as VaultEntry;
}

export async function deleteCredential(id: string, userId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;
  await supabase!
    .from('credentials_vault')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
}

export async function rotateCredential(id: string, userId: string, newSecret: PlaintextSecret): Promise<void> {
  if (!isSupabaseEnabled()) return;
  const encrypted = encryptSecret(newSecret);
  await supabase!
    .from('credentials_vault')
    .update({
      encrypted_secret: encrypted,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId);
  // Increment version atomically via RPC
  await supabase!.rpc('increment_vault_version', { vault_uuid: id });
}

// --- Binding Management ---

export async function bindToAgent(
  credentialId: string,
  agentId: string,
  context?: string,
  priority?: number,
): Promise<void> {
  if (!isSupabaseEnabled()) return;
  await supabase!
    .from('agent_credential_bindings')
    .upsert({
      agent_id: agentId,
      credential_id: credentialId,
      usage_context: context ?? null,
      priority: priority ?? 0,
    }, { onConflict: 'agent_id,credential_id' });
}

export async function unbindFromAgent(credentialId: string, agentId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;
  await supabase!
    .from('agent_credential_bindings')
    .delete()
    .eq('credential_id', credentialId)
    .eq('agent_id', agentId);
}

export async function getAgentCredentials(agentId: string): Promise<BoundCredential[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('agent_credential_bindings')
    .select(`
      id,
      usage_context,
      priority,
      credentials_vault!inner (${VAULT_METADATA_COLS})
    `)
    .eq('agent_id', agentId)
    .order('priority', { ascending: true });
  if (error) { console.error('getAgentCredentials error:', error); return []; }
  return (data ?? []).map((row: any) => ({
    ...row.credentials_vault,
    usage_context: row.usage_context,
    priority: row.priority,
    binding_id: row.id,
  })) as BoundCredential[];
}

// --- Resolution ---

export async function getCredentialForAgent(agentId: string, domain: string): Promise<VaultEntry | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('agent_credential_bindings')
    .select(`
      credential_id,
      priority,
      credentials_vault!inner (${VAULT_METADATA_COLS}, deleted_at)
    `)
    .eq('agent_id', agentId)
    .order('priority', { ascending: true });
  if (error || !data) return null;

  for (const row of data as any[]) {
    const cred = row.credentials_vault;
    if (cred.deleted_at) continue;
    if (cred.domains.includes(domain)) {
      return cred as VaultEntry;
    }
  }
  return null;
}

export async function findByDomain(userId: string, domain: string): Promise<VaultEntry[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('credentials_vault')
    .select(VAULT_METADATA_COLS)
    .eq('user_id', userId)
    .contains('domains', [domain])
    .is('deleted_at', null);
  if (error) return [];
  return (data ?? []) as VaultEntry[];
}

// --- Injection (security-critical) ---

export async function decryptForInjection(
  id: string,
  userId: string,
  agentId?: string,
): Promise<PlaintextSecret | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('credentials_vault')
    .select('id, encrypted_secret, user_id')
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single();
  if (error || !data) return null;

  // Increment use_count atomically
  await supabase!.rpc('increment_vault_use', {
    vault_uuid: id,
    agent_uuid: agentId ?? null,
  });

  // Decrypt — caller MUST use immediately and discard
  return decryptSecret(data.encrypted_secret as EncryptedCredentials);
}

// --- Helpers ---

function normalizeDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/vault.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/vault.ts server/__tests__/vault.test.ts
git commit -m "feat(vault): add credential vault service with CRUD, bindings, and resolution"
```

---

## Chunk 2: Server API + Login Detection

### Task 5: Vault REST Routes

**Files:**
- Create: `server/src/routes/vault.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Create vault routes**

```typescript
import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import {
  createCredential,
  getCredential,
  listCredentials,
  updateCredential,
  deleteCredential,
  rotateCredential,
  bindToAgent,
  unbindFromAgent,
  getAgentCredentials,
} from '../vault.js';

const router = Router();

// List all credentials for the authenticated user
router.get('/', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const credentials = await listCredentials(userId);
  res.json(credentials);
});

// Get a single credential
router.get('/:id', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const credential = await getCredential(req.params.id, userId);
  if (!credential) return res.status(404).json({ error: 'Credential not found' });
  res.json(credential);
});

// Create a new credential
router.post('/', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const { label, credential_type, secret, metadata, domains } = req.body;

  if (!label || !secret) {
    return res.status(400).json({ error: 'label and secret are required' });
  }

  const credential = await createCredential(
    userId,
    label,
    credential_type ?? 'username_password',
    secret,
    metadata ?? {},
    domains ?? [],
  );

  if (!credential) return res.status(500).json({ error: 'Failed to create credential' });
  res.status(201).json(credential);
});

// Update a credential (label, metadata, domains only — not the secret)
router.put('/:id', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const { label, metadata, domains } = req.body;
  const updated = await updateCredential(req.params.id, userId, { label, metadata, domains });
  if (!updated) return res.status(404).json({ error: 'Credential not found' });
  res.json(updated);
});

// Soft-delete a credential
router.delete('/:id', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  await deleteCredential(req.params.id, userId);
  res.status(204).end();
});

// Rotate credential secret (change password / API key)
router.put('/:id/secret', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const { secret } = req.body;
  if (!secret) return res.status(400).json({ error: 'secret is required' });
  await rotateCredential(req.params.id, userId, secret);
  res.status(204).end();
});

// Bind credential to agent (verifies credential ownership)
router.post('/:id/bind/:agentId', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  // Verify the authenticated user owns this credential
  const credential = await getCredential(req.params.id, userId);
  if (!credential) return res.status(404).json({ error: 'Credential not found' });
  const { usage_context, priority } = req.body ?? {};
  await bindToAgent(req.params.id, req.params.agentId, usage_context, priority);
  res.status(201).json({ ok: true });
});

// Unbind credential from agent (verifies credential ownership)
router.delete('/:id/bind/:agentId', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const credential = await getCredential(req.params.id, userId);
  if (!credential) return res.status(404).json({ error: 'Credential not found' });
  await unbindFromAgent(req.params.id, req.params.agentId);
  res.status(204).end();
});

export default router;
```

- [ ] **Step 2: Create agent credentials route**

Add to `server/src/routes/vault.ts` before the export, OR add to `server/src/routes/agents.ts`:

Best to add to vault.ts as a separate exported router:

```typescript
// Agent-scoped credential listing — mounted at /api/agents/:id/credentials
export const agentCredentialsRouter = Router({ mergeParams: true });

agentCredentialsRouter.get('/', requireAuth, async (req, res) => {
  const agentId = req.params.id;
  const credentials = await getAgentCredentials(agentId);
  res.json(credentials);
});
```

- [ ] **Step 3: Mount routes in index.ts**

Add imports and mount points in `server/src/index.ts`:

```typescript
import vaultRouter, { agentCredentialsRouter } from './routes/vault.js';
```

Add after existing route mounts:

```typescript
app.use('/api/vault', vaultRouter);
app.use('/api/agents/:id/credentials', agentCredentialsRouter);
```

- [ ] **Step 4: Verify server starts**

Run: `cd browser-agent-chat && npm run dev:server`
Expected: Server starts without errors. Kill after verifying.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/vault.ts server/src/index.ts
git commit -m "feat(api): add vault REST endpoints and agent credentials route"
```

---

### Task 6: Login Detector

**Files:**
- Create: `server/src/login-detector.ts`
- Create: `server/__tests__/login-detector.test.ts`

- [ ] **Step 1: Write login detector tests**

```typescript
import { describe, it, expect } from 'vitest';
import { buildDetectionScript, computeScore, LOGIN_THRESHOLD } from '../src/login-detector.js';

describe('Login Detector', () => {
  it('computeScore returns correct score for standard login page', () => {
    const signals = {
      hasVisiblePasswordField: true,
      hasLoginFormAction: true,
      hasSignInButton: true,
      hasPasswordNameField: false,
      hasUsernameField: true,
    };
    const score = computeScore(signals);
    expect(score).toBe(12); // 5 + 3 + 2 + 0 + 2
    expect(score >= LOGIN_THRESHOLD).toBe(true);
  });

  it('computeScore returns low score for non-login page', () => {
    const signals = {
      hasVisiblePasswordField: false,
      hasLoginFormAction: false,
      hasSignInButton: false,
      hasPasswordNameField: false,
      hasUsernameField: false,
    };
    const score = computeScore(signals);
    expect(score).toBe(0);
    expect(score >= LOGIN_THRESHOLD).toBe(false);
  });

  it('password field alone meets threshold', () => {
    const signals = {
      hasVisiblePasswordField: true,
      hasLoginFormAction: false,
      hasSignInButton: false,
      hasPasswordNameField: false,
      hasUsernameField: false,
    };
    const score = computeScore(signals);
    expect(score).toBe(5);
    expect(score >= LOGIN_THRESHOLD).toBe(true);
  });

  it('buildDetectionScript returns a string', () => {
    const script = buildDetectionScript();
    expect(typeof script).toBe('string');
    expect(script).toContain('input[type="password"]');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/login-detector.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement login-detector.ts**

```typescript
import type { LoginDetectionResult } from './types.js';

export const LOGIN_THRESHOLD = 5;

interface DetectionSignals {
  hasVisiblePasswordField: boolean;
  hasLoginFormAction: boolean;
  hasSignInButton: boolean;
  hasPasswordNameField: boolean;
  hasUsernameField: boolean;
}

const WEIGHTS = {
  hasVisiblePasswordField: 5,
  hasLoginFormAction: 3,
  hasSignInButton: 2,
  hasPasswordNameField: 2,
  hasUsernameField: 2,
};

export function computeScore(signals: DetectionSignals): number {
  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    if (signals[key as keyof DetectionSignals]) score += weight;
  }
  return score;
}

/**
 * Returns a script to be run via page.evaluate() that inspects the DOM
 * for login form signals and returns selectors.
 */
export function buildDetectionScript(): string {
  return `(() => {
    const isVisible = (el) => el && el.offsetParent !== null;

    // Password field
    const pwFields = [...document.querySelectorAll('input[type="password"]')].filter(isVisible);
    const hasVisiblePasswordField = pwFields.length > 0;

    // Form action
    const forms = [...document.querySelectorAll('form')];
    const loginForm = forms.find(f => {
      const action = (f.getAttribute('action') || '').toLowerCase();
      return action.includes('login') || action.includes('signin') || action.includes('sign-in') || action.includes('auth');
    });
    const hasLoginFormAction = !!loginForm;

    // Sign-in button
    const buttons = [...document.querySelectorAll('button, input[type="submit"], a[role="button"]')];
    const signInBtn = buttons.find(b => {
      const text = (b.textContent || b.getAttribute('value') || '').toLowerCase().trim();
      return /^(sign\\s*in|log\\s*in|submit|login)$/i.test(text) || text.includes('sign in') || text.includes('log in');
    });
    const hasSignInButton = !!signInBtn && isVisible(signInBtn);

    // Password-like name attribute
    const namedPwFields = [...document.querySelectorAll('input[name*="password"], input[name*="passwd"], input[name*="pass"]')].filter(isVisible);
    const hasPasswordNameField = namedPwFields.length > 0 && !hasVisiblePasswordField;

    // Username-like field
    const userFields = [...document.querySelectorAll('input[type="email"], input[type="text"][name*="user"], input[type="text"][name*="email"], input[type="text"][name*="login"], input[id*="user"], input[id*="email"], input[id*="login"]')].filter(isVisible);
    const hasUsernameField = userFields.length > 0;

    // Build selectors
    const pwSelector = pwFields[0] ? buildSelector(pwFields[0]) : null;
    const userSelector = userFields[0] ? buildSelector(userFields[0]) : null;
    const submitSelector = signInBtn ? buildSelector(signInBtn) : null;

    function buildSelector(el) {
      if (el.id) return '#' + CSS.escape(el.id);
      if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
      // Fallback: type + index
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') || 'text';
      const siblings = [...document.querySelectorAll(tag + '[type="' + type + '"]')];
      const idx = siblings.indexOf(el);
      return tag + '[type="' + type + '"]:nth-of-type(' + (idx + 1) + ')';
    }

    // Detect strategy
    let strategy = 'unknown';
    if (hasVisiblePasswordField && hasUsernameField) {
      strategy = 'standard_form';
    } else if (hasUsernameField && !hasVisiblePasswordField) {
      strategy = 'two_step';
    }

    return {
      hasVisiblePasswordField,
      hasLoginFormAction,
      hasSignInButton,
      hasPasswordNameField,
      hasUsernameField,
      selectors: { username: userSelector, password: pwSelector, submit: submitSelector },
      strategy,
    };
  })()`;
}

/**
 * Detect login page by running DOM heuristic via page.evaluate().
 * Returns LoginDetectionResult with score, selectors, and strategy.
 */
export async function detectLoginPage(page: any): Promise<LoginDetectionResult> {
  const url = new URL(page.url());
  const domain = url.hostname;

  const result = await page.evaluate(buildDetectionScript());
  const score = computeScore(result);

  return {
    score,
    isLoginPage: score >= LOGIN_THRESHOLD,
    selectors: result.selectors,
    domain,
    strategy: result.strategy as LoginDetectionResult['strategy'],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/login-detector.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/login-detector.ts server/__tests__/login-detector.test.ts
git commit -m "feat(login): add DOM heuristic login detector with confidence scoring"
```

---

### Task 7: Login Strategy Engine

**Files:**
- Create: `server/src/login-strategy.ts`
- Create: `server/__tests__/login-strategy.test.ts`

- [ ] **Step 1: Write login strategy tests**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { executeStandardLogin, verifyLoginSuccess } from '../src/login-strategy.js';

describe('Login Strategy', () => {
  function mockPage(opts: { urlAfter?: string; hasPassword?: boolean } = {}) {
    return {
      url: vi.fn().mockReturnValue(opts.urlAfter ?? 'https://app.example.com/dashboard'),
      fill: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      // evaluate returns whether a visible password field exists
      // verifyLoginSuccess checks: if URL changed → success; if same URL and password field gone → success
      evaluate: vi.fn().mockResolvedValue(opts.hasPassword ?? false),
    };
  }

  it('executeStandardLogin fills fields and clicks submit', async () => {
    const page = mockPage();
    const selectors = { username: '#email', password: '#pass', submit: '#login-btn' };
    const secret = { password: 'secret123' };
    const metadata = { username: 'admin@test.com' };

    const result = await executeStandardLogin(page, selectors, secret, metadata, 'https://example.com/login');

    expect(page.fill).toHaveBeenCalledWith('#email', 'admin@test.com');
    expect(page.fill).toHaveBeenCalledWith('#pass', 'secret123');
    expect(page.click).toHaveBeenCalledWith('#login-btn');
    expect(result.success).toBe(true);
  });

  it('executeStandardLogin reports failure if still on login page', async () => {
    const page = mockPage({ urlAfter: 'https://example.com/login', hasPassword: true });
    const selectors = { username: '#email', password: '#pass', submit: '#login-btn' };

    const result = await executeStandardLogin(page, selectors, { password: 'wrong' }, { username: 'admin' }, 'https://example.com/login');

    expect(result.success).toBe(false);
  });

  it('verifyLoginSuccess detects URL change', async () => {
    const page = mockPage({ urlAfter: 'https://example.com/dashboard' });
    const success = await verifyLoginSuccess(page, 'https://example.com/login');
    expect(success).toBe(true);
  });

  it('verifyLoginSuccess detects same URL with password field still visible', async () => {
    const page = mockPage({ urlAfter: 'https://example.com/login', hasPassword: true });
    const success = await verifyLoginSuccess(page, 'https://example.com/login');
    expect(success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/login-strategy.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement login-strategy.ts**

```typescript
import type { LoginResult, PlaintextSecret } from './types.js';

interface Selectors {
  username: string | null;
  password: string | null;
  submit: string | null;
}

/**
 * Execute a standard form login: fill username, fill password, click submit.
 * Security: password variable is zeroed after page.fill().
 */
export async function executeStandardLogin(
  page: any,
  selectors: Selectors,
  secret: PlaintextSecret,
  metadata: { username?: string },
  loginUrl: string,
): Promise<LoginResult> {
  try {
    // Fill username
    if (selectors.username && metadata.username) {
      await page.fill(selectors.username, metadata.username);
    }

    // Fill password — zero variable immediately after
    if (selectors.password && secret.password) {
      await page.fill(selectors.password, secret.password);
      // Security: zero the reference (caller should also zero their copy)
      (secret as any).password = null;
    }

    // Click submit
    if (selectors.submit) {
      await page.click(selectors.submit);
    }

    // Wait for navigation
    await page.waitForLoadState('networkidle').catch(() => {});

    // Verify success
    const success = await verifyLoginSuccess(page, loginUrl);
    return { success, error: success ? undefined : 'Login verification failed' };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Check if login succeeded by verifying URL changed or password field disappeared.
 */
export async function verifyLoginSuccess(page: any, loginUrl: string): Promise<boolean> {
  const currentUrl = page.url();

  // URL changed away from login page
  if (currentUrl !== loginUrl) return true;

  // Same URL but check if password field is gone
  const hasPasswordField = await page.evaluate(() => {
    const pw = document.querySelector('input[type="password"]');
    return pw !== null && (pw as HTMLElement).offsetParent !== null;
  });

  return !hasPasswordField;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat/server && npx vitest run __tests__/login-strategy.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/login-strategy.ts server/__tests__/login-strategy.test.ts
git commit -m "feat(login): add standard form login strategy with success verification"
```

---

## Chunk 3: Agent Integration

> **Dependency note:** Task 10 (Muscle Memory updates) MUST be completed before Task 8, because Task 8 imports `injectCredentials` with its new 3-argument signature and `recordLoginPattern` which are defined in Task 10. Implement in order: **10 → 8 → 9**.

### Task 8: Replace executeLogin in agent.ts

**Depends on:** Task 10 (new `injectCredentials` signature and `recordLoginPattern` function)

**Files:**
- Modify: `server/src/agent.ts`

- [ ] **Step 1: Add imports**

Add at top of `server/src/agent.ts`:

```typescript
import { detectLoginPage } from './login-detector.js';
import { executeStandardLogin, verifyLoginSuccess } from './login-strategy.js';
import { getCredentialForAgent, getCredential, decryptForInjection, pendingCredentialRequests } from './vault.js';
import { getLearnedPatterns, injectCredentials, recordLoginPattern } from './muscle-memory.js';
import type { LoginDetectionResult, PlaintextSecret, ServerMessage } from './types.js';
```

- [ ] **Step 2: Replace executeLogin with handleLoginDetection**

Remove the existing `executeLogin()` function entirely. Replace with:

```typescript
/**
 * Detect login pages and handle credential injection.
 * Flow: detect → muscle memory → vault resolution → ask user → inject → record pattern.
 * LLM never sees credentials — Playwright fills fields directly.
 */
export async function handleLoginDetection(
  page: any,
  agentId: string,
  userId: string,
  broadcast: (msg: ServerMessage) => void,
): Promise<void> {
  const detection = await detectLoginPage(page);

  if (!detection.isLoginPage) return;

  broadcast({ type: 'thought', content: `Login page detected (confidence: ${detection.score}). Looking up credentials...` });

  // Guard: only standard_form is supported in MVP
  if (detection.strategy !== 'standard_form' && detection.strategy !== 'unknown') {
    broadcast({ type: 'thought', content: `Detected ${detection.strategy} login flow (not yet supported). Skipping automatic login.` });
    return;
  }

  const loginUrl = page.url();

  // 1. Check muscle memory for this domain first
  const patterns = await getLearnedPatterns(agentId, detection.domain);
  const loginPattern = patterns.find(p => p.pattern_type === 'login' && p.status === 'active');

  if (loginPattern?.credential_id) {
    broadcast({ type: 'thought', content: 'Found saved login pattern. Replaying...' });
    const secret = await decryptForInjection(loginPattern.credential_id, userId, agentId);
    if (secret) {
      const cred = await getCredential(loginPattern.credential_id, userId);
      const steps = injectCredentials(loginPattern.steps, secret, (cred?.metadata ?? {}) as { username?: string });
      // Zero secret immediately
      (secret as any).password = null;
      (secret as any).apiKey = null;
      // Execute the replay steps via Playwright
      for (const step of steps) {
        if (step.action === 'fill' && step.selector && step.value) {
          await page.fill(step.selector, step.value);
        } else if (step.action === 'click' && step.selector) {
          await page.click(step.selector);
        }
      }
      await page.waitForLoadState('networkidle').catch(() => {});
      const success = await verifyLoginSuccess(page, loginUrl);
      if (success) {
        broadcast({ type: 'thought', content: 'Login successful (replayed from muscle memory).' });
        broadcast({ type: 'screenshot', data: (await page.screenshot({ type: 'png' })).toString('base64') });
        broadcast({ type: 'nav', url: page.url() });
        return;
      }
      broadcast({ type: 'thought', content: 'Muscle memory replay failed. Trying vault...' });
    }
  }

  // 2. Try to find credential via agent bindings + domain
  const credential = await getCredentialForAgent(agentId, detection.domain);

  if (credential) {
    // Domain verification (exfiltration prevention)
    const pageHostname = new URL(loginUrl).hostname;
    if (!credential.domains.includes(pageHostname)) {
      broadcast({ type: 'thought', content: `Domain mismatch: page is ${pageHostname} but credential is for ${credential.domains.join(', ')}. Skipping injection.` });
      return;
    }

    // Decrypt and inject
    const secret = await decryptForInjection(credential.id, userId, agentId);
    if (!secret) {
      broadcast({ type: 'thought', content: 'Failed to decrypt credentials.' });
      return;
    }

    broadcast({ type: 'thought', content: 'Injecting credentials...' });
    const result = await executeStandardLogin(
      page,
      detection.selectors,
      secret,
      credential.metadata as { username?: string },
      loginUrl,
    );

    // Zero secret
    (secret as any).password = null;
    (secret as any).apiKey = null;

    if (result.success) {
      broadcast({ type: 'thought', content: 'Login successful.' });
      broadcast({ type: 'screenshot', data: (await page.screenshot({ type: 'png' })).toString('base64') });
      broadcast({ type: 'nav', url: page.url() });
      // Record muscle memory for future replays
      await recordLoginPattern(agentId, detection.domain, credential.id, detection.strategy, detection.selectors).catch(() => {});
    } else {
      broadcast({ type: 'thought', content: `Login failed: ${result.error}` });
    }
    return;
  }

  // 3. No credential found — ask user
  broadcast({ type: 'thought', content: `No credentials found for ${detection.domain}. Asking you to provide them...` });

  const CREDENTIAL_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  try {
    const credentialId = await Promise.race([
      new Promise<string>((resolve, reject) => {
        // Key by agentId — each agent can have one pending request
        pendingCredentialRequests.set(agentId, { resolve, reject });
        broadcast({
          type: 'credential_needed',
          agentId,
          domain: detection.domain,
          strategy: detection.strategy,
        });
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Credential request timed out')), CREDENTIAL_TIMEOUT)
      ),
    ]);
    pendingCredentialRequests.delete(agentId);

    // User provided credential — decrypt and inject
    const secret = await decryptForInjection(credentialId, userId, agentId);
    if (!secret) {
      broadcast({ type: 'thought', content: 'Failed to decrypt provided credentials.' });
      return;
    }

    const cred = await getCredential(credentialId, userId);

    broadcast({ type: 'thought', content: 'Injecting provided credentials...' });
    const result = await executeStandardLogin(
      page,
      detection.selectors,
      secret,
      (cred?.metadata ?? {}) as { username?: string },
      loginUrl,
    );

    // Zero secret
    (secret as any).password = null;
    (secret as any).apiKey = null;

    if (result.success) {
      broadcast({ type: 'thought', content: 'Login successful.' });
      broadcast({ type: 'screenshot', data: (await page.screenshot({ type: 'png' })).toString('base64') });
      broadcast({ type: 'nav', url: page.url() });
      // Record muscle memory
      await recordLoginPattern(agentId, detection.domain, credentialId, detection.strategy, detection.selectors).catch(() => {});
    } else {
      broadcast({ type: 'thought', content: `Login failed: ${result.error}` });
    }
  } catch (err) {
    pendingCredentialRequests.delete(agentId);
    broadcast({ type: 'thought', content: 'Credential request timed out or was cancelled. Continuing without login.' });
  }
}
```

- [ ] **Step 3: Update the caller in index.ts**

In `server/src/index.ts`, find where `executeLogin` was called (in the `msg.type === 'start'` handler) and replace with `handleLoginDetection`. The call needs `userId` which must be resolved from the agent's `user_id` field:

```typescript
// OLD
executeLogin(session, credentials, broadcast);
// NEW — agentId and userId come from the agent record fetched earlier
await handleLoginDetection(page, agentId, agent.user_id, broadcast);
```

Note: `handleLoginDetection` is called from index.ts (not from within agent.ts). The agent's `user_id` is available from the agent record fetched at session start.

- [ ] **Step 4: Verify server compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p server/tsconfig.json`
Expected: No new errors related to vault/login

- [ ] **Step 5: Commit**

```bash
git add server/src/agent.ts
git commit -m "feat(agent): replace executeLogin with vault-based handleLoginDetection"
```

---

### Task 9: Update index.ts WebSocket Handler

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add imports**

```typescript
import { pendingCredentialRequests } from './vault.js';
import { handleLoginDetection } from './agent.js';
```

- [ ] **Step 2: Add credential_provided handler to WebSocket message switch**

In the `ws.on('message')` handler, add a new case:

```typescript
    if (msg.type === 'credential_provided') {
      const agentId = clientAgents.get(ws);
      if (!agentId) return;
      // pendingCredentialRequests is keyed by agentId (matching handleLoginDetection)
      const pending = pendingCredentialRequests.get(agentId);
      if (pending) {
        pending.resolve(msg.credentialId);
      }
      return;
    }
```

- [ ] **Step 3: Remove old credential decryption from 'start' handler**

In the `msg.type === 'start'` handler, find and remove:
- The `decryptCredentials()` call
- The `credentials` local variable
- The `if (agent?.credentials)` block that called `executeLogin`

These are replaced by `handleLoginDetection` which is called when the agent encounters a login page during navigation. The call passes the agent's `user_id` from the agent record:

```typescript
// In the navigation/page event handler, after page loads:
await handleLoginDetection(page, agentId, agent.user_id, broadcast);
```

Note: `agent.user_id` is available from the agent record fetched in the `start` handler. Store it in a `clientUserIds` map if needed:

```typescript
// Add alongside the existing clientAgents map:
const clientUserIds = new Map<WebSocket, string>();

// In the 'start' handler, after fetching agent:
clientUserIds.set(ws, agent.user_id);

// In cleanup:
clientUserIds.delete(ws);
```

- [ ] **Step 4: Verify server starts**

Run: `cd browser-agent-chat && npm run dev:server`
Expected: Server starts without errors

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(ws): add credential_provided handler, remove old credential decryption, track userId"
```

---

### Task 10: Update Muscle Memory

**Files:**
- Modify: `server/src/muscle-memory.ts`

- [ ] **Step 1: Update injectCredentials to work with PlaintextSecret**

The function already receives decrypted values and replaces placeholders. Update the type signature but keep it pure:

```typescript
import type { PlaintextSecret } from './types.js';

export function injectCredentials(
  steps: PlaywrightStep[],
  secret: PlaintextSecret,
  metadata: { username?: string },
): PlaywrightStep[] {
  return steps.map(step => {
    if (!step.value) return step;
    let value = step.value;
    if (metadata.username) value = value.replace('{{username}}', metadata.username);
    if (secret.password) value = value.replace('{{password}}', secret.password);
    return { ...step, value };
  });
}
```

- [ ] **Step 2: Add getLearnedPatterns function**

The existing `loadPatterns(agentId)` loads all patterns for an agent. Add a domain-filtered variant used by `handleLoginDetection`:

```typescript
export async function getLearnedPatterns(agentId: string, domain: string): Promise<LearnedPattern[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('learned_patterns')
    .select('*')
    .eq('agent_id', agentId)
    .eq('domain', domain)
    .eq('status', 'active');
  if (error || !data) return [];
  return data as LearnedPattern[];
}
```

- [ ] **Step 3: Update LoginPattern interface to reference credential_id**

Update the existing `LoginPattern` interface (or add if missing) to store `credential_id` instead of plaintext credentials:

```typescript
interface LoginPattern {
  domain: string;
  credential_id: string;       // Reference to vault entry, NOT plaintext
  strategy: 'standard_form';
  username_selector: string;
  password_selector: string;
  submit_selector: string;
}
```

- [ ] **Step 4: Add recordLoginPattern function**

This function is called by `handleLoginDetection` after a successful login to save the pattern for future replays:

```typescript
export async function recordLoginPattern(
  agentId: string,
  domain: string,
  credentialId: string,
  strategy: string,
  selectors: { username: string | null; password: string | null; submit: string | null },
): Promise<void> {
  if (!isSupabaseEnabled()) return;
  // Store as a learned pattern with steps using {{placeholder}} syntax
  const steps: PlaywrightStep[] = [];
  if (selectors.username) {
    steps.push({ action: 'fill', selector: selectors.username, value: '{{username}}' });
  }
  if (selectors.password) {
    steps.push({ action: 'fill', selector: selectors.password, value: '{{password}}' });
  }
  if (selectors.submit) {
    steps.push({ action: 'click', selector: selectors.submit });
  }

  await supabase!
    .from('learned_patterns')
    .upsert({
      agent_id: agentId,
      domain,
      pattern_type: 'login',
      credential_id: credentialId,
      strategy,
      steps,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent_id,domain,pattern_type' });
}
```

- [ ] **Step 5: Verify server compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit -p server/tsconfig.json`
Expected: No errors from muscle-memory changes

- [ ] **Step 6: Commit**

```bash
git add server/src/muscle-memory.ts
git commit -m "feat(muscle-memory): update to use vault credential_id, add recordLoginPattern and getLearnedPatterns"
```

---

## Chunk 4: Client Foundation

### Task 11: Client Types + Vault API

**Files:**
- Modify: `client/src/types/assistant.ts`
- Create: `client/src/lib/vaultApi.ts`

- [ ] **Step 1: Add vault types to client/src/types/assistant.ts**

```typescript
// --- Credential Vault Types ---

export interface VaultEntry {
  id: string;
  user_id: string;
  label: string;
  credential_type: string;
  metadata: { username?: string; notes?: string };
  domains: string[];
  scope: string;
  version: number;
  use_count: number;
  last_used_at: string | null;
  last_used_by_agent: string | null;
  created_by_agent: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoundCredential extends VaultEntry {
  usage_context: string | null;
  priority: number;
  binding_id: string;
}

export interface CredentialNeededEvent {
  type: 'credential_needed';
  agentId: string;
  domain: string;
  strategy: string;
}
```

- [ ] **Step 2: Create client/src/lib/vaultApi.ts**

```typescript
import { apiAuthFetch } from './api';
import type { VaultEntry, BoundCredential } from '../types/assistant';

export async function listCredentials(token: string | null): Promise<VaultEntry[]> {
  const res = await apiAuthFetch('/api/vault', token);
  if (!res.ok) return [];
  return res.json();
}

export async function getCredential(token: string | null, id: string): Promise<VaultEntry | null> {
  const res = await apiAuthFetch(`/api/vault/${id}`, token);
  if (!res.ok) return null;
  return res.json();
}

export async function createCredential(
  token: string | null,
  data: {
    label: string;
    credential_type: string;
    secret: { password?: string; apiKey?: string };
    metadata: Record<string, unknown>;
    domains: string[];
  },
): Promise<VaultEntry | null> {
  const res = await apiAuthFetch('/api/vault', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function updateCredential(
  token: string | null,
  id: string,
  data: { label?: string; metadata?: Record<string, unknown>; domains?: string[] },
): Promise<VaultEntry | null> {
  const res = await apiAuthFetch(`/api/vault/${id}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function deleteCredential(token: string | null, id: string): Promise<void> {
  await apiAuthFetch(`/api/vault/${id}`, token, { method: 'DELETE' });
}

export async function rotateCredential(
  token: string | null,
  id: string,
  secret: { password?: string; apiKey?: string },
): Promise<void> {
  await apiAuthFetch(`/api/vault/${id}/secret`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  });
}

export async function bindToAgent(
  token: string | null,
  credentialId: string,
  agentId: string,
  context?: string,
  priority?: number,
): Promise<void> {
  await apiAuthFetch(`/api/vault/${credentialId}/bind/${agentId}`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usage_context: context, priority }),
  });
}

export async function unbindFromAgent(
  token: string | null,
  credentialId: string,
  agentId: string,
): Promise<void> {
  await apiAuthFetch(`/api/vault/${credentialId}/bind/${agentId}`, token, { method: 'DELETE' });
}

export async function getAgentCredentials(
  token: string | null,
  agentId: string,
): Promise<BoundCredential[]> {
  const res = await apiAuthFetch(`/api/agents/${agentId}/credentials`, token);
  if (!res.ok) return [];
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/types/assistant.ts client/src/lib/vaultApi.ts
git commit -m "feat(client): add vault types and API client"
```

---

### Task 12: useVault Hook

**Files:**
- Create: `client/src/hooks/useVault.ts`

- [ ] **Step 1: Create the useVault hook**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import * as vaultApi from '../lib/vaultApi';
import type { VaultEntry } from '../types/assistant';

export function useVault() {
  const { getAccessToken } = useAuth();
  const [credentials, setCredentials] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const data = await vaultApi.listCredentials(token);
      setCredentials(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async (data: Parameters<typeof vaultApi.createCredential>[1]) => {
    const token = await getAccessToken();
    const result = await vaultApi.createCredential(token, data);
    if (result) await refresh();
    return result;
  }, [getAccessToken, refresh]);

  const update = useCallback(async (id: string, data: Parameters<typeof vaultApi.updateCredential>[2]) => {
    const token = await getAccessToken();
    const result = await vaultApi.updateCredential(token, id, data);
    if (result) await refresh();
    return result;
  }, [getAccessToken, refresh]);

  const remove = useCallback(async (id: string) => {
    const token = await getAccessToken();
    await vaultApi.deleteCredential(token, id);
    await refresh();
  }, [getAccessToken, refresh]);

  const bind = useCallback(async (credentialId: string, agentId: string, context?: string, priority?: number) => {
    const token = await getAccessToken();
    await vaultApi.bindToAgent(token, credentialId, agentId, context, priority);
  }, [getAccessToken]);

  const unbind = useCallback(async (credentialId: string, agentId: string) => {
    const token = await getAccessToken();
    await vaultApi.unbindFromAgent(token, credentialId, agentId);
  }, [getAccessToken]);

  return {
    credentials,
    loading,
    error,
    refresh,
    createCredential: create,
    updateCredential: update,
    deleteCredential: remove,
    bindToAgent: bind,
    unbindFromAgent: unbind,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useVault.ts
git commit -m "feat(client): add useVault hook for credential management"
```

---

## Chunk 5: Vault UI

### Task 13: Vault CSS

**Files:**
- Create: `client/src/components/Vault/Vault.css`

- [ ] **Step 1: Create themed vault styles**

```css
/* Vault page styles — uses CSS custom properties from App.css */

.vault-page {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
  color: var(--text-body);
}

.vault-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.vault-title {
  font-size: 18px;
  font-weight: bold;
  color: var(--text-primary);
}

.vault-add-btn {
  background: var(--brand);
  color: var(--text-primary);
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}

.vault-add-btn:hover {
  background: var(--brand-hover);
}

/* Search & Filter */
.vault-filters {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.vault-search {
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  color: var(--text-body);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
}

.vault-search::placeholder {
  color: var(--text-dim);
}

.vault-type-filter {
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  color: var(--text-body);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
}

/* Credential List */
.vault-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vault-item {
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.vault-item-info {
  flex: 1;
  min-width: 0;
}

.vault-item-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.vault-item-meta {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 2px;
}

.vault-item-domains {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.vault-domain-chip {
  background: var(--bg-secondary);
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
}

.vault-item-stats {
  font-size: 11px;
  color: var(--text-dimmer);
  text-align: right;
  white-space: nowrap;
}

.vault-item-actions {
  display: flex;
  gap: 6px;
}

.vault-action-btn {
  background: var(--bg-hover);
  border: 1px solid var(--border-secondary);
  color: var(--text-muted);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}

.vault-action-btn:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

.vault-action-btn--danger:hover {
  color: #ef4444; /* Allowlisted semantic error red — see .stylelintrc.json */
}

/* Empty State */
.vault-empty {
  text-align: center;
  color: var(--text-dim);
  padding: 40px 20px;
  font-size: 14px;
}

/* Form */
.vault-form {
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.vault-form-title {
  font-size: 14px;
  font-weight: bold;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.vault-form-row {
  margin-bottom: 12px;
}

.vault-form-row label {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 4px;
}

.vault-form-row input,
.vault-form-row select {
  width: 100%;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  color: var(--text-body);
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
}

.vault-form-row input:focus,
.vault-form-row select:focus {
  outline: none;
  border-color: var(--brand);
}

.vault-form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}

.vault-form-cancel {
  background: var(--bg-hover);
  border: 1px solid var(--border-secondary);
  color: var(--text-muted);
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}

.vault-form-save {
  background: var(--brand);
  border: none;
  color: var(--text-primary);
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}

.vault-form-save:hover {
  background: var(--brand-hover);
}

.vault-form-save:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Domain chip input */
.vault-domain-input {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  padding: 4px 8px;
  min-height: 36px;
  align-items: center;
}

.vault-domain-input input {
  border: none;
  background: none;
  flex: 1;
  min-width: 100px;
  padding: 4px 0;
}

.vault-domain-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-hover);
  border: 1px solid var(--border-secondary);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  color: var(--accent);
}

.vault-domain-tag button {
  background: none;
  border: none;
  color: var(--text-dimmer);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  line-height: 1;
}

.vault-domain-tag button:hover {
  color: #ef4444;
}

/* Change password button */
.vault-change-pw-btn {
  background: var(--bg-hover);
  border: 1px solid var(--border-secondary);
  color: var(--accent);
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

/* Linked credentials in settings */
.linked-credentials {
  margin-top: 16px;
}

.linked-cred-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  margin-bottom: 6px;
}

.linked-cred-label {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.linked-cred-domains {
  font-size: 10px;
  color: var(--text-dim);
}

.linked-cred-unlink {
  background: none;
  border: none;
  color: var(--text-dimmer);
  cursor: pointer;
  font-size: 12px;
}

.linked-cred-unlink:hover {
  color: #ef4444;
}

.link-cred-btn {
  background: var(--bg-hover);
  border: 1px dashed var(--border-secondary);
  color: var(--accent);
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  width: 100%;
  font-family: inherit;
  margin-top: 8px;
}

.link-cred-btn:hover {
  background: var(--bg-active);
}
```

- [ ] **Step 2: Run stylelint to verify**

Run: `cd browser-agent-chat && npx stylelint 'client/src/components/Vault/Vault.css'`
Expected: No errors (all colors use CSS variables or allowlisted values)

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Vault/Vault.css
git commit -m "feat(ui): add vault page styles using CSS theme variables"
```

---

### Task 14: VaultForm Component

**Files:**
- Create: `client/src/components/Vault/VaultForm.tsx`

- [ ] **Step 1: Create VaultForm component**

```typescript
import { useState, useCallback, type KeyboardEvent } from 'react';
import type { VaultEntry } from '../../types/assistant';

interface VaultFormProps {
  editing?: VaultEntry | null;
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

export default function VaultForm({ editing, onSave, onCancel }: VaultFormProps) {
  const [label, setLabel] = useState(editing?.label ?? '');
  const [credType, setCredType] = useState(editing?.credential_type ?? 'username_password');
  const [username, setUsername] = useState((editing?.metadata?.username as string) ?? '');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showPasswordField, setShowPasswordField] = useState(!editing);
  const [domains, setDomains] = useState<string[]>(editing?.domains ?? []);
  const [domainInput, setDomainInput] = useState('');
  const [saving, setSaving] = useState(false);

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
        <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g., Github Work" />
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

      <div className="vault-form-actions">
        <button className="vault-form-cancel" onClick={onCancel}>Cancel</button>
        <button className="vault-form-save" onClick={handleSave} disabled={!canSave || saving}>
          {saving ? 'Saving...' : editing ? 'Update' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/Vault/VaultForm.tsx
git commit -m "feat(ui): add VaultForm component with dynamic type-based fields"
```

---

### Task 15: VaultPage Component

**Files:**
- Create: `client/src/components/Vault/VaultPage.tsx`

- [ ] **Step 1: Create VaultPage component**

```typescript
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

  const handleSave = async (data: Parameters<typeof createCredential>[0]) => {
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
    } else {
      await createCredential(data);
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
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/Vault/VaultPage.tsx
git commit -m "feat(ui): add VaultPage with search, filter, edit, delete"
```

---

### Task 16: Routing + Sidebar

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Sidebar.tsx`

- [ ] **Step 1: Add vault route to App.tsx**

Add import:
```typescript
import VaultPage from './components/Vault/VaultPage';
```

Add route before the catch-all `<Route path="*"`:
```typescript
<Route path="/vault" element={<ProtectedRoute><VaultPage /></ProtectedRoute>} />
```

- [ ] **Step 2: Add vault nav item to Sidebar.tsx**

Add import:
```typescript
import { KeyRound } from 'lucide-react';
```

Add a vault button. Since `/vault` is user-level (not agent-scoped), it needs a direct navigate call instead of `navTo()`:

```typescript
<button
  className={`sidebar-item${location.pathname === '/vault' ? ' active' : ''}`}
  onClick={() => navigate('/vault')}
>
  <KeyRound size={18} />
  {expanded && <span className="sidebar-label">Vault</span>}
</button>
```

Place this **after the spacer div** (before the theme toggle and Settings), since Vault is user-level, not agent-scoped. It belongs in the bottom section alongside Settings.

- [ ] **Step 3: Verify the app compiles and vault page loads**

Run: `cd browser-agent-chat && npm run dev:client`
Navigate to `http://localhost:5174/vault`
Expected: Vault page renders with "No credentials stored yet" empty state

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/components/Sidebar.tsx
git commit -m "feat(ui): add /vault route and sidebar navigation"
```

---

## Chunk 6: Client Integration

### Task 17: WebSocketContext Credential Events

**Files:**
- Modify: `client/src/contexts/WebSocketContext.tsx`

- [ ] **Step 1: Update WebSocketState interface and add state**

In the `WebSocketState` interface (the context type), add these fields:
```typescript
pendingCredentialRequest: { agentId: string; domain: string; strategy: string } | null;
sendCredentialProvided: (credentialId: string) => void;
```

Also update `client/src/types.ts` (the main types file, not `types/assistant.ts`) to add credential WS events to the message unions:

In `ServerMessage` union, add:
```typescript
  | { type: 'credential_needed'; agentId: string; domain: string; strategy: string }
```

In `ClientMessage` union, add:
```typescript
  | { type: 'credential_provided'; credentialId: string }
```

- [ ] **Step 2: Add state and handler**

Add state:
```typescript
const [pendingCredentialRequest, setPendingCredentialRequest] = useState<{ agentId: string; domain: string; strategy: string } | null>(null);
```

Add to `handleMessage` switch (now type-safe since we added `credential_needed` to `ServerMessage`):
```typescript
case 'credential_needed': {
  const m = msg as { type: 'credential_needed'; agentId: string; domain: string; strategy: string };
  setPendingCredentialRequest({ agentId: m.agentId, domain: m.domain, strategy: m.strategy });
  break;
}
```

Add send function:
```typescript
const sendCredentialProvided = useCallback((credentialId: string) => {
  if (wsRef.current?.readyState === WebSocket.OPEN) {
    wsRef.current.send(JSON.stringify({ type: 'credential_provided', credentialId }));
  }
  setPendingCredentialRequest(null);
}, []);
```

- [ ] **Step 3: Expose in context value**

Add `pendingCredentialRequest` and `sendCredentialProvided` to the context provider value.

- [ ] **Step 4: Commit**

```bash
git add client/src/contexts/WebSocketContext.tsx
git commit -m "feat(ws): handle credential_needed events and expose sendCredentialProvided"
```

---

### Task 18: ChatPanel Inline Credential Flow

**Files:**
- Modify: `client/src/components/ChatPanel.tsx`

- [ ] **Step 1: Add vault integration to ChatPanel**

Import vault API and auth:
```typescript
import * as vaultApi from '../lib/vaultApi';
import { useAuth } from '../hooks/useAuth';
```

Read `pendingCredentialRequest` and `sendCredentialProvided` from the WebSocket context, and get auth token:
```typescript
const { getAccessToken } = useAuth();
const { pendingCredentialRequest, sendCredentialProvided } = useWS();
```

- [ ] **Step 2: Replace existing credential detection with vault-backed flow**

Replace the old LOGIN_KEYWORDS detection with a check on `pendingCredentialRequest`:

When `pendingCredentialRequest` is non-null, show a credential form with:
- Domain prominently displayed (from `pendingCredentialRequest.domain`)
- Username input
- Password input
- Label input (pre-filled with domain)
- Save button

On submit:
```typescript
const handleCredentialSubmit = async () => {
  const token = await getAccessToken();
  const result = await vaultApi.createCredential(token, {
    label: credLabel || pendingCredentialRequest!.domain,
    credential_type: 'username_password',
    secret: { password: credPassword },
    metadata: { username: credUsername },
    domains: [pendingCredentialRequest!.domain],
  });
  if (result) {
    await vaultApi.bindToAgent(token, result.id, pendingCredentialRequest!.agentId);
    sendCredentialProvided(result.id);
  }
};
```

- [ ] **Step 3: Remove old credential detection and update interface**

Remove the `LOGIN_KEYWORDS` / `INTENT_KEYWORDS` arrays and the `useEffect` that watched messages for login-related keywords. The server now sends an explicit `credential_needed` event instead.

Also remove the old credential-related props from `ChatPanelProps`:
- Remove `hasCredentials` prop
- Remove `onSaveCredentials` prop

**Critical: Update TestingView.tsx** (the parent component that renders ChatPanel):
- Remove `hasCredentials` state and the `useEffect` that fetches it
- Remove `handleSaveCredentials` function
- Remove `hasCredentials={hasCredentials}` and `onSaveCredentials={handleSaveCredentials}` props from the `<ChatPanel>` JSX
- If these props are not removed from TestingView, TypeScript compilation will fail

- [ ] **Step 3b: Add inline credential form JSX**

Add state for the inline form fields:
```typescript
const [credUsername, setCredUsername] = useState('');
const [credPassword, setCredPassword] = useState('');
const [credLabel, setCredLabel] = useState('');
```

Render the inline form when `pendingCredentialRequest` is non-null. Place this above the chat input area:
```typescript
{pendingCredentialRequest && (
  <div className="chat-cred-form">
    <div className="chat-cred-header">
      Credentials needed for <strong>{pendingCredentialRequest.domain}</strong>
    </div>
    <input
      type="text"
      placeholder="Label (optional)"
      value={credLabel}
      onChange={e => setCredLabel(e.target.value)}
    />
    <input
      type="text"
      placeholder="Username"
      value={credUsername}
      onChange={e => setCredUsername(e.target.value)}
      autoComplete="off"
    />
    <input
      type="password"
      placeholder="Password"
      value={credPassword}
      onChange={e => setCredPassword(e.target.value)}
      autoComplete="new-password"
    />
    <button
      onClick={handleCredentialSubmit}
      disabled={!credUsername.trim() || !credPassword.trim()}
    >
      Save & Login
    </button>
  </div>
)}
```

Note: The `chat-cred-form` class should be styled using existing chat panel CSS patterns (use `var(--bg-card)`, `var(--border-primary)`, etc.). Add minimal styles to the component or to `Vault.css` if needed.

After successful submit, clear the form state:
```typescript
setCredUsername('');
setCredPassword('');
setCredLabel('');
```

- [ ] **Step 4: Verify inline flow works end-to-end**

This requires a running server with a real agent session hitting a login page. Manual test:
1. Start agent on a site with a login page
2. Agent should detect login, send `credential_needed`
3. ChatPanel shows inline form
4. Fill in credentials, submit
5. Credential saved to vault, bound to agent, agent logs in

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ChatPanel.tsx
git commit -m "feat(chat): replace keyword detection with vault-backed credential flow"
```

---

### Task 19: AgentSettings Linked Credentials

**Files:**
- Modify: `client/src/components/AgentSettings.tsx`

- [ ] **Step 1: Add linked credentials section**

Import hooks, API, and CSS:
```typescript
import { useVault } from '../hooks/useVault';
import * as vaultApi from '../lib/vaultApi';
import type { BoundCredential } from '../types/assistant';
import '../Vault/Vault.css'; // Reuse linked-cred-* and vault-form styles
```

Add state for linked credentials:
```typescript
const [linkedCreds, setLinkedCreds] = useState<BoundCredential[]>([]);
const { credentials: allCreds } = useVault();
```

Fetch linked credentials on mount:
```typescript
useEffect(() => {
  const load = async () => {
    const token = await getAccessToken();
    const creds = await vaultApi.getAgentCredentials(token, id!);
    setLinkedCreds(creds);
  };
  load();
}, [id, getAccessToken]);
```

- [ ] **Step 2: Add linked credentials UI**

After the existing credentials section (or replacing it), add:

```typescript
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
</section>
```

- [ ] **Step 3: Add link picker**

When the user clicks "Link a credential from vault", show a simple dropdown of vault entries not already linked:

```typescript
const [showLinkPicker, setShowLinkPicker] = useState(false);
const availableCreds = allCreds.filter(c => !linkedCreds.some(l => l.id === c.id));

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
```

- [ ] **Step 4: Remove old credentials section**

Remove the old username/password input fields from AgentSettings that saved credentials directly to the agent. These are replaced by the vault-backed linked credentials.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/AgentSettings.tsx
git commit -m "feat(settings): replace inline credentials with vault-linked credentials"
```

---

### Task 20: Data Migration

**Files:**
- Create: `server/migrations/007_migrate_credentials_to_vault.sql`

- [ ] **Step 1: Write migration script**

This migration moves existing `agents.credentials` data to the vault. Since the server does encryption in TypeScript (not SQL), this migration is a Node.js script rather than pure SQL.

Create `server/scripts/migrate-credentials.ts`:

```typescript
import 'dotenv/config';
import { supabase } from '../src/supabase.js';
import { decryptCredentials } from '../src/crypto.js';
import { encryptSecret } from '../src/crypto.js';

async function migrate() {
  if (!supabase) { console.error('Supabase not configured'); process.exit(1); }

  // 1. Fetch all agents with credentials
  const { data: agents, error } = await supabase
    .from('agents')
    .select('id, user_id, name, url, credentials')
    .not('credentials', 'is', null);

  if (error) { console.error('Failed to fetch agents:', error); process.exit(1); }
  if (!agents?.length) { console.log('No agents with credentials to migrate.'); return; }

  console.log(`Migrating ${agents.length} agent(s) with credentials...`);

  for (const agent of agents) {
    try {
      // 2. Decrypt old credentials
      const plain = decryptCredentials(agent.credentials);

      // 3. Extract domain from agent URL
      let domain = '';
      try { domain = new URL(agent.url).hostname; } catch {}

      // 4. Create vault entry
      const encrypted = encryptSecret({ password: plain.password });
      const { data: vaultEntry, error: vaultError } = await supabase
        .from('credentials_vault')
        .insert({
          user_id: agent.user_id,
          label: agent.name,
          credential_type: 'username_password',
          encrypted_secret: encrypted,
          metadata: { username: plain.username },
          domains: domain ? [domain] : [],
        })
        .select('id')
        .single();

      if (vaultError) { console.error(`Failed to create vault entry for agent ${agent.id}:`, vaultError); continue; }

      // 5. Create binding
      await supabase
        .from('agent_credential_bindings')
        .insert({
          agent_id: agent.id,
          credential_id: vaultEntry.id,
          usage_context: 'Migrated from agent credentials',
          priority: 0,
        });

      // 6. Clear old credentials
      await supabase
        .from('agents')
        .update({ credentials: null })
        .eq('id', agent.id);

      console.log(`  Migrated agent "${agent.name}" (${agent.id})`);
    } catch (err) {
      console.error(`  Failed to migrate agent ${agent.id}:`, err);
    }
  }

  console.log('Migration complete.');
}

migrate();
```

Also create `server/migrations/007_migrate_credentials_to_vault.sql` for reference:

```sql
-- Migration 007: Credential Vault data migration
-- NOTE: Data migration is handled by server/scripts/migrate-credentials.ts
-- This file documents the schema change only.

-- After running the migration script, drop the old column:
-- ALTER TABLE agents DROP COLUMN IF EXISTS credentials;
```

- [ ] **Step 2: Run migration script**

```bash
cd browser-agent-chat/server && npx tsx scripts/migrate-credentials.ts
```

Expected: Migrated agents listed, or "No agents with credentials to migrate."

- [ ] **Step 3: Verify migration**

Check Supabase dashboard:
- `credentials_vault` should have entries matching old agent credentials
- `agent_credential_bindings` should link them
- `agents.credentials` should be null for migrated agents

- [ ] **Step 4: Commit**

```bash
git add server/scripts/migrate-credentials.ts server/migrations/007_migrate_credentials_to_vault.sql
git commit -m "feat(migration): add script to migrate agent credentials to vault"
```

---

### Task 21: Run All Tests

- [ ] **Step 1: Run server tests**

Run: `cd browser-agent-chat/server && npx vitest run`
Expected: All tests pass (existing + new crypto, vault, login-detector, login-strategy tests)

- [ ] **Step 2: Fix any failures**

Address any test failures from integration between modules.

- [ ] **Step 3: Verify client builds**

Run: `cd browser-agent-chat && npm run build`
Expected: Both server and client build without errors

- [ ] **Step 4: Final commit (if any fixes were needed)**

```bash
# Only stage files that were modified for fixes — review git status first
git status
# Stage only the specific files that were fixed
git add <fixed-files>
git commit -m "chore: fix integration issues from credential vault implementation"
```
