/**
 * A generic OpenID Connect relying party, used to sign in *through* an upstream
 * provider.
 *
 * Google, Microsoft and LinkedIn all publish an OIDC discovery document, so one
 * implementation serves all three; the per-provider quirks live in
 * federation/providers.js rather than here.
 *
 * Nothing in this file trusts anything that is not either (a) signed by the
 * upstream's published keys, or (b) echoed back from a value we generated.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

const base64url = (buffer) => buffer.toString('base64url');
const sha256 = (value) => createHash('sha256').update(value).digest();

// Discovery documents and JWKS are cached per provider for the process
// lifetime; both are stable and fetched on a user-facing path.
const cache = new Map();

async function discover(provider) {
  const cached = cache.get(provider.id);
  if (cached?.metadata) return cached;

  const url = `${provider.issuer}/.well-known/openid-configuration`;

  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    logger.error('federation discovery unreachable', { provider: provider.id, url, message: cause.message });
    throw ApiError.badRequest(`Cannot reach ${provider.displayName} right now. Try again in a moment.`);
  }

  if (!response.ok) {
    logger.error('federation discovery failed', { provider: provider.id, url, status: response.status });
    throw ApiError.badRequest(`${provider.displayName} sign-in is temporarily unavailable.`);
  }

  const metadata = await response.json();
  const entry = { metadata, jwks: createRemoteJWKSet(new URL(metadata.jwks_uri)) };
  cache.set(provider.id, entry);

  return entry;
}

/**
 * Step 1 — build the URL to send the browser to.
 *
 * Returns the secrets that must come back with the user: `state` proves the
 * callback belongs to this request, `nonce` binds the ID token to it, and the
 * PKCE verifier proves the code was redeemed by whoever started the flow.
 */
export async function createAuthorizationRequest(provider) {
  const { metadata } = await discover(provider);

  const state = base64url(randomBytes(24));
  const nonce = base64url(randomBytes(24));
  const codeVerifier = provider.usePkce ? base64url(randomBytes(32)) : null;

  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: provider.redirectUri,
    response_type: 'code',
    scope: provider.scope,
    state,
    nonce,
    ...(provider.authorizationParams ?? {}),
  });

  if (codeVerifier) {
    params.set('code_challenge', base64url(sha256(codeVerifier)));
    params.set('code_challenge_method', 'S256');
  }

  return {
    url: `${metadata.authorization_endpoint}?${params}`,
    state,
    nonce,
    codeVerifier,
  };
}

/**
 * Step 2 — redeem the code and return verified claims about the user.
 */
export async function exchangeCode(provider, { code, state, expectedState, nonce, codeVerifier }) {
  if (!safeEqual(state, expectedState)) {
    throw ApiError.badRequest('That sign-in could not be verified. Please try again.');
  }

  const { metadata, jwks } = await discover(provider);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: provider.redirectUri,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
  });
  if (codeVerifier) body.set('code_verifier', codeVerifier);

  let response;
  try {
    response = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
  } catch (cause) {
    logger.error('federation token request unreachable', { provider: provider.id, message: cause.message });
    throw ApiError.badRequest(`Cannot reach ${provider.displayName} right now. Try again in a moment.`);
  }

  const tokens = await response.json().catch(() => ({}));

  if (!response.ok) {
    // The upstream's own error text is useful in logs but should not be shown
    // to the user, who can do nothing about `invalid_client`.
    logger.error('federation token request rejected', {
      provider: provider.id,
      status: response.status,
      error: tokens.error,
      description: tokens.error_description,
    });
    throw ApiError.badRequest(`${provider.displayName} rejected the sign-in. Please try again.`);
  }

  const claims = await verifyIdToken(provider, tokens.id_token, { jwks, nonce });
  const profile = await enrich(provider, metadata, tokens, claims);

  return { tokens, claims: profile };
}

async function verifyIdToken(provider, idToken, { jwks, nonce }) {
  if (!idToken) {
    throw ApiError.badRequest(`${provider.displayName} did not return an identity token.`);
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, jwks, {
      audience: provider.clientId,
      clockTolerance: 60,
      // Issuer is checked below, because Microsoft's multi-tenant issuer is a
      // pattern rather than a fixed string.
    }));
  } catch (cause) {
    logger.warn('federation id_token verification failed', { provider: provider.id, message: cause.message });
    throw ApiError.badRequest(`The identity token from ${provider.displayName} is not valid.`);
  }

  const issuerOk = provider.validateIssuer
    ? provider.validateIssuer(payload.iss, provider.issuer)
    : payload.iss === provider.issuer;

  if (!issuerOk) {
    logger.warn('federation issuer mismatch', { provider: provider.id, iss: payload.iss, expected: provider.issuer });
    throw ApiError.badRequest(`The identity token from ${provider.displayName} is not valid.`);
  }

  if (payload.nonce !== nonce) {
    throw ApiError.badRequest('That sign-in could not be verified. Please try again.');
  }

  return payload;
}

/**
 * Some providers put very little in the ID token. If anything we need is
 * missing, fall back to the userinfo endpoint — but only to *fill gaps*, never
 * to override a signed claim.
 */
async function enrich(provider, metadata, tokens, claims) {
  const needsMore = !claims.email || !claims.name;
  if (!needsMore || !metadata.userinfo_endpoint || !tokens.access_token) return claims;

  try {
    const response = await fetch(metadata.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' },
    });
    if (!response.ok) return claims;

    const userinfo = await response.json();

    // A userinfo response is only about the subject the ID token named.
    if (userinfo.sub && userinfo.sub !== claims.sub) return claims;

    return { ...userinfo, ...claims, email: claims.email ?? userinfo.email };
  } catch {
    // Enrichment is best-effort; the ID token alone is enough to sign in.
    return claims;
  }
}

/**
 * Flattens an upstream's claims into the shape Texor stores.
 *
 * `emailVerified` is the important one: it decides whether this sign-in may be
 * matched against an existing Texor account by email. See federation.service.js.
 */
export function normalizeClaims(provider, claims) {
  const given = claims.given_name ?? '';
  const family = claims.family_name ?? '';
  const name = claims.name ?? [given, family].filter(Boolean).join(' ').trim();

  /**
   * Some providers send only a full `name` with no given/family breakdown. The
   * whole string goes into the given-name field rather than being split on a
   * space: guessing where a name divides is wrong for a great many people, and
   * a name that renders exactly as its owner wrote it beats a tidy-looking
   * mangling of it.
   */
  const hasParts = Boolean(given || family);

  return {
    provider: provider.id,
    subject: String(claims.sub),
    email: typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null,
    // Absent means "not asserted", which is treated as unverified.
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name,
    givenName: hasParts ? given : name,
    familyName: family,
    picture: typeof claims.picture === 'string' ? claims.picture : '',
    locale: typeof claims.locale === 'string' ? claims.locale : undefined,
  };
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
