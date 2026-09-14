/**
 * Envelope encryption for secrets that must be recoverable.
 *
 * Passwords are hashed (see password.js) because we only ever need to *verify*
 * them. Client secrets are different: oidc-provider compares the secret a
 * product presents at the token endpoint against the registered value, so it
 * needs the original back. Hashing is therefore not an option — the secrets are
 * encrypted with AES-256-GCM under a key held outside the database.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function keyFrom(secret) {
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32) {
    throw new Error('SECRET_ENCRYPTION_KEY must be 32 bytes encoded as base64 (generate with `npm run keys:generate`).');
  }
  return key;
}

export function encryptSecret(plaintext, encryptionKey) {
  const key = keyFrom(encryptionKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(envelope, encryptionKey) {
  if (typeof envelope !== 'string') return null;
  const [version, iv, tag, ciphertext] = envelope.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) return null;

  const decipher = createDecipheriv(ALGORITHM, keyFrom(encryptionKey), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
