/**
 * A Texor Account.
 *
 * One user document backs every product in the ecosystem — finvoice, talk,
 * payroll and anything added later all resolve to the same `_id`, which is the
 * `sub` claim in every ID token we issue.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },

    // Optional: an account created through Google, Microsoft or LinkedIn has no
    // password at all until the owner sets one. `hasPassword` on the document
    // is the thing to check — never the truthiness of this field, which is not
    // loaded unless explicitly selected.
    passwordHash: { type: String, default: null, select: false },
    hasPassword: { type: Boolean, default: false },
    passwordChangedAt: { type: Date, default: null },

    name: {
      given: { type: String, trim: true, default: '' },
      family: { type: String, trim: true, default: '' },
    },
    picture: { type: String, default: '' },
    // Set when the picture is an asset we uploaded, so the old one can be
    // deleted when it is replaced rather than accumulating forever.
    picturePublicId: { type: String, default: '' },

    // E.164, e.g. +447700900123. Stored in one canonical form so that the same
    // number is never two different strings.
    phone: { type: String, default: '', trim: true },
    phoneVerified: { type: Boolean, default: false },

    locale: { type: String, default: 'en-US' },
    zoneinfo: { type: String, default: 'UTC' },

    status: {
      type: String,
      enum: ['active', 'suspended', 'deleted'],
      default: 'active',
      index: true,
    },
    roles: {
      type: [String],
      default: ['user'],
    },

    lastLoginAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

userSchema.virtual('displayName').get(function displayName() {
  const full = [this.name?.given, this.name?.family].filter(Boolean).join(' ').trim();
  return full || this.email.split('@')[0];
});

userSchema.virtual('isLocked').get(function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
});

/**
 * Keeps the queryable `hasPassword` flag in step with the hash itself, so the
 * two can never disagree. It exists as a stored field because `passwordHash` is
 * `select: false`, and the sign-in screen needs to know whether a password is
 * even an option without loading the credential.
 */
userSchema.pre('save', function syncHasPassword() {
  if (this.isModified('passwordHash')) {
    this.hasPassword = Boolean(this.passwordHash);
  }
});

/** The claim set handed to oidc-provider. Keys match OIDC standard claims. */
userSchema.methods.toClaims = function toClaims() {
  return {
    sub: this._id.toString(),
    email: this.email,
    email_verified: this.emailVerified,
    name: this.displayName,
    given_name: this.name?.given || undefined,
    family_name: this.name?.family || undefined,
    picture: this.picture || undefined,
    phone_number: this.phone || undefined,
    phone_number_verified: this.phone ? this.phoneVerified : undefined,
    locale: this.locale,
    zoneinfo: this.zoneinfo,
    updated_at: Math.floor(new Date(this.updatedAt).getTime() / 1000),
  };
};

export const User = mongoose.model('User', userSchema);
export default User;
