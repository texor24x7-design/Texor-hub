/**
 * End-to-end exercise of "Continue with Google / Microsoft / LinkedIn".
 *
 *   npm run test:federation
 *
 * The real providers cannot be driven from a test — they need registered
 * credentials and a human at a consent screen. So this stands up a small but
 * protocol-accurate OIDC provider (real discovery document, real JWKS, real
 * RS256 id_tokens, real PKCE checking) and points Texor's `google` connector at
 * it with GOOGLE_ISSUER. What is under test is our side: the relying party, the
 * account-linking policy, and the interaction resume.
 *
 * Covers the linking rules that matter, including the refusal when an upstream
 * has NOT verified an email that already belongs to a Texor account.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const TEXOR_PORT = 4901;
const UPSTREAM_PORT = 4900;
const TEXOR = `http://localhost:${TEXOR_PORT}`;
const UPSTREAM = `http://localhost:${UPSTREAM_PORT}`;
const WEB = 'http://localhost:3901';
const PRODUCT = 'http://localhost:3902';

const CLIENT_ID = 'texor-broker';
const CLIENT_SECRET = 'upstream-secret-value';
const REDIRECT_URI = `${TEXOR}/api/auth/federated/google/callback`;

// ── the stand-in upstream provider ───────────────────────────────────────────
const upstreamKeys = await generateKeyPair('RS256', { extractable: true });
const upstreamJwk = { ...(await exportJWK(upstreamKeys.publicKey)), use: 'sig', alg: 'RS256', kid: 'up-1' };

/** Whoever the upstream will claim to be signing in next. */
let nextUser = null;
const codes = new Map();

const upstreamApp = express();
upstreamApp.use(express.urlencoded({ extended: false }));

upstreamApp.get('/.well-known/openid-configuration', (_req, res) => res.json({
  issuer: UPSTREAM,
  authorization_endpoint: `${UPSTREAM}/authorize`,
  token_endpoint: `${UPSTREAM}/token`,
  userinfo_endpoint: `${UPSTREAM}/userinfo`,
  jwks_uri: `${UPSTREAM}/jwks`,
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  code_challenge_methods_supported: ['S256'],
}));

upstreamApp.get('/jwks', (_req, res) => res.json({ keys: [upstreamJwk] }));

upstreamApp.get('/authorize', (req, res) => {
  const { client_id: clientId, redirect_uri: redirectUri, state, nonce, code_challenge: challenge } = req.query;

  if (clientId !== CLIENT_ID) return res.status(400).json({ error: 'invalid_client' });
  if (redirectUri !== REDIRECT_URI) return res.status(400).json({ error: 'invalid_redirect_uri' });

  const code = randomBytes(16).toString('hex');
  codes.set(code, { nonce, challenge, user: nextUser });

  // The double represents a user already signed in upstream, so it returns
  // immediately rather than rendering a login screen.
  return res.redirect(`${redirectUri}?code=${code}&state=${encodeURIComponent(state)}`);
});

