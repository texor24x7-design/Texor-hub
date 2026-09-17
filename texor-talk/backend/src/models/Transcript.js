/**
 * What was said in a meeting, and who said it.
 *
 * One document per meeting, holding the utterances in the order they were
 * spoken. Rendered, it is the conversation:
 *
 *   surya: endhuko telidu.
 *   john: I don't know either.
 *
 * ── Why one document rather than a collection of utterances ──
 *
 * A transcript is only ever read whole — as a conversation, or as a file
 * somebody downloads — and never queried across meetings by utterance. Keeping
 * them together makes the read one lookup instead of a paginated scan, and
 * makes the append an atomic `$push` rather than a read-modify-write that two
 * people talking at once would race on. Two hours of continuous speech is
 * around three hundred kilobytes, well inside the sixteen megabyte limit; the
 * append in `captions.service.js` enforces a cap so a runaway process cannot
 * find the edge of it.
 *
 * ── Why the speaker's name is stored on every utterance ──
 *
 * Denormalised on purpose, like the mention marks on a note. A transcript is a
 * record of what happened, and if somebody changes their display name in their
 * Texor Account next year, the record of who spoke in this meeting should not
 * change with it. `speakerTexorId` stays the identity; `speakerName` is what
 * they were called at the time.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const segmentSchema = new Schema(
  {
    speakerTexorId: { type: String, required: true },
    speakerName: { type: String, default: '' },

    text: { type: String, required: true, maxlength: 2000 },

    /**
     * What the recogniser decided this utterance was spoken in, per utterance
     * rather than per meeting.
     *
     * A meeting is not in one language. Somebody switching between Telugu and
     * English mid-sentence is the ordinary case this was built for, and a
     * single language stamped on the whole transcript would be wrong for most
     * of it.
     */
    language: { type: String, default: '' },

    /** Mean token probability, 0–1. Kept so a reader can tell a confident line
     * from a guess, and so the noise filter can be tuned against real data. */
    confidence: { type: Number, default: 0, min: 0, max: 1 },

    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    durationMs: { type: Number, default: 0, min: 0 },

    /**
     * Milliseconds from the start of the meeting.
     *
     * Wall-clock times are what actually happened, but they are useless for
     * reading a transcript back — nobody knows what 14:42:07 meant. The offset
     * is what the `[12:03]` stamps in the downloaded file are built from.
     */
    offsetMs: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const speakerSchema = new Schema(
  {
    texorId: { type: String, required: true },
    name: { type: String, default: '' },
    picture: { type: String, default: '' },
  },
  { _id: false },
);

const transcriptSchema = new Schema(
  {
    meetingCode: { type: String, required: true, unique: true, index: true },
    meeting: { type: Schema.Types.ObjectId, ref: 'Meeting', default: null, index: true },

    // Copied at creation so a transcript reads correctly even after the meeting
    // it came from has been renamed or deleted.
    meetingTitle: { type: String, default: '' },
    meetingStartedAt: { type: Date, default: null },
    meetingEndedAt: { type: Date, default: null },

    segments: { type: [segmentSchema], default: [] },
    speakers: { type: [speakerSchema], default: [] },

    /** Every language heard, most-spoken first. Maintained on append so the
     * listing can show it without reading every utterance. */
    languages: { type: [String], default: [] },

    /** Who turned captions on, which is the person accountable for the
     * recording having been made. Also written to the audit log. */
    startedByTexorId: { type: String, default: null },
    startedByName: { type: String, default: '' },

    /**
     * When retention removes this.
     *
     * Null means keep it. The TTL index below ignores documents where this is
     * not a date, so "forever" needs no special case — and an admin shortening
     * the retention window applies it to transcripts already stored, which is
     * what a retention policy is for.
     */
    expiresAt: { type: Date, default: null },

    /**
     * Set when the utterance cap was reached and appending stopped.
     *
     * A document has a hard sixteen megabyte limit, and a transcript that
     * silently stopped growing would be indistinguishable from a meeting where
     * everybody went quiet. Saying so on the record is the only honest way to
     * hit a limit.
     */
    truncated: { type: Boolean, default: false },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** The transcripts for one person's meetings, newest first. */
transcriptSchema.index({ 'speakers.texorId': 1, deletedAt: 1, createdAt: -1 });

/**
 * Search across what was said.
 *
 * ── `language_override`, and why leaving it out breaks Telugu ──
 *
 * A MongoDB text index reads a field called `language` on each indexed document
 * — including on each element of an indexed array — and treats its value as the
 * stemming language for that entry. Our segments carry exactly that field, set
 * to whatever whisper detected, and the two meanings collide: storing an
 * utterance detected as `te` was rejected outright with
 * `language override unsupported: te`, because Telugu is not one of the dozen
 * or so languages text search can stem.
 *
 * The failure is at *write* time, so it does not degrade search — it makes the
 * utterance impossible to store at all, and only for the languages least likely
 * to be tested. Pointing the override at a field nothing ever sets leaves
 * `language` as ordinary data and indexes every utterance with the default
 * stemmer, whatever language it was spoken in.
 */
transcriptSchema.index(
  { 'segments.text': 'text', meetingTitle: 'text' },
  { language_override: 'textIndexLanguage' },
);

/**
 * Retention, enforced by the database rather than by a job we have to remember
 * to run. `expireAfterSeconds: 0` means "delete when `expiresAt` passes".
 */
transcriptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Transcript = mongoose.model('Transcript', transcriptSchema);
export default Transcript;
