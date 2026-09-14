/**
 * Single-use tokens sent by email.
 *
 * Two purposes share the collection because the machinery is identical: a
 * random secret, delivered out of band, that proves control of an inbox once.
 *
 * Only a SHA-256 hash is stored. A token is a bearer credential — anyone
 * holding one can take over the account it belongs to — so a database dump
 * must not contain usable ones.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const verificationTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    purpose: {
      type: String,
      required: true,
      enum: ['email_verification', 'password_reset'],
      index: true,
    },

    tokenHash: { type: String, required: true, unique: true, index: true },

    // The address the token was sent to. A password reset issued before an
    // email change must not validate against the new one.
    email: { type: String, required: true, lowercase: true, trim: true },

    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },

    requestedIp: { type: String, default: '' },
  },
  { timestamps: true },
);

// Mongo reaps expired tokens; `consumedAt` covers the ones already used.
verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VerificationToken = mongoose.model('VerificationToken', verificationTokenSchema);
export default VerificationToken;
