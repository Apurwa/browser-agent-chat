import type { Suggestion } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, options);
}

export async function apiAuthFetch(path: string, token: string | null, options: RequestInit = {}): Promise<Response> {
  return apiFetch(path, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export async function fetchPendingSuggestions(agentId: string, token: string | null): Promise<Suggestion[]> {
  const res = await apiAuthFetch(`/api/agents/${agentId}/suggestions`, token);
  if (!res.ok) throw new Error('Failed to fetch suggestions');
  return res.json();
}

export async function fetchSuggestionCount(agentId: string, token: string | null): Promise<number> {
  const res = await apiAuthFetch(`/api/agents/${agentId}/suggestions/count`, token);
  if (!res.ok) return 0;
  const data = await res.json();
  return data.count;
}

export async function acceptSuggestionApi(agentId: string, suggestionId: string, token: string | null): Promise<boolean> {
  const res = await apiAuthFetch(`/api/agents/${agentId}/suggestions/${suggestionId}/accept`, token, { method: 'PUT' });
  return res.ok;
}

export async function dismissSuggestionApi(agentId: string, suggestionId: string, token: string | null): Promise<boolean> {
  const res = await apiAuthFetch(`/api/agents/${agentId}/suggestions/${suggestionId}/dismiss`, token, { method: 'PUT' });
  return res.ok;
}

export async function updateSuggestionApi(agentId: string, suggestionId: string, data: unknown, token: string | null): Promise<Suggestion | null> {
  const res = await apiAuthFetch(`/api/agents/${agentId}/suggestions/${suggestionId}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function bulkAcceptSuggestionsApi(agentId: string, token: string | null): Promise<number> {
  const res = await apiAuthFetch(`/api/agents/${agentId}/suggestions/accept-all`, token, { method: 'POST' });
  if (!res.ok) return 0;
  const data = await res.json();
  return data.accepted;
}

export async function bulkDismissSuggestionsApi(agentId: string, token: string | null): Promise<boolean> {
  const res = await apiAuthFetch(`/api/agents/${agentId}/suggestions/dismiss-all`, token, { method: 'POST' });
  return res.ok;
}