upstreamApp.post('/token', async (req, res) => {
  const { code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret } = req.body;

  if (clientId !== CLIENT_ID || clientSecret !== CLIENT_SECRET) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  const entry = codes.get(code);
  if (!entry) return res.status(400).json({ error: 'invalid_grant' });
  codes.delete(code);

  // Real PKCE verification — this is the half our client has to get right.
  if (entry.challenge) {
    const computed = createHash('sha256').update(verifier ?? '').digest('base64url');
    if (computed !== entry.challenge) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE mismatch' });
  }

  const idToken = await new SignJWT({ ...entry.user, nonce: entry.nonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'up-1' })
    .setIssuer(UPSTREAM)
    .setAudience(CLIENT_ID)
    .setSubject(entry.user.sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(upstreamKeys.privateKey);

  return res.json({ token_type: 'Bearer', expires_in: 300, access_token: `at-${code}`, id_token: idToken });
});

const upstreamServer = createServer(upstreamApp);
await new Promise((resolve) => upstreamServer.listen(UPSTREAM_PORT, resolve));

// ── Texor Account, with the google connector pointed at the double ───────────
const mongod = await MongoMemoryServer.create();
const { privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = await exportJWK(privateKey);

Object.assign(process.env, {
  NODE_ENV: 'development',
  PORT: String(TEXOR_PORT),
  ISSUER_ORIGIN: TEXOR,
  ACCOUNTS_WEB_ORIGIN: WEB,
  CORS_ORIGINS: WEB,
  MONGODB_URI: mongod.getUri('federation_test'),
  COOKIE_DOMAIN: '',
  COOKIE_KEYS: 'fed-test-key-a,fed-test-key-b',
  SECRET_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  OIDC_JWKS: JSON.stringify([{ ...jwk, use: 'sig', alg: 'RS256', kid: 'test' }]),
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
  GOOGLE_ISSUER: UPSTREAM,
  LOG_LEVEL: 'error',
});

const BASE = new URL('../src/', import.meta.url).href;
const { connectDatabase, disconnectDatabase } = await import(`${BASE}config/db.js`);
const { createProvider } = await import(`${BASE}oidc/provider.js`);
const { createApp } = await import(`${BASE}app.js`);
const { registerUser } = await import(`${BASE}services/user.service.js`);
const { registerClient } = await import(`${BASE}services/client.service.js`);

await connectDatabase();
const provider = await createProvider();
const texorServer = createServer(createApp(provider));
await new Promise((resolve) => texorServer.listen(TEXOR_PORT, resolve));

// ── browser ──────────────────────────────────────────────────────────────────
let jar = new Map();
const go = async (url, init = {}) => {
  const response = await fetch(url, {
    redirect: 'manual',
    ...init,
    headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(init.headers ?? {}) },
  });
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!value || /expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name);
    else jar.set(name, value);
  }
  return response;
};

