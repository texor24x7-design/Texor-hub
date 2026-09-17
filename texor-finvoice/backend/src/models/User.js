/**
 * A local projection of a Texor Account.
 *
 * Finvoice does not own identity — Texor does. This collection exists so the
 * product can attach its own data (workspace membership, preferences) to a
 * stable key, and so a list of invoices can show a name without
 * calling the identity provider for every row.
 *
 * `texorId` is the `sub` claim: the single identifier the same human carries
 * across finvoice, talk and payroll.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    texorId: { type: String, required: true, unique: true, index: true },

    // Refreshed from the ID token on every sign-in; never edited here. Profile
    // changes belong in accounts.texor.app.
    email: { type: String, required: true, index: true },
    // Whether Texor vouches for the address. Workspace invites are addressed by
    // email, so only a verified address may claim one.
    emailVerified: { type: Boolean, default: false },
    displayName: { type: String, default: '' },
    picture: { type: String, default: '' },

    // The workspace this person last opened, so sign-in lands them back in it.
    lastWorkspace: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },

    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

/**
 * Creates the local record on first sign-in and keeps the cached profile fresh
 * on every one after that.
 */
userSchema.statics.upsertFromClaims = async function upsertFromClaims(claims) {
  return this.findOneAndUpdate(
    { texorId: claims.sub },
    {
      $set: {
        email: claims.email,
        emailVerified: claims.email_verified === true,
        displayName: claims.name ?? claims.email,
        picture: claims.picture ?? '',
        lastSeenAt: new Date(),
      },
      $setOnInsert: { texorId: claims.sub },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
};

export const User = mongoose.model('User', userSchema);
export default User;
