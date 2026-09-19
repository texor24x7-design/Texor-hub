/**
 * A label.
 *
 * Flat, and many per note — Google Keep's model rather than a folder tree.
 * Nesting was considered and left out: every screen would need tree UI, move
 * rules and a cycle guard, to express something two labels on one note already
 * says.
 *
 * A label can be shared, and that is the difference between this and a tag. A
 * shared label carries its whole contents to the people it is shared with, so a
 * team can work on "Q3 launch" instead of on eleven separate notes.
 */
import mongoose from 'mongoose';
import { NOTE_COLOURS, shareSchema } from './Note.js';

const { Schema } = mongoose;

const labelSchema = new Schema(
  {
    ownerTexorId: { type: String, required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 60 },
    colour: { type: String, enum: NOTE_COLOURS, default: 'default' },

    shares: { type: [shareSchema], default: [] },
    sharedTexorIds: { type: [String], default: [], index: true },

    /**
     * An app's own label.
     *
     * Every API key gets one, named after the app, and every note that app
     * creates is filed under it — which is how somebody who integrated their
     * CRM finds those notes here without hunting. It refuses to be renamed or
     * deleted while the key lives, because the name is how the notes are
     * identified; the colour is theirs to change.
     */
    locked: { type: Boolean, default: false },
    apiKey: { type: Schema.Types.ObjectId, ref: 'ApiKey', default: null },
  },
  { timestamps: true },
);

/**
 * One label of a given name per person, whatever the capitals.
 *
 * The collation is what makes "Work" and "work" the same name. Without it a
 * sidebar ends up with both, and notes filed under whichever the person typed
 * that day. A clash raises a duplicate key error, which `middleware/error.js`
 * already turns into a 409 — so there is no check-then-insert race here to get
 * wrong.
 */
labelSchema.index(
  { ownerTexorId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);

export const Label = mongoose.model('Label', labelSchema);
export default Label;
