/**
 * Reading back what a meeting's captions recorded.
 *
 * Live captions travel on the media socket, because they are part of the call.
 * The transcript is the opposite — it outlives the call, and is read from the
 * meeting page days later — so it is an ordinary authenticated resource here.
 *
 * Three routes: the conversation as data, the conversation as a file, and
 * deleting it. There is deliberately no route that edits one. A transcript that
 * anybody could rewrite is not a record of anything, and "this is what was
 * said, except where someone preferred otherwise" is a worse artefact to hold
 * than no artefact at all.
 */
import Meeting from '../models/Meeting.js';
import Transcript from '../models/Transcript.js';
import ApiError from '../utils/ApiError.js';
import { ACTIONS, record } from '../services/audit.service.js';
import { getPolicy } from '../services/policy.service.js';
import {
  canReadTranscript,
  captionsAllowed,
  getTranscript,
  present,
  transcriptsStored,
} from '../services/captions.service.js';
import { status as whisperStatus } from '../services/whisper.service.js';
import { countWords, renderTranscript, renderTranscriptFile } from '../utils/transcript.js';

/** The meeting, plus the check that this caller may see its transcript. */
async function loadFor(req) {
  const meeting = await Meeting.findOne({ code: (req.params.code ?? '').toLowerCase() }).exec();
  if (!meeting) throw ApiError.notFound('No meeting with that code.');

  if (!canReadTranscript(meeting, req.user)) {
    /**
     * "Not found" rather than "forbidden", and on purpose.
     *
     * Meeting codes are guessable by design. Answering 403 for a meeting that
     * exists and 404 for one that does not turns this route into a way to
     * enumerate which codes are real, and to learn that a particular meeting
     * was captioned — which is itself something people are entitled not to
     * broadcast.
     */
    throw ApiError.notFound('No transcript for that meeting.');
  }

  return meeting;
}

/**
 * Whether captions can run at all, for a client deciding what to draw.
 *
 * Answered before anybody is in a call, because the button has to be right the
 * first time it is shown — offering captions on a server with no model, and
 * failing once somebody presses it, is worse than not offering them.
 */
export async function captionsStatus(_req, res) {
  const policy = await getPolicy();
  const engine = await whisperStatus();

  res.json({
    captions: {
      allowed: captionsAllowed(policy),
      stored: transcriptsStored(policy),
      retentionDays: policy.transcriptRetentionDays,
      available: engine.available,
      // Only worth saying when something is actually wrong; a reason attached
      // to a working feature reads as a warning about it.
      reason: engine.available ? null : engine.reason,
      model: engine.model,
      language: engine.language,
    },
  });
}

export async function getMeetingTranscript(req, res) {
  const meeting = await loadFor(req);
  const transcript = await getTranscript(meeting.code);

  if (!transcript) {
    /**
     * A meeting with no transcript is not an error.
     *
     * Most meetings never turn captions on, and the page that shows this asks
     * for it unconditionally — answering 404 would make "nobody captioned this"
     * indistinguishable from "something went wrong" in every client that
     * handles the two differently.
     */
    return res.json({ transcript: null, captions: meeting.settings?.captions ?? 'off' });
  }

  res.json({
    transcript: {
      ...present(transcript),
      // Rendered server-side so the file somebody downloads and the text they
      // see on the page are produced by the same code and cannot drift.
      text: renderTranscript(transcript.segments),
      words: countWords(transcript.segments),
    },
    captions: meeting.settings?.captions ?? 'off',
  });
}

/**
 * The transcript as a file.
 *
 * Plain text, because a transcript is dialogue and every other format would be
 * decoration around the same lines. Timestamped, because the one thing a reader
 * wants from a file they opened three weeks later is to find the bit they
 * remember.
 */
export async function downloadTranscript(req, res) {
  const meeting = await loadFor(req);
  const transcript = await getTranscript(meeting.code);

  if (!transcript) throw ApiError.notFound('No transcript for that meeting.');

  const body = renderTranscriptFile(transcript, { timestamps: true });

  /**
   * Exporting is audited, because it is the moment the record leaves the
   * product. Everything before it is access control this process still
   * enforces; a downloaded file is one nobody can reach after the fact.
   */
  await record({
    action: ACTIONS.TRANSCRIPT_EXPORTED,
    actor: req.user,
    meeting,
    metadata: { utterances: transcript.segments?.length ?? 0 },
    req,
  });

  const name = (meeting.title || 'meeting').replace(/[\\/:*?"<>|]/g, '').slice(0, 60).trim();

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name || 'meeting'} transcript.txt"`);
  res.send(body);
}

/**
 * Deleting a transcript.
 *
 * Restricted to the meeting's owner rather than to anyone who was in it or is
 * currently hosting. Destroying the record of what a room full of people said
 * is not a thing a stand-in host, promoted because they arrived first, should
 * be able to do — and an admin who needs to is doing so through retention,
 * which applies evenly rather than to one inconvenient meeting.
 */
export async function deleteTranscript(req, res) {
  const meeting = await Meeting.findOne({ code: (req.params.code ?? '').toLowerCase() }).exec();
  if (!meeting) throw ApiError.notFound('No meeting with that code.');

  if (!meeting.isOwner(req.user.texorId)) {
    throw ApiError.forbidden('Only the person who owns this meeting can delete its transcript.');
  }

  /**
   * Soft-deleted, like a message. The row stays so the audit line above it
   * refers to something, and so "this transcript was deleted, by whom, and
   * when" remains answerable — which is the whole point of having an audit log
   * that cannot be edited.
   */
  const result = await Transcript.updateOne(
    { meetingCode: meeting.code, deletedAt: null },
    { $set: { deletedAt: new Date() } },
  );

  if (result.matchedCount === 0) throw ApiError.notFound('No transcript for that meeting.');

  await record({ action: ACTIONS.TRANSCRIPT_DELETED, actor: req.user, meeting, req });

  res.json({ deleted: true });
}

export default { captionsStatus, getMeetingTranscript, downloadTranscript, deleteTranscript };
