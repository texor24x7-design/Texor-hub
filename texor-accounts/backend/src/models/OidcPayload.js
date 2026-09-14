/**
 * Backing collection for the oidc-provider adapter.
 *
 * Every stateful object the provider creates — grants, authorization codes,
 * access and refresh tokens, its own sessions, interactions — lands here as one
 * document tagged with its model name. See src/oidc/adapter.js for the mapping.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const oidcPayloadSchema = new Schema(
  {
    // oidc-provider model name, e.g. 'AccessToken', 'Grant', 'Session'.
    model: { type: String, required: true },
    // The provider's id for that object; unique per model, not globally.
    identifier: { type: String, required: true },

    payload: { type: Schema.Types.Mixed, required: true },

    // Secondary lookup keys the provider queries by.
    grantId: { type: String, default: null, index: true },
    userCode: { type: String, default: null, index: true },
    uid: { type: String, default: null, index: true },

    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

oidcPayloadSchema.index({ model: 1, identifier: 1 }, { unique: true });
oidcPayloadSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OidcPayload = mongoose.model('OidcPayload', oidcPayloadSchema);
export default OidcPayload;