/** Walks the redirect chain of a federated sign-in and returns where it landed. */
async function signInWith(user, { start = `${TEXOR}/api/auth/federated/google/start`, hops = 6 } = {}) {
  nextUser = user;
  let location = start;

  for (let i = 0; i < hops; i += 1) {
    const response = await go(location);
    const next = response.headers.get('location');
    if (!next) return { finalStatus: response.status, location };
    // Stop as soon as we leave the servers under test.
    if (next.startsWith(WEB) || next.startsWith(PRODUCT)) return { location: next };
    location = next;
  }

  return { location };
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const errorOf = (url) => new URL(url).searchParams.get('error');

// ── 0. issuer resolution ─────────────────────────────────────────────────────
// Asserted directly, because everything below sets GOOGLE_ISSUER and so cannot
// see this failure. The override vars are declared with `.default('')`, so an
// unset one arrives as an empty string; `??` treated that as deliberate and
// left every provider with no issuer, breaking Google and Microsoft entirely
// while leaving this suite green.
const { resolveIssuer } = await import(`${BASE}federation/providers.js`);
check('an unset issuer override falls back to the provider default',
  resolveIssuer({ issuer: 'https://accounts.google.com' }, '') === 'https://accounts.google.com',
  JSON.stringify(resolveIssuer({ issuer: 'https://accounts.google.com' }, '')));
check('an explicit issuer override wins',
  resolveIssuer({ issuer: 'https://accounts.google.com' }, 'http://localhost:9999') === 'http://localhost:9999');
check('a computed issuer is resolved and trailing slashes trimmed',
  resolveIssuer({ issuer: () => 'https://login.microsoftonline.com/common/v2.0/' }, '')
    === 'https://login.microsoftonline.com/common/v2.0');

// ── 1. the sign-in screen only offers configured providers ───────────────────
const providers = await (await go(`${TEXOR}/api/auth/providers`)).json();
check('only configured providers are offered',
  providers.providers.length === 1 && providers.providers[0].id === 'google',
  JSON.stringify(providers.providers.map((p) => p.id)));

// ── 2. the authorization request is well formed ──────────────────────────────
const started = await go(`${TEXOR}/api/auth/federated/google/start?next=/account`);
const authUrl = new URL(started.headers.get('location'));
check('start redirects to the upstream authorization endpoint', authUrl.origin + authUrl.pathname === `${UPSTREAM}/authorize`, authUrl.pathname);
check('PKCE challenge sent', authUrl.searchParams.get('code_challenge_method') === 'S256' && Boolean(authUrl.searchParams.get('code_challenge')));
check('state and nonce sent', Boolean(authUrl.searchParams.get('state')) && Boolean(authUrl.searchParams.get('nonce')));
check('transaction cookie stored', jar.has('texor_fed'));

// ── 3. a brand new person gets a Texor Account ───────────────────────────────
jar = new Map();
const ADA = { sub: 'google-ada-001', email: 'ada@example.com', email_verified: true, name: 'Ada Lovelace', given_name: 'Ada', family_name: 'Lovelace' };
let landed = await signInWith(ADA);
check('new user signed in and returned to the account UI', landed.location === `${WEB}/account`, landed.location);
check('texor session cookie set', jar.has('texor_sid'));

let me = await (await go(`${TEXOR}/api/auth/me`)).json();
check('account created from upstream claims', me.user?.email === 'ada@example.com' && me.user?.displayName === 'Ada Lovelace', JSON.stringify(me.user).slice(0, 120));
check('federated account has no password', me.user?.hasPassword === false);
const adaId = me.user?.id;

// ── 4. signing in again reuses the account rather than duplicating it ────────
jar = new Map();
landed = await signInWith(ADA);
me = await (await go(`${TEXOR}/api/auth/me`)).json();
check('second sign-in resolves to the same account', me.user?.id === adaId, `${me.user?.id} vs ${adaId}`);

// ── 5. a password login on a passwordless account explains itself ────────────
const passwordAttempt = await fetch(`${TEXOR}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'ada@example.com', password: 'not-the-password' }),
});
const passwordBody = await passwordAttempt.json();
check('password sign-in on a Google-only account is explained, not a generic 401',
  passwordAttempt.status === 401 && passwordBody.error?.code === 'password_not_set' && /Google/.test(passwordBody.error.message),
  passwordBody.error?.message);

// ── 6. a VERIFIED upstream email links onto an existing password account ─────
await registerUser({ email: 'grace@example.com', password: 'Hopper1906!x', givenName: 'Grace', familyName: 'Hopper' });
jar = new Map();
landed = await signInWith({ sub: 'google-grace-001', email: 'grace@example.com', email_verified: true, name: 'Grace Hopper' });
check('verified upstream email links to the existing account', landed.location === `${WEB}/account`, landed.location);
me = await (await go(`${TEXOR}/api/auth/me`)).json();
check('linked, not duplicated', me.user?.email === 'grace@example.com' && me.user?.hasPassword === true, JSON.stringify(me.user).slice(0, 120));
const graceId = me.user?.id;

// ── 7. an UNVERIFIED upstream email must NOT take over that account ──────────
jar = new Map();
landed = await signInWith({ sub: 'google-impostor-001', email: 'grace@example.com', email_verified: false, name: 'Not Grace' });
check('unverified upstream email is refused, not silently linked',
  landed.location?.startsWith(`${WEB}/signin?error=`) && /not verified/i.test(errorOf(landed.location) ?? ''),
  errorOf(landed.location)?.slice(0, 90));
check('no session granted to the impostor', !jar.has('texor_sid'));

// ── 8. a tampered state is rejected ──────────────────────────────────────────
jar = new Map();
nextUser = ADA;
const tamperStart = await go(`${TEXOR}/api/auth/federated/google/start`);
const tampered = await go(tamperStart.headers.get('location'));
const callbackUrl = new URL(tampered.headers.get('location'));
callbackUrl.searchParams.set('state', 'not-the-state-we-issued');
const tamperResult = await go(callbackUrl.toString());
check('a tampered state is rejected', /error=/.test(tamperResult.headers.get('location') ?? ''),
  errorOf(tamperResult.headers.get('location'))?.slice(0, 70));

// ── 9. linking a second provider from account settings ───────────────────────
jar = new Map();
await signInWith({ sub: 'google-grace-001', email: 'grace@example.com', email_verified: true, name: 'Grace Hopper' });
let identities = await (await go(`${TEXOR}/api/account/identities`)).json();
check('account settings lists the connected provider',
  identities.identities?.length === 1 && identities.identities[0].provider === 'google', JSON.stringify(identities.identities));

// ── 10. unlinking rules ──────────────────────────────────────────────────────
const unlinkWithPassword = await go(`${TEXOR}/api/account/identities/google`, { method: 'DELETE' });
check('a provider can be disconnected when a password exists', unlinkWithPassword.status === 200);

jar = new Map();
await signInWith(ADA);   // passwordless account
const unlinkLast = await go(`${TEXOR}/api/account/identities/google`, { method: 'DELETE' });
const unlinkBody = await unlinkLast.json();
check('disconnecting the only sign-in method is refused',
  unlinkLast.status === 409 && /only way to sign in/i.test(unlinkBody.error?.message ?? ''),
  unlinkBody.error?.message?.slice(0, 80));

const setPassword = await go(`${TEXOR}/api/account/password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ newPassword: 'FirstPassword1x', signOutOtherSessions: false }),
});
check('a passwordless account can set a first password without a current one', setPassword.status === 200,
  JSON.stringify(await setPassword.clone().json()).slice(0, 120));

