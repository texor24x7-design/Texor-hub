/**
 * End-to-end exercise of the Texor identity provider.
 *
 *   npm run test:smoke
 *
 * Boots the real app against a throwaway in-memory MongoDB and drives a full
 * browser-shaped flow with a cookie jar — no mocks, no stubs. Run it after any
 * change to the OIDC configuration, the adapter, or the interaction endpoints;
 * those three are where a subtle mistake silently breaks sign-in for every
 * product at once.
 *
 * Covers:
 * discovery -> authorization -> interaction -> code -> tokens -> userinfo,
 * then a second product to prove single sign-on across the ecosystem.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { exportJWK, generateKeyPair } from 'jose';

const BACKEND_PORT = 4599;
const ORIGIN = `http://localhost:${BACKEND_PORT}`;
const WEB = 'http://localhost:3999';

const mongod = await MongoMemoryServer.create();
const { privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = await exportJWK(privateKey);

Object.assign(process.env, {
  NODE_ENV: 'development',
  PORT: String(BACKEND_PORT),
  ISSUER_ORIGIN: ORIGIN,
  ACCOUNTS_WEB_ORIGIN: WEB,
  CORS_ORIGINS: WEB,
  MONGODB_URI: mongod.getUri('texor_accounts_test'),
  COOKIE_DOMAIN: '',
  COOKIE_KEYS: 'test-key-a,test-key-b',
  SECRET_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  OIDC_JWKS: JSON.stringify([{ ...jwk, use: 'sig', alg: 'RS256', kid: 'test' }]),
  LOG_LEVEL: 'error',
});

const BASE = new URL('../src/', import.meta.url).href;
const { connectDatabase } = await import(`${BASE}config/db.js`);
const { createProvider } = await import(`${BASE}oidc/provider.js`);
const { createApp } = await import(`${BASE}app.js`);
const { registerClient } = await import(`${BASE}services/client.service.js`);
const { registerUser } = await import(`${BASE}services/user.service.js`);

await connectDatabase();
const provider = await createProvider();
const app = createApp(provider);
const server = createServer(app);
await new Promise((r) => server.listen(BACKEND_PORT, r));

// ── fixtures ──────────────────────────────────────────────────────────────────
const USER = { email: 'ada@texor.app', password: 'Lovelace1843!x', givenName: 'Ada', familyName: 'Lovelace' };
await registerUser(USER);

const finvoice = await registerClient({
  clientId: 'finvoice',
  clientName: 'Finvoice',
  redirectUris: ['http://localhost:3001/api/auth/callback'],
  postLogoutRedirectUris: ['http://localhost:3001', 'http://localhost:3001/'],
  appUrl: 'http://localhost:3001',
  resourceIndicator: 'https://api.finvoice.texor.app',
  isFirstParty: true,
});
const payroll = await registerClient({
  clientId: 'payroll',
  clientName: 'Texor Payroll',
  redirectUris: ['http://localhost:3003/api/auth/callback'],
  appUrl: 'http://localhost:3003',
  resourceIndicator: 'https://api.payroll.texor.app',
  isFirstParty: true,
});

// ── tiny cookie jar ───────────────────────────────────────────────────────────
const jar = new Map();
function absorb(response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name);
    else jar.set(name, value);
  }
  return response;
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const go = async (url, init = {}) => absorb(await fetch(url, {
  redirect: 'manual',
  ...init,
  headers: { cookie: cookieHeader(), ...(init.headers ?? {}) },
}));

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

// ── 1. discovery ──────────────────────────────────────────────────────────────
const discovery = await (await go(`${ORIGIN}/oidc/.well-known/openid-configuration`)).json();
check('discovery document served', discovery.issuer === `${ORIGIN}/oidc`, discovery.issuer);
check('PKCE advertised', discovery.code_challenge_methods_supported?.includes('S256'));
const jwks = await (await go(discovery.jwks_uri)).json();
check('JWKS published', jwks.keys?.length === 1 && jwks.keys[0].kid === 'test');

// ── 2. authorization request from finvoice ────────────────────────────────────
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('base64url');

const authUrl = (clientId, redirectUri) => `${ORIGIN}/oidc/auth?` + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'openid profile email offline_access',
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
});

let response = await go(authUrl('finvoice', 'http://localhost:3001/api/auth/callback'));
let location = response.headers.get('location');
check('authorization redirects to the account UI', response.status === 303 && location?.startsWith(`${WEB}/interaction/`), location);

const uid = location.split('/interaction/')[1];
check('interaction cookie issued', jar.has('_texor_interaction'));

// ── 3. the account UI reads the interaction ───────────────────────────────────
const details = await (await go(`${ORIGIN}/api/interaction/${uid}`)).json();
check('interaction details readable', details.prompt?.name === 'login', JSON.stringify(details.prompt?.name));
check('client metadata resolved from mongo', details.client?.name === 'Finvoice' && details.client?.firstParty === true);

// ── 4. sign in ────────────────────────────────────────────────────────────────
const loginResponse = await go(`${ORIGIN}/api/interaction/${uid}/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: USER.email, password: USER.password }),
});
const loginBody = await loginResponse.json();
check('interaction login accepted', loginResponse.status === 200 && Boolean(loginBody.redirectTo), JSON.stringify(loginBody).slice(0, 160));
check('texor SSO session cookie set', jar.has('texor_sid'));

// ── 5. resume: first-party consent is granted automatically ───────────────────
response = await go(loginBody.redirectTo);
location = response.headers.get('location');
check('resume issues an authorization code without a consent prompt',
  Boolean(location?.startsWith('http://localhost:3001/api/auth/callback?')), location);

const code = new URL(location).searchParams.get('code');
check('state echoed back intact', new URL(location).searchParams.get('state') === state);

// ── 6. token exchange with PKCE + client_secret_basic ─────────────────────────
const basic = (id, secret) => 'Basic ' + Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64');
const tokenResponse = await fetch(`${ORIGIN}/oidc/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic('finvoice', finvoice.clientSecret) },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: 'http://localhost:3001/api/auth/callback',
    code_verifier: verifier,
  }),
});
const tokens = await tokenResponse.json();
check('token exchange succeeds', tokenResponse.status === 200 && Boolean(tokens.access_token), JSON.stringify(tokens).slice(0, 200));
check('refresh token issued to a first-party product', Boolean(tokens.refresh_token));

const idClaims = tokens.id_token ? JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url')) : {};
check('id_token carries profile + email claims', idClaims.email === USER.email && idClaims.name === 'Ada Lovelace', JSON.stringify(idClaims).slice(0, 200));

const subject = idClaims.sub;

// ── 7. userinfo ───────────────────────────────────────────────────────────────
const userinfo = await (await fetch(`${ORIGIN}/oidc/me`, { headers: { authorization: `Bearer ${tokens.access_token}` } })).json();
check('userinfo returns the account', userinfo.email === USER.email, JSON.stringify(userinfo).slice(0, 160));

// ── 7b. refresh grant keeps the product signed in, and rotates the token ──────
const refreshed = await (await fetch(`${ORIGIN}/oidc/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic('finvoice', finvoice.clientSecret) },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
})).json();
check('refresh grant returns a fresh access token', Boolean(refreshed.access_token), JSON.stringify(refreshed).slice(0, 200));
check('refresh token rotated', Boolean(refreshed.refresh_token) && refreshed.refresh_token !== tokens.refresh_token);

// ── 8. SSO: a second product must not re-prompt ───────────────────────────────
const verifier2 = randomBytes(32).toString('base64url');
const challenge2 = createHash('sha256').update(verifier2).digest('base64url');
response = await go(`${ORIGIN}/oidc/auth?` + new URLSearchParams({
  client_id: 'payroll',
  redirect_uri: 'http://localhost:3003/api/auth/callback',
  response_type: 'code',
  scope: 'openid profile email',
  state: 'payroll-state',
  code_challenge: challenge2,
  code_challenge_method: 'S256',
  // Opting in to an API-audience access token for payroll's own backend.
  resource: 'https://api.payroll.texor.app',
}));
location = response.headers.get('location');
check('second product signs in silently (single sign-on)',
  Boolean(location?.startsWith('http://localhost:3003/api/auth/callback?code=')), location);

const code2 = location?.includes('code=') ? new URL(location).searchParams.get('code') : null;
const token2 = await (await fetch(`${ORIGIN}/oidc/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic('payroll', payroll.clientSecret) },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: code2,
    redirect_uri: 'http://localhost:3003/api/auth/callback',
    code_verifier: verifier2,
    resource: 'https://api.payroll.texor.app',
  }),
})).json();
const at2 = token2.access_token?.includes('.')
  ? JSON.parse(Buffer.from(token2.access_token.split('.')[1], 'base64url'))
  : {};
check('payroll token issued', Boolean(token2.access_token), JSON.stringify(token2).slice(0, 200));
check('payroll access token is a JWT bound to its own API',
  at2.aud === 'https://api.payroll.texor.app', JSON.stringify(at2.aud));
check('same subject across both products', at2.sub && at2.sub === subject);

// ── 9. account API via the SSO cookie ─────────────────────────────────────────
const meResponse = await (await go(`${ORIGIN}/api/auth/me`)).json();
check('account API recognises the SSO cookie', meResponse.user?.email === USER.email);
const apps = await (await go(`${ORIGIN}/api/account/connected-apps`)).json();
check('connected apps lists both products', apps.apps?.length === 2, JSON.stringify(apps.apps?.map((a) => a.clientId)));

// ── 9b. CORS refuses without throwing ─────────────────────────────────────────
// A disallowed origin must get a normal response with no Access-Control-Allow-
// Origin header, letting the browser enforce the policy. Answering 500 instead
// breaks every top-level navigation that carries an Origin — including the
// cross-site redirect back from Google, which arrives as the literal `null`.
for (const [origin, allowed] of [[WEB, true], ['null', false], ['https://evil.example', false]]) {
  const response = await fetch(`${ORIGIN}/api/health`, { headers: { origin } });
  const acao = response.headers.get('access-control-allow-origin');
  check(`CORS: origin ${origin} answers normally`, response.status === 200, `HTTP ${response.status}`);
  check(`CORS: origin ${origin} ${allowed ? 'is' : 'is not'} granted the header`,
    allowed ? acao === origin : acao === null, String(acao));
}

// ── 9c. RP-initiated logout ───────────────────────────────────────────────────
// Signing out has to work for both spellings of a product's home page.
// `post_logout_redirect_uri` is compared as an exact string, and a product
// built from APP_ORIGIN sends the bare origin while a hand-written registration
// tends to carry a trailing slash. Registering one and sending the other is a
// confusing invalid_request at the very end of a session.
for (const postLogout of ['http://localhost:3001', 'http://localhost:3001/']) {
  const endSession = await go(`${ORIGIN}/oidc/session/end?${new URLSearchParams({
    client_id: 'finvoice',
    id_token_hint: tokens.id_token,
    post_logout_redirect_uri: postLogout,
  })}`);

  const accepted = endSession.status === 200;
  check(`logout accepts post_logout_redirect_uri "${postLogout}"`, accepted,
    accepted ? 'confirmation page' : `HTTP ${endSession.status} -> ${endSession.headers.get('location')}`);

  if (!accepted) continue;

  // The provider renders a form carrying its own XSRF token; submitting it is
  // what actually ends the session.
  const html = await endSession.text();
  const action = html.match(/<form[^>]+action="([^"]+)"/)?.[1];
  const fields = [...html.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)];

  const body = new URLSearchParams(fields.map(([, name, value]) => [name, value]));
  body.set('logout', 'yes');

  const completed = await go(new URL(action, ORIGIN).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  check(`logout returns to the product for "${postLogout}"`,
    completed.headers.get('location')?.startsWith(postLogout),
    completed.headers.get('location') ?? `HTTP ${completed.status}`);
}

// An unregistered destination must still be refused.
const badLogout = await go(`${ORIGIN}/oidc/session/end?${new URLSearchParams({
  client_id: 'finvoice',
  post_logout_redirect_uri: 'https://evil.example/steal',
})}`);
// Refused outright rather than redirected: an unregistered destination is
// precisely the one place the provider must not send anybody.
check('logout refuses an unregistered post_logout_redirect_uri',
  badLogout.status >= 400 || /error=/.test(badLogout.headers.get('location') ?? ''),
  `HTTP ${badLogout.status}${badLogout.headers.get('location') ? ` -> ${badLogout.headers.get('location')}` : ''}`);

// ── 10. wrong password is rejected ────────────────────────────────────────────
const bad = await fetch(`${ORIGIN}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: USER.email, password: 'wrong-password' }),
});
check('bad credentials rejected', bad.status === 401);

// ── summary ───────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

server.close();
await (await import('mongoose')).default.disconnect();
await mongod.stop();
process.exit(failed.length ? 1 : 0);
