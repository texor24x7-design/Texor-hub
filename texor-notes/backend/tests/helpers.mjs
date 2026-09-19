/**
 * The bits every suite needs, and nothing else.
 *
 * Sessions are seeded straight into Mongo rather than driven through Texor
 * Account: the identity provider is a different product and does not have to be
 * running for these to mean anything. What is being tested is what this product
 * does once it knows who you are.
 */
import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';

export const API = process.env.TEST_API ?? 'http://localhost:4104';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

let pass = 0;
let fail = 0;

export const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  ok   ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label} ${extra}`); }
};

export const section = (title) => console.log(`\n── ${title} ──`);

export function report() {
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

/** A signed-in person: the local projection plus a session cookie for them. */
export async function seedUser({ texorId, email, displayName }) {
  const db = mongoose.connection.db;
  const now = new Date();

  const { insertedId } = await db.collection('users').insertOne({
    texorId, email, displayName, picture: '',
    signedInAt: now, lastSeenAt: now, createdAt: now, updatedAt: now, __v: 0,
  });

  const token = randomBytes(32).toString('base64url');
  await db.collection('sessions').insertOne({
    user: insertedId, texorId, tokenHash: sha256(token),
    accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null,
    userAgent: 'e2e', ip: '127.0.0.1',
    expiresAt: new Date(Date.now() + 864e5), revokedAt: null,
    createdAt: now, updatedAt: now, __v: 0,
  });

  return { texorId, email, displayName, cookie: `notes_sid=${token}` };
}

/** One request, as somebody (or as nobody, with `null`). */
export async function call(user, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(user?.cookie ? { cookie: user.cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = text; }

  return { status: response.status, body: payload };
}

/** Empty the collections a suite is about to write to. */
export async function wipe(...collections) {
  const db = mongoose.connection.db;
  for (const name of collections) await db.collection(name).deleteMany({}).catch(() => {});
}
