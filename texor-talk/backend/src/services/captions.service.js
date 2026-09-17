/**
 * Captions and the transcript they leave behind.
 *
 * The recogniser in `whisper.service.js` turns audio into text and knows
 * nothing else. This is the layer that decides whether a meeting is allowed to
 * do that at all, who the words belong to, and what is kept afterwards.
 *
 * ── On keeping a record of what people said ──
 *
 * A stored transcript is a materially different thing from a live caption. A
 * caption helps somebody follow the sentence they are hearing and then it is
 * gone; a transcript is a durable record of what a named person said, which is
 * the sort of thing that turns up in a dispute. So it is gated in three places
 * rather than one — the organisation allows it, the host turns it on for this
 * meeting, and everybody in the room is told while it is happening — and the
 * act of turning it on is written to the audit log with a name against it.
 */
import Transcript from '../models/Transcript.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { languagesIn, toSegment } from '../utils/transcript.js';

/**
 * The most utterances one transcript will hold.
 *
 * A document cannot exceed sixteen megabytes. At the two hundred-odd bytes an
 * utterance takes, this is roughly forty hours of continuous speech — far
 * beyond any real meeting, and low enough that the limit is hit by something
 * going wrong rather than by somebody talking a lot.
 */
const MAX_SEGMENTS = 40_000;

/** Whether the organisation permits captions at all. */
export const captionsAllowed = (policy) => Boolean(policy?.allowCaptions ?? true) && env.captions.enabled;

/** Whether this meeting's transcript is kept once the call ends. */
export const transcriptsStored = (policy) => captionsAllowed(policy) && Boolean(policy?.storeTranscripts ?? true);

/**
 * Whether captions are on for this meeting, given what the org allows.
 *
 * The org can only ever turn this *off*. A host cannot switch on something the
 * organisation has withdrawn, and an org that allows captions does not thereby
 * turn them on in everybody's meetings.
 */
export function effectiveCaptions(meeting, policy) {
  if (!captionsAllowed(policy)) return 'off';
  return meeting?.settings?.captions === 'on' ? 'on' : 'off';
}

