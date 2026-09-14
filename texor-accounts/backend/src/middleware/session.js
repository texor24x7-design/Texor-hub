/**
 * Attaches the Texor Account session to every request.
 *
 * `attachSession` is permissive — it runs on all API routes and simply leaves
 * req.user null when there is no valid cookie. `requireUser` and `requireAdmin`
 * are the gates.
 */
import { SESSION_COOKIE, resolveSession } from '../services/session.service.js';
import ApiError from '../utils/ApiError.js';

export async function attachSession(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const resolved = await resolveSession(token);

  req.sessionToken = token ?? null;
  req.user = resolved?.user ?? null;
  req.accountSession = resolved?.session ?? null;

  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(ApiError.unauthorized('Sign in to continue.'));
  return next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(ApiError.unauthorized('Sign in to continue.'));
  if (!req.user.roles.includes('admin')) {
    return next(ApiError.forbidden('This action requires a Texor administrator account.'));
  }
  return next();
}
