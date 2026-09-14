/**
 * A request to be let into a meeting — the waiting room.
 *
 * Its own collection rather than an array on the meeting, because a knock is
 * polled hard by two sides at once (the person waiting, and every host looking
 * at the admit list) and because a TTL index is the cheapest way to make an
 * abandoned knock disappear on its own.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const knockSchema = new Schema(
  {
    meeting: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },

    texorId: { type: String, required: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    picture: { type: String, default: '' },

    status: {
      type: String,
      enum: ['waiting', 'admitted', 'denied', 'expired'],
      default: 'waiting',
      index: true,
    },

    decidedByTexorId: { type: String, default: null },
    decidedByName: { type: String, default: '' },
    decidedAt: { type: Date, default: null },

    // Swept by Mongo once it passes. A knock nobody answered simply stops
    // existing, and the waiting page reports that rather than hanging forever.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

knockSchema.index({ meeting: 1, status: 1, createdAt: 1 });
knockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// One live knock per person per meeting: re-knocking updates the existing row
// instead of filling the host's admit list with the same face five times.
knockSchema.index(
  { meeting: 1, texorId: 1 },
  { unique: true, partialFilterExpression: { status: 'waiting' } },
);

export const Knock = mongoose.model('Knock', knockSchema);
export default Knock;
