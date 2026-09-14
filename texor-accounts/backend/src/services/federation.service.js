/**
 * Turning an upstream sign-in into a Texor Account.
 *
 * The whole security question here is one thing: **when may a Google/Microsoft/
 * LinkedIn sign-in be matched onto an existing Texor account?**
 *
 * If the answer were "whenever the email matches", then anyone who can get an
 * IdP to issue them a token carrying someone else's email address takes over
 * that Texor account. Some providers let you register an address without ever
 * proving you own it. So the rule is:
 *
 *   match by email ONLY when the upstream asserts email_verified: true
 *
 * Anything else has to be linked deliberately, from account settings, by
 * someone who has already proved they own the Texor account.
 */
import Identity from '../models/Identity.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { getProvider } from '../federation/providers.js';

/** Copies the latest upstream profile onto the stored link. */
function applyClaims(identity, claims) {
  identity.email = claims.email ?? '';
  identity.emailVerified = claims.emailVerified;
  identity.displayName = claims.name ?? '';
  identity.picture = claims.picture ?? '';
  identity.lastUsedAt = new Date();
  return identity;
}

/**
 * The sign-in path: resolve these upstream claims to a Texor user, creating one
 * if this is a genuinely new person.
 *
 * Returns `{ user, created, linked }` so the caller can tell a first-time
 * sign-up from a returning user.
 */
export async function resolveUserFromClaims(claims) {
  const provider = getProvider(claims.provider);
  if (!provider) throw ApiError.badRequest('That sign-in method is not available.');

  // ── 1. Already linked. The common case, and the only one that needs no
  //       email reasoning at all: the upstream `sub` is the identifier.
  const existing = await Identity.findOne({
    provider: claims.provider,
    subject: claims.subject,
  }).exec();

  if (existing) {
    const user = await User.findById(existing.user).exec();

    if (!user || user.status !== 'active') {
      throw ApiError.forbidden('This account is not active. Contact Texor support.');
    }

    await applyClaims(existing, claims).save();
    await refreshProfile(user, claims);

    return { user, created: false, linked: false };
  }

  // ── 2. Not linked yet. Everything below needs an email address.
  if (!claims.email) {
    throw ApiError.badRequest(
      `${provider.displayName} did not share an email address, so we cannot create your Texor Account. `
      + 'Grant email access and try again.',
    );
  }

  const byEmail = await User.findOne({ email: claims.email }).exec();

  // ── 3. An account with this email exists.
  if (byEmail) {
    if (!claims.emailVerified) {
      // The dangerous case. Refuse, and point at the safe route.
      logger.warn('federation link refused: unverified upstream email', {
        provider: claims.provider,
        subject: claims.subject,
      });
      throw ApiError.conflict(
        `A Texor Account already uses ${claims.email}, but ${provider.displayName} has not verified that `
        + `address. Sign in to Texor first, then connect ${provider.displayName} from your account settings.`,
      );
    }

    if (byEmail.status !== 'active') {
      throw ApiError.forbidden('This account is not active. Contact Texor support.');
    }

    await applyClaims(
      new Identity({ user: byEmail._id, provider: claims.provider, subject: claims.subject }),
      claims,
    ).save();
    await refreshProfile(byEmail, claims);

    logger.info('federated identity linked to existing account', {
      provider: claims.provider,
      userId: byEmail._id.toString(),
    });

    return { user: byEmail, created: false, linked: true };
  }

  // ── 4. Brand new person. Create the account with no password; they can add
  //       one later from account settings if they want a second way in.
  const user = await User.create({
    email: claims.email,
    emailVerified: claims.emailVerified,
    emailVerifiedAt: claims.emailVerified ? new Date() : null,
    passwordHash: null,
    name: { given: claims.givenName ?? '', family: claims.familyName ?? '' },
    picture: claims.picture ?? '',
    ...(claims.locale ? { locale: claims.locale } : {}),
  });

  await applyClaims(
    new Identity({ user: user._id, provider: claims.provider, subject: claims.subject }),
    claims,
  ).save();

  logger.info('texor account created from federated sign-in', {
    provider: claims.provider,
    userId: user._id.toString(),
  });

  return { user, created: true, linked: true };
}

