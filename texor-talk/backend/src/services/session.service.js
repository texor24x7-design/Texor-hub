/**
 * Texor Talk session lifecycle.
 *
 * The browser holds an opaque handle; the Texor tokens stay in Mongo. When an
 * access token is close to expiry, `resolveSession` silently refreshes it, so
 * callers never have to think about token lifetimes.
 */
import Session from '../models/Session.js';
import User from '../models/User.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { randomToken, sha256 } from '../utils/ids.js';
import { texor } from '../texor/index.js';

export const SESSION_COOKIE = 'talk_sid';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Refresh a little before the token actually expires so a slow request does not
// go out with a token that dies in flight.
const REFRESH_SKEW_MS = 60 * 1000;

export const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProduction,
  domain: env.cookieDomain,
  path: '/',
  maxAge: SESSION_TTL_MS,
});

export async function createSession({ user, claims, tokens, userAgent = '', ip = '' }) {
  const token = randomToken(32);

  await Session.create({
    user: user._id,
    texorId: claims.sub,
    tokenHash: sha256(token),
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    idToken: tokens.id_token ?? null,
    accessTokenExpiresAt: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null,
    userAgent: userAgent.slice(0, 512),
    ip,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  return token;
}

export async function resolveSession(token) {
  if (!token) return null;

  const session = await Session.findOne({ tokenHash: sha256(token) })
    .select('+accessToken +refreshToken +idToken')
    .exec();

  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  const user = await User.findById(session.user).exec();
  if (!user) return null;

  await maybeRefresh(session);

  return { session, user };
}

/**
 * Renews the access token when it is about to expire. A failure here is not
 * fatal — the session stays valid for Texor Talk's own pages; only calls that
 * need a live Texor token will fail, and those report it themselves.
 */
async function maybeRefresh(session) {
  const expiresAt = session.accessTokenExpiresAt?.getTime();
  if (!session.refreshToken || !expiresAt) return;
  if (expiresAt - REFRESH_SKEW_MS > Date.now()) return;

  try {
    const tokens = await texor.refresh(session.refreshToken);

    session.accessToken = tokens.access_token ?? session.accessToken;
    // The provider rotates refresh tokens, so the old one is now dead.
    if (tokens.refresh_token) session.refreshToken = tokens.refresh_token;
    if (tokens.id_token) session.idToken = tokens.id_token;
    session.accessTokenExpiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    await session.save();
  } catch (error) {
    logger.warn('texor token refresh failed', { sessionId: session.id, message: error.message });
  }
}

export async function revokeSession(token) {
  if (!token) return null;

  const session = await Session.findOne({ tokenHash: sha256(token) })
    .select('+idToken')
    .exec();

  if (!session) return null;

  session.revokedAt = new Date();
  await session.save();

  // Returned so the caller can pass id_token_hint to Texor's logout endpoint.
  return session.idToken;
}
