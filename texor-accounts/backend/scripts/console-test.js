/**
 * End-to-end exercise of the Texor developer console.
 *
 *   npm run test:console
 *
 * Registers an app the way a third-party developer would, then drives a real
 * authorization request against it — consent screen included — and checks that
 * the guard rails hold: a developer cannot make their own app first-party or
 * published, and an app in testing works only for accounts its owner listed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { exportJWK, generateKeyPair } from 'jose';

const PORT = 4950;
const ORIGIN = `http://localhost:${PORT}`;
const WEB = 'http://localhost:3950';
const APP_CALLBACK = 'https://devapp.example.com/callback';

const mongod = await MongoMemoryServer.create();
const { privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = await exportJWK(privateKey);

Object.assign(process.env, {
  NODE_ENV: 'development',
  PORT: String(PORT),
  ISSUER_ORIGIN: ORIGIN,
  ACCOUNTS_WEB_ORIGIN: WEB,
  CORS_ORIGINS: WEB,
  MONGODB_URI: mongod.getUri('console_test'),
  COOKIE_DOMAIN: '',
  COOKIE_KEYS: 'console-test-a,console-test-b',
  SECRET_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  OIDC_JWKS: JSON.stringify([{ ...jwk, use: 'sig', alg: 'RS256', kid: 'test' }]),
  LOG_LEVEL: 'error',
});

const BASE = new URL('../src/', import.meta.url).href;
const { connectDatabase, disconnectDatabase } = await import(`${BASE}config/db.js`);
const { createProvider } = await import(`${BASE}oidc/provider.js`);
const { createApp: buildApp } = await import(`${BASE}app.js`);
const { registerUser } = await import(`${BASE}services/user.service.js`);
const User = (await import(`${BASE}models/User.js`)).default;

await connectDatabase();
const provider = await createProvider();
const server = createServer(buildApp(provider));
await new Promise((resolve) => server.listen(PORT, resolve));

const DEV = { email: 'dev@example.com', password: 'DeveloperPass1x', givenName: 'Dana', familyName: 'Dev' };
const TESTER = { email: 'tester@example.com', password: 'TesterPass1xy', givenName: 'Tess', familyName: 'Ter' };
const OUTSIDER = { email: 'outsider@example.com', password: 'OutsiderPass1x', givenName: 'Otto', familyName: 'Out' };
const ADMIN = { email: 'admin@example.com', password: 'AdminPass1xyz', givenName: 'Ada', familyName: 'Min' };

for (const person of [DEV, TESTER, OUTSIDER, ADMIN]) await registerUser(person);
await User.updateOne({ email: ADMIN.email }, { $addToSet: { roles: 'admin' } });

// ── a browser per person ─────────────────────────────────────────────────────
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

async function signIn(person) {
  const go = browser();
  await go(`${ORIGIN}/api/auth/login`, { method: 'POST', body: JSON.stringify({ email: person.email, password: person.password }) });
  return go;
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const dev = await signIn(DEV);
const admin = await signIn(ADMIN);

// ── 1. the scope catalogue drives the console ────────────────────────────────
const catalogue = await (await dev(`${ORIGIN}/api/console/scopes`)).json();
check('scope catalogue is served', catalogue.scopes?.some((s) => s.id === 'email'),
  JSON.stringify(catalogue.scopes?.map((s) => s.id)));

// ── 2. registering an app ────────────────────────────────────────────────────
const created = await (await dev(`${ORIGIN}/api/console/apps`, {
  method: 'POST',
  body: JSON.stringify({
    clientName: 'Weather Widget',
    description: 'Shows the weather.',
    redirectUris: [APP_CALLBACK],
    allowedScopes: ['profile', 'email'],
    appUrl: 'https://devapp.example.com',
    policyUri: 'https://devapp.example.com/privacy',
    supportEmail: 'support@devapp.example.com',
  }),
})).json();

const app = created.app;
check('app registered', Boolean(app?.clientId), JSON.stringify(created).slice(0, 160));
check('client secret returned exactly once', typeof created.clientSecret === 'string' && created.clientSecret.length > 20);
check('openid is added automatically', app?.allowedScopes?.includes('openid'), JSON.stringify(app?.allowedScopes));
check('a new app starts in testing', app?.publishingStatus === 'testing', app?.publishingStatus);
check('a new app is never first-party', app?.isFirstParty === false);
check('the console hands over the endpoints to wire up', app?.endpoints?.discovery?.endsWith('/.well-known/openid-configuration'));

const CLIENT_ID = app.clientId;
const CLIENT_SECRET = created.clientSecret;

// ── 3. redirect URI validation ───────────────────────────────────────────────
for (const [uri, why] of [
  ['http://devapp.example.com/cb', 'plaintext http off localhost'],
  ['https://devapp.example.com/cb#frag', 'a fragment'],
  ['https://*.example.com/cb', 'a wildcard'],
  ['not-a-url', 'a relative value'],
]) {
  const response = await dev(`${ORIGIN}/api/console/apps`, {
    method: 'POST',
    body: JSON.stringify({ clientName: 'Bad App', redirectUris: [uri] }),
  });
  check(`redirect URI with ${why} is rejected`, response.status === 400, `HTTP ${response.status}`);
}
const loopback = await dev(`${ORIGIN}/api/console/apps`, {
  method: 'POST',
  body: JSON.stringify({ clientName: 'Local Dev App', redirectUris: ['http://localhost:8080/cb'] }),
});
check('plaintext http IS allowed on localhost', loopback.status === 201, `HTTP ${loopback.status}`);

// ── 4. a developer cannot promote their own app ──────────────────────────────
const escalate = await (await dev(`${ORIGIN}/api/console/apps/${CLIENT_ID}`, {
  method: 'PATCH',
  body: JSON.stringify({ isFirstParty: true, publishingStatus: 'published', status: 'active' }),
})).json();
check('a developer cannot make their own app first-party', escalate.app?.isFirstParty === false);
check('a developer cannot publish their own app', escalate.app?.publishingStatus === 'testing', escalate.app?.publishingStatus);

const adminOnly = await dev(`${ORIGIN}/api/admin/apps`);
check('the admin surface is closed to developers', adminOnly.status === 403, `HTTP ${adminOnly.status}`);

// ── 5. another developer cannot see or touch the app ─────────────────────────
const outsider = await signIn(OUTSIDER);
const peek = await outsider(`${ORIGIN}/api/console/apps/${CLIENT_ID}`);
check("another developer cannot read someone else's app", peek.status === 404, `HTTP ${peek.status}`);
const theirApps = await (await outsider(`${ORIGIN}/api/console/apps`)).json();
check('the console lists only your own apps', theirApps.apps?.length === 0, String(theirApps.apps?.length));

// ── 6. a real authorization request against the registered app ───────────────
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

/**
 * Drives an authorization request as far as it will go.
 *
 * The Texor session cookie authenticates the account UI, but the provider keeps
 * its own session — so a first authorization request raises a login prompt even
 * for someone already signed in. That prompt is resolved from the existing
 * session (the silent path every product relies on), and whatever comes next is
 * handed back to the caller.
 */
