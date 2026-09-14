/**
 * Self-service account management — the "manage your Texor Account" screens.
 */
import { z } from 'zod';
import { changePassword, updateProfile, toPublicUser } from '../services/user.service.js';
import {
  listSessions,
  revokeAllSessions,
  revokeSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '../services/session.service.js';
import Session from '../models/Session.js';
import { listConnectedApps, revokeConnectedApp } from '../services/client.service.js';
import { passwordSchema, phoneSchema } from './auth.controller.js';
import ApiError from '../utils/ApiError.js';

export const profileSchema = z.object({
  givenName: z.string().max(80).optional(),
  familyName: z.string().max(80).optional(),
  picture: z.url().or(z.literal('')).optional(),
  phone: phoneSchema.or(z.literal('')).optional(),
  locale: z.string().max(20).optional(),
  zoneinfo: z.string().max(60).optional(),
});

export const changePasswordSchema = z.object({
  // Optional here, enforced in the service: an account created through Google
  // has no current password to supply, and a valid session is the proof of
  // ownership in that case.
  currentPassword: z.string().optional(),
  newPassword: passwordSchema,
  signOutOtherSessions: z.boolean().optional().default(true),
});

export async function getProfile(req, res) {
  res.json({ user: toPublicUser(req.user) });
}

export async function patchProfile(req, res) {
  const user = await updateProfile(req.user._id, req.body);
  res.json({ user: toPublicUser(user) });
}

export async function postPassword(req, res) {
  const { currentPassword, newPassword, signOutOtherSessions } = req.body;
  await changePassword(req.user._id, { currentPassword, newPassword });

  // A password change should invalidate anything an attacker may already hold.
  if (signOutOtherSessions) {
    await revokeAllSessions(req.user._id, { exceptToken: req.sessionToken });
  }

  res.json({ ok: true });
}

export async function getSessions(req, res) {
  res.json({ sessions: await listSessions(req.user._id, req.sessionToken) });
}

export async function deleteSession(req, res) {
  const session = await Session.findOne({ _id: req.params.id, user: req.user._id }).exec();
  if (!session) throw ApiError.notFound('Session not found.');

  session.revokedAt = new Date();
  await session.save();

  // Signing out the session you are currently using also clears the cookie.
  if (req.accountSession && session._id.equals(req.accountSession._id)) {
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  }

  res.json({ ok: true });
}

export async function deleteAllSessions(req, res) {
  await revokeAllSessions(req.user._id, { exceptToken: req.sessionToken });
  res.json({ ok: true });
}

export async function getConnectedApps(req, res) {
  res.json({ apps: await listConnectedApps(req.user._id.toString()) });
}

export async function deleteConnectedApp(req, res) {
  await revokeConnectedApp(req.user._id.toString(), req.params.grantId);
  res.json({ ok: true });
}
