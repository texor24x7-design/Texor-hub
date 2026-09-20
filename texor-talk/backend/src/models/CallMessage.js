/**
 * Something somebody said in a call.
 *
 * In-call chat used to be broadcast and forgotten. Breakout rooms are what
 * changed that: a host who splits a meeting into six rooms cannot be in all of
 * them, and the whole point of sending people away to talk is to find out what
 * they said. So these are kept — and keeping them is a change of posture, not
 * a feature, which is why three things ship with it: a retention period an
 * admin sets, a switch to turn it off entirely, and a line in the chat panel
 * telling people their messages are saved.
 *
 * The author's name and the room's name are denormalised at write time. Both
 * can change — somebody's profile, a room being renamed — and a transcript
 * should read the way it read at the time rather than being quietly rewritten
 * by a later edit.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const callMessageSchema = new Schema(
  {
    meeting: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true },
    /** `''` for the main room, `b2` for a breakout. */
    roomKey: { type: String, default: '' },
    roomName: { type: String, default: '' },

    authorTexorId: { type: String, required: true },
    authorName: { type: String, default: '' },
    isGuest: { type: Boolean, default: false },

    /** An announcement is the host talking into every room at once. */
    kind: { type: String, enum: ['message', 'announcement'], default: 'message' },
    body: { type: String, required: true, maxlength: 2000 },

    /**
     * Stamped at write time from the organisation's retention setting, rather
     * than computed when the index sweeps. Shortening the period therefore
     * applies to what is said next and never silently rewrites what is already
     * stored; lengthening it does not resurrect what has already gone.
     */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// The only query there is: one room's transcript, in the order it was said.
callMessageSchema.index({ meeting: 1, roomKey: 1, createdAt: 1 });
callMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const CallMessage = mongoose.model('CallMessage', callMessageSchema);
export default CallMessage;