const reachPrompt = async (go, state) => {
  const authUrl = `${ORIGIN}/oidc/auth?${new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: APP_CALLBACK,
    response_type: 'code',
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })}`;

  let location = (await go(authUrl)).headers.get('location');

  for (let hop = 0; hop < 5; hop += 1) {
    if (!location?.includes('/interaction/')) return { location, uid: null, details: null };

    const uid = location.split('/interaction/')[1];
    const details = await (await go(`${ORIGIN}/api/interaction/${uid}`)).json();

    if (details.prompt?.name === 'login') {
      const resumed = await (await go(`${ORIGIN}/api/interaction/${uid}/login`, {
        method: 'POST',
        body: JSON.stringify({ useExistingSession: true }),
      })).json();
      location = (await go(resumed.redirectTo)).headers.get('location');
      continue;
    }

    return { location, uid, details };
  }

  return { location, uid: null, details: null };
};

// The owner is implicitly a test account.
let { uid, details } = await reachPrompt(dev, 'owner-state');
check('the owner reaches the consent screen while in testing',
  Boolean(uid) && details?.prompt?.name === 'consent', details?.prompt?.name ?? 'no interaction');
check('the consent screen carries the developer branding',
  details.client?.name === 'Weather Widget' && details.client?.appUrl === 'https://devapp.example.com',
  JSON.stringify(details.client).slice(0, 140));
check('an unreviewed app is marked unverified', details.client?.verified === false, String(details.client?.verified));
check('scopes are explained in plain words',
  details.scopeDetails?.some((s) => s.id === 'email' && s.title.length > 5),
  JSON.stringify(details.scopeDetails?.map((s) => s.id)));

const confirmed = await (await dev(`${ORIGIN}/api/interaction/${uid}/confirm`, { method: 'POST', body: JSON.stringify({}) })).json();
const back = await dev(confirmed.redirectTo);
const callback = back.headers.get('location');
check('consent produces an authorization code', callback?.startsWith(`${APP_CALLBACK}?code=`), callback?.slice(0, 60));

