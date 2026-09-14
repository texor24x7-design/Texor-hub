/**
 * Recording and verifying the audit trail.
 *
 * Call `record` from the place the thing actually happened, after it has
 * happened — never from a route as a wrapper. An audit line written before the
 * write it describes is a line that can be a lie.
 */
import AuditEvent, { AuditCounter } from '../models/AuditEvent.js';
import logger from '../utils/logger.js';
import { sha256 } from '../utils/ids.js';

export const ACTIONS = {
  MEETING_CREATED: 'meeting.created',
  MEETING_UPDATED: 'meeting.updated',
  MEETING_CANCELLED: 'meeting.cancelled',
  MEETING_STARTED: 'meeting.started',
  MEETING_ENDED: 'meeting.ended',
  MEETING_JOINED: 'meeting.joined',
  MEETING_LEFT: 'meeting.left',
  MEETING_JOIN_DENIED: 'meeting.join_denied',
  LOBBY_KNOCKED: 'lobby.knocked',
  LOBBY_ADMITTED: 'lobby.admitted',
  LOBBY_DENIED: 'lobby.denied',
  PARTICIPANT_REMOVED: 'participant.removed',
  ROLE_GRANTED: 'role.granted',
  ROLE_REVOKED: 'role.revoked',
  INVITEE_ADDED: 'invitee.added',
  INVITEE_REMOVED: 'invitee.removed',
  INVITE_RESPONDED: 'invite.responded',
  POLICY_UPDATED: 'policy.updated',
  GUEST_ADMITTED_PASS: 'guest.pass_issued',
};

// Field separator for the hashed form. A control character, so it cannot occur
// inside a name or an agenda and let two different events hash the same.
const SEP = String.fromCharCode(31);

/**
 * The bytes that get hashed.
 *
 * Built by hand from a fixed field order rather than by serialising the
 * document, because `JSON.stringify` over a Mongoose object folds in key order
 * and undefined-vs-missing differences, and would make verification flaky for
 * reasons that have nothing to do with tampering.
 */
function canonical(event) {
  return [
    event.seq,
    new Date(event.at).toISOString(),
    event.action,
    event.actorTexorId ?? '',
    event.actorEmail ?? '',
    event.meetingCode ?? '',
    event.targetTexorId ?? '',
    JSON.stringify(event.metadata ?? {}),
  ].join(SEP);
}

export const hashEvent = (event) => sha256(canonical(event));

/** Atomically claims the next sequence number. */
async function nextSeq() {
  const counter = await AuditCounter.findOneAndUpdate(
    { key: 'audit' },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return counter.value;
}

/**
 * Appends one event.
 *
 * Never throws. An audit write that fails is worth an error in the log and a
 * look in the morning; it is not worth failing the join the user is in the
 * middle of, and throwing from here would do exactly that.
 */
export async function record({
  action,
  actor = null,
  meeting = null,
  target = null,
  metadata = {},
  req = null,
}) {
  try {
    const event = {
      seq: await nextSeq(),
      at: new Date(),
      action,
      actorTexorId: actor?.texorId ?? null,
      actorName: actor?.displayName ?? actor?.name ?? '',
      actorEmail: actor?.email ?? '',
      meeting: meeting?._id ?? null,
      meetingCode: meeting?.code ?? null,
      targetTexorId: target?.texorId ?? null,
      targetName: target?.name ?? target?.displayName ?? '',
      metadata,
      ip: req?.ip ?? '',
      userAgent: (req?.get?.('user-agent') ?? '').slice(0, 512),
    };

    return await AuditEvent.create({ ...event, hash: hashEvent(event) });
  } catch (error) {
    logger.error('audit write failed', { action, message: error.message });
    return null;
  }
}

/**
 * Re-reads the whole log and reports whether it still adds up.
 *
 * Two independent checks: every row must hash to its stored value (nothing was
 * edited), and the sequence numbers must run without a gap (nothing was
 * removed). `head` is the hash of the newest event — anchoring that value
 * somewhere outside this database is what would close the last hole.
 */
export async function verifyChain() {
  const events = await AuditEvent.find().sort({ seq: 1 }).lean();

  const tampered = [];
  const gaps = [];
  let expected = 1;

  for (const event of events) {
    if (hashEvent(event) !== event.hash) tampered.push(event.seq);
    while (expected < event.seq) gaps.push(expected++);
    expected = event.seq + 1;
  }

  return {
    ok: tampered.length === 0 && gaps.length === 0,
    events: events.length,
    firstSeq: events.at(0)?.seq ?? null,
    lastSeq: events.at(-1)?.seq ?? null,
    head: events.at(-1)?.hash ?? null,
    tamperedSeqs: tampered,
    missingSeqs: gaps,
  };
}

export default { ACTIONS, record, verifyChain, hashEvent };