/** When a transcript created now should be deleted, or null to keep it. */
export function expiryFor(policy) {
  const days = Number(policy?.transcriptRetentionDays ?? 0);
  if (!days || days <= 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Opens the transcript for a meeting, or returns the one already open.
 *
 * Upsert rather than find-then-create, for the same reason the policy document
 * is: two people can turn captions on in the same instant, and two transcripts
 * for one meeting would mean half the conversation in each.
 */
export async function openTranscript({ meeting, user, policy }) {
  if (!transcriptsStored(policy)) return null;

  return Transcript.findOneAndUpdate(
    { meetingCode: meeting.code },
    {
      $setOnInsert: {
        meetingCode: meeting.code,
        meeting: meeting._id,
        meetingTitle: meeting.title,
        meetingStartedAt: meeting.startedAt,
        startedByTexorId: user?.texorId ?? null,
        startedByName: user?.displayName ?? user?.name ?? '',
        expiresAt: expiryFor(policy),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}

/**
 * Records one utterance.
 *
 * Returns the stored segment, or null if the text was noise or the transcript
 * is closed — the caller uses that to decide whether to broadcast, so filtered
 * hallucinations never reach anybody's screen either.
 *
 * ── Why this is three atomic updates and not one read-modify-write ──
 *
 * Several people talk at once, and each of their utterances arrives on its own
 * socket and finishes recognition at its own time. Loading the document,
 * pushing onto the array and saving would drop whichever of two concurrent
 * utterances lost the race, silently. `$push` and `$addToSet` are applied by
 * the database to whatever the document is at that moment, so concurrent
 * speakers cannot overwrite one another.
 */
export async function appendSegment({ meetingCode, speaker, recognised, startedAt, durationMs, meetingStartedAt }) {
  const segment = toSegment({
    speakerTexorId: speaker.texorId,
    speakerName: speaker.name,
    text: recognised.text,
    language: recognised.language,
    confidence: recognised.confidence,
    startedAt,
    durationMs,
    offsetMs: meetingStartedAt ? new Date(startedAt) - new Date(meetingStartedAt) : 0,
  });

  // Noise. Nothing to store, and nothing to show anybody.
  if (!segment) return null;

  const result = await Transcript.updateOne(
    {
      meetingCode,
      deletedAt: null,
      // The cap, applied by the database rather than by reading the length
      // first — `$size` here is what makes "stop at the cap" race-free.
      [`segments.${MAX_SEGMENTS - 1}`]: { $exists: false },
    },
    {
      $push: { segments: segment },
      ...(segment.language ? { $addToSet: { languages: segment.language } } : {}),
    },
  );

  if (result.matchedCount === 0) {
    // Either there is no transcript for this meeting — captions are on but the
    // org does not store them — or the cap has been reached.
    await Transcript.updateOne(
      { meetingCode, deletedAt: null, truncated: false },
      { $set: { truncated: true } },
    ).catch(() => {});

    return segment;
  }

  /**
   * The speaker list, added to only once per person.
   *
   * Guarded by `$ne` rather than `$addToSet`, because the entry carries a name
   * and a picture — two `$addToSet` calls with a changed display name would
   * add the same person twice.
   */
  await Transcript.updateOne(
    { meetingCode, 'speakers.texorId': { $ne: speaker.texorId } },
    { $push: { speakers: { texorId: speaker.texorId, name: speaker.name, picture: speaker.picture ?? '' } } },
  ).catch(() => {});

  return segment;
}

/** Stamps the end of the meeting on the transcript. */
export async function closeTranscript(meetingCode, endedAt = new Date()) {
  return Transcript.updateOne(
    { meetingCode, meetingEndedAt: null },
    { $set: { meetingEndedAt: endedAt } },
  ).catch((error) => {
    logger.warn('closing transcript failed', { meetingCode, message: error.message });
    return null;
  });
}

export async function getTranscript(meetingCode) {
  return Transcript.findOne({ meetingCode, deletedAt: null }).lean();
}

/**
 * Who may read a meeting's transcript.
 *
 * Attendance, not invitation. Being invited to a meeting you did not go to
 * does not entitle you to a record of what the people who did go said in it —
 * and a guest, whose pass expires in hours and who has no account to sign back
 * into, never gets one at all.
 */
export function canReadTranscript(meeting, user) {
  if (!user || user.isGuest) return false;
  if (meeting.isHost(user.texorId) || meeting.isOwner(user.texorId)) return true;

  return meeting.attendance.some((entry) => entry.texorId === user.texorId);
}

/**
 * Re-applies the retention window to transcripts already stored.
 *
 * Called when an admin changes the policy. Without this, shortening retention
 * would only affect meetings held after the change, which is not what anybody
 * means by "we keep transcripts for thirty days" — the point of the setting is
 * the material already on disk.
 */
export async function applyRetention(policy) {
  const expiresAt = expiryFor(policy);

  if (!transcriptsStored(policy)) {
    // Storage switched off org-wide. Existing transcripts are left alone rather
    // than deleted — withdrawing permission to record in future is a different
    // decision from destroying the record of what already happened, and the
    // second one should never be a side effect of the first.
    return { updated: 0 };
  }

  const result = await Transcript.updateMany({ deletedAt: null }, { $set: { expiresAt } });
  return { updated: result.modifiedCount ?? 0 };
}

/** The transcript in the shape the API hands out. */
export function present(transcript) {
  if (!transcript) return null;

  return {
    meetingCode: transcript.meetingCode,
    meetingTitle: transcript.meetingTitle,
    meetingStartedAt: transcript.meetingStartedAt,
    meetingEndedAt: transcript.meetingEndedAt,
    startedByName: transcript.startedByName,
    speakers: transcript.speakers ?? [],
    languages: transcript.languages?.length ? transcript.languages : languagesIn(transcript.segments),
    segments: transcript.segments ?? [],
    truncated: Boolean(transcript.truncated),
    expiresAt: transcript.expiresAt ?? null,
    updatedAt: transcript.updatedAt,
  };
}

export default {
  captionsAllowed,
  transcriptsStored,
  effectiveCaptions,
  openTranscript,
  appendSegment,
  closeTranscript,
  getTranscript,
  canReadTranscript,
  applyRetention,
  present,
  MAX_SEGMENTS,
};
