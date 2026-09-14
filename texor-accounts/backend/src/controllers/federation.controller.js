/**
 * "Continue with Google / Microsoft / LinkedIn".
 *
 * Two entry points share this code:
 *
 *   sign-in — from /signin or /signup on the account UI
 *   link    — from account settings, by someone already signed in
 *
 * and a federated sign-in can begin *inside* an authorization request from a
 * product. When it does, the transaction carries the interaction uid, and the
 * callback finishes that interaction rather than returning to the account UI —
 * so clicking "Continue with Google" on the Finvoice sign-in screen lands the
 * user back in Finvoice, not on their Texor profile page.
 */
import env from '../config/env.js';
import logger from '../utils/logger.js';
import ApiError from '../utils/ApiError.js';
import { getProvider, publicProviders } from '../federation/providers.js';
import { createAuthorizationRequest, exchangeCode, normalizeClaims } from '../federation/client.js';
import { clearTransaction, readTransaction, saveTransaction } from '../federation/transaction.js';
import { linkIdentity, listIdentities, resolveUserFromClaims, unlinkIdentity } from '../services/federation.service.js';
import { toPublicUser } from '../services/user.service.js';
import {
  SESSION_COOKIE,
  createSession,
  sessionCookieOptions,
} from '../services/session.service.js';

const cookieFlags = { secure: env.isProduction };

/** Only ever redirect back into the account UI, never to an arbitrary URL. */
function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/account';
  return value;
}

/** The providers this deployment has credentials for. Public. */
export function listProviders(_req, res) {
  res.json({ providers: publicProviders() });
}

export const makeFederationController = (provider) => ({
  listProviders,

  /**
   * Step 1 — hand the browser to the upstream provider.
   *
   * A GET rather than a POST because it is reached by a plain link or a full
   * navigation; the CSRF protection is the `state` value, not a token here.
   */
  async start(req, res) {
    const upstream = getProvider(req.params.provider);

    if (!upstream) {
      return res.redirect(`${env.accountsWebOrigin}/signin?error=${encodeURIComponent('That sign-in method is not available.')}`);
    }

    const mode = req.query.mode === 'link' ? 'link' : 'signin';

    if (mode === 'link' && !req.user) {
      return res.redirect(`${env.accountsWebOrigin}/signin?next=/account/security`);
    }

    const request = await createAuthorizationRequest(upstream);

    saveTransaction(res, {
      provider: upstream.id,
      state: request.state,
      nonce: request.nonce,
      codeVerifier: request.codeVerifier,
      mode,
      next: safeNext(req.query.next),
      // Present only when this began inside a product's authorization request.
      interactionUid: typeof req.query.interaction === 'string' ? req.query.interaction : null,
    }, cookieFlags);

    return res.redirect(request.url);
  },

  /**
   * Step 2 — the upstream sends the browser back here.
   */
  async callback(req, res) {
    const transaction = readTransaction(req);
    clearTransaction(res, cookieFlags);

    const upstream = getProvider(req.params.provider);

    // Where to report a failure. Inside an interaction, the account UI can
    // still recover; otherwise the sign-in page is the right place.
    const failureBase = transaction?.interactionUid
      ? `${env.accountsWebOrigin}/interaction/${transaction.interactionUid}`
      : `${env.accountsWebOrigin}/signin`;

    const fail = (message) => {
      logger.warn('federated sign-in failed', { provider: req.params.provider, message });
      return res.redirect(`${failureBase}?error=${encodeURIComponent(message)}`);
    };

    if (!upstream) return fail('That sign-in method is not available.');
    if (!transaction || transaction.provider !== upstream.id) {
      return fail('That sign-in took too long. Please try again.');
    }

    // The user pressed cancel, or the provider refused. Its own wording is the
    // most accurate thing we have.
    if (req.query.error) {
      return fail(req.query.error_description || req.query.error);
    }

    let claims;
    try {
      const result = await exchangeCode(upstream, {
        code: req.query.code,
        state: req.query.state,
        expectedState: transaction.state,
        nonce: transaction.nonce,
        codeVerifier: transaction.codeVerifier,
      });
      claims = normalizeClaims(upstream, result.claims);
    } catch (error) {
      return fail(error instanceof ApiError ? error.message : `Could not complete ${upstream.displayName} sign-in.`);
    }

    // ── Linking an extra provider to the account already signed in ──────────
    if (transaction.mode === 'link') {
      if (!req.user) return fail('Your session expired. Sign in and try again.');

      try {
        await linkIdentity(req.user, claims);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'Could not connect that account.';
        return res.redirect(`${env.accountsWebOrigin}/account/security?error=${encodeURIComponent(message)}`);
      }

      return res.redirect(`${env.accountsWebOrigin}/account/security?linked=${upstream.id}`);
    }

    // ── Signing in ──────────────────────────────────────────────────────────
    let user;
    try {
      ({ user } = await resolveUserFromClaims(claims));
    } catch (error) {
      return fail(error instanceof ApiError ? error.message : 'Could not complete that sign-in.');
    }

    const token = await createSession(user._id, {
      userAgent: req.get('user-agent') ?? '',
      ip: req.ip ?? '',
    });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());

    // Started inside a product's authorization request: finish it, so the user
    // ends up back in the product rather than on their Texor profile.
    if (transaction.interactionUid) {
      try {
        const redirectTo = await provider.interactionResult(
          req,
          res,
          { login: { accountId: user._id.toString(), remember: true } },
          { mergeWithLastSubmission: false },
        );
        return res.redirect(redirectTo);
      } catch (error) {
        // The interaction expired while the user was away at the provider.
        // They are signed in to Texor now, so the product can simply retry.
        logger.warn('could not resume interaction after federated sign-in', { message: error.message });
        return fail('That sign-in request expired. Please try again from the app.');
      }
    }

    return res.redirect(`${env.accountsWebOrigin}${safeNext(transaction.next)}`);
  },
});

/** GET /api/account/identities */
export async function getIdentities(req, res) {
  res.json({
    hasPassword: Boolean(req.user.hasPassword),
    identities: await listIdentities(req.user._id),
    available: publicProviders(),
    user: toPublicUser(req.user),
  });
}

/** DELETE /api/account/identities/:provider */
export async function deleteIdentity(req, res) {
  await unlinkIdentity(req.user, req.params.provider);
  res.json({ ok: true, identities: await listIdentities(req.user._id) });
}

export default makeFederationController;