const code = new URL(callback).searchParams.get('code');
const tokens = await (await fetch(`${ORIGIN}/oidc/token`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
  },
  body: new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: APP_CALLBACK, code_verifier: verifier,
  }),
})).json();
const claims = tokens.id_token ? JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url')) : {};
check('the registered app exchanges the code for tokens', claims.email === DEV.email,
  JSON.stringify(tokens.error ?? claims).slice(0, 140));

// ── 7. a stranger cannot use an app that is still in testing ─────────────────
const stranger = await signIn(OUTSIDER);
const blocked = await reachPrompt(stranger, 'stranger-state');
check('an app in testing blocks an account that is not a tester',
  blocked.details?.prompt?.reasons?.includes('app_not_available'),
  JSON.stringify(blocked.details?.prompt?.reasons));

// ── 8. adding them as a test account lets them through ───────────────────────
const withTester = await (await dev(`${ORIGIN}/api/console/apps/${CLIENT_ID}/test-accounts`, {
  method: 'PUT',
  body: JSON.stringify({ emails: [OUTSIDER.email, 'nobody@example.com'] }),
})).json();
check('test accounts are resolved from email addresses', withTester.testAccountEmails?.includes(OUTSIDER.email),
  JSON.stringify(withTester.testAccountEmails));
check('an address with no Texor Account is reported back', withTester.unknown?.includes('nobody@example.com'),
  JSON.stringify(withTester.unknown));

const stranger2 = await signIn(OUTSIDER);
const nowAllowed = await reachPrompt(stranger2, 'tester-state');
check('a listed test account now reaches consent',
  nowAllowed.details?.prompt?.name === 'consent'
    && !nowAllowed.details.prompt.reasons.includes('app_not_available'),
  JSON.stringify(nowAllowed.details?.prompt?.reasons));

// ── 9. review and publish ────────────────────────────────────────────────────
const reviewed = await (await dev(`${ORIGIN}/api/console/apps/${CLIENT_ID}/submit-review`, { method: 'POST' })).json();
check('an app can be submitted for review', reviewed.app?.publishingStatus === 'in_review', reviewed.app?.publishingStatus);

const queue = await (await admin(`${ORIGIN}/api/admin/apps?status=in_review`)).json();
check('the app appears in the admin review queue with its owner',
  queue.apps?.some((entry) => entry.clientId === CLIENT_ID && entry.owner === DEV.email),
  JSON.stringify(queue.apps?.map((a) => [a.clientId, a.owner])));

const published = await (await admin(`${ORIGIN}/api/admin/apps/${CLIENT_ID}/publish`, {
  method: 'POST', body: JSON.stringify({ notes: 'Looks fine.' }),
})).json();
check('an administrator can publish it', published.app?.publishingStatus === 'published', published.app?.publishingStatus);

const anyone = await signIn(TESTER);
const anyoneAttempt = await reachPrompt(anyone, 'anyone-state');
check('once published, any account can use it',
  anyoneAttempt.details?.prompt?.name === 'consent'
    && !anyoneAttempt.details.prompt.reasons.includes('app_not_available'),
  JSON.stringify(anyoneAttempt.details?.prompt?.reasons));
check('a published app is shown as verified', anyoneAttempt.details?.client?.verified === true);

// ── 10. secret rotation invalidates the old secret ───────────────────────────
const rotated = await (await dev(`${ORIGIN}/api/console/apps/${CLIENT_ID}/rotate-secret`, { method: 'POST' })).json();
check('rotating returns a new secret', rotated.clientSecret && rotated.clientSecret !== CLIENT_SECRET);

const withOldSecret = await fetch(`${ORIGIN}/oidc/token`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
  },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'whatever' }),
});
const oldSecretBody = await withOldSecret.json();
check('the old secret no longer authenticates', oldSecretBody.error === 'invalid_client', JSON.stringify(oldSecretBody.error));

// ── 11. deletion ─────────────────────────────────────────────────────────────
const removed = await dev(`${ORIGIN}/api/console/apps/${CLIENT_ID}`, { method: 'DELETE' });
check('an app can be deleted by its owner', removed.status === 200, `HTTP ${removed.status}`);
const gone = await dev(`${ORIGIN}/oidc/auth?${new URLSearchParams({
  client_id: CLIENT_ID, redirect_uri: APP_CALLBACK, response_type: 'code', scope: 'openid',
  state: 'gone', code_challenge: challenge, code_challenge_method: 'S256',
})}`);
check('a deleted app can no longer authorize',
  gone.headers.get('location')?.includes('invalid_client') || gone.status >= 400,
  gone.headers.get('location')?.slice(0, 70) ?? `HTTP ${gone.status}`);

// ── summary ──────────────────────────────────────────────────────────────────
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);

server.close();
await disconnectDatabase();
await mongod.stop();
process.exit(failed ? 1 : 0);
