/**
 * Email verification and password reset.
 *
 * Both are the same shape: mint a single-use secret, mail a link containing it,
 * and accept it once. The security properties that matter:
 *
 *   - Tokens are stored hashed, so a database dump yields nothing usable.
 *   - Issuing a token invalidates any earlier one for the same purpose, so a
 *     forwarded old email cannot be replayed after a new request.
 *   - Requesting a reset never reveals whether an account exists. The endpoint
 *     answers identically either way.
 *   - A completed reset signs out every other session, because a reset is what
 *     someone does when they suspect they have lost control of the account.
 */
import VerificationToken from '../models/VerificationToken.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { randomToken, sha256 } from '../utils/ids.js';
import { hashPassword } from '../utils/password.js';
import { sendMail } from '../mail/mailer.js';
import { passwordChanged, resetPassword, verifyEmail } from '../mail/templates.js';
import { revokeAllSessions } from './session.service.js';

const TTL_MINUTES = { email_verification: 60 * 24, password_reset: 30 };

/** Issues a token and returns the raw value, which exists only in the email. */
async function issue(user, purpose, { ip = '' } = {}) {
  // One live token per purpose: a new request retires the previous link.
  await VerificationToken.deleteMany({ user: user._id, purpose, consumedAt: null });

  const token = randomToken(32);
  const minutes = TTL_MINUTES[purpose];

  await VerificationToken.create({
    user: user._id,
    purpose,
    tokenHash: sha256(token),
    email: user.email,
    expiresAt: new Date(Date.now() + minutes * 60 * 1000),
    requestedIp: ip,
  });

  return { token, minutes };
}

/** Resolves a raw token, or explains precisely why it will not work. */
async function consume(rawToken, purpose) {
  if (!rawToken || typeof rawToken !== 'string') {
    throw ApiError.badRequest('That link is not valid.');
  }

  const record = await VerificationToken.findOne({ tokenHash: sha256(rawToken), purpose }).exec();

  if (!record) throw ApiError.badRequest('That link is not valid. It may already have been used.');
  if (record.consumedAt) throw ApiError.badRequest('That link has already been used.');
  if (record.expiresAt <= new Date()) throw ApiError.badRequest('That link has expired. Request a new one.');

  const user = await User.findById(record.user).select('+passwordHash').exec();
  if (!user || user.status !== 'active') throw ApiError.badRequest('That link is no longer valid.');

  // The address is pinned at issue time, so a link cannot be applied to an
  // address the account has since moved away from.
  if (record.email !== user.email) {
    throw ApiError.badRequest('That link was sent to a different email address.');
  }

  record.consumedAt = new Date();
  await record.save();

  return user;
}

const link = (path, token) => `${env.accountsWebOrigin}${path}?token=${encodeURIComponent(token)}`;

export async function sendVerificationEmail(user, { ip } = {}) {
  if (user.emailVerified) throw ApiError.conflict('This email address is already confirmed.');

  const { token, minutes } = await issue(user, 'email_verification', { ip });

  await sendMail({
    to: user.email,
    ...verifyEmail({
      url: link('/verify-email', token),
      displayName: user.displayName,
      expiresInMinutes: minutes,
    }),
  });

  logger.info('verification email issued', { userId: user._id.toString() });

  return { expiresInMinutes: minutes };
}

export async function confirmEmail(rawToken) {
  const user = await consume(rawToken, 'email_verification');

  if (!user.emailVerified) {
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    await user.save();
    logger.info('email verified', { userId: user._id.toString() });
  }

  return user;
}

/**
 * Starts a password reset.
 *
 * Returns nothing about whether the account exists — the caller answers the
 * same way regardless, so the endpoint cannot be used to discover which
 * addresses have Texor Accounts.
 */
export async function requestPasswordReset(email, { ip } = {}) {
  const normalized = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalized }).exec();

  if (!user || user.status !== 'active') {
    logger.info('password reset requested for unknown address', { ip });
    return;
  }

  const { token, minutes } = await issue(user, 'password_reset', { ip });

  await sendMail({
    to: user.email,
    ...resetPassword({
      url: link('/reset-password', token),
      displayName: user.displayName,
      expiresInMinutes: minutes,
    }),
  });

  logger.info('password reset email issued', { userId: user._id.toString() });
}

export async function completePasswordReset(rawToken, newPassword) {
  const user = await consume(rawToken, 'password_reset');

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;

  // Reaching a reset link proves control of the inbox, which is the same
  // evidence the address itself rests on.
  if (!user.emailVerified) {
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
  }

  await user.save();

  // Whoever prompted this may have had access; end every existing session.
  await revokeAllSessions(user._id);

  await sendMail({ to: user.email, ...passwordChanged({ displayName: user.displayName }) })
    .catch((error) => logger.warn('could not send password-changed notice', { message: error.message }));

  logger.info('password reset completed', { userId: user._id.toString() });

  return user;
}
