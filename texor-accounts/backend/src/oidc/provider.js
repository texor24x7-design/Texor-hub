/**
 * The Texor identity provider.
 *
 * This is the piece that makes one Texor Account work across every product.
 * Products never see a password — they run a standard OpenID Connect
 * authorization-code flow against this issuer and receive tokens describing the
 * signed-in user.
 *
 * Two decisions here are worth knowing about:
 *
 *  1. Clients are dynamic. `clients` is left empty so that oidc-provider falls
 *     through to the adapter, which reads the `clients` collection. Registering
 *     a new product is a database write, not a redeploy.
 *
 *  2. First-party products skip consent. `loadExistingGrant` auto-grants the
 *     requested scopes for clients flagged `first_party`, which is why moving
 *     between finvoice and payroll feels seamless. Third-party integrations
 *     added later omit the flag and get the normal consent screen.
 */
import Provider, { errors as oidcErrors, interactionPolicy } from 'oidc-provider';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { createAdapter } from './adapter.js';
import { loadJwks } from './keys.js';
import { findAccount } from './account.js';

const DAY = 24 * 60 * 60;

const cookieBase = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProduction,
  domain: env.cookieDomain,
};

export async function createProvider() {
  const keys = await loadJwks();

  const configuration = {
    adapter: createAdapter,
    jwks: { keys },
    findAccount,

    // Intentionally empty — see note (1) above.
    clients: [],

    clientDefaults: {
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
      id_token_signed_response_alg: 'RS256',
    },

    // Lets a Client document carry `first_party` and `resource_indicator`
    // through to the provider. Note that unlike standard metadata, extra
    // properties are NOT camelCased onto the Client instance — they are read
    // back below exactly as spelled here.
    extraClientMetadata: {
      properties: ['first_party', 'resource_indicator', 'publishing_status', 'test_accounts'],
      validator() {
        // Values originate from our own admin API, which validates them.
      },
    },

    scopes: ['openid', 'profile', 'email', 'phone', 'offline_access'],

    claims: {
      openid: ['sub'],
      profile: ['name', 'given_name', 'family_name', 'picture', 'locale', 'zoneinfo', 'updated_at'],
      email: ['email', 'email_verified'],
      phone: ['phone_number', 'phone_number_verified'],
    },

    // First-party products read identity straight from the ID token instead of
    // making a second call to /userinfo on every request.
    conformIdTokenClaims: false,

    pkce: {
      required: () => true,
    },

    rotateRefreshToken: true,

    /**
     * oidc-provider follows the OIDC spec and silently drops `offline_access`
     * unless the request carries `prompt=consent` — which would force a consent
     * screen on every sign-in and defeat the seamless hand-off between Texor
     * products. First-party products are trusted with a refresh token without
     * that dance; third-party ones still have to ask for offline_access the
     * standard way.
     *
     * Refresh tokens remain bound to the Texor session (oidc-provider's default
     * `expiresWithSession`), so signing out of the account still ends them.
     */
    async issueRefreshToken(_ctx, client, code) {
      if (!client.grantTypeAllowed('refresh_token')) return false;
      return Boolean(client.first_party) || code.scopes.has('offline_access');
    },

    ttl: {
      AccessToken: 60 * 60,
      AuthorizationCode: 10 * 60,
      ClientCredentials: 10 * 60,
      Grant: 30 * DAY,
      IdToken: 60 * 60,
      Interaction: 60 * 60,
      RefreshToken: 30 * DAY,
      Session: 30 * DAY,
    },

    cookies: {
      keys: env.cookieKeys,
      names: {
        session: '_texor_oidc',
        interaction: '_texor_interaction',
        resume: '_texor_resume',
      },
      long: { ...cookieBase, path: '/' },
      // oidc-provider would otherwise scope the interaction cookie to the exact
      // interaction URL. The account UI reads interaction details through
      // /api/interaction/:uid, so the cookie has to be readable site-wide.
      short: { ...cookieBase, path: '/' },
    },

    // Hand the browser to the Next.js account UI; it fetches the interaction
    // details from our API and renders the right step.
    interactions: {
      url(_ctx, interaction) {
        return `${env.accountsWebOrigin}/interaction/${interaction.uid}`;
      },
      policy: buildInteractionPolicy(),
    },

    features: {
      devInteractions: { enabled: false },
      revocation: { enabled: true },
      introspection: { enabled: true },
      userinfo: { enabled: true },
      clientCredentials: { enabled: true },

      rpInitiatedLogout: {
        enabled: true,
        logoutSource,
        postLogoutSuccessSource,
      },

      // Gives each product's API its own JWT audience, so a token minted for
      // finvoice cannot be replayed against payroll.
      resourceIndicators: {
        enabled: true,
        // Deliberately no `defaultResource`. If every token were minted for a
        // product's API audience, none of them would be accepted at /userinfo.
        // Products that want an API-scoped token ask for it explicitly with
        // `resource=https://api.<product>.texor.app` on the authorization
        // request; everything else gets a token good against the account API.
        // Left at the default (opt-out). A token only becomes audience-bound
        // when the authorization request asked for a resource, which keeps the
        // two token shapes predictable rather than context-dependent.
        getResourceServerInfo(_ctx, resourceIndicator, client) {
          if (client.resource_indicator && client.resource_indicator !== resourceIndicator) {
            throw new oidcErrors.InvalidTarget();
          }
          return {
            audience: resourceIndicator,
            scope: client.scope || 'openid profile email',
            accessTokenTTL: 60 * 60,
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'RS256' } },
          };
        },
      },
    },

    /**
     * Consent policy. Returning a Grant here means "already approved"; returning
     * undefined sends the user to the consent prompt.
     */
    async loadExistingGrant(ctx) {
      const grantId = ctx.oidc.result?.consent?.grantId
        ?? ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId);

      if (grantId) {
        const grant = await ctx.oidc.provider.Grant.find(grantId);
        if (grant) {
          // Keep long-lived grants from being reaped mid-session.
          if (grant.exp < ctx.oidc.session.exp) {
            grant.exp = ctx.oidc.session.exp;
            await grant.save();
          }
          return grant;
        }
      }

      if (!ctx.oidc.client.first_party || !ctx.oidc.session.accountId) return undefined;

      const grant = new ctx.oidc.provider.Grant({
        clientId: ctx.oidc.client.clientId,
        accountId: ctx.oidc.session.accountId,
      });
      grant.addOIDCScope(ctx.oidc.params.scope);
      if (ctx.oidc.client.resource_indicator) {
        grant.addResourceScope(ctx.oidc.client.resource_indicator, ctx.oidc.params.scope);
      }
      await grant.save();
      return grant;
    },

    renderError(ctx, out, error) {
      logger.warn('oidc error', { ...out, message: error?.message });
      const params = new URLSearchParams({
        error: out.error ?? 'server_error',
        error_description: out.error_description ?? '',
      });
      ctx.status = 303;
      ctx.redirect(`${env.accountsWebOrigin}/error?${params.toString()}`);
    },
  };

  const provider = new Provider(env.issuer, configuration);

  // Behind a load balancer or tunnel, honour X-Forwarded-Proto/For so the
  // provider builds https URLs and sees real client addresses.
  provider.proxy = true;

  provider.on('server_error', (_ctx, error) => logger.error('oidc server_error', error));
  provider.on('grant.error', (_ctx, error) => logger.warn('oidc grant.error', { message: error.message }));
  provider.on('authorization.error', (_ctx, error) => logger.warn('oidc authorization.error', { message: error.message }));

  return provider;
}

