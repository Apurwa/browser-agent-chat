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
