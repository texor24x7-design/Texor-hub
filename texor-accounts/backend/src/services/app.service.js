/**
 * The developer console's core: registering and managing apps.
 *
 * Everything a self-service developer can do goes through here, and the guard
 * rails live here rather than in the controllers so that a second entry point
 * cannot quietly skip them.
 *
 * The rules that matter:
 *
 *   - A developer never sets `isFirstParty`. That flag skips the consent screen,
 *     so a self-service app with it could take tokens without ever asking.
 *   - A developer never publishes their own app. `testing` restricts an app to
 *     accounts its owner has listed, which is what stops an unverified app from
 *     being aimed at the whole user base.
 *   - Redirect URIs are validated properly. A loose one is how authorization
 *     codes get handed to somebody else.
 */
import Client from '../models/Client.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { encryptSecret } from '../utils/crypto.js';
import { randomToken } from '../utils/ids.js';
import { REQUIRED_SCOPES, SCOPE_IDS, describeScopes, isKnownScope, requiresReview } from '../config/scopes.js';

/** Quotas, so one account cannot exhaust the namespace or the console. */
export const LIMITS = {
  appsPerDeveloper: 25,
  redirectUris: 10,
  testAccounts: 100,
};

// Fields a developer is allowed to write. Anything outside this list is
// ignored rather than trusted, which is why the update path uses it explicitly.
const DEVELOPER_WRITABLE = new Set([
  'clientName',
  'description',
  'redirectUris',
  'postLogoutRedirectUris',
  'allowedScopes',
  'logoUri',
  'appUrl',
  'policyUri',
  'tosUri',
  'supportEmail',
  'resourceIndicator',
  'tokenEndpointAuthMethod',
]);

/**
 * Validates a redirect URI.
 *
 * Exact-match registration is only as good as what gets registered, so the
 * shapes that make exact matching meaningless are rejected here: wildcards,
 * fragments, and plaintext HTTP anywhere but loopback.
 */
export function validateRedirectUri(value, { field = 'redirectUris' } = {}) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw ApiError.badRequest(`"${value}" is not a valid absolute URL.`, [
      { field, message: 'Enter a full URL, including https://' },
    ]);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw ApiError.badRequest('Redirect URIs must use http or https.', [
      { field, message: 'Only http and https are supported.' },
    ]);
  }

  if (url.hash) {
    throw ApiError.badRequest('Redirect URIs cannot contain a fragment.', [
      { field, message: 'Remove everything from the # onwards.' },
    ]);
  }

  if (value.includes('*')) {
    throw ApiError.badRequest('Redirect URIs cannot contain wildcards.', [
      { field, message: 'Register each exact URL you will use.' },
    ]);
  }

  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

  // Plaintext is tolerated on loopback because that is where people develop,
  // and the traffic never leaves the machine.
  if (url.protocol === 'http:' && !isLoopback) {
    throw ApiError.badRequest('Redirect URIs must use https, except on localhost.', [
      { field, message: 'Use https:// for anything that is not localhost.' },
    ]);
  }

  return url.toString();
}

function normalizeRedirectUris(list, field) {
  if (!Array.isArray(list) || list.length === 0) {
    throw ApiError.badRequest('Register at least one redirect URI.', [
      { field, message: 'At least one is required.' },
    ]);
  }

  if (list.length > LIMITS.redirectUris) {
    throw ApiError.badRequest(`An app can have at most ${LIMITS.redirectUris} ${field}.`);
  }

  const seen = new Set();
  return list.map((entry) => {
    const normalized = validateRedirectUri(entry, { field });
    if (seen.has(normalized)) {
      throw ApiError.badRequest(`"${entry}" is listed twice.`, [{ field, message: 'Remove the duplicate.' }]);
    }
    seen.add(normalized);
    return normalized;
  });
}

function normalizeScopes(list) {
  const requested = Array.isArray(list) && list.length ? list : ['openid', 'profile', 'email'];

  const unknown = requested.filter((scope) => !isKnownScope(scope));
  if (unknown.length) {
    throw ApiError.badRequest(`Unknown scope: ${unknown.join(', ')}.`, [
      { field: 'allowedScopes', message: `Choose from: ${SCOPE_IDS.join(', ')}` },
    ]);
  }

  // `openid` is what makes this OIDC rather than plain OAuth; it is not optional.
  return [...new Set([...REQUIRED_SCOPES, ...requested])];
}

