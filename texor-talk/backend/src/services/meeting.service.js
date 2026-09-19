/**
 * The rules of a meeting: when it happens, who may walk in, and who has to
 * knock. The controller does HTTP; the decisions live here.
 */
import Meeting from '../models/Meeting.js';
import Knock from '../models/Knock.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { meetingCode } from '../utils/ids.js';
import { admissionFor } from './admission.service.js';

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
  /**
   * Who, and whether they knock, is decided in one place — see
   * `admission.service.js`. What stays here is *when* and *how many*.
   */
  const decision = admissionFor({ meeting, user, policy });

  if (decision.outcome === 'refuse') {
    throw new ApiError(decision.status ?? 403, decision.code, decision.reason);
  }

  const { role, isHost, isExternal } = decision;

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
  // Occupied minutes, not minutes since it started: an hour of nobody being
  // here should not spend somebody's hour.
  if (meeting.maxDurationMinutes > 0 && meeting.startedAt) {
    const elapsedMinutes = elapsedMsOf(meeting, now.getTime()) / MINUTE;
    if (elapsedMinutes > meeting.maxDurationMinutes) {
      throw new ApiError(
        410,
        'meeting_over',
        `This meeting reached its ${meeting.maxDurationMinutes} minute limit.`,
      );
    }
  }

  // ── Lobby ──
  return { outcome: decision.outcome, role, isExternal, lobby: decision.lobby, why: decision.why };
}

/**
 * Records that someone is in the call.
 *
 * Idempotent per person: a reconnect updates the existing row and counts the
 * rejoin, rather than adding a second line for the same human.
 */
/**
 * Save, and if somebody else saved first, do it again on top of their version.
 *
 * Two people admitted at once collect their admission in the same instant, and
 * both requests write to the one meeting document; Mongoose refuses the second
 * with a VersionError, which reached the person as "something went wrong on our
 * end" for a write that only moved a timestamp. Retrying on a freshly read
 * document re-applies the intent rather than overwriting whatever the winner
 * just wrote, so neither attendance row is lost.
 */
export async function saveReapplying(meeting, apply, attempts = 3) {
  let doc = meeting;

  for (let attempt = 1; ; attempt += 1) {
    const result = apply(doc);

    try {
      await doc.save();
      return { ...result, meeting: doc };
    } catch (error) {
      if (error?.name !== 'VersionError' || attempt >= attempts) throw error;
      doc = await Meeting.findById(meeting._id).exec();
      if (!doc) throw error;
    }
  }
}

