/**
 * Product (OAuth client) registration.
 *
 * A product joins the ecosystem by getting a row here. The plaintext secret is
 * returned exactly once, at creation or rotation — after that only the encrypted
 * envelope exists, and the only component that decrypts it is the OIDC adapter.
 */
import Client from '../models/Client.js';
import Grant from '../models/OidcPayload.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { encryptSecret } from '../utils/crypto.js';
import { randomToken } from '../utils/ids.js';

export async function registerClient(input) {
  const existing = await Client.findOne({ clientId: input.clientId }).exec();
  if (existing) throw ApiError.conflict(`Client "${input.clientId}" is already registered.`);

  const isPublic = input.tokenEndpointAuthMethod === 'none';
  const secret = isPublic ? null : randomToken(32);

  const client = await Client.create({
    ...input,
    // Anything registered through this path is provisioned by an operator (the
    // seed, or an administrator) rather than self-service, so it goes live
    // immediately. Console registrations start in `testing` — see
    // services/app.service.js.
    publishingStatus: input.publishingStatus ?? 'published',
    publishedAt: new Date(),
    clientSecretEncrypted: secret ? encryptSecret(secret, env.SECRET_ENCRYPTION_KEY) : null,
    secretRotatedAt: secret ? new Date() : null,
  });

  return { client, clientSecret: secret };
}

export async function rotateSecret(clientId) {
  const client = await Client.findOne({ clientId }).exec();
  if (!client) throw ApiError.notFound(`Client "${clientId}" not found.`);
  if (client.tokenEndpointAuthMethod === 'none') {
    throw ApiError.badRequest('Public clients do not have a client secret.');
  }

  const secret = randomToken(32);
  client.clientSecretEncrypted = encryptSecret(secret, env.SECRET_ENCRYPTION_KEY);
  await client.save();

  return { client, clientSecret: secret };
}

export async function listClients() {
  return Client.find().sort({ clientName: 1 }).lean();
}

export async function getClient(clientId) {
  const client = await Client.findOne({ clientId }).exec();
  if (!client) throw ApiError.notFound(`Client "${clientId}" not found.`);
  return client;
}

export async function updateClient(clientId, patch) {
  const client = await getClient(clientId);
  Object.assign(client, patch);
  await client.save();
  return client;
}

/**
 * The products a user has actually connected, assembled from their live grants.
 * Powers the "Apps with access to your Texor Account" screen.
 */
export async function listConnectedApps(userId) {
  const grants = await Grant.find({ model: 'Grant', 'payload.accountId': userId }).lean();
  if (grants.length === 0) return [];

  const clientIds = [...new Set(grants.map((grant) => grant.payload.clientId))];
  const clients = await Client.find({ clientId: { $in: clientIds } }).lean();
  const byId = new Map(clients.map((client) => [client.clientId, client]));

  return grants.map((grant) => {
    const client = byId.get(grant.payload.clientId);
    return {
      grantId: grant.identifier,
      clientId: grant.payload.clientId,
      clientName: client?.clientName ?? grant.payload.clientId,
      logoUri: client?.logoUri ?? '',
      appUrl: client?.appUrl ?? '',
      scopes: (grant.payload.openid?.scope ?? '').split(' ').filter(Boolean),
      grantedAt: grant.createdAt,
    };
  });
}

/**
 * Revoking a grant drops every token issued under it, so the product is signed
 * out the next time it refreshes.
 */
export async function revokeConnectedApp(userId, grantId) {
  const grant = await Grant.findOne({ model: 'Grant', identifier: grantId }).lean();
  if (!grant || grant.payload.accountId !== userId) {
    throw ApiError.notFound('Connected app not found.');
  }

  await Grant.deleteMany({ $or: [{ grantId }, { model: 'Grant', identifier: grantId }] });
}
