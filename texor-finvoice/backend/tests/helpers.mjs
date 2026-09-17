/** Shared by the end-to-end suites: a check counter, seeded sessions, and a fetch wrapper. */
import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { connectForTests } from './db.mjs';

export const API = process.env.TEST_API ?? 'http://localhost:4101';

let pass = 0;
let fail = 0;

export function check(label, ok, extra = '') {
  if (ok) { pass += 1; console.log(`  ok   ${label}`); } else { fail += 1; console.log(`  FAIL ${label} ${typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 400)}`); }
}

export const section = (title) => console.log(`\n── ${title} ──`);

export async function connect() {
  await connectForTests(process.env.MONGODB_URI);
  return mongoose.connection.db;
}

export async function finish() {
  await mongoose.disconnect();
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

/** Inserts a user and a live session directly, as if they had signed in with Texor. */
export async function seedUser(db, { texorId, email, displayName, emailVerified = true }) {
  const now = new Date();
  const { insertedId } = await db.collection('users').insertOne({
    texorId, email, emailVerified, displayName, picture: '', lastWorkspace: null, lastSeenAt: now, createdAt: now, updatedAt: now, __v: 0,
  });
  const token = randomBytes(32).toString('base64url');
  await db.collection('sessions').insertOne({
    user: insertedId, texorId, tokenHash: sha256(token), accessToken: null, refreshToken: null, idToken: null,
    accessTokenExpiresAt: null, userAgent: 'e2e', ip: '127.0.0.1', expiresAt: new Date(Date.now() + 864e5), revokedAt: null,
    createdAt: now, updatedAt: now, __v: 0,
  });
  return { _id: insertedId, email, displayName, cookie: `finvoice_sid=${token}` };
}

export async function call(user, path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(user ? { cookie: user.cookie } : {}),
      ...(body && !isBuffer ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? (isBuffer ? body : JSON.stringify(body)) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { status: res.status, body: payload, headers: res.headers };
}
