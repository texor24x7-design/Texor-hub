/**
 * The rules of a meeting: when it happens, who may walk in, and who has to
 * knock. The controller does HTTP; the decisions live here.
 */
import Meeting from '../models/Meeting.js';
import Knock from '../models/Knock.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { meetingCode } from '../utils/ids.js';
import { effectiveLobby, isExternalEmail } from './policy.service.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** How long after a meeting's scheduled end the code still opens the room. */
const LATE_JOIN_GRACE_MS = 2 * HOUR;

export const KNOCK_TTL_MS = 10 * MINUTE;

/**
 * Allocates an unused meeting code.
 *
 * Retries on collision rather than trusting the odds, and then gives up rather
 * than looping forever — if ten random draws in a row are all taken, something
 * is wrong that a eleventh draw will not fix.
 */
export async function allocateCode(attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = meetingCode();
    const taken = await Meeting.exists({ code });
    if (!taken) return code;
  }
  throw new Error('Could not allocate an unused meeting code.');
}

// ── Recurrence ───────────────────────────────────────────────────────────────

const addDays = (date, days) => new Date(date.getTime() + days * 24 * HOUR);

function addMonths(date, months) {
  const next = new Date(date);
  const targetDay = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  // A meeting on the 31st lands on the 3rd of the month after a 28-day one
  // unless it is pulled back — calendars clamp to the last day, so do we.
  if (next.getUTCDate() < targetDay) next.setUTCDate(0);
  return next;
}

function step(date, recurrence) {
  const interval = Math.max(1, recurrence.interval ?? 1);

  switch (recurrence.freq) {
    case 'daily':
      return addDays(date, interval);
    case 'weekly':
      return addDays(date, 7 * interval);
    case 'monthly':
      return addMonths(date, interval);
    case 'weekdays': {
      // Interval is meaningless for a weekdays rule: the next one is simply
      // the next day that is not a weekend.
      let next = addDays(date, 1);
      while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next = addDays(next, 1);
      return next;
    }
    default:
      return null;
  }
}

/**
 * The occurrence of a recurring meeting that matters right now — the one in
 * progress if there is one, otherwise the next one due.
 *
 * Returns null once the series has run out, which is how a finished recurring
 * meeting stops accepting joins without anyone having to cancel it.
 */
export function currentOccurrence(meeting, now = new Date()) {
  if (!meeting.scheduledStart) return null;

  const start = new Date(meeting.scheduledStart);
  const durationMs = meeting.scheduledEnd
    ? new Date(meeting.scheduledEnd).getTime() - start.getTime()
    : HOUR;

  const recurrence = meeting.recurrence ?? {};

  if (!recurrence.freq || recurrence.freq === 'none') {
    return { start, end: new Date(start.getTime() + durationMs), index: 0, isLast: true };
  }

  const until = recurrence.until ? new Date(recurrence.until) : null;
  const limit = recurrence.count ?? 0;
  // Two years of daily occurrences, as a stop rather than a feature: a rule
  // that has not resolved by then is malformed, not merely long.
  const maxIterations = 800;

  let cursor = start;
  let index = 0;

  while (index < maxIterations) {
    const end = new Date(cursor.getTime() + durationMs);
    const withinCount = limit === 0 || index < limit;
    const withinUntil = !until || cursor <= until;

    if (!withinCount || !withinUntil) return null;

    // The one in progress, or the next one still to come.
    if (end.getTime() + LATE_JOIN_GRACE_MS > now.getTime()) {
      const next = step(cursor, recurrence);
      const hasMore =
        next !== null &&
        (limit === 0 || index + 1 < limit) &&
        (!until || next <= until);

      return { start: cursor, end, index, isLast: !hasMore };
    }

    const next = step(cursor, recurrence);
    if (!next) return null;
    cursor = next;
    index += 1;
  }

  return null;
}

/** When the doors open and when the code stops working, for one occurrence. */
export function joinWindow(meeting, occurrence) {
  if (!occurrence) return { opensAt: null, closesAt: null };

  return {
    opensAt: new Date(occurrence.start.getTime() - env.MEETING_JOIN_EARLY_MINUTES * MINUTE),
    closesAt: new Date(occurrence.end.getTime() + LATE_JOIN_GRACE_MS),
  };
}

// ── Joining ──────────────────────────────────────────────────────────────────

/**
 * Decides what happens when someone asks to join.
 *
 * One function for the whole decision on purpose. Spread across a controller
 * these checks drift, and "who can get into a meeting" is exactly the logic
 * that must not have two slightly different versions of itself.
 *
 * Returns `{ outcome: 'admit' | 'knock', role }`, or throws the refusal.
 */
