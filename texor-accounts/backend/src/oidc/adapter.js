/**
 * MongoDB adapter for oidc-provider.
 *
 * oidc-provider is storage-agnostic: it hands us a model name ('AccessToken',
 * 'Grant', 'Session', 'Interaction', …) and expects an object with find/upsert/
 * destroy/consume and the two secondary lookups. Everything except clients goes
 * into the single `oidcpayloads` collection; clients are read from the `clients`
 * collection so products can be registered through the admin API without a
 * restart.
 *
 * Contract reference: the interface mirrors oidc-provider's built-in
 * MemoryAdapter (node_modules/oidc-provider/lib/adapters/memory_adapter.js).
 */
import OidcPayload from '../models/OidcPayload.js';
import Client from '../models/Client.js';
import { decryptSecret } from '../utils/crypto.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const epochTime = (date = new Date()) => Math.floor(date.getTime() / 1000);

/** Models whose lifetime is tied to a grant and are revoked together with it. */
const GRANTABLE = new Set([
  'AccessToken',
  'AuthorizationCode',
  'RefreshToken',
  'DeviceCode',
  'BackchannelAuthenticationRequest',
  'PreAuthorizedCode',
]);

class MongoAdapter {
  constructor(model) {
    this.model = model;
  }

  async upsert(id, payload, expiresIn) {
    const update = {
      model: this.model,
      identifier: id,
      payload,
      grantId: GRANTABLE.has(this.model) ? payload.grantId ?? null : null,
      userCode: payload.userCode ?? null,
      uid: payload.uid ?? null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };

    await OidcPayload.updateOne(
      { model: this.model, identifier: id },
      { $set: update },
      { upsert: true },
    );
  }

  async find(id) {
    if (this.model === 'Client') {
      return findClientMetadata(id);
    }

    const doc = await OidcPayload.findOne({ model: this.model, identifier: id }).lean();
    return unwrap(doc);
  }

  async findByUserCode(userCode) {
    const doc = await OidcPayload.findOne({ model: this.model, userCode }).lean();
    return unwrap(doc);
  }

  async findByUid(uid) {
    const doc = await OidcPayload.findOne({ model: this.model, uid }).lean();
    return unwrap(doc);
  }

  /**
   * Marks a one-time artifact (an authorization code, typically) as used.
   * The provider reads `payload.consumed` back on the next find and rejects
   * replays, so the flag has to live inside the payload itself.
   */
  async consume(id) {
    await OidcPayload.updateOne(
      { model: this.model, identifier: id },
      { $set: { consumedAt: new Date(), 'payload.consumed': epochTime() } },
    );
  }

  async destroy(id) {
    await OidcPayload.deleteOne({ model: this.model, identifier: id });
  }

  async revokeByGrantId(grantId) {
    await OidcPayload.deleteMany({ grantId });
  }
}

/**
 * Documents outlive their logical expiry until Mongo's TTL monitor sweeps them
 * (it runs about once a minute), so expiry is enforced on read as well.
 */
function unwrap(doc) {
  if (!doc) return undefined;
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) return undefined;
  return doc.payload;
}

async function findClientMetadata(clientId) {
  const client = await Client.findOne({ clientId, status: 'active' })
    .select('+clientSecretEncrypted')
    .exec();

  if (!client) return undefined;

  let secret;
  if (client.clientSecretEncrypted) {
    try {
      secret = decryptSecret(client.clientSecretEncrypted, env.SECRET_ENCRYPTION_KEY);
    } catch (error) {
      logger.error('failed to decrypt client secret', { clientId, message: error.message });
      return undefined;
    }
  }

  return client.toProviderMetadata(secret);
}

/** oidc-provider calls this factory once per model. */
export const createAdapter = (model) => new MongoAdapter(model);

export default MongoAdapter;
