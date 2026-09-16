/**
 * A note somebody took in a meeting.
 *
 * One author, always. Notes are the one place in this product where the useful
 * default is private — people write "ask about the Q3 number, he was evasive"
 * in their own notes, and a product that shared that by default would teach
 * everybody to stop using it. The author can share a note with the meeting when
 * they mean to.
 *
 * The document itself is blocks of plain text with mark ranges over them; see
 * `services/notes.service.js` for why it is not HTML.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

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

const noteSchema = new Schema(
  {
    /**
     * Notes belong to a meeting. That is what makes the Notes section useful
     * rather than a second inbox: they group by the thing they were about, and
     * the people taggable in one are the people who were in it.
     */
    meetingCode: { type: String, required: true, index: true },
    meetingTitle: { type: String, default: '' },
    meetingStartedAt: { type: Date, default: null },

    ownerTexorId: { type: String, required: true, index: true },
    ownerName: { type: String, default: '' },
    ownerPicture: { type: String, default: '' },

    title: { type: String, default: '', trim: true, maxlength: 200 },
    blocks: { type: [blockSchema], default: [] },

    /**
     * Derived from the blocks on every save, never sent by the client.
     *
     * This exists so "notes that mention me" is an indexed lookup rather than a
     * scan over every note in the organisation reading its marks.
     */
    mentionedTexorIds: { type: [String], default: [], index: true },

    visibility: { type: String, enum: ['private', 'meeting'], default: 'private', index: true },

    pinned: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The Notes section, for one person: their own notes, newest first.
noteSchema.index({ ownerTexorId: 1, deletedAt: 1, updatedAt: -1 });
// One meeting's shared notes, which is the other way in.
noteSchema.index({ meetingCode: 1, visibility: 1, deletedAt: 1 });
// Free-text search across a note and the meeting it came from.
noteSchema.index({ title: 'text', 'blocks.text': 'text', meetingTitle: 'text' });

export const Note = mongoose.model('Note', noteSchema);
export default Note;