export async function evaluateJoin({ meeting, user, policy, now = new Date() }) {
  if (meeting.status === 'cancelled') {
    throw new ApiError(410, 'meeting_cancelled', 'This meeting was cancelled.');
  }
  if (meeting.status === 'ended' && !meeting.isHost(user.texorId)) {
    throw new ApiError(410, 'meeting_ended', 'This meeting has ended.');
  }

  if (meeting.isRemoved(user.texorId)) {
    throw ApiError.forbidden('You were removed from this meeting.');
  }

  const role = meeting.roleOf(user.texorId, user.email);
  const isHost = role === 'host' || role === 'cohost';
  // A guest has no email and therefore no domain to match; they are external by
  // definition, and must not fall through to "nobody is external" when
  // ORG_EMAIL_DOMAINS is unset.
  const isExternal = Boolean(user.isGuest) || isExternalEmail(user.email);

  // ── Is this person allowed in at all ──
  if (isExternal && !(policy.allowExternalGuests && meeting.settings.allowExternalGuests)) {
    throw ApiError.forbidden('This meeting is not open to guests from outside the organisation.');
  }

  if (meeting.access === 'invited' && role === 'guest') {
    throw ApiError.forbidden('This meeting is for invited people only.');
  }

  // ── Is it the right time ──
  // Hosts are never held back: someone has to be able to open the room early.
  if (!isHost && meeting.scheduledStart && meeting.status !== 'live') {
    const occurrence = currentOccurrence(meeting, now);
    if (!occurrence) {
      throw new ApiError(410, 'meeting_over', 'This meeting series has finished.');
    }

    const { opensAt, closesAt } = joinWindow(meeting, occurrence);

    if (now < opensAt) {
      throw new ApiError(
        425,
        'too_early',
        `This meeting opens ${env.MEETING_JOIN_EARLY_MINUTES} minutes before it starts.`,
        { opensAt },
      );
    }
    if (now > closesAt) {
      throw new ApiError(410, 'meeting_over', 'This meeting is over.');
    }
  }

  // ── Is there room ──
  if (!isHost && meeting.maxParticipants > 0) {
    if (meeting.liveAttendance().length >= meeting.maxParticipants) {
      throw new ApiError(
        409,
        'meeting_full',
        `This meeting is limited to ${meeting.maxParticipants} participants.`,
      );
    }
  }

  // ── Has it run past its limit ──
  if (meeting.maxDurationMinutes > 0 && meeting.startedAt) {
    const elapsedMinutes = (now.getTime() - meeting.startedAt.getTime()) / MINUTE;
    if (elapsedMinutes > meeting.maxDurationMinutes) {
      throw new ApiError(
        410,
        'meeting_over',
        `This meeting reached its ${meeting.maxDurationMinutes} minute limit.`,
      );
    }
  }

  // ── Lobby ──
  /**
   * Anyone who has already been inside walks straight back in.
   *
   * This covers both a reconnect (still on the participant list) and a return
   * (left and came back). The waiting room exists to vet strangers, and someone
   * a host has already admitted is not one — making them knock again every time
   * their wifi drops turns the lobby into a tax on the host.
   */
  if (meeting.hasBeenAdmitted(user.texorId)) {
    return { outcome: 'admit', role, isExternal, lobby: meeting.lobby };
  }

  const lobby = effectiveLobby(meeting, policy, { isExternal });
  const mustKnock =
    !isHost && (lobby === 'everyone' || (lobby === 'external' && (isExternal || role === 'guest')));

  // Nobody to let them in. Rather than leave someone staring at a waiting
  // screen no host will ever see, the first arrival opens the room themselves.
  if (mustKnock && meeting.liveAttendance().length === 0 && meeting.status !== 'live') {
    throw new ApiError(
      409,
      'host_not_present',
      'The host has not started this meeting yet. Try again once it begins.',
    );
  }

  return { outcome: mustKnock ? 'knock' : 'admit', role, isExternal, lobby };
}

/**
 * Records that someone is in the call.
 *
 * Idempotent per person: a reconnect updates the existing row and counts the
 * rejoin, rather than adding a second line for the same human.
 */
export async function markJoined({ meeting, user, role, now = new Date() }) {
  const existing = meeting.attendance.find((entry) => entry.texorId === user.texorId);
  const wasPresent = Boolean(existing && !existing.leftAt);

  // Getting in at all is what earns a standing pass for this meeting, whether
  // it came from a host admitting them or from walking in with no lobby.
  if (!meeting.admittedTexorIds.includes(user.texorId)) {
    meeting.admittedTexorIds.push(user.texorId);
  }

  if (existing) {
    existing.lastSeenAt = now;
    existing.role = role;
    if (existing.leftAt) {
      existing.leftAt = null;
      existing.joins += 1;
    }
  } else {
    meeting.attendance.push({
      texorId: user.texorId,
      name: user.displayName || user.email,
      picture: user.picture ?? '',
      email: user.email,
      role,
      firstJoinedAt: now,
      lastSeenAt: now,
      joins: 1,
    });
  }

  const started = meeting.status !== 'live';
  if (started) {
    meeting.status = 'live';
    meeting.startedAt = meeting.startedAt ?? now;
  }

  await meeting.save();
  return { started, wasPresent };
}

