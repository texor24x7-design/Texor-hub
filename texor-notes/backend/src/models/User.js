/**
 * A local projection of a Texor Account.
 *
 * Texor Notes does not own identity — Texor does. This collection exists so a
 * note can carry an author's name without asking the identity provider for it
 * on every row, and so a note can be shared with somebody by email before they
 * have ever opened this product.
 *
 * `texorId` is the `sub` claim: the single identifier the same human carries
 * across notes, talk, finvoice and payroll.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    texorId: { type: String, required: true, unique: true, index: true },

    // Refreshed from the ID token on every sign-in; never edited here. Profile
    // changes belong in accounts.texor.app.
    email: { type: String, required: true, index: true },
    displayName: { type: String, default: '' },
    picture: { type: String, default: '' },

    /**
     * Whether this person has actually signed in, or is only a placeholder.
     *
     * A trusted first-party key (Texor Talk) files a note in somebody's account
     * before they have ever opened Notes, and a share addressed to an email
     * does the same. Those rows exist so the note has an owner and a name to
     * show, but the person behind them has never been here — which is worth
     * knowing before this collection is used as a directory of users.
     */
    signedInAt: { type: Date, default: null },

    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

/**
 * Creates the local record on first sign-in and keeps the cached profile fresh
 * on every one after that.
 */
userSchema.statics.upsertFromClaims = async function upsertFromClaims(claims) {
  const now = new Date();

  return this.findOneAndUpdate(
    { texorId: claims.sub },
    {
      $set: {
        email: String(claims.email ?? '').toLowerCase(),
        displayName: claims.name ?? claims.email,
        picture: claims.picture ?? '',
        lastSeenAt: now,
        signedInAt: now,
      },
      $setOnInsert: { texorId: claims.sub },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
};

/**
 * The placeholder a note's owner gets when somebody else's product put it here.
 *
 * Deliberately never overwrites a real profile: the ID token is the truth about
 * a person, and a name passed over an API by another product is a guess. Only
 * the fields of a row that has never been signed into are refreshed.
 */
userSchema.statics.upsertPlaceholder = async function upsertPlaceholder({ texorId, email, name, picture }) {
  return this.findOneAndUpdate(
    { texorId },
    {
      $setOnInsert: {
        texorId,
        email: String(email ?? '').toLowerCase(),
        displayName: name || email || 'Someone',
        picture: picture ?? '',
        signedInAt: null,
      },
      $set: { lastSeenAt: new Date() },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
};

export const User = mongoose.model('User', userSchema);
export default User;
