/**
 * A key another platform holds.
 *
 * The product's second front door. Somebody's CRM, helpdesk or — first of all —
 * Texor Talk writes notes into an account here and reads them back, and this is
 * what says who is calling.
 *
 * The key is `ntk_live_` and 32 random bytes, and only its SHA-256 is stored.
 * That is the same primitive `session.service.js` already uses for the browser
 * cookie: a stolen database gives an attacker a list of hashes and no way to
 * call the API with any of them. It follows that the key cannot be shown twice,
 * which is why the UI says so at the moment it is created.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const apiKeySchema = new Schema(
  {
    ownerTexorId: { type: String, required: true, index: true },

    /** What the app is called. Also the name of the label its notes land under. */
    appName: { type: String, required: true, trim: true, maxlength: 60 },

    /** The first characters, so a list of keys can be told apart. Never secret. */
    prefix: { type: String, required: true },
    hash: { type: String, required: true, unique: true, index: true },

    /**
     * Who owns the notes this key writes.
     *
     *   owner — the person who made the key. The default, and right for an
     *           integration somebody runs for themselves.
     *   user  — each of the app's own users connects their Texor account once,
     *           and their notes go to them. The app then sends their connection
     *           token alongside this key.
     */
    mode: { type: String, enum: ['owner', 'user'], default: 'owner' },

    /** The locked label every note from this key is filed under. */
    label: { type: Schema.Types.ObjectId, ref: 'Label', default: null },

    /**
     * Where to send changes made here.
     *
     * The other half of two-way sync: a note edited in Notes is POSTed back to
     * the app that created it, signed with the secret below so the receiver can
     * tell it is us. Unset means one-way, which is a perfectly good integration.
     */
    webhookUrl: { type: String, default: '' },
    webhookSecret: { type: String, default: '' },

    /** Where the connect flow may send somebody back to, for `mode: 'user'`. */
    redirectUris: { type: [String], default: [] },

    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

apiKeySchema.index({ ownerTexorId: 1, revokedAt: 1, createdAt: -1 });

export const ApiKey = mongoose.model('ApiKey', apiKeySchema);
export default ApiKey;
