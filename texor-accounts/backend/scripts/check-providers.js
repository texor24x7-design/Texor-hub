/**
 * Checks the Google / Microsoft / LinkedIn sign-in wiring.
 *
 *   npm run check:providers
 *
 * Reports which providers this deployment offers, confirms each one's discovery
 * document is reachable, and prints the exact redirect URI to register in its
 * console — which is the single most common thing to get wrong.
 *
 * It deliberately does not attempt a token exchange: that needs a real user at
 * a real consent screen. A green result here means "configured and reachable",
 * not "a sign-in will succeed".
 */
import env from '../src/config/env.js';
import { PROVIDER_IDS, enabledProviders, getProvider } from '../src/federation/providers.js';

const ok = (label, detail = '') => console.log(`  ok    ${label}${detail ? `  ${detail}` : ''}`);
const bad = (label, detail = '') => console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`);
const off = (label, detail = '') => console.log(`  --    ${label}${detail ? `  ${detail}` : ''}`);

const configured = enabledProviders();
const missing = PROVIDER_IDS.filter((id) => !getProvider(id));

console.log(`\nSocial sign-in providers  (${env.NODE_ENV})\n`);

if (configured.length === 0) {
  console.log('  No providers are configured, so no buttons appear on the sign-in screen.\n');
  console.log('  Set a client id and secret pair in .env to enable one:\n');
  console.log('    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET');
  console.log('    MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET');
  console.log('    LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET\n');
  console.log('  See documentation/social-sign-in.md for the console steps.\n');
}

let failures = 0;

for (const provider of configured) {
  console.log(`  ${provider.displayName}`);

  const discoveryUrl = `${provider.issuer}/.well-known/openid-configuration`;

  try {
    const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(10_000) });

    if (!response.ok) {
      failures += 1;
      bad('discovery', `HTTP ${response.status} from ${discoveryUrl}`);
    } else {
      const metadata = await response.json();
      ok('discovery', discoveryUrl);
      ok('authorization endpoint', metadata.authorization_endpoint);

      // A provider that cannot sign tokens we can verify is unusable.
      if (!metadata.jwks_uri) {
        failures += 1;
        bad('jwks_uri missing from the discovery document');
      }

      const supportsS256 = metadata.code_challenge_methods_supported?.includes('S256');
      if (provider.usePkce && supportsS256 === false) {
        // Not fatal — the connector may still work — but worth knowing.
        off('PKCE', 'the provider does not advertise S256; set usePkce: false if sign-in fails');
      }
    }
  } catch (error) {
    failures += 1;
    bad('discovery unreachable', `${discoveryUrl} — ${error.message}`);
  }

  // The thing people actually get wrong.
  console.log(`        register this redirect URI:  ${provider.redirectUri}`);
  console.log('');
}

for (const id of missing) {
  off(`${id} not configured`, `set ${id.toUpperCase()}_CLIENT_ID and ${id.toUpperCase()}_CLIENT_SECRET`);
}

console.log('');
process.exit(failures ? 1 : 0);
