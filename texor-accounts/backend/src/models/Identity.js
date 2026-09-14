/**
 * A link between a Texor Account and an upstream provider account.
 *
 * One Texor user can have several — signing in with Google and with Microsoft
 * should land on the same account, not create two. The pair
 * (provider, subject) is what identifies someone upstream; `subject` is the
 * provider's `sub` claim, which is stable even when the person changes their
 * email or name there.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const identitySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    provider: {
      type: String,
      required: true,
      enum: ['google', 'microsoft', 'linkedin', 'zoho'],
    },
    // The upstream `sub`. Never the email — emails get reassigned, subs do not.
    subject: { type: String, required: true },

    // What the provider told us at the last sign-in. Cached for display on the
    // "how you sign in" screen; never used to authenticate anything.
    email: { type: String, default: '', lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    displayName: { type: String, default: '' },
    picture: { type: String, default: '' },

    linkedAt: { type: Date, default: () => new Date() },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One upstream account maps to exactly one Texor account.
identitySchema.index({ provider: 1, subject: 1 }, { unique: true });
// A Texor account has at most one link per provider.
identitySchema.index({ user: 1, provider: 1 }, { unique: true });

export const Identity = mongoose.model('Identity', identitySchema);
export default Identity;
