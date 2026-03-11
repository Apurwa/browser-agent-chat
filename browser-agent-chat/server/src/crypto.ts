import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedCredentials, PlaintextCredentials } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY environment variable is required');
  }
  return Buffer.from(key, 'hex');
}

export function encryptCredentials(creds: PlaintextCredentials): EncryptedCredentials {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(creds);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    iv: iv.toString('hex'),
    encrypted,
    tag,
  };
}

export function decryptCredentials(data: EncryptedCredentials): PlaintextCredentials {
  const key = getKey();
  const iv = Buffer.from(data.iv, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));

  let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}
