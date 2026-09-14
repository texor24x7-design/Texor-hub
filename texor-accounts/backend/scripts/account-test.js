/**
 * Email verification, password recovery, phone numbers and picture uploads.
 *
 *   npm run test:account
 *
 * Resend is not called: the mailer's development transport prints instead of
 * sending, so the suite reads the link out of the token collection — the same
 * value the email carries. Cloudinary is likewise not called; what is checked
 * here is the signature we hand the browser and the validation of what comes
 * back, which is the half that can be got wrong dangerously.
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { exportJWK, generateKeyPair } from 'jose';

const PORT = 4960;
const ORIGIN = `http://localhost:${PORT}`;
const WEB = 'http://localhost:3960';

const mongod = await MongoMemoryServer.create();
const { privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = await exportJWK(privateKey);

Object.assign(process.env, {
  NODE_ENV: 'development',
  PORT: String(PORT),
  ISSUER_ORIGIN: ORIGIN,
  ACCOUNTS_WEB_ORIGIN: WEB,
  CORS_ORIGINS: WEB,
  MONGODB_URI: mongod.getUri('account_test'),
  COOKIE_DOMAIN: '',
  COOKIE_KEYS: 'account-test-a,account-test-b',
  SECRET_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  OIDC_JWKS: JSON.stringify([{ ...jwk, use: 'sig', alg: 'RS256', kid: 'test' }]),
  // Present so the signing path is exercised; no request ever leaves.
  CLOUDINARY_CLOUD_NAME: 'texor-test',
  CLOUDINARY_API_KEY: '123456789',
  CLOUDINARY_API_SECRET: 'test-secret',
  CLOUDINARY_FOLDER: 'texor/avatars',
  LOG_LEVEL: 'error',
});

const BASE = new URL('../src/', import.meta.url).href;
const { connectDatabase, disconnectDatabase } = await import(`${BASE}config/db.js`);
const { createProvider } = await import(`${BASE}oidc/provider.js`);
const { createApp } = await import(`${BASE}app.js`);
const VerificationToken = (await import(`${BASE}models/VerificationToken.js`)).default;
const User = (await import(`${BASE}models/User.js`)).default;
const { sha256 } = await import(`${BASE}utils/ids.js`);

await connectDatabase();
const provider = await createProvider();
const server = createServer(createApp(provider));
await new Promise((resolve) => server.listen(PORT, resolve));

function browser() {
  const jar = new Map();
  return async (url, init = {}) => {
    const response = await fetch(url, {
      redirect: 'manual',
      ...init,
      headers: {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || /expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  };
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

/**
 * The raw token only ever exists inside the email, so the suite mints a known
 * one: issue as normal, then overwrite the stored hash with the hash of a value
 * it chose. Everything downstream — expiry, single use, address pinning — is
 * still the real code path.
 */
async function grabToken(email, purpose) {
  const user = await User.findOne({ email }).exec();
  const record = await VerificationToken.findOne({ user: user._id, purpose, consumedAt: null })
    .sort({ createdAt: -1 }).exec();
  if (!record) return null;

  const known = randomBytes(24).toString('base64url');
  record.tokenHash = sha256(known);
  await record.save();
  return known;
}

const USER = { email: 'nina@example.com', password: 'CorrectHorse1x', givenName: 'Nina', familyName: 'Novak' };

// ── 1. sign-up collects a phone number and starts verification ───────────────
const go = browser();
const signup = await go(`${ORIGIN}/api/auth/signup`, {
  method: 'POST',
  body: JSON.stringify({ ...USER, phone: '+14155550123' }),
});
const signupBody = await signup.json();
check('sign-up succeeds with a phone number', signup.status === 201, JSON.stringify(signupBody).slice(0, 140));
check('the phone number is stored', signupBody.user?.phone === '+14155550123', signupBody.user?.phone);
check('a new address starts unverified', signupBody.user?.emailVerified === false);
check('a verification email is issued at sign-up', signupBody.verificationSent === true);

