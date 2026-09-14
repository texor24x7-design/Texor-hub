/**
 * Texor SSO client — the relying-party half of "sign in with Texor".
 *
 * This file is deliberately self-contained and identical across every product
 * repo. It will be extracted to a published `@texor/auth-sdk` package once the
 * shape settles; until then, a change here should be copied to the other
 * products rather than forked.
 *
 * It implements the authorization-code flow with PKCE against
 * accounts.texor.app, and verifies the returned ID token against the provider's
 * published JWKS — the product never sees, stores or transmits a password.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const base64url = (buffer) => buffer.toString('base64url');
const sha256 = (value) => createHash('sha256').update(value).digest();

export class TexorAuthError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message);
    this.name = 'TexorAuthError';
    this.code = code;
    this.cause = cause;
  }
}

export class TexorClient {
  /**
   * @param {object} options
   * @param {string} options.issuer        e.g. https://accounts.texor.app/oidc
   * @param {string} options.clientId
   * @param {string} options.clientSecret
   * @param {string} options.redirectUri   this product's /api/auth/callback
   * @param {string} [options.postLogoutRedirectUri]
   * @param {string} [options.scope]
   * @param {string} [options.resource]    this product's API audience
   */
  constructor(options) {
    this.issuer = options.issuer.replace(/\/$/, '');
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    this.postLogoutRedirectUri = options.postLogoutRedirectUri;
    // `||`, not `??`: TEXOR_SCOPE is declared with a default and so always
    // arrives defined. A present-but-empty line in .env would otherwise be
    // taken as a deliberate empty scope and rejected by the provider.
    this.scope = options.scope || 'openid profile email';
    this.resource = options.resource;

    this.metadata = null;
    this.jwks = null;
    this.discovery = null;
  }

  /**
   * Fetches and caches the provider's discovery document. Concurrent callers
   * share one in-flight request rather than each firing their own.
   */
  async discover() {
    if (this.metadata) return this.metadata;

    this.discovery ??= (async () => {
      const url = `${this.issuer}/.well-known/openid-configuration`;
      let response;

      try {
        response = await fetch(url);
      } catch (cause) {
        this.discovery = null;
        throw new TexorAuthError(`Cannot reach Texor Account at ${url}`, { code: 'discovery_unreachable', cause });
      }

      if (!response.ok) {
        this.discovery = null;
        throw new TexorAuthError(`Texor discovery failed with HTTP ${response.status}`, { code: 'discovery_failed' });
      }

      const metadata = await response.json();
      this.metadata = metadata;
      this.jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
      return metadata;
    })();

    return this.discovery;
  }

  /**
   * Step 1 — where to send the browser.
   *
   * The returned `state`, `nonce` and `codeVerifier` must be stashed somewhere
   * only this browser can present back (see texor/transaction.js) and handed to
   * `exchangeCode` on the way back.
   */
  async createAuthorizationRequest({ prompt, loginHint, returnTo } = {}) {
    const metadata = await this.discover();

    const state = base64url(randomBytes(24));
    const nonce = base64url(randomBytes(24));
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(sha256(codeVerifier));

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: this.scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    // Asking for a resource makes the access token a JWT addressed to this
    // product's own API, so it cannot be replayed against a sibling product.
    if (this.resource) params.set('resource', this.resource);
    if (prompt) params.set('prompt', prompt);
    if (loginHint) params.set('login_hint', loginHint);

    return {
      url: `${metadata.authorization_endpoint}?${params}`,
      state,
      nonce,
      codeVerifier,
      returnTo,
    };
  }

  /**
   * Step 2 — turn the authorization code into tokens and a verified identity.
   */
  async exchangeCode({ code, state, expectedState, nonce, codeVerifier }) {
    if (!code) throw new TexorAuthError('Texor did not return an authorization code.', { code: 'missing_code' });
    if (!safeEqual(state, expectedState)) {
      throw new TexorAuthError('Sign-in could not be verified. Please try again.', { code: 'state_mismatch' });
    }

    const metadata = await this.discover();

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      code_verifier: codeVerifier,
    });
    if (this.resource) body.set('resource', this.resource);

    const tokens = await this.#tokenRequest(metadata.token_endpoint, body);
    const claims = await this.verifyIdToken(tokens.id_token, { nonce });

    return { tokens, claims };
  }

  /** Step 3 (later) — swap a refresh token for a new access token. */
  async refresh(refreshToken) {
    const metadata = await this.discover();

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (this.resource) body.set('resource', this.resource);

    return this.#tokenRequest(metadata.token_endpoint, body);
  }

  /**
   * Validates an ID token's signature, issuer, audience, expiry and nonce.
   * Everything the product believes about who the user is comes from here.
   */
  async verifyIdToken(idToken, { nonce } = {}) {
    if (!idToken) throw new TexorAuthError('Texor did not return an ID token.', { code: 'missing_id_token' });

    await this.discover();

    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        issuer: this.issuer,
        audience: this.clientId,
        clockTolerance: 30,
      }));
    } catch (cause) {
      throw new TexorAuthError('The identity token from Texor is not valid.', { code: 'invalid_id_token', cause });
    }

    if (nonce && payload.nonce !== nonce) {
      throw new TexorAuthError('Sign-in could not be verified. Please try again.', { code: 'nonce_mismatch' });
    }

    return payload;
  }

  /** Current profile straight from the provider, for a token without a resource. */
  async userinfo(accessToken) {
    const metadata = await this.discover();
    const response = await fetch(metadata.userinfo_endpoint, {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new TexorAuthError(`Texor userinfo failed with HTTP ${response.status}`, { code: 'userinfo_failed' });
    }

    return response.json();
  }

  /**
   * Where to send the browser to end the Texor session as well as this one.
   * Signing out of the product alone would leave the user silently signed in.
   */
  async endSessionUrl({ idToken, state } = {}) {
    const metadata = await this.discover();
    if (!metadata.end_session_endpoint) return this.postLogoutRedirectUri ?? '/';

    const params = new URLSearchParams({ client_id: this.clientId });
    if (idToken) params.set('id_token_hint', idToken);
    if (this.postLogoutRedirectUri) params.set('post_logout_redirect_uri', this.postLogoutRedirectUri);
    if (state) params.set('state', state);

    return `${metadata.end_session_endpoint}?${params}`;
  }

  async #tokenRequest(endpoint, body) {
    const credentials = Buffer
      .from(`${encodeURIComponent(this.clientId)}:${encodeURIComponent(this.clientSecret)}`)
      .toString('base64');

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${credentials}`,
        },
        body,
      });
    } catch (cause) {
      throw new TexorAuthError('Cannot reach the Texor token endpoint.', { code: 'token_unreachable', cause });
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new TexorAuthError(
        payload.error_description || payload.error || `Token request failed with HTTP ${response.status}`,
        { code: payload.error ?? 'token_failed' },
      );
    }

    return payload;
  }
}

/** Constant-time comparison that tolerates undefined without throwing. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export default TexorClient;
