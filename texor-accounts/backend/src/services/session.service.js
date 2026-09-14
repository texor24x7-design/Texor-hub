/**
 * Texor Account SSO sessions.
 *
 * This is the session behind the `texor_sid` cookie — the one that makes a
 * second product skip the login screen entirely. Only a SHA-256 hash of the
 * token is stored, so a leaked database dump cannot be replayed as a login.
 */
import Session from '../models/Session.js';
import User from '../models/User.js';
import { randomToken, sha256 } from '../utils/ids.js';
import env from '../config/env.js';

export const SESSION_COOKIE = 'texor_sid';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    domain: env.cookieDomain,
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

export async function createSession(userId, { userAgent = '', ip = '' } = {}) {
  const token = randomToken(32);

  await Session.create({
    user: userId,
    tokenHash: sha256(token),
    userAgent: userAgent.slice(0, 512),
    ip,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  return token;
}

/** Resolves a raw cookie value to its user, or null if the session is not usable. */
export async function resolveSession(token) {
  if (!token) return null;

  const session = await Session.findOne({ tokenHash: sha256(token) }).exec();
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  const user = await User.findById(session.user).exec();
  if (!user || user.status !== 'active') return null;

  // Cheap activity tracking; avoids a write on every single request.
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  if (session.lastSeenAt.getTime() < fiveMinutesAgo) {
    session.lastSeenAt = new Date();
    await session.save();
  }

  return { session, user };
}

export async function revokeSession(token) {
  if (!token) return;
  await Session.updateOne(
    { tokenHash: sha256(token), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function revokeAllSessions(userId, { exceptToken } = {}) {
  const filter = { user: userId, revokedAt: null };
  if (exceptToken) filter.tokenHash = { $ne: sha256(exceptToken) };
  await Session.updateMany(filter, { $set: { revokedAt: new Date() } });
}

export async function listSessions(userId, currentToken) {
  const currentHash = currentToken ? sha256(currentToken) : null;
  const sessions = await Session.find({
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastSeenAt: -1 })
    .lean();

  return sessions.map((session) => ({
    id: session._id.toString(),
    userAgent: session.userAgent,
    ip: session.ip,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    current: session.tokenHash === currentHash,
  }));
}
