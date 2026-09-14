/**
 * Guest access: joining one meeting with a name and nothing else.
 *
 * Every rule about *whether* a guest may exist lives here, in one function, for
 * the same reason `evaluateJoin` does — three gates spread across three call
 * sites become two gates and a hole.
 */
import GuestSession from '../models/GuestSession.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { randomToken, sha256 } from '../utils/ids.js';

export const GUEST_COOKIE = 'talk_guest';

/** A guest pass is for one meeting, and should not outlive a long one. */
export const GUEST_TTL_MS = 12 * 60 * 60 * 1000;

export const guestCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProduction,
  domain: env.cookieDomain,
  path: '/',
  maxAge: GUEST_TTL_MS,
});

/**
 * Characters that must not survive into a display name.
 *
 * Assembled from escape sequences rather than written as one regex literal.
 * A literal containing real control characters is invisible in an editor,
 * trivially mangled by a later edit, and impossible to review — this file had
 * exactly that problem. Named ranges make what is removed, and why, legible.
 */
const UNSAFE_NAME_CHARS = new RegExp(
  [
    '\\u0000-\\u001F', // C0 controls
    '\\u007F-\\u009F', // DEL and the C1 controls
    '\\u200B-\\u200F', // zero-width spaces and joiners, LTR/RTL marks
    '\\u202A-\\u202E', // bidirectional embedding and overrides
    '\\u2066-\\u2069', // bidirectional isolates
  ]
    .map((range) => `[${range}]`)
    .join('|'),
  'g',
);

/**
 * Cleans a typed-in display name.
 *
 * Shown to everyone in the meeting, and chosen by somebody who has proved
 * nothing about themselves. The characters stripped above are the ones that let
 * a name misrepresent where it came from — text rendered right-to-left over its
 * neighbours, or padded out of its own label with invisible whitespace.
 *
 * It cannot stop somebody typing a colleague's name, because no name field can.
 * That is why guests are labelled as guests wherever they appear, rather than
 * being trusted to identify themselves honestly.
 */
export function cleanGuestName(raw) {
  const cleaned = String(raw ?? '')
    .replace(UNSAFE_NAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

  if (cleaned.length < 1) {
    throw ApiError.badRequest('Enter the name you want to appear as.', [
      { field: 'name', message: 'Please enter a name.' },
    ]);
  }

  return cleaned;
}

/**
 * Whether this meeting will take guests at all.
 *
 * Three independent gates, and all of them must agree:
 *
 *   1. org policy allows external guests
 *   2. the meeting's own settings allow them
 *   3. the meeting's access is `anyone`
 *
 * The third is the important one. `texor` means "anyone with a Texor Account",
 * which is a statement that signing in is required — quietly letting someone
 * past that with a typed name would make the setting a lie. Opening a meeting
 * to people without accounts has to be a decision somebody took.
 */
export function guestsAllowed(meeting, policy) {
  if (!policy.allowExternalGuests) {
    return { allowed: false, reason: 'Your organisation does not allow guests without an account.' };
  }
  if (!meeting.settings.allowExternalGuests) {
    return { allowed: false, reason: 'This meeting is not open to guests.' };
  }
  if (meeting.access !== 'anyone') {
    return {
      allowed: false,
      reason: meeting.access === 'invited'
        ? 'This meeting is for invited people only.'
        : 'This meeting needs a Texor Account to join.',
    };
  }
  if (meeting.status === 'cancelled' || meeting.status === 'ended') {
    return { allowed: false, reason: 'This meeting is over.' };
  }

  return { allowed: true };
}

export async function createGuestSession({ meeting, name, ip = '', userAgent = '' }) {
  const token = randomToken(32);
  const guestId = `guest:${randomToken(16)}`;

  await GuestSession.create({
    tokenHash: sha256(token),
    meeting: meeting._id,
    guestId,
    name,
    ip,
    userAgent: userAgent.slice(0, 512),
    expiresAt: new Date(Date.now() + GUEST_TTL_MS),
  });

  return { token, guestId, name };
}

/**
 * Resolves a guest cookie into something shaped like a user.
 *
 * The returned object carries `isGuest` and a `meetingId`, and every caller is
 * expected to check both — a guest pass for one meeting must not open another,
 * and a guest must not reach anything that assumes a Texor identity.
 */
export async function resolveGuest(token) {
  if (!token) return null;

  const session = await GuestSession.findOne({ tokenHash: sha256(token) })
    // The code as well as the id, so a client can tell whether this pass is for
    // the meeting it is looking at without a second round trip.
    .populate('meeting', 'code')
    .exec();

  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  // A pass whose meeting has been deleted is a pass to nowhere.
  if (!session.meeting) return null;

  return {
    isGuest: true,
    texorId: session.guestId,
    displayName: session.name,
    email: '',
    picture: '',
    meetingId: session.meeting._id.toString(),
    meetingCode: session.meeting.code,
  };
}

export async function revokeGuest(token) {
  if (!token) return;
  await GuestSession.updateOne({ tokenHash: sha256(token) }, { $set: { revokedAt: new Date() } });
}

/** The guard every guest-reachable route needs: right kind, right meeting. */
export function assertGuestScope(user, meeting) {
  if (!user?.isGuest) return;
  if (user.meetingId !== meeting._id.toString()) {
    throw ApiError.forbidden('Your guest pass is for a different meeting.');
  }
}

export default {
  GUEST_COOKIE,
  guestCookieOptions,
  cleanGuestName,
  guestsAllowed,
  createGuestSession,
  resolveGuest,
  revokeGuest,
  assertGuestScope,
};
