import { SESSION_COOKIE, resolveSession } from '../services/session.service.js';
import { GUEST_COOKIE, resolveGuest } from '../services/guest.service.js';
import ApiError from '../utils/ApiError.js';

/**
 * Works out who is making this request.
 *
 * Two kinds of caller, and the order matters: a real Texor session always wins.
 * Somebody signed in who also happens to hold a stale guest cookie from an
 * earlier meeting is themselves, not a guest.
 */
export async function attachSession(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const resolved = await resolveSession(token);

  req.sessionToken = token ?? null;
  req.session = resolved?.session ?? null;
  req.user = resolved?.user ?? null;

  if (!req.user) {
    const guestToken = req.cookies?.[GUEST_COOKIE];
    const guest = await resolveGuest(guestToken);

    if (guest) {
      req.guestToken = guestToken;
      req.user = guest;
    }
  }

  next();
}

/**
 * A signed-in Texor Account, and nothing less.
 *
 * This is the default for the whole API. A guest pass is refused here as firmly
 * as no credential at all — it exists to let somebody into one meeting, and
 * channels, the meeting list, scheduling, invitations and the admin console are
 * none of that. Only the few routes that explicitly use `requireParticipant`
 * accept one.
 */
export function requireUser(req, _res, next) {
  if (!req.user) return next(ApiError.unauthorized('Sign in with Texor to continue.'));

  if (req.user.isGuest) {
    return next(ApiError.forbidden('Guests can only take part in the meeting they joined.'));
  }

  return next();
}

/**
 * A Texor Account **or** a guest pass.
 *
 * Used only on the handful of routes a guest genuinely needs — joining the
 * meeting they were admitted to, polling their own knock, and leaving. The
 * route itself is still responsible for checking the guest's pass is for *this*
 * meeting, which `assertGuestScope` does once the meeting has been loaded.
 */
export function requireParticipant(req, _res, next) {
  if (!req.user) return next(ApiError.unauthorized('Sign in, or join as a guest, to continue.'));
  return next();
}

export default { attachSession, requireUser, requireParticipant };
