/**
 * Password hashing.
 *
 * Uses scrypt from node:crypto — memory-hard, in the standard library, and with
 * no native build step, which keeps `npm install` reliable across machines and
 * CI images. The cost parameters are stored inside the hash string, so they can
 * be raised later and old hashes still verify (and are re-hashed on next login
 * via `needsRehash`).
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };
// scrypt needs roughly 128 * N * r bytes; node's default maxmem is exactly 32 MiB
// which this configuration sits right on top of, so give it explicit headroom.
const MAXMEM = 128 * PARAMS.N * PARAMS.r * 2;

const b64 = (buffer) => buffer.toString('base64url');

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain.normalize('NFKC'), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAXMEM,
  });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, b64(salt), b64(derived)].join('$');
}

export async function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, N, r, p, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt') return false;

  const saltBuffer = Buffer.from(salt, 'base64url');
  const expected = Buffer.from(digest, 'base64url');

  const derived = await scryptAsync(plain.normalize('NFKC'), saltBuffer, expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** True when a stored hash was produced with weaker parameters than we use now. */
export function needsRehash(stored) {
  if (typeof stored !== 'string') return true;
  const [scheme, N, r, p] = stored.split('$');
  return scheme !== 'scrypt' || Number(N) < PARAMS.N || Number(r) < PARAMS.r || Number(p) < PARAMS.p;
}
