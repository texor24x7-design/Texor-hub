/**
 * Sign-up, sign-in and sign-out for the Texor Account itself.
 *
 * These endpoints manage the `texor_sid` cookie. They are what the account UI
 * calls directly; the OIDC endpoints under /oidc are driven by products.
 */
import { z } from 'zod';
import {
  SESSION_COOKIE,
  createSession,
  sessionCookieOptions,
  revokeSession,
} from '../services/session.service.js';
import { authenticate, registerUser, toPublicUser } from '../services/user.service.js';
import { sendVerificationEmail } from '../services/verification.service.js';
import logger from '../utils/logger.js';

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(200, 'That password is too long.')
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value), 'Mix upper and lower case letters.')
  .refine((value) => /\d/.test(value), 'Include at least one number.');

/**
 * E.164: a leading + and 8–15 digits.
 *
 * Deliberately not a full national-format parser. A canonical single form is
 * what makes a number comparable and dialable, and asking for it plainly beats
 * guessing a country from a browser locale.
 */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Use the international format, like +14155550123.');

export const signupSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: passwordSchema,
  givenName: z.string().max(80).optional().default(''),
  familyName: z.string().max(80).optional().default(''),
  phone: phoneSchema.or(z.literal('')).optional().default(''),
});

export const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

const requestContext = (req) => ({
  userAgent: req.get('user-agent') ?? '',
  ip: req.ip ?? '',
});

export async function signup(req, res) {
  const user = await registerUser(req.body);

  const token = await createSession(user._id, requestContext(req));
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());

  // Best effort. A mail outage should not cost someone their new account —
  // they land signed in, with a banner offering to send it again.
  let verificationSent = true;
  try {
    await sendVerificationEmail(user, { ip: req.ip });
  } catch (error) {
    verificationSent = false;
    logger.error('could not send verification email at signup', {
      userId: user._id.toString(),
      message: error.message,
    });
  }

  res.status(201).json({ user: toPublicUser(user), verificationSent });
}

export async function login(req, res) {
  const user = await authenticate(req.body);

  const token = await createSession(user._id, requestContext(req));
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());

  res.json({ user: toPublicUser(user) });
}

/**
 * Clears the account session. The caller is expected to follow up by visiting
 * the provider's end_session_endpoint so oidc-provider drops its own session
 * too — `endSessionUrl` in the response tells the UI where to go.
 */
export async function logout(req, res) {
  await revokeSession(req.sessionToken);
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  res.json({ ok: true });
}

export async function me(req, res) {
  res.json({ user: req.user ? toPublicUser(req.user) : null });
}
