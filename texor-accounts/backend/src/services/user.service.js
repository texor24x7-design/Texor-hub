/**
 * Account lifecycle: registration, credential checks, profile updates.
 */
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import { hashPassword, verifyPassword, needsRehash } from '../utils/password.js';
import { listIdentities } from './federation.service.js';

/** "Google and Microsoft", "Google, Microsoft and LinkedIn". */
const formatList = (items) => (items.length <= 1
  ? items[0] ?? ''
  : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

export async function registerUser({ email, password, givenName = '', familyName = '', phone = '' }) {
  const normalized = email.trim().toLowerCase();

  const existing = await User.findOne({ email: normalized }).exec();
  if (existing) {
    throw ApiError.conflict('An account with this email already exists.', { field: 'email' });
  }

  const user = await User.create({
    email: normalized,
    passwordHash: await hashPassword(password),
    name: { given: givenName.trim(), family: familyName.trim() },
    phone: phone.trim(),
  });

  return user;
}

/**
 * Verifies credentials and applies lockout.
 *
 * Deliberately returns the same error for "no such user" and "wrong password" so
 * the endpoint cannot be used to enumerate which emails have Texor accounts.
 */
export async function authenticate({ email, password }) {
  const normalized = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalized }).select('+passwordHash').exec();

  if (!user) {
    // Spend comparable time so timing does not reveal account existence.
    await hashPassword(password);
    throw ApiError.unauthorized('Incorrect email or password.');
  }

  if (user.isLocked) {
    throw ApiError.tooManyRequests('Too many failed attempts. Try again in a few minutes.');
  }

  if (user.status !== 'active') {
    throw ApiError.forbidden('This account is not active. Contact Texor support.');
  }

  /**
   * An account created through Google, Microsoft or LinkedIn has no password.
   * Returning the generic "incorrect email or password" here would leave its
   * owner permanently stuck — there is no password to get right, and no reset
   * flow to rescue them. So this case says what is actually wrong.
   *
   * It does confirm the address has a Texor Account. That is already true of
   * POST /api/auth/signup, which answers 409 for a taken email, so this reveals
   * nothing new. See documentation/security.md.
   */
  if (!user.passwordHash) {
    const methods = await listIdentities(user._id);
    const names = methods.map((method) => method.displayName);

    throw new ApiError(401, 'password_not_set', names.length
      ? `This account signs in with ${formatList(names)}. Use that button, or set a password from your `
        + 'account settings once you are signed in.'
      : 'This account does not have a password set.');
  }

  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    throw ApiError.unauthorized('Incorrect email or password.');
  }

  // Successful login: clear counters and upgrade the hash if parameters moved on.
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  if (needsRehash(user.passwordHash)) {
    user.passwordHash = await hashPassword(password);
  }
  await user.save();

  return user;
}

/**
 * Changes a password, or sets the first one.
 *
 * A user who signed up through Google has nothing to prove ownership of, so
 * `currentPassword` is not required in that case — holding a valid session is
 * the proof. Once a password exists, it is always required.
 */
export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash').exec();
  if (!user) throw ApiError.notFound('Account not found.');

  if (user.passwordHash) {
    if (!currentPassword) {
      throw ApiError.badRequest('Enter your current password.', [
        { field: 'currentPassword', message: 'Enter your current password.' },
      ]);
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw ApiError.unauthorized('Your current password is incorrect.');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();

  return user;
}

export async function updateProfile(userId, patch) {
  const user = await User.findById(userId).exec();
  if (!user) throw ApiError.notFound('Account not found.');

  if (patch.givenName !== undefined) user.name.given = patch.givenName.trim();
  if (patch.familyName !== undefined) user.name.family = patch.familyName.trim();
  if (patch.picture !== undefined) user.picture = patch.picture.trim();
  if (patch.locale !== undefined) user.locale = patch.locale;
  if (patch.zoneinfo !== undefined) user.zoneinfo = patch.zoneinfo;

  if (patch.phone !== undefined) {
    // Changing the number invalidates any confirmation of the old one.
    if (patch.phone !== user.phone) user.phoneVerified = false;
    user.phone = patch.phone.trim();
  }

  await user.save();
  return user;
}

/** Shape sent to the account UI. Never includes credentials. */
export function toPublicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    emailVerified: user.emailVerified,
    givenName: user.name?.given ?? '',
    familyName: user.name?.family ?? '',
    displayName: user.displayName,
    picture: user.picture,
    phone: user.phone,
    phoneVerified: user.phoneVerified,
    locale: user.locale,
    zoneinfo: user.zoneinfo,
    roles: user.roles,
    // Lets the UI show "Set a password" rather than "Change password".
    hasPassword: Boolean(user.hasPassword),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}