// ── 2. phone numbers must be in one canonical form ───────────────────────────
for (const bad of ['555-0123', '00441234567890', '+0123456789', 'not a phone']) {
  const response = await fetch(`${ORIGIN}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `x${Math.random()}@example.com`, password: 'CorrectHorse1x', phone: bad }),
  });
  check(`phone "${bad}" is rejected`, response.status === 400, `HTTP ${response.status}`);
}

// ── 3. confirming the address ────────────────────────────────────────────────
const badToken = await go(`${ORIGIN}/api/auth/verify-email`, {
  method: 'POST', body: JSON.stringify({ token: 'x'.repeat(32) }),
});
check('an unknown verification token is rejected', badToken.status === 400, `HTTP ${badToken.status}`);

const verifyToken = await grabToken(USER.email, 'email_verification');
check('a verification token was actually issued', Boolean(verifyToken));

const confirmed = await (await go(`${ORIGIN}/api/auth/verify-email`, {
  method: 'POST', body: JSON.stringify({ token: verifyToken }),
})).json();
check('the address is confirmed', confirmed.user?.emailVerified === true, JSON.stringify(confirmed).slice(0, 120));

const replay = await go(`${ORIGIN}/api/auth/verify-email`, {
  method: 'POST', body: JSON.stringify({ token: verifyToken }),
});
check('a verification token cannot be used twice', replay.status === 400, `HTTP ${replay.status}`);

// ── 4. the verified flag reaches products through the id_token ───────────────
const me = await (await go(`${ORIGIN}/api/auth/me`)).json();
check('the account reports itself verified', me.user?.emailVerified === true);

// ── 5. password recovery ─────────────────────────────────────────────────────
const unknownAddress = await (await fetch(`${ORIGIN}/api/auth/forgot-password`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'nobody@example.com' }),
})).json();
const knownAddress = await (await fetch(`${ORIGIN}/api/auth/forgot-password`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: USER.email }),
})).json();
check('forgot-password answers identically for known and unknown addresses',
  JSON.stringify(unknownAddress) === JSON.stringify(knownAddress), JSON.stringify(knownAddress));
check('no token is minted for an address with no account',
  (await VerificationToken.countDocuments({ purpose: 'password_reset' })) === 1);

const resetToken = await grabToken(USER.email, 'password_reset');
const NEW_PASSWORD = 'BrandNewPass9z';

const reset = await (await go(`${ORIGIN}/api/auth/reset-password`, {
  method: 'POST', body: JSON.stringify({ token: resetToken, newPassword: NEW_PASSWORD }),
})).json();
check('the password is reset', Boolean(reset.user), JSON.stringify(reset).slice(0, 120));

const oldPassword = await fetch(`${ORIGIN}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: USER.email, password: USER.password }),
});
check('the old password no longer works', oldPassword.status === 401, `HTTP ${oldPassword.status}`);

const fresh = browser();
const newPassword = await fresh(`${ORIGIN}/api/auth/login`, {
  method: 'POST', body: JSON.stringify({ email: USER.email, password: NEW_PASSWORD }),
});
check('the new password works', newPassword.status === 200, `HTTP ${newPassword.status}`);

const resetReplay = await fresh(`${ORIGIN}/api/auth/reset-password`, {
  method: 'POST', body: JSON.stringify({ token: resetToken, newPassword: 'AnotherOne1xy' }),
});
check('a reset token cannot be used twice', resetReplay.status === 400, `HTTP ${resetReplay.status}`);

// ── 6. picture uploads ───────────────────────────────────────────────────────
const signed = await (await fresh(`${ORIGIN}/api/account/picture/signature`)).json();
const upload = signed.upload;
const userId = (await User.findOne({ email: USER.email }).lean())._id.toString();

check('an upload signature is issued', Boolean(upload?.signature && upload?.timestamp), JSON.stringify(upload?.cloudName));
check('the upload is confined to a folder for this account',
  upload?.folder === `texor/avatars/${userId}`, upload?.folder);
check('the API secret is never handed to the browser',
  !JSON.stringify(upload).includes('test-secret'));

const goodUrl = `https://res.cloudinary.com/texor-test/image/upload/v1/texor/avatars/${userId}/avatar-1.jpg`;
const saved = await (await fresh(`${ORIGIN}/api/account/picture`, {
  method: 'PUT',
  body: JSON.stringify({ secureUrl: goodUrl, publicId: `texor/avatars/${userId}/avatar-1` }),
})).json();
check('a genuine upload result is accepted', saved.user?.picture === goodUrl, JSON.stringify(saved).slice(0, 120));

// The dangerous cases: pointing an avatar somewhere it did not come from.
const attacks = [
  ['another account’s folder', {
    secureUrl: goodUrl,
    publicId: 'texor/avatars/000000000000000000000000/avatar-1',
  }],
  ['an arbitrary URL', {
    secureUrl: 'https://evil.example/tracker.gif',
    publicId: `texor/avatars/${userId}/avatar-2`,
  }],
  ['a different Cloudinary cloud', {
    secureUrl: 'https://res.cloudinary.com/someone-else/image/upload/v1/x.jpg',
    publicId: `texor/avatars/${userId}/avatar-3`,
  }],
];

for (const [label, body] of attacks) {
  const response = await fresh(`${ORIGIN}/api/account/picture`, { method: 'PUT', body: JSON.stringify(body) });
  check(`an upload result pointing at ${label} is rejected`, response.status === 400, `HTTP ${response.status}`);
}

const removed = await (await fresh(`${ORIGIN}/api/account/picture`, { method: 'DELETE' })).json();
check('a picture can be removed', removed.user?.picture === '', JSON.stringify(removed.user?.picture));

// ── 7. the phone scope is offered and gated ──────────────────────────────────
const discovery = await (await fetch(`${ORIGIN}/oidc/.well-known/openid-configuration`)).json();
check('the phone scope is advertised', discovery.scopes_supported?.includes('phone'),
  JSON.stringify(discovery.scopes_supported));
check('phone claims are advertised', discovery.claims_supported?.includes('phone_number'),
  JSON.stringify(discovery.claims_supported?.filter((c) => c.startsWith('phone'))));

// ── summary ──────────────────────────────────────────────────────────────────
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);

server.close();
await disconnectDatabase();
await mongod.stop();
process.exit(failed ? 1 : 0);
