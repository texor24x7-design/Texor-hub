/**
 * The Texor Account SSO session — the cookie that makes signing in once at
 * accounts.texor.app carry across every product.
 *
 * This is deliberately separate from oidc-provider's own `Session` model: this
 * one authenticates the *account UI itself* and is what lets an authorization
 * request skip the login prompt. The session token is stored only as a SHA-256
 * hash, so the database never holds a usable credential.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },

    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },

    lastSeenAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Mongo reaps expired sessions on its own; `revokedAt` covers explicit sign-out.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

sessionSchema.virtual('isActive').get(function isActive() {
  return !this.revokedAt && this.expiresAt > new Date();
});

export const Session = mongoose.model('Session', sessionSchema);
export default Session;
