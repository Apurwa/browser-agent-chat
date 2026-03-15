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
