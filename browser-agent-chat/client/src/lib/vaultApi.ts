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
