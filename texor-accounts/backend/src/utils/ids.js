import { randomBytes, randomUUID, createHash } from 'node:crypto';

/** URL-safe opaque token, used for session ids and client secrets. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Stable identifier for a document we expose publicly. */
export const uuid = () => randomUUID();

/**
 * Session ids and client secrets are stored hashed, so a database dump alone is
 * not enough to impersonate a user or a product.
 */
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
