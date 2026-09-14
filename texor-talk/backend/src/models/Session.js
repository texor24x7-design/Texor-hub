/**
 * Texor Talk's own session.
 *
 * Texor authenticates the user; this session is how Texor Talk remembers that it
 * already happened, so every request does not bounce through the provider. The
 * tokens live here rather than in the browser: the cookie is an opaque handle,
 * and the access and refresh tokens never leave the server.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    texorId: { type: String, required: true, index: true },

    tokenHash: { type: String, required: true, unique: true, index: true },

    // Kept server-side so the product can call Texor APIs and sign out cleanly.
    accessToken: { type: String, default: null, select: false },
    refreshToken: { type: String, default: null, select: false },
    idToken: { type: String, default: null, select: false },
    accessTokenExpiresAt: { type: Date, default: null },

    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },

    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model('Session', sessionSchema);
export default Session;