export async function markLeft({ meeting, texorId, now = new Date() }) {
  const entry = meeting.attendance.find((item) => item.texorId === texorId);
  if (!entry || entry.leftAt) return false;

  entry.leftAt = now;
  entry.lastSeenAt = now;
  await meeting.save();
  return true;
}

/**
 * Marks everyone with an open socket as still here.
 *
 * This is the write that keeps `reapStaleAttendance` honest, and its absence
 * was a real bug: presence moved onto the WebSocket, but nothing then refreshed
 * `lastSeenAt`, so after `MEETING_HEARTBEAT_TIMEOUT_SECONDS` every participant
 * looked departed. The next request to touch the meeting — somebody new
 * joining, a knock being polled, a host admitting — reaped the lot of them,
 * decided the meeting was abandoned and ended it under everyone.
 *
 * Called from the room ticker, which already knows precisely who is connected.
 */
export function markPresent(meeting, texorIds, now = new Date()) {
  const present = new Set(texorIds);
  let changed = false;

  for (const entry of meeting.attendance) {
    if (!present.has(entry.texorId)) continue;

    entry.lastSeenAt = now;
    // A reconnect inside the timeout window puts them back without a rejoin.
    if (entry.leftAt) {
      entry.leftAt = null;
      changed = true;
    }
    changed = true;
  }

  return changed;
}

/**
 * Closes out anyone whose browser stopped checking in.
 *
 * Leaving is normally reported by the client, and a client that crashes or
 * loses power never reports anything. Without this sweep those people stay
 * "in the meeting" forever, which quietly breaks the participant count, the
 * capacity limit and every attendance report.
 */
export function reapStaleAttendance(meeting, now = new Date()) {
  const cutoff = now.getTime() - env.MEETING_HEARTBEAT_TIMEOUT_SECONDS * 1000;
  let changed = false;

  for (const entry of meeting.attendance) {
    if (!entry.leftAt && entry.lastSeenAt.getTime() < cutoff) {
      entry.leftAt = entry.lastSeenAt;
      changed = true;
    }
  }

  return changed;
}

/**
 * Whether a live meeting has been empty long enough to close itself out.
 *
 * The delay matters. Someone who steps out for ten seconds, or whose laptop
 * sleeps on the way to a meeting room, has not ended the meeting — and without
 * a grace period the next person to arrive would be told it was over. Once
 * everybody has genuinely been gone for a full heartbeat timeout, it is over.
 */
export function isAbandoned(meeting, now = new Date()) {
  if (meeting.status !== 'live' || !meeting.startedAt) return false;
  if (meeting.attendance.some((entry) => !entry.leftAt)) return false;

  const lastDeparture = Math.max(
    ...meeting.attendance.map((entry) => entry.leftAt.getTime()),
    meeting.startedAt.getTime(),
  );

  return now.getTime() - lastDeparture > env.MEETING_HEARTBEAT_TIMEOUT_SECONDS * 1000;
}

/** Ends a meeting and closes every open attendance row in the same breath. */
export async function endMeeting({ meeting, reason, now = new Date() }) {
  for (const entry of meeting.attendance) {
    if (!entry.leftAt) entry.leftAt = now;
  }

  meeting.status = 'ended';
  meeting.endedAt = now;
  meeting.endedReason = reason;

  // Everybody in the waiting room is waiting for a door that is now shut.
  await Knock.updateMany(
    { meeting: meeting._id, status: 'waiting' },
    { $set: { status: 'denied', decidedAt: now } },
  );

  await meeting.save();
  return meeting;
}

/**
 * A recurring meeting does not stay ended.
 *
 * Once the occurrence that ended is behind us and another is due, the document
 * goes back to `scheduled` so the same code opens next week's call. Attendance
 * from the finished occurrence is cleared — it has already been written to the
 * audit log, which is where the durable record of who attended lives.
 */
export function rollForward(meeting, now = new Date()) {
  if (meeting.status !== 'ended') return false;
  if (!meeting.recurrence?.freq || meeting.recurrence.freq === 'none') return false;

  const occurrence = currentOccurrence(meeting, now);
  if (!occurrence) return false;
  // Still inside the occurrence that was ended — it stays ended.
  if (meeting.endedAt && occurrence.start <= meeting.endedAt) return false;

  meeting.status = 'scheduled';
  meeting.startedAt = null;
  meeting.endedAt = null;
  meeting.endedReason = '';
  meeting.attendance = [];
  return true;
}

export default {
  allocateCode,
  currentOccurrence,
  joinWindow,
  evaluateJoin,
  markJoined,
  markLeft,
  markPresent,
  reapStaleAttendance,
  endMeeting,
  rollForward,
  isAbandoned,
  KNOCK_TTL_MS,
};