const unlinkAfter = await go(`${TEXOR}/api/account/identities/google`, { method: 'DELETE' });
check('and can then disconnect the provider', unlinkAfter.status === 200);

// ── 11. federated sign-in from inside a product's authorization request ──────
const { clientSecret } = await registerClient({
  clientId: 'finvoice',
  clientName: 'Finvoice',
  redirectUris: [`${PRODUCT}/api/auth/callback`],
  appUrl: PRODUCT,
  isFirstParty: true,
});

jar = new Map();
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

const authorize = await go(`${TEXOR}/oidc/auth?${new URLSearchParams({
  client_id: 'finvoice',
  redirect_uri: `${PRODUCT}/api/auth/callback`,
  response_type: 'code',
  scope: 'openid profile email',
  state: 'product-state',
  code_challenge: challenge,
  code_challenge_method: 'S256',
})}`);
const interactionUrl = authorize.headers.get('location');
const uid = interactionUrl?.split('/interaction/')[1];
check('product authorization reaches the account UI', Boolean(uid), interactionUrl);

const details = await (await go(`${TEXOR}/api/interaction/${uid}`)).json();
check('the sign-in prompt offers the federated buttons too',
  details.providers?.some((p) => p.id === 'google'), JSON.stringify(details.providers));

landed = await signInWith(
  { sub: 'google-hedy-001', email: 'hedy@example.com', email_verified: true, name: 'Hedy Lamarr' },
  { start: `${TEXOR}/api/auth/federated/google/start?interaction=${uid}` },
);
check('federated sign-in completes the product authorization',
  landed.location?.startsWith(`${PRODUCT}/api/auth/callback?code=`), landed.location?.slice(0, 70));

const code = landed.location?.includes('code=') ? new URL(landed.location).searchParams.get('code') : null;
const tokens = await (await fetch(`${TEXOR}/oidc/token`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: `Basic ${Buffer.from(`finvoice:${clientSecret}`).toString('base64')}`,
  },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${PRODUCT}/api/auth/callback`,
    code_verifier: verifier,
  }),
})).json();
const idClaims = tokens.id_token ? JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url')) : {};
check('the product receives a Texor token for the Google user',
  idClaims.email === 'hedy@example.com', JSON.stringify(tokens.error ?? idClaims).slice(0, 140));
check('a provider that sends only a full name does not lose it',
  idClaims.name === 'Hedy Lamarr', JSON.stringify(idClaims.name));

// ── 12. the callback survives the Origin a cross-site redirect carries ───────
// Browsers send `Origin: null` on a cross-site redirect navigation, which is
// exactly what returning from Google is. Treating that as a CORS violation
// turned a completed sign-in into a 500 at the last step.
const nullOrigin = await fetch(`${TEXOR}/api/auth/federated/google/callback?code=x&state=y`, {
  redirect: 'manual',
  headers: { origin: 'null' },
});
check('the federated callback is not rejected as a CORS violation',
  nullOrigin.status !== 500, `HTTP ${nullOrigin.status}`);
check('it redirects the user to a readable error instead',
  nullOrigin.status === 302 && /\/signin\?error=/.test(nullOrigin.headers.get('location') ?? ''),
  nullOrigin.headers.get('location')?.slice(0, 80));

// ── summary ──────────────────────────────────────────────────────────────────
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);

texorServer.close();
upstreamServer.close();
await disconnectDatabase();
await mongod.stop();
process.exit(failed ? 1 : 0);
