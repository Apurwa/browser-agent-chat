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
const VAULT_METADATA_COLS = 'id, user_id, label, credential_type, metadata, domains, scope, version, use_count, last_used_at, last_used_by_agent, created_by_agent, created_at, updated_at, enabled';

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

  const normalizedDomain = normalizeDomain(domain);
  for (const row of data as any[]) {
    const cred = row.credentials_vault;
    if (cred.deleted_at) continue;
    if (cred.enabled === false) continue;
    if (cred.domains.includes(normalizedDomain)) {
      return cred as VaultEntry;
    }
  }
  return null;
}

export async function findByDomain(userId: string, domain: string): Promise<VaultEntry[]> {
  if (!isSupabaseEnabled()) return [];
  const normalizedDomain = normalizeDomain(domain);
  const { data, error } = await supabase!
    .from('credentials_vault')
    .select(VAULT_METADATA_COLS)
    .eq('user_id', userId)
    .contains('domains', [normalizedDomain])
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

  await insertAuditLog(id, 'decrypt', agentId);

  // Decrypt — caller MUST use immediately and discard
  return decryptSecret(data.encrypted_secret as EncryptedCredentials);
}

// --- Audit Log ---

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

  const cred = await getCredential(credentialId, userId);
  if (!cred) return { resolved: [], unresolved: [] };
  const credDomains = new Set(cred.domains);

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

  const knownDomains = new Set<string>();
  for (const node of nodes as any[]) {
    const pattern = node.url_pattern as string;
    const hostname = normalizeDomain(pattern);
    if (hostname && hostname !== '/') knownDomains.add(hostname);
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

// --- Helpers ---

export function normalizeDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase()
    .replace(/^www\./, '');
}
