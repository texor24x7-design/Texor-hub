import { SESSION_COOKIE, resolveSession } from '../services/session.service.js';
import ApiError from '../utils/ApiError.js';

export async function attachSession(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const resolved = await resolveSession(token);

  req.sessionToken = token ?? null;
  req.session = resolved?.session ?? null;
  req.user = resolved?.user ?? null;

  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(ApiError.unauthorized('Sign in with Texor to continue.'));
  return next();
}