/** Turns an app name into a client id nobody else has. */
async function allocateClientId(name) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'app';

  // A short random suffix keeps ids unguessable and sidesteps a race between
  // two developers registering the same name at the same moment.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6)}`;
    const clash = await Client.exists({ clientId: candidate });
    if (!clash) return candidate;
  }

  throw ApiError.conflict('Could not allocate a client id. Try a different app name.');
}

/** Everything the console shows about an app. Never includes the secret. */
export function toConsoleApp(client) {
  return {
    clientId: client.clientId,
    clientName: client.clientName,
    description: client.description,
    redirectUris: client.redirectUris,
    postLogoutRedirectUris: client.postLogoutRedirectUris,
    allowedScopes: client.allowedScopes,
    scopeDetails: describeScopes(client.allowedScopes),
    resourceIndicator: client.resourceIndicator,
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    grantTypes: client.grantTypes,

    logoUri: client.logoUri,
    appUrl: client.appUrl,
    policyUri: client.policyUri,
    tosUri: client.tosUri,
    supportEmail: client.supportEmail,

    publishingStatus: client.effectivePublishingStatus
      ? client.effectivePublishingStatus()
      : client.publishingStatus,
    testAccounts: (client.testAccounts ?? []).map((id) => id.toString()),
    submittedForReviewAt: client.submittedForReviewAt,
    publishedAt: client.publishedAt,
    reviewNotes: client.reviewNotes,

    isFirstParty: client.isFirstParty,
    status: client.status,
    hasSecret: client.tokenEndpointAuthMethod !== 'none',
    secretRotatedAt: client.secretRotatedAt,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,

    // The endpoints a developer needs to wire up, so they are not hunting
    // through documentation for the issuer's shape.
    endpoints: {
      issuer: env.issuer,
      discovery: `${env.issuer}/.well-known/openid-configuration`,
      authorization: `${env.issuer}/auth`,
      token: `${env.issuer}/token`,
      userinfo: `${env.issuer}/me`,
      jwks: `${env.issuer}/jwks`,
      endSession: `${env.issuer}/session/end`,
    },
  };
}

/** Loads an app and proves the caller is allowed to touch it. */
export async function loadOwnedApp(clientId, user) {
  const client = await Client.findOne({ clientId }).exec();
  if (!client) throw ApiError.notFound('App not found.');

  const isOwner = client.owner && client.owner.equals(user._id);
  const isAdmin = user.roles.includes('admin');

  // Admins can reach any app; everyone else only their own. Reporting "not
  // found" rather than "forbidden" keeps the console from confirming that an
  // app id exists to someone who has nothing to do with it.
  if (!isOwner && !isAdmin) throw ApiError.notFound('App not found.');

  return client;
}

export async function listAppsFor(user) {
  const clients = await Client.find({ owner: user._id }).sort({ createdAt: -1 }).exec();
  return clients.map(toConsoleApp);
}

export async function createApp(user, input) {
  const count = await Client.countDocuments({ owner: user._id });
  if (count >= LIMITS.appsPerDeveloper) {
    throw ApiError.conflict(
      `You have reached the limit of ${LIMITS.appsPerDeveloper} apps. Delete one, or contact Texor support.`,
    );
  }

  const isPublic = input.tokenEndpointAuthMethod === 'none';

  const client = new Client({
    clientId: await allocateClientId(input.clientName),
    clientName: input.clientName,
    description: input.description ?? '',
    owner: user._id,

    redirectUris: normalizeRedirectUris(input.redirectUris, 'redirectUris'),
    postLogoutRedirectUris: input.postLogoutRedirectUris?.length
      ? normalizeRedirectUris(input.postLogoutRedirectUris, 'postLogoutRedirectUris')
      : [],

    allowedScopes: normalizeScopes(input.allowedScopes),
    tokenEndpointAuthMethod: input.tokenEndpointAuthMethod ?? 'client_secret_basic',

    logoUri: input.logoUri ?? '',
    appUrl: input.appUrl ?? '',
    policyUri: input.policyUri ?? '',
    tosUri: input.tosUri ?? '',
    supportEmail: input.supportEmail ?? user.email,

    // Self-service apps always start restricted, and never first-party.
    publishingStatus: 'testing',
    isFirstParty: false,
    testAccounts: [],
  });

  const secret = isPublic ? null : randomToken(32);
  if (secret) {
    client.clientSecretEncrypted = encryptSecret(secret, env.SECRET_ENCRYPTION_KEY);
    client.secretRotatedAt = new Date();
  }

  await client.save();

  logger.info('app registered', { clientId: client.clientId, owner: user._id.toString() });

  return { app: toConsoleApp(client), clientSecret: secret };
}

