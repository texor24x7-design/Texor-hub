/**
 * One person, letting one app write notes into their account.
 *
 * Only for a key in `mode: 'user'`. The app sends its user here, they approve
 * in a page that looks like the rest of this product, and the app gets a token
 * that is good for that person and that app and nothing else. Revoking it is
 * the person's to do, which is the whole reason this exists rather than the app
 * simply asking everybody for their own API key.
 *
 * Like every other credential in the ecosystem, only the hash is kept.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const connectionSchema = new Schema(
  {
    apiKey: { type: Schema.Types.ObjectId, ref: 'ApiKey', required: true, index: true },

    texorId: { type: String, required: true, index: true },
    email: { type: String, default: '' },
    name: { type: String, default: '' },

    tokenHash: { type: String, required: true, unique: true, index: true },

    /** The label this app's notes land under, in *this* person's account. */
    label: { type: Schema.Types.ObjectId, ref: 'Label', default: null },

    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

connectionSchema.index({ apiKey: 1, texorId: 1 }, { unique: true });

export const Connection = mongoose.model('Connection', connectionSchema);
export default Connection;
