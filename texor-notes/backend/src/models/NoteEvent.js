/**
 * What happened to a note, and who did it.
 *
 * The trail a shared note needs. Two people editing the same document is only
 * comfortable when it is obvious who changed it last and what else has been
 * going on — otherwise every surprise is a mystery, and the reasonable response
 * to a mystery is to stop sharing.
 *
 * Deliberately *not* a version history. It records that a note was edited, not
 * what it said before: keeping every revision of every note is a different
 * feature with a different storage bill, and the question people actually ask
 * is "who touched this".
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

export const EVENT_ACTIONS = [
  'created', 'edited', 'shared', 'unshared', 'labelled',
  'archived', 'restored', 'trashed', 'synced',
];

const noteEventSchema = new Schema(
  {
    note: { type: Schema.Types.ObjectId, ref: 'Note', required: true, index: true },
    at: { type: Date, default: () => new Date() },

    actorTexorId: { type: String, default: '' },
    actorName: { type: String, default: '' },

    action: { type: String, enum: EVENT_ACTIONS, required: true },

    // Free-form and small: an email for a share, an app name for a sync.
    detail: { type: String, default: '' },
  },
  { timestamps: false },
);

noteEventSchema.index({ note: 1, at: -1 });

/**
 * Records what happened, unless it is the same person still typing.
 *
 * An autosave fires every second or so. One row per save would make the panel a
 * keylog and the collection the largest thing in the database, so consecutive
 * edits by the same person inside the window collapse into the first one, whose
 * timestamp moves forward. Everything else is always its own row — sharing a
 * note twice in a minute is two decisions.
 */
const COLLAPSE_MS = 10 * 60 * 1000;

noteEventSchema.statics.record = async function record({ note, actor, action, detail = '' }) {
  const at = new Date();

  if (action === 'edited') {
    const merged = await this.findOneAndUpdate(
      {
        note,
        action: 'edited',
        actorTexorId: actor.texorId,
        at: { $gte: new Date(at.getTime() - COLLAPSE_MS) },
      },
      { $set: { at, actorName: actor.name ?? '' } },
      { sort: { at: -1 } },
    ).exec();

    if (merged) return merged;
  }

  return this.create({
    note, at, action, detail,
    actorTexorId: actor.texorId ?? '',
    actorName: actor.name ?? '',
  });
};

export const NoteEvent = mongoose.model('NoteEvent', noteEventSchema);
export default NoteEvent;
