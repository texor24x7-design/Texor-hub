/**
 * Org meeting policy: reading it, changing it, and enforcing it.
 *
 * Everything that asks "is this allowed" goes through here, so there is one
 * answer per question rather than one per controller.
 */
import Policy from '../models/Policy.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

/**
 * The policy document, created with its defaults the first time it is asked
 * for. Upsert rather than find-then-create so two requests racing on a cold
 * database cannot both decide they are the one to create it.
 */
export async function getPolicy() {
  return Policy.findOneAndUpdate(
    { key: 'org' },
    { $setOnInsert: { key: 'org' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}

/**
 * Admins come from two places and the env list wins.
 *
 * ADMIN_EMAILS is deployment configuration, so it cannot be edited away from
 * inside the console — that is the escape hatch if someone removes themselves
 * or every other admin leaves the company on the same day.
 */
export async function isAdmin(user, policy = null) {
  if (!user) return false;
  if (env.adminEmails.includes((user.email ?? '').toLowerCase())) return true;

  const current = policy ?? (await getPolicy());
  return current.adminTexorIds.includes(user.texorId);
}

export async function requireAdminUser(user) {
  if (!(await isAdmin(user))) {
    throw ApiError.forbidden('This is an admin-only area of Texor Talk.');
  }
}

/**
 * Whether an email belongs to the organisation.
 *
 * With ORG_EMAIL_DOMAINS unset nobody is external, which is the right default
 * for a single-tenant deployment: it would be worse to start treating every
 * colleague as a guest because a config line is missing.
 */
export function isExternalEmail(email) {
  if (env.orgEmailDomains.length === 0) return false;
  const domain = (email ?? '').toLowerCase().split('@')[1] ?? '';
  return !env.orgEmailDomains.includes(domain);
}

export async function assertCanCreateMeeting(user) {
  const policy = await getPolicy();

  if (policy.whoCanCreateMeetings === 'allowlist') {
    const allowed =
      policy.creatorAllowlist.includes(user.texorId) || (await isAdmin(user, policy));

    if (!allowed) {
      throw ApiError.forbidden(
        'Your organisation only lets approved people start meetings. Ask an admin to add you.',
      );
    }
  }

  return policy;
}

/** The policy fields a new meeting inherits at the moment it is created. */
export function meetingDefaults(policy) {
  return {
    lobby: policy.lobbyDefault,
    // A new meeting starts at the organisation's ceiling, or Standard if that
    // ceiling is higher — nobody should be spending the most by default.
    quality: policy.maxQuality === 'saver' ? 'saver' : 'standard',
    maxDurationMinutes: policy.maxDurationMinutes,
    maxParticipants: policy.maxParticipants,
    settings: {
      muteOnEntry: policy.defaultMuteOnEntry,
      videoOffOnEntry: policy.defaultVideoOffOnEntry,
      screenShare: policy.screenShareDefault,
      allowChat: true,
      allowExternalGuests: policy.allowExternalGuests,
    },
  };
}

/**
 * The lobby rule actually applied to one person joining one meeting.
 *
 * The host's setting is the starting point; `forceLobbyForExternal` can only
 * tighten it. A host cannot wave an outside guest straight in when the org has
 * said outside guests always knock.
 */
export function effectiveLobby(meeting, policy, { isExternal }) {
  if (isExternal && policy.forceLobbyForExternal && meeting.lobby === 'off') return 'external';
  return meeting.lobby;
}

export default {
  getPolicy,
  isAdmin,
  requireAdminUser,
  isExternalEmail,
  assertCanCreateMeeting,
  meetingDefaults,
  effectiveLobby,
};