export async function updateApp(client, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!DEVELOPER_WRITABLE.has(key) || value === undefined) continue;

    if (key === 'redirectUris' || key === 'postLogoutRedirectUris') {
      client[key] = value.length ? normalizeRedirectUris(value, key) : [];
      continue;
    }

    if (key === 'allowedScopes') {
      const next = normalizeScopes(value);
      // Widening the ask after publication is exactly when a user should get
      // another look at it, so it goes back through review.
      const widened = next.some((scope) => !client.allowedScopes.includes(scope));
      if (widened && client.effectivePublishingStatus() === 'published' && requiresReview(next)) {
        client.publishingStatus = 'in_review';
        client.submittedForReviewAt = new Date();
      }
      client.allowedScopes = next;
      continue;
    }

    if (key === 'resourceIndicator') {
      client.resourceIndicator = value ? validateRedirectUri(value, { field: 'resourceIndicator' }) : null;
      continue;
    }

    client[key] = value;
  }

  await client.save();
  return toConsoleApp(client);
}

export async function rotateSecret(client) {
  if (client.tokenEndpointAuthMethod === 'none') {
    throw ApiError.badRequest('Public apps do not have a client secret.');
  }

  const secret = randomToken(32);
  client.clientSecretEncrypted = encryptSecret(secret, env.SECRET_ENCRYPTION_KEY);
  client.secretRotatedAt = new Date();
  await client.save();

  logger.info('app secret rotated', { clientId: client.clientId });

  return { app: toConsoleApp(client), clientSecret: secret };
}

export async function deleteApp(client) {
  if (client.isFirstParty) {
    throw ApiError.forbidden('First-party Texor apps cannot be deleted from the console.');
  }

  await client.deleteOne();
  logger.info('app deleted', { clientId: client.clientId });
}

/**
 * Test accounts, resolved from email addresses.
 *
 * Addresses are used rather than ids because a developer knows their testers'
 * emails and not their Texor account ids. An address with no Texor Account is
 * reported rather than silently dropped, since a tester who cannot sign in is
 * otherwise a mystery.
 */
export async function setTestAccounts(client, emails) {
  if (emails.length > LIMITS.testAccounts) {
    throw ApiError.badRequest(`An app can have at most ${LIMITS.testAccounts} test accounts.`);
  }

  const normalized = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const users = await User.find({ email: { $in: normalized } }).select('_id email').lean();

  const found = new Map(users.map((user) => [user.email, user._id]));
  const unknown = normalized.filter((email) => !found.has(email));

  client.testAccounts = [...found.values()];
  await client.save();

  return { app: toConsoleApp(client), unknown };
}

export async function listTestAccounts(client) {
  if (!client.testAccounts?.length) return [];
  const users = await User.find({ _id: { $in: client.testAccounts } }).select('email').lean();
  return users.map((user) => user.email);
}

/** A developer asks for their app to be looked at. They cannot publish it. */
export async function submitForReview(client) {
  const current = client.effectivePublishingStatus();

  if (current === 'published') throw ApiError.conflict('This app is already published.');
  if (current === 'in_review') throw ApiError.conflict('This app is already awaiting review.');

  const problems = [];
  if (!client.appUrl) problems.push('a homepage URL');
  if (!client.policyUri) problems.push('a privacy policy URL');
  if (!client.supportEmail) problems.push('a support email address');

  if (problems.length) {
    throw ApiError.badRequest(
      `Before review, add ${problems.join(', ')}. Users see these on the consent screen.`,
    );
  }

  client.publishingStatus = 'in_review';
  client.submittedForReviewAt = new Date();
  client.reviewNotes = '';
  await client.save();

  logger.info('app submitted for review', { clientId: client.clientId });

  return toConsoleApp(client);
}
