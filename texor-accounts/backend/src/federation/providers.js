/**
 * Upstream identity providers Texor Account can federate to.
 *
 * Texor is both sides of an OIDC relationship: a *provider* to finvoice, talk
 * and payroll, and a *client* of Google, Microsoft and LinkedIn. This file
 * describes the client half.
 *
 * A provider is only offered to users if its credentials are configured, so a
 * deployment can enable Google alone without any code change.
 */
import env from '../config/env.js';

/** Microsoft's multi-tenant issuers embed the caller's tenant GUID. */
const MICROSOFT_TENANT_ISSUER = /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/i;

const DEFINITIONS = {
  google: {
    id: 'google',
    displayName: 'Google',
    issuer: 'https://accounts.google.com',
    scope: 'openid profile email',
    usePkce: true,
    // Without this, a user with several Google accounts is silently signed in
    // as whichever one their browser happens to be holding.
    authorizationParams: { prompt: 'select_account' },
  },

  microsoft: {
    id: 'microsoft',
    displayName: 'Microsoft',
    // `common` accepts both work/school and personal accounts.
    // `MICROSOFT_TENANT` is declared with a default, but a present-but-empty
    // line in .env still arrives as '' — hence the fallback here as well.
    issuer: () => `https://login.microsoftonline.com/${env.MICROSOFT_TENANT || 'common'}/v2.0`,
    scope: 'openid profile email',
    usePkce: true,
    authorizationParams: { prompt: 'select_account' },
    /**
     * The multi-tenant discovery document advertises a literal
     * `https://login.microsoftonline.com/{tenantid}/v2.0` placeholder, while
     * real tokens carry the signing tenant's GUID. Exact-matching the issuer
     * therefore rejects every valid token, so the check is a pattern instead.
     */
    validateIssuer(iss, configuredIssuer) {
      if (iss === configuredIssuer) return true;
      const multiTenant = ['common', 'organizations', 'consumers'].includes(env.MICROSOFT_TENANT || 'common');
      return multiTenant && MICROSOFT_TENANT_ISSUER.test(iss);
    },
  },

  linkedin: {
    id: 'linkedin',
    displayName: 'LinkedIn',
    issuer: 'https://www.linkedin.com/oauth',
    scope: 'openid profile email',
    // LinkedIn's OIDC implementation does not document PKCE support and is
    // strict about unexpected parameters, so the flow relies on `state` and
    // `nonce` alone. Both are still required and checked.
    usePkce: false,
  },

  zoho: {
    id: 'zoho',
    displayName: 'Zoho',
    // Zoho keeps an account in exactly one data centre, and each publishes its
    // own discovery document and signing keys. Pointing at the wrong one fails
    // at token verification rather than at sign-in, so the region is explicit.
    issuer: () => `https://accounts.zoho.${env.ZOHO_REGION}`,
    scope: 'openid profile email',
    usePkce: true,
  },
};

/** Credentials, read once at boot. A provider without both is simply not offered. */
const CREDENTIALS = {
  google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, issuerOverride: env.GOOGLE_ISSUER },
  microsoft: { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, issuerOverride: env.MICROSOFT_ISSUER },
  linkedin: { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET, issuerOverride: env.LINKEDIN_ISSUER },
  zoho: { clientId: env.ZOHO_CLIENT_ID, clientSecret: env.ZOHO_CLIENT_SECRET, issuerOverride: env.ZOHO_ISSUER },
};

/**
 * Picks the issuer for a provider: the override when one is genuinely set,
 * otherwise the provider's own.
 *
 * Note the `||` rather than `??`. The override env vars are declared with
 * `.default('')`, so they are always defined — an unset GOOGLE_ISSUER arrives
 * as an empty string, not undefined. `??` would treat that empty string as a
 * deliberate value and leave every provider with no issuer at all.
 *
 * Exported so this can be asserted directly; the failure it guards against is
 * invisible to any test that sets an override.
 */
export function resolveIssuer(definition, issuerOverride) {
  const issuer = issuerOverride
    || (typeof definition.issuer === 'function' ? definition.issuer() : definition.issuer);

  return typeof issuer === 'string' ? issuer.replace(/\/$/, '') : '';
}

function build(id) {
  const definition = DEFINITIONS[id];
  const credentials = CREDENTIALS[id];

  if (!credentials.clientId || !credentials.clientSecret) return null;

  const configuredIssuer = resolveIssuer(definition, credentials.issuerOverride);

  if (!configuredIssuer) {
    // Nothing usable can be done with a provider we cannot locate, and an
    // empty issuer would otherwise surface as a baffling relative-URL fetch.
    throw new Error(
      `Provider "${id}" has credentials but no issuer URL. Set ${id.toUpperCase()}_ISSUER, `
      + 'or remove the override so the built-in default is used.',
    );
  }

  return {
    ...definition,
    issuer: configuredIssuer,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    redirectUri: `${env.ISSUER_ORIGIN.replace(/\/$/, '')}/api/auth/federated/${id}/callback`,
  };
}

const configured = new Map(
  Object.keys(DEFINITIONS)
    .map((id) => [id, build(id)])
    .filter(([, provider]) => provider !== null),
);

/** Every provider this deployment can actually use. */
export const enabledProviders = () => [...configured.values()];

export const getProvider = (id) => configured.get(id) ?? null;

/** Safe to hand to an unauthenticated browser — no secrets. */
export const publicProviders = () =>
  enabledProviders().map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    startUrl: `/api/auth/federated/${provider.id}/start`,
  }));

export const PROVIDER_IDS = Object.keys(DEFINITIONS);
