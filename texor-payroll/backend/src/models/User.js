/**
 * A local projection of a Texor Account.
 *
 * Texor Payroll does not own identity — Texor does. This collection exists so the
 * product can attach its own data (org membership, preferences, invoice
 * ownership) to a stable key, and so a list of invoices can show a name without
 * calling the identity provider for every row.
 *
 * `texorId` is the `sub` claim: the single identifier the same human carries
 * across payroll, talk and payroll.
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

    // Product-specific state.
    companyName: { type: String, default: '' },
    payCurrency: { type: String, default: 'USD' },
    payFrequency: { type: String, enum: ['weekly', 'fortnightly', 'monthly'], default: 'monthly' },

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