/**
 * Fills in profile fields the account does not have yet.
 *
 * Deliberately non-destructive: a name the user typed into Texor is not
 * overwritten by whatever Google has on file.
 */
async function refreshProfile(user, claims) {
  let changed = false;

  if (!user.name?.given && claims.givenName) { user.name.given = claims.givenName; changed = true; }
  if (!user.name?.family && claims.familyName) { user.name.family = claims.familyName; changed = true; }
  if (!user.picture && claims.picture) { user.picture = claims.picture; changed = true; }

  // A verified address upstream is good enough to mark verified here.
  if (!user.emailVerified && claims.emailVerified && claims.email === user.email) {
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    changed = true;
  }

  user.lastLoginAt = new Date();
  await user.save();

  return changed;
}

/**
 * The deliberate link path: an already-authenticated user connecting a provider
 * from account settings. No email reasoning needed — they have proved who they
 * are on both sides.
 */
export async function linkIdentity(user, claims) {
  const existing = await Identity.findOne({
    provider: claims.provider,
    subject: claims.subject,
  }).exec();

  if (existing) {
    if (existing.user.equals(user._id)) {
      await applyClaims(existing, claims).save();
      return { alreadyLinked: true };
    }

    const provider = getProvider(claims.provider);
    throw ApiError.conflict(
      `That ${provider?.displayName ?? claims.provider} account is already connected to a different `
      + 'Texor Account.',
    );
  }

  try {
    await applyClaims(
      new Identity({ user: user._id, provider: claims.provider, subject: claims.subject }),
      claims,
    ).save();
  } catch (error) {
    // The { user, provider } unique index.
    if (error?.code === 11000) {
      const provider = getProvider(claims.provider);
      throw ApiError.conflict(`Your Texor Account already has a ${provider?.displayName} connection.`);
    }
    throw error;
  }

  return { alreadyLinked: false };
}

/**
 * Disconnecting a provider.
 *
 * Refuses to remove the last way into an account — a user who unlinks Google
 * from a passwordless account would be locked out permanently, with no password
 * reset flow to rescue them.
 */
export async function unlinkIdentity(user, providerId) {
  const identity = await Identity.findOne({ user: user._id, provider: providerId }).exec();
  if (!identity) throw ApiError.notFound('That sign-in method is not connected to your account.');

  const otherIdentities = await Identity.countDocuments({
    user: user._id,
    _id: { $ne: identity._id },
  });

  if (!user.hasPassword && otherIdentities === 0) {
    const provider = getProvider(providerId);
    throw ApiError.conflict(
      `${provider?.displayName ?? 'That provider'} is the only way to sign in to this account. `
      + 'Set a password first, then disconnect it.',
    );
  }

  await identity.deleteOne();

  logger.info('federated identity unlinked', { provider: providerId, userId: user._id.toString() });
}

export async function listIdentities(userId) {
  const identities = await Identity.find({ user: userId }).sort({ linkedAt: 1 }).lean();

  return identities.map((identity) => ({
    provider: identity.provider,
    displayName: getProvider(identity.provider)?.displayName ?? identity.provider,
    email: identity.email,
    linkedAt: identity.linkedAt,
    lastUsedAt: identity.lastUsedAt,
  }));
}

/** Sign-in methods available on an account — used for the security screen. */
export async function describeSignInMethods(user) {
  const identities = await listIdentities(user._id);
  return { hasPassword: Boolean(user.hasPassword), identities };
}

/** Removes an account's links when the account itself goes away. */
export async function deleteIdentitiesFor(userId) {
  await Identity.deleteMany({ user: userId });
}
