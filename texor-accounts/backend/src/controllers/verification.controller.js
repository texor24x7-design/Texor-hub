/**
 * Email verification and password recovery endpoints.
 */
import { z } from 'zod';
import { passwordSchema } from './auth.controller.js';
import { toPublicUser } from '../services/user.service.js';
import {
  completePasswordReset,
  confirmEmail,
  requestPasswordReset,
  sendVerificationEmail,
} from '../services/verification.service.js';
import {
  SESSION_COOKIE,
  createSession,
  sessionCookieOptions,
} from '../services/session.service.js';
import env from '../config/env.js';

export const emailSchema = z.object({ email: z.email('Enter a valid email address.') });
export const tokenSchema = z.object({ token: z.string().min(10, 'That link is not valid.') });
export const resetSchema = z.object({
  token: z.string().min(10, 'That link is not valid.'),
  newPassword: passwordSchema,
});

/** Sends (or re-sends) the confirmation email for the signed-in account. */
export async function postSendVerification(req, res) {
  const result = await sendVerificationEmail(req.user, { ip: req.ip });

  res.json({
    ok: true,
    ...result,
    // In development with no Resend key the link is printed to the server log
    // instead of being delivered; saying so beats waiting for an email that
    // will never arrive.
    delivered: env.mailEnabled,
  });
}

export async function postConfirmEmail(req, res) {
  const user = await confirmEmail(req.body.token);

  // Confirming from a link often happens in a browser with no session — the
  // one in the email client, say. Proving control of the inbox is enough to
  // sign in, and it saves an immediate second sign-in.
  if (!req.user) {
    const token = await createSession(user._id, {
      userAgent: req.get('user-agent') ?? '',
      ip: req.ip ?? '',
    });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  }

  res.json({ user: toPublicUser(user) });
}

/**
 * Always answers the same way, whether or not the address has an account.
 * Anything else turns this into a way to enumerate Texor users.
 */
export async function postForgotPassword(req, res) {
  await requestPasswordReset(req.body.email, { ip: req.ip });

  res.json({
    ok: true,
    message: 'If that address has a Texor Account, a reset link is on its way.',
  });
}

export async function postResetPassword(req, res) {
  const user = await completePasswordReset(req.body.token, req.body.newPassword);

  // Every other session was just revoked; sign this browser in so the person
  // lands somewhere useful rather than at a login screen.
  const token = await createSession(user._id, {
    userAgent: req.get('user-agent') ?? '',
    ip: req.ip ?? '',
  });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());

  res.json({ user: toPublicUser(user) });
}
