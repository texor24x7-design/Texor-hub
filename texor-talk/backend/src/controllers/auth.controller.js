/**
 * "Sign in with Texor" for Texor Talk.
 *
 * The whole flow is four endpoints:
 *
 *   GET  /api/auth/login     start — redirect the browser to Texor
 *   GET  /api/auth/callback  finish — exchange the code, open a session
 *   POST /api/auth/logout    end this session, then Texor's
 *   GET  /api/auth/me        who is signed in
 *
 * Note that login and callback are full browser redirects, not fetches: the
 * user has to actually visit accounts.texor.app so their existing Texor session
 * cookie is in play. That is what makes the second product sign in instantly.
 */
import User from '../models/User.js';
import env from '../config/env.js';
import { GUEST_COOKIE, guestCookieOptions, revokeGuest } from '../services/guest.service.js';
import { isAdmin } from '../services/policy.service.js';
import logger from '../utils/logger.js';
import {
  SESSION_COOKIE,
  createSession,
  revokeSession,
  sessionCookieOptions,
} from '../services/session.service.js';
import {
  clearTransaction,
  readTransaction,
  saveTransaction,
  texor,
} from '../texor/index.js';

const cookieFlags = { secure: env.isProduction };

/** Only allow post-login redirects back into this app. */
function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export async function startLogin(req, res) {
  const request = await texor.createAuthorizationRequest({
    returnTo: safeReturnTo(req.query.returnTo),
    prompt: req.query.prompt,
  });

  saveTransaction(res, request, cookieFlags);
  res.redirect(request.url);
}

export async function handleCallback(req, res) {
  const transaction = readTransaction(req);
  clearTransaction(res, cookieFlags);

  const fail = (reason) => {
    logger.warn('texor sign-in failed', { reason });
    res.redirect(`${env.appOrigin}/signin?error=${encodeURIComponent(reason)}`);
  };

  // The provider reports user-facing refusals (a declined consent screen) on
  // the redirect itself rather than as a failed token exchange.
  if (req.query.error) return fail(req.query.error_description || req.query.error);
  if (!transaction) return fail('Your sign-in took too long. Please try again.');

  let claims;
  let tokens;

  try {
    ({ claims, tokens } = await texor.exchangeCode({
      code: req.query.code,
      state: req.query.state,
      expectedState: transaction.state,
      nonce: transaction.nonce,
      codeVerifier: transaction.codeVerifier,
    }));
  } catch (error) {
    return fail(error.message);
  }

  const user = await User.upsertFromClaims(claims);

  const token = await createSession({
    user,
    claims,
    tokens,
    userAgent: req.get('user-agent') ?? '',
    ip: req.ip ?? '',
  });

  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  return res.redirect(`${env.appOrigin}${safeReturnTo(transaction.returnTo)}`);
}

export async function logout(req, res) {
  /**
   * A guest is not signed in to anything, so there is nothing to sign out of.
   *
   * This used to fall through to the code below and build an OIDC end-session
   * URL for somebody who has no OIDC session and no `id_token` — sending a
   * guest to an identity provider that has never heard of them, which fails
   * there rather than here and looks like the account system is broken.
   *
   * All a guest pass is, is a cookie. Revoking it and clearing it *is* the
   * logout.
   */
  if (req.user?.isGuest) {
    await revokeGuest(req.guestToken);
    res.clearCookie(GUEST_COOKIE, { ...guestCookieOptions(), maxAge: undefined });
    return res.json({ ok: true, redirectTo: env.appOrigin });
  }

  const idToken = await revokeSession(req.sessionToken);
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });

  // Ending the Texor session too, otherwise the next visit signs straight
  // back in and the user thinks logout is broken.
  const redirectTo = await texor.endSessionUrl({ idToken }).catch(() => env.appOrigin);
  return res.json({ ok: true, redirectTo });
}

export async function me(req, res) {
  if (!req.user) return res.json({ user: null });

  /**
   * A guest is a user here too, and a differently shaped one.
   *
   * There is no local `User` document behind a guest pass, so reading `_id`
   * threw and this endpoint answered 500 — which the frontend reasonably read
   * as "not signed in" and redirected to the sign-in page, immediately after
   * somebody had successfully joined as a guest. The narrower shape is
   * returned, marked, and scoped to its one meeting.
   */
  if (req.user.isGuest) {
    return res.json({
      user: {
        texorId: req.user.texorId,
        displayName: req.user.displayName,
        email: '',
        picture: '',
        isGuest: true,
        isAdmin: false,
        meetingCode: req.user.meetingCode ?? null,
      },
    });
  }

  return res.json({
    user: {
      id: req.user._id.toString(),
      texorId: req.user.texorId,
      email: req.user.email,
      displayName: req.user.displayName,
      picture: req.user.picture,
      status: req.user.status,
      statusText: req.user.statusText,
      // Decides whether the admin console appears in the navigation. It is not
      // what protects it — every /api/admin route checks this again for itself.
      isAdmin: await isAdmin(req.user),
      isGuest: false,
    },
  });
}