export async function markJoined({ meeting, user, role, now = new Date() }) {
  return saveReapplying(meeting, (doc) => {
    const existing = doc.attendance.find((entry) => entry.texorId === user.texorId);
    const wasPresent = Boolean(existing && !existing.leftAt);

    // Getting in earns a pass for the rest of this sitting — a dropped connection
    // or a coffee break does not mean knocking again. It ends when the room
    // empties (`reconcileHost`), the meeting ends, or the host tightens the door.
    if (!doc.admittedTexorIds.includes(user.texorId)) {
      doc.admittedTexorIds.push(user.texorId);
    }

    if (existing) {
      existing.lastSeenAt = now;
      existing.role = role;
      if (existing.leftAt) {
        existing.leftAt = null;
        existing.joins += 1;
      }
    } else {
      doc.attendance.push({
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

    const started = doc.status !== 'live';
    if (started) {
      doc.status = 'live';
      doc.startedAt = doc.startedAt ?? now;

      // Left behind until now, so a running meeting carried the time it had
      // supposedly ended at — which read as a contradiction anywhere the two
      // were shown together, and would have made "is it over" ambiguous for
      // anything deciding by `endedAt` rather than by status.
      doc.endedAt = null;
      doc.endedReason = '';
    }

    // Somebody is here by definition, so the clock runs; and if nobody present
    // can run the room, the person who just arrived can.
    const here = doc.liveAttendance().map((entry) => entry.texorId);
    syncActiveTime(doc, here.length, now);
    reconcileHost(doc, here);

    return { started, wasPresent };
  });
}

/**
 * How long the room has actually been occupied, in milliseconds.
 *
 * `activeMs` is what previous stretches banked; `activeSince` is the one still
 * running. Reading them together is the only correct way to ask "how long has
 * this meeting been going" — `now - startedAt` counts the hours nobody was
 * here, and counts them again after a reopen.
 */
export const elapsedMsOf = (meeting, now = Date.now()) => {
  const banked = Number(meeting.activeMs) || 0;
  if (!meeting.activeSince) return banked;

  // Clamped: a clock that steps backwards must not subtract from time that was
  // genuinely spent.
  return banked + Math.max(0, now - new Date(meeting.activeSince).getTime());
};

/**
 * Start or stop the clock as the room fills and empties.
 *
 * Idempotent in both directions, which matters because presence is reconciled
 * from several places — a join, a leave, the five-second ticker, and a lazy
 * sweep on read — and two of them can easily see the same transition. Calling
 * this twice for one departure must not bank the stretch twice.
 */
export function syncActiveTime(meeting, presentCount, now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);

  if (presentCount > 0) {
    if (!meeting.activeSince) meeting.activeSince = at;
    return false;
  }

  if (!meeting.activeSince) return false;

  meeting.activeMs = (Number(meeting.activeMs) || 0)
    + Math.max(0, at.getTime() - new Date(meeting.activeSince).getTime());
  meeting.activeSince = null;
  return true;
}

/**
 * Who, of the people currently here, should run the room.
 *
 * Prefers a signed-in member over a guest, then whoever has been here longest.
 * A guest ends up hosting only a room that is entirely guests — which is the
 * right answer for a room that is entirely guests, and the wrong one anywhere
 * else.
 */
export function earliestJoined(meeting, presentTexorIds) {
  const present = new Set(presentTexorIds);

  const candidates = meeting.attendance
    /**
     * Only somebody who is actually in the room, by the room's own rules.
     *
     * A socket lingers for a moment after somebody hangs up, and the server's
     * next read of "who is here" still counts it. That ghost was enough to be
     * handed the empty room — and an acting host never knocks, so hanging up
     * and coming back was a way past the waiting room. A pass for this sitting
     * is what "legitimately here" means; `markJoined` writes one for everybody
     * it lets in, and it is cleared when the room empties.
     */
    .filter((entry) => present.has(entry.texorId) && (meeting.admittedTexorIds ?? []).includes(entry.texorId))
    .sort((left, right) => {
      const guest = Number(left.role === 'guest') - Number(right.role === 'guest');
      if (guest !== 0) return guest;
      return new Date(left.firstJoinedAt).getTime() - new Date(right.firstJoinedAt).getTime();
    });

  return candidates[0]?.texorId ?? null;
}

/**
 * Keep the room in the hands of somebody who is in it.
 *
 * A meeting used to be left hostless the moment its owner closed their laptop:
 * nobody could admit from the lobby, nobody could mute, and a knocker waited
 * at a door that could not be opened. The old answer was a dialog asking the
 * departing host to nominate a successor, which is a question the product can
 * answer for itself — and could not answer at all when the host simply lost
 * their connection.
 *
 * Returns true when something changed, so callers know whether to save.
 */
export function reconcileHost(meeting, presentTexorIds) {
  const present = new Set(presentTexorIds);
  const before = meeting.actingHostTexorId;

  /**
   * An empty room is the end of a sitting.
   *
   * Everybody who was let in during it loses their pass, and whoever was
   * standing in for the host stops being the host. Both used to outlive the
   * sitting indefinitely — a pass from last week's meeting walked past "everyone
   * knocks" this week, and a stand-in coming back to an empty room was the host
   * again before anybody had admitted them. A dropped connection with somebody
   * else still in the call is not the end of anything, so it keeps its pass.
   */
  if (present.size === 0) {
    const changed = Boolean(before) || meeting.admittedTexorIds.length > 0;
    meeting.actingHostTexorId = null;
    meeting.admittedTexorIds = [];
    return changed;
  }

  /**
   * The owner takes it back by walking in.
   *
   * The stand-in becomes a co-host rather than dropping to nothing: they have
   * been running the room, possibly for an hour, and taking the admit button
   * out of their hands the moment the owner reappears would be a worse
   * surprise than leaving it there.
   */
  if (present.has(meeting.hostTexorId)) {
    if (before && before !== meeting.hostTexorId && !meeting.cohostTexorIds.includes(before)) {
      meeting.cohostTexorIds.push(before);
    }
    meeting.actingHostTexorId = null;
    return before !== null;
  }

  const covered = meeting.cohostTexorIds.some((id) => present.has(id))
    || Boolean(before && present.has(before));

  // Somebody here can already run it.
  if (covered) return false;

  meeting.actingHostTexorId = earliestJoined(meeting, present);
  return meeting.actingHostTexorId !== before;
}

export async function markLeft({ meeting, texorId, now = new Date() }) {
  const entry = meeting.attendance.find((item) => item.texorId === texorId);
  if (!entry || entry.leftAt) return false;

  // Two people leaving at the same moment write the same document, and the
  // second save is refused; see `saveReapplying`.
  const { left } = await saveReapplying(meeting, (doc) => {
    const row = doc.attendance.find((item) => item.texorId === texorId);
    if (!row || row.leftAt) return { left: false };

    row.leftAt = now;
    row.lastSeenAt = now;

    /**
     * The last person out stops the clock.
     *
     * This cannot be left to the ticker: when the final socket closes the room
     * is deleted from memory, and the ticker only visits meetings that still
     * have a connected socket — so it would never look at this meeting again
     * and the running stretch would stay open forever, quietly counting an
     * empty room for as long as the record lasted.
     */
    const here = doc.liveAttendance().map((item) => item.texorId);
    syncActiveTime(doc, here.length, now);
    reconcileHost(doc, here);

    return { left: true };
  });

  return left;
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

  /**
   * The two things that follow from presence, settled here because this is the
   * only place holding the authoritative list of who is connected.
   *
   * `markPresent` runs from the five-second ticker and from the lazy sweep on
   * read, so both the clock and the room's custody stay right even when the
   * events that should have updated them were missed — a browser that crashed
   * without a close frame, a server restart, a socket that died silently.
   */
  if (syncActiveTime(meeting, present.size, now)) changed = true;
  if (reconcileHost(meeting, texorIds)) changed = true;

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

  // Reaping is how a crashed client is noticed, and it can be what empties the
  // room — so the clock has to stop here too, backdated to nothing later than
  // now. Without this, a room emptied by a crash rather than a goodbye would
  // keep counting.
  if (changed && syncActiveTime(meeting, meeting.liveAttendance().length, now)) changed = true;

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

  // Everybody was just marked gone, so the stretch that was running is over.
  syncActiveTime(meeting, 0, now);

  /**
   * Custody ends with the sitting.
   *
   * Cleared rather than kept, because the next person through the door should
   * be able to run the room — leaving a stand-in named here would mean an
   * empty, reopened meeting had a host who was not in it and could not admit
   * anybody.
   */
  meeting.actingHostTexorId = null;

  // And so do the passes. Coming back to a reopened meeting is a new sitting,
  // and "everyone knocks" means everyone again.
  meeting.admittedTexorIds = [];

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
  // A new occurrence has run for no time and is nobody's to host yet.
  meeting.activeMs = 0;
  meeting.activeSince = null;
  meeting.actingHostTexorId = null;
  // Last week's pass does not open this week's door.
  meeting.admittedTexorIds = [];
  return true;
}

export default {
  allocateCode,
  elapsedMsOf,
  syncActiveTime,
  reconcileHost,
  earliestJoined,
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
