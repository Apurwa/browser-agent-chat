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
