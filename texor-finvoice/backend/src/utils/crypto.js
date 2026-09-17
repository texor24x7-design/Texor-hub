/**
 * Encryption for secrets we hold on a customer's behalf — Gmail refresh tokens,
 * WhatsApp tokens, SMTP passwords.
 *
 * AES-256-GCM: the auth tag means a ciphertext that was edited in the database
 * fails to decrypt rather than decrypting to something else.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import env from '../config/env.js';

const key = env.ENCRYPTION_KEY
  ? Buffer.from(env.ENCRYPTION_KEY, 'base64')
  // Dev only (env.js refuses to start production without a real key).
  : createHash('sha256').update(`finvoice-dev:${env.COOKIE_SECRET}`).digest();

if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes.');

export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}

export function decrypt(sealed) {
  if (!sealed) return null;
  const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
