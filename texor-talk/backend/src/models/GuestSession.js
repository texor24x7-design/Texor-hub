/**
 * Someone in a meeting who has no Texor Account.
 *
 * Deliberately **not** a `Session`, and deliberately not a `User`. A Texor
 * session says "this is who you are, everywhere in this product"; this says
 * something far narrower:
 *
 *   this browser may act as the name "Sam" in exactly one meeting, until it ends
 *
 * That narrowness is the whole security design. The token is scoped to a single
 * meeting id, so it cannot be replayed against another meeting even if it
 * leaks, and it grants nothing outside the handful of endpoints a guest needs.
 * Channels, the meeting list, scheduling and the admin console all require a
 * real Texor session and refuse this one.
 *
 * Guests get a synthetic id of the form `guest:<random>` so that everything
 * keyed on a participant id — attendance, knocks, peers, the audit log — works
 * unchanged, while remaining obviously not a Texor `sub` wherever it appears.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const guestSessionSchema = new Schema(
  {
    // The opaque handle lives in a cookie; only its hash is stored, exactly as
    // the Texor session does it.
    tokenHash: { type: String, required: true, unique: true, index: true },

    meeting: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },

    guestId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },

    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },

    /**
     * Short-lived on purpose. A guest pass outliving the meeting it was issued
     * for is a credential nobody is tracking — swept by Mongo rather than left
     * to a cleanup job that might not run.
     */
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

guestSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const GuestSession = mongoose.model('GuestSession', guestSessionSchema);
export default GuestSession;
