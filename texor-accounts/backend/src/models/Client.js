/**
 * A registered app — an OAuth 2.0 / OIDC client.
 *
 * This is the unit developers create in the Texor console, and it is also how
 * Texor's own products are registered. One document is one app: its identity,
 * its credentials, the branding shown on the consent screen, and where it is in
 * the publishing lifecycle.
 *
 * Two flags decide how much the platform trusts an app:
 *
 *   isFirstParty      administrator-only. Skips the consent screen entirely —
 *                     you do not consent to Google showing you Gmail, and the
 *                     same reasoning applies inside one ecosystem. A
 *                     self-service developer can never set this, because it
 *                     would let any app collect tokens silently.
 *
 *   publishingStatus  'testing' apps work only for their owner and the accounts
 *                     listed in testAccounts. This is what stops an unverified
 *                     app from being pointed at the whole user base.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const clientSchema = new Schema(
  {
    clientId: { type: String, required: true, unique: true, index: true },
    clientName: { type: String, required: true },
    description: { type: String, default: '' },

    // Who owns this app in the console. Null for the platform's own products,
    // which are created by the seed rather than by a person.
    owner: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    // Confidential clients only; public (PKCE-only) clients leave this null.
    // AES-256-GCM envelope — see src/utils/crypto.js for why this is not a hash.
    clientSecretEncrypted: { type: String, default: null, select: false },
    secretRotatedAt: { type: Date, default: null },

    redirectUris: { type: [String], default: [] },
    postLogoutRedirectUris: { type: [String], default: [] },

    grantTypes: { type: [String], default: ['authorization_code', 'refresh_token'] },
    responseTypes: { type: [String], default: ['code'] },
    tokenEndpointAuthMethod: {
      type: String,
      enum: ['client_secret_basic', 'client_secret_post', 'none'],
      default: 'client_secret_basic',
    },

    // What this app is allowed to ask a user for.
    allowedScopes: {
      type: [String],
      default: ['openid', 'profile', 'email'],
    },
    // Resource indicator (API audience) this app's access tokens target.
    resourceIndicator: { type: String, default: null },

    // ── Consent screen ───────────────────────────────────────────────────────
    // Everything here is shown to a user being asked to trust the app, so it is
    // the part that most needs to be accurate.
    logoUri: { type: String, default: '' },
    appUrl: { type: String, default: '' },
    policyUri: { type: String, default: '' },
    tosUri: { type: String, default: '' },
    supportEmail: { type: String, default: '', lowercase: true, trim: true },

    // ── Publishing lifecycle ─────────────────────────────────────────────────
    publishingStatus: {
      type: String,
      enum: ['testing', 'in_review', 'published'],
      default: 'testing',
      index: true,
    },
    // Accounts allowed to use the app while it is in testing.
    testAccounts: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    submittedForReviewAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    reviewNotes: { type: String, default: '' },

    isFirstParty: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', index: true },
  },
  { timestamps: true },
);

/**
 * Documents created before the publishing lifecycle existed have no
 * `publishingStatus`. Rather than a migration that has to be remembered, they
 * resolve here: the platform's own products were live already, and anything
 * else starts restricted.
 */
clientSchema.methods.effectivePublishingStatus = function effectivePublishingStatus() {
  if (this.publishingStatus) return this.publishingStatus;
  return this.isFirstParty ? 'published' : 'testing';
};

/** Shape oidc-provider expects for a client's metadata. */
clientSchema.methods.toProviderMetadata = function toProviderMetadata(clientSecret) {
  return {
    client_id: this.clientId,
    client_name: this.clientName,
    client_secret: clientSecret ?? undefined,
    redirect_uris: this.redirectUris,
    post_logout_redirect_uris: this.postLogoutRedirectUris,
    grant_types: this.grantTypes,
    response_types: this.responseTypes,
    token_endpoint_auth_method: this.tokenEndpointAuthMethod,
    scope: this.allowedScopes.join(' '),
    logo_uri: this.logoUri || undefined,
    client_uri: this.appUrl || undefined,
    policy_uri: this.policyUri || undefined,
    tos_uri: this.tosUri || undefined,

    // Declared in the provider's `extraClientMetadata.properties`, which is what
    // lets these survive onto the Client instance. Note that extra properties
    // are NOT camelCased the way standard metadata is — they are read back
    // spelled exactly as they are written here.
    first_party: this.isFirstParty,
    resource_indicator: this.resourceIndicator || undefined,
    publishing_status: this.effectivePublishingStatus(),
    // Consulted by the authorization-time access check while an app is in
    // testing. Ids are stringified because that is how the session carries them.
    test_accounts: [
      ...(this.owner ? [this.owner.toString()] : []),
      ...this.testAccounts.map((id) => id.toString()),
    ],
  };
};

export const Client = mongoose.model('Client', clientSchema);
export default Client;
