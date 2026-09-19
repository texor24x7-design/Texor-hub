/**
 * Issuing keys, and turning one back into an account.
 *
 * Every key gets a locked label named after the app. That is the part of this
 * design that makes the API feel like part of the product rather than a hole in
 * the side of it: notes written by somebody's CRM arrive filed under "Acme CRM"
 * in their sidebar, next to the ones they typed.
 */
import env from '../config/env.js';
import ApiKey from '../models/ApiKey.js';
import Label from '../models/Label.js';
import ApiError from '../utils/ApiError.js';
import { randomToken, sha256 } from '../utils/ids.js';

export const KEY_PREFIX = 'ntk_live_';
export const USER_TOKEN_PREFIX = 'ntu_';

/**
 * May a key made by this person say who a note belongs to?
 *
 * Answered from TRUSTED_KEY_EMAILS on every request rather than stamped onto
 * the key when it was made. Stamped, it had two faults: listing yourself after
 * creating Texor Talk's key did nothing until the key was thrown away and made
 * again — which is exactly the order anybody sets this up in — and taking an
 * address off the list left every key it had already made still trusted.
 * Trust is a property of the deployment, so the deployment is asked.
 */
export function isTrusted(email) {
  return Boolean(email) && env.trustedKeyEmails.includes(String(email).toLowerCase());
}

/** Enough of a key to recognise it in a list, and not enough to use it. */
const displayPrefix = (key) => key.slice(0, KEY_PREFIX.length + 4);

/**
 * The label an app's notes land in, for one account.
 *
 * Reused rather than recreated: a key in `mode: 'user'` needs one of these per
 * person who connects, and somebody who revokes a key and issues a new one for
 * the same app should not end up with "Acme CRM" twice in their sidebar.
 */
export async function appLabelFor({ appName, ownerTexorId, apiKeyId }) {
  const existing = await Label.findOne({ ownerTexorId, name: appName })
    .collation({ locale: 'en', strength: 2 })
    .exec();

  if (existing) {
    if (!existing.locked) {
      existing.locked = true;
      existing.apiKey = apiKeyId;
      await existing.save();
    }
    return existing;
  }

  return Label.create({ ownerTexorId, name: appName, locked: true, apiKey: apiKeyId });
}

export async function createKey({ user, appName, mode = 'owner', webhookUrl = '', redirectUris = [] }) {
  const token = `${KEY_PREFIX}${randomToken(32)}`;

  const key = await ApiKey.create({
    ownerTexorId: user.texorId,
    appName: appName.trim(),
    prefix: displayPrefix(token),
    hash: sha256(token),
    mode,
    webhookUrl,
    webhookSecret: webhookUrl ? randomToken(24) : '',
    redirectUris,
  });

  const label = await appLabelFor({
    appName: key.appName,
    ownerTexorId: user.texorId,
    apiKeyId: key._id,
  });

  key.label = label._id;
  await key.save();

  // The one and only time the key itself exists outside the caller's hands.
  return { key, token, label };
}

export async function revokeKey({ id, ownerTexorId }) {
  const key = await ApiKey.findOne({ _id: id, ownerTexorId }).exec();
  if (!key) throw ApiError.notFound('No such key.');

  key.revokedAt = new Date();
  await key.save();

  /**
   * The label outlives the key, unlocked.
   *
   * Its notes are still the person's notes and still need somewhere to live —
   * and deleting a label full of somebody's writing because they rotated a
   * credential would be an astonishing thing for this to do.
   */
  if (key.label) {
    await Label.updateOne({ _id: key.label }, { $set: { locked: false, apiKey: null } }).exec();
  }

  return key;
}

/** The key behind a header, or null. Revoked keys are simply not found. */
export async function keyFromToken(token) {
  if (!token || !token.startsWith(KEY_PREFIX)) return null;
  return ApiKey.findOne({ hash: sha256(token), revokedAt: null }).exec();
}

export function presentKey(key, { label, trusted = false } = {}) {
  return {
    id: String(key._id),
    appName: key.appName,
    prefix: key.prefix,
    mode: key.mode,
    trusted,
    webhookUrl: key.webhookUrl || '',
    redirectUris: key.redirectUris ?? [],
    label: label ? { id: String(label._id), name: label.name } : key.label ? String(key.label) : null,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
  };
}

export default { isTrusted, createKey, revokeKey, keyFromToken, presentKey, appLabelFor, KEY_PREFIX, USER_TOKEN_PREFIX };
