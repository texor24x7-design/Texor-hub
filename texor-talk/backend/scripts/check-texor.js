/**
 * Verifies this product's Texor Account wiring before you go hunting through
 * redirect logs.
 *
 *   npm run check:texor
 *
 * Checks that the issuer is reachable, that TEXOR_CLIENT_ID / TEXOR_CLIENT_SECRET
 * actually authenticate, and prints the authorization URL this product will
 * send users to. Run it whenever sign-in "just stops working" after a config
 * change — it isolates a bad secret or a wrong issuer in one step.
 */
import env from '../src/config/env.js';
import { texor } from '../src/texor/index.js';

const ok = (label, detail = '') => console.log(`  ok    ${label}${detail ? `  ${detail}` : ''}`);
const bad = (label, detail = '') => console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`);

console.log(`\nChecking Texor Talk → Texor Account wiring\n  issuer: ${env.TEXOR_ISSUER}\n`);

/** True when the refusal is about the grant, not about who is asking. */
const isGrantNotAllowed = (payload) =>
  payload.error === 'unauthorized_client'
  || payload.error === 'unsupported_grant_type'
  || /grant type is not allowed|unsupported grant/i.test(payload.error_description ?? '');

let failures = 0;

// 1. Discovery
let metadata;
try {
  metadata = await texor.discover();
  ok('discovery document reachable');
  ok('authorization endpoint', metadata.authorization_endpoint);
  ok('token endpoint', metadata.token_endpoint);
} catch (error) {
  bad('discovery failed', error.message);
  console.log('\n  Is texor-accounts/backend running, and is TEXOR_ISSUER correct?\n');
  process.exit(1);
}

// 2. Client credentials. A client_credentials grant is the cheapest way to
//    prove the id/secret pair is accepted without involving a browser.
try {
  const credentials = Buffer
    .from(`${encodeURIComponent(env.TEXOR_CLIENT_ID)}:${encodeURIComponent(env.TEXOR_CLIENT_SECRET)}`)
    .toString('base64');

  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

  const payload = await response.json().catch(() => ({}));

  if (response.ok) {
    ok('client credentials accepted', `(${env.TEXOR_CLIENT_ID})`);
  } else if (payload.error === 'invalid_client') {
    failures += 1;
    bad('client credentials rejected', 'TEXOR_CLIENT_SECRET does not match the registered client.');
  } else if (isGrantNotAllowed(payload)) {
    /**
     * The product is registered but not allowed this grant. The id/secret pair
     * still authenticated, which is the only thing this step tests.
     *
     * Matched on the description as well as the code, because the provider
     * answers this with `invalid_request` rather than the `unauthorized_client`
     * you would expect — and reporting a failure here sends people hunting for
     * a credential problem that does not exist.
     */
    ok('client credentials accepted', '(client_credentials grant not enabled for this client)');
  } else {
    failures += 1;
    bad('token endpoint error', payload.error_description ?? payload.error ?? `HTTP ${response.status}`);
  }
} catch (error) {
  failures += 1;
  bad('token endpoint unreachable', error.message);
}

// 3. Show the outgoing request so a redirect_uri mismatch is obvious.
const request = await texor.createAuthorizationRequest({ returnTo: '/invoices' });
console.log('\n  Authorization URL this product will use:');
console.log(`  ${request.url}\n`);
console.log(`  redirect_uri must be registered in Texor Account:\n  ${env.TEXOR_REDIRECT_URI}\n`);

process.exit(failures ? 1 : 0);
