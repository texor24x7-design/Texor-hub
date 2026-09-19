/**
 * A note.
 *
 * Standalone, unlike the notes in Texor Talk this document model was lifted
 * from: there is no meeting, and nothing outside this file decides who may read
 * one. A note has an owner, a list of people it has been shared with, and the
 * labels it is filed under — and the strongest of those three is what
 * `services/access.service.js` turns into a role.
 *
 * The document itself is blocks of plain text with mark ranges over them, byte
 * for byte the format Talk stores. That is what lets a meeting note cross
 * between the two products with no mapping layer at all; see
 * `services/notes.service.js` for why it is not HTML.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

/** The palette a note's own colour is drawn from — the mark colours, reused. */
export const NOTE_COLOURS = [
  'default', 'yellow', 'green', 'blue', 'pink', 'purple', 'red', 'orange', 'grey',
];

const markSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['bold', 'italic', 'underline', 'strike', 'code', 'highlight', 'color', 'link', 'mention'],
      required: true,
    },
    start: { type: Number, required: true, min: 0 },
    end: { type: Number, required: true, min: 0 },

    /**
     * highlight and color. The two share a field because they are the same
     * question — which named colour — asked of the background and of the ink.
     * The enum is the union; `sanitiseMark` is what keeps a highlight from
     * being set to a text colour and the other way round.
     */
    color: {
      type: String,
      enum: ['yellow', 'green', 'blue', 'pink', 'purple', 'red', 'orange', 'grey'],
      default: undefined,
    },

    /**
     * link only. Already reduced to an allowed scheme by `safeHref` before it
     * reaches here — this field stores a destination, never markup.
     */
    href: { type: String, default: undefined, maxlength: 2000 },

    // mention only. The name is denormalised so a note renders without looking
    // anybody up; `texorId` stays the source of truth if the two disagree.
    texorId: { type: String, default: undefined },
    name: { type: String, default: undefined },
  },
  { _id: false },
);

const blockSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['paragraph', 'heading', 'bullet', 'numbered', 'todo', 'quote'],
      default: 'paragraph',
    },
    text: { type: String, default: '', maxlength: 5000 },
    marks: { type: [markSchema], default: [] },

    // heading only: which of the three sizes.
    level: { type: Number, enum: [1, 2, 3], default: undefined },

    /**
     * Paragraph properties, stored only when they differ from the default —
     * `undefined` rather than 'left' and 0, so a note nobody has formatted
     * carries no formatting at all.
     */
    align: { type: String, enum: ['center', 'right', 'justify'], default: undefined },
    indent: { type: Number, min: 0, max: 5, default: undefined },

    // todo only
    done: { type: Boolean, default: undefined },

    // quote only: who said it, and when they said it.
    speakerTexorId: { type: String, default: undefined },
    speakerName: { type: String, default: undefined },
    at: { type: Date, default: undefined },
  },
  { _id: false },
);

/**
 * Somebody a note or a label has been shared with.
 *
 * Embedded rather than a collection of its own: a note is read together with
 * its shares on every screen there is, and a join would put a second query on
 * the hottest path in the product to save nothing.
 *
 * `texorId` is null for a share addressed to an email nobody has signed in with
 * yet. `User.upsertFromClaims` fills it in the first time they arrive, which is
 * the whole of the invitation mechanism — no tokens, no mail server.
 */
export const shareSchema = new Schema(
  {
    texorId: { type: String, default: null },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: '' },
    role: { type: String, enum: ['viewer', 'editor'], default: 'viewer' },
    addedByTexorId: { type: String, default: '' },
    addedAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const noteSchema = new Schema(
  {
    ownerTexorId: { type: String, required: true, index: true },
    ownerName: { type: String, default: '' },
    ownerPicture: { type: String, default: '' },

    title: { type: String, default: '', trim: true, maxlength: 200 },
    blocks: { type: [blockSchema], default: [] },

    colour: { type: String, enum: NOTE_COLOURS, default: 'default' },
    labels: { type: [Schema.Types.ObjectId], ref: 'Label', default: [] },

    shares: { type: [shareSchema], default: [] },

    /**
     * A flat projection of `shares[].texorId`, kept in step on every save.
     *
     * "Shared with me" is a list screen, and a multikey index over an array of
     * strings answers it in one hop. Indexing `shares.texorId` instead would
     * work and then stop working the moment the query wanted a sort, because a
     * compound index over a subdocument array cannot serve one.
     */
    sharedTexorIds: { type: [String], default: [] },

    /**
     * Derived from the blocks on every save, never sent by the client.
     *
     * Mentioning somebody grants them nothing — see `access.service.js`. This
     * exists so the mention itself can be found without scanning every note in
     * the product and reading its marks.
     */
    mentionedTexorIds: { type: [String], default: [] },

    pinned: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },

    /**
     * The conflict guard.
     *
     * Two people share a note, both have it open, both type. The document is
     * saved as a whole rather than merged, so without this the slower save
     * silently discards the faster one's paragraph. Every write carries the
     * version it was made against; a mismatch is refused with a 409 and the
     * current document, and the editor offers both.
     */
    version: { type: Number, default: 1 },
    lastEditedBy: {
      texorId: { type: String, default: '' },
      name: { type: String, default: '' },
      at: { type: Date, default: null },
    },

    /**
     * Where this note came from.
     *
     * `web` for one typed here. Otherwise the app behind an API key, with the
     * identifier that app knows it by — which is what makes a second POST of
     * the same thing an update rather than a duplicate, and what lets Texor
     * Talk address a note by its own id without ever storing ours.
     */
    source: {
      app: { type: String, default: 'web' },
      apiKey: { type: Schema.Types.ObjectId, ref: 'ApiKey', default: null },
      externalId: { type: String, default: null },
      url: { type: String, default: '' },
    },
  },
  { timestamps: true },
);

// The board: my notes, pinned first, newest first, archive and trash excluded.
noteSchema.index({ ownerTexorId: 1, deletedAt: 1, archivedAt: 1, pinned: -1, updatedAt: -1 });

// One label's notes.
noteSchema.index({ ownerTexorId: 1, labels: 1, deletedAt: 1, updatedAt: -1 });

// Shared with me, and the trash, which sorts by when it was thrown away.
noteSchema.index({ sharedTexorIds: 1, deletedAt: 1, updatedAt: -1 });
noteSchema.index({ ownerTexorId: 1, deletedAt: -1 });

// Claiming the shares waiting for somebody the first time they sign in.
noteSchema.index({ 'shares.email': 1 });

// Notes that mention me.
noteSchema.index({ mentionedTexorIds: 1 });

/**
 * One note per (key, external id).
 *
 * Partial, so the millions of notes typed in the browser — all of which have no
 * external id — are not competing for a single null slot. This index is the
 * whole of the API's idempotency: a racing double POST becomes a duplicate key
 * error, which the error middleware already renders as a 409.
 */
noteSchema.index(
  { 'source.apiKey': 1, 'source.externalId': 1 },
  { unique: true, partialFilterExpression: { 'source.externalId': { $type: 'string' } } },
);

// Search. Mongo's text index is whole-word and stemmed, which is the known
// ceiling here: "meet" does not find "meeting" until the word is finished.
// ponytail: swap for Atlas Search if that draws a second complaint.
noteSchema.index({ title: 'text', 'blocks.text': 'text' });

export const Note = mongoose.model('Note', noteSchema);
export default Note;