/**
 * Adds the app-availability gate to the standard interaction policy.
 *
 * An app in `testing` may only be used by its owner and the accounts that owner
 * listed. This is what stops somebody registering an app in the console and
 * immediately pointing it at the whole Texor user base — the console cannot
 * publish an app, only an administrator can.
 *
 * The check hangs off the consent prompt because it needs to know who is
 * signing in, which is only true once the login prompt has resolved. It is
 * placed first so that an unavailable app is reported ahead of any missing
 * consent, which would otherwise be the more confusing message.
 */
function buildInteractionPolicy() {
  const policy = interactionPolicy.base();

  const check = new interactionPolicy.Check(
    'app_not_available',
    'This app is still in testing and is not available to this account',
    'access_denied',
    (ctx) => {
      const { client, session } = ctx.oidc;

      // Texor's own products, and anything an administrator has published.
      if (client.first_party) return interactionPolicy.Check.NO_NEED_TO_PROMPT;
      if (client.publishing_status === 'published') return interactionPolicy.Check.NO_NEED_TO_PROMPT;

      // No account resolved yet — the login prompt runs first, and this check
      // is evaluated again once it has.
      if (!session.accountId) return interactionPolicy.Check.NO_NEED_TO_PROMPT;

      const testers = client.test_accounts ?? [];
      return testers.includes(session.accountId)
        ? interactionPolicy.Check.NO_NEED_TO_PROMPT
        : interactionPolicy.Check.REQUEST_PROMPT;
    },
  );

  // First, so it wins over `consent_required` when both would fire.
  policy.get('consent').checks.unshift(check);

  return policy;
}

/**
 * RP-initiated logout confirmation. First-party products in one ecosystem do not
 * need an interstitial, so this auto-submits the provider's own form (which
 * carries the XSRF token) while still rendering something if scripting is off.
 */
async function logoutSource(ctx, form) {
  ctx.type = 'html';
  ctx.body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Signing out of Texor</title>
<style>body{font:15px/1.5 system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#1a1a1a;background:#fafafa}button{font:inherit;padding:.6rem 1.1rem;border-radius:8px;border:0;background:#1a1a1a;color:#fff;cursor:pointer}</style>
</head>
<body>
  <main>
    <p>Signing you out of Texor&hellip;</p>
    ${form}
    <button id="texor-logout-continue" form="op.logoutForm" type="submit" name="logout" value="yes">Continue</button>
  </main>
  <script>document.getElementById('texor-logout-continue').click();</script>
</body>
</html>`;
}

async function postLogoutSuccessSource(ctx) {
  ctx.status = 303;
  ctx.redirect(`${env.accountsWebOrigin}/signin?signed_out=1`);
}

export default createProvider;
