/**
 * Token signing keys.
 *
 * Production keys come from OIDC_JWKS so that every instance behind the load
 * balancer signs with the same material and tokens survive a redeploy. In
 * development a key is generated at boot — convenient, but it means tokens
 * issued before a restart stop validating, which the warning below calls out.
 */
import { exportJWK, generateKeyPair } from 'jose';
import env from '../config/env.js';
import logger from '../utils/logger.js';

let cached = null;

export async function loadJwks() {
  if (cached) return cached;

  if (env.jwks) {
    cached = env.jwks;
    return cached;
  }

  logger.warn(
    'OIDC_JWKS is not set — generating an ephemeral development signing key. '
    + 'Tokens will stop validating on restart. Run `npm run keys:generate` and set OIDC_JWKS.',
  );

  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  cached = [{ ...jwk, use: 'sig', alg: 'RS256', kid: 'dev-rs256' }];
  return cached;
}

export default loadJwks;
