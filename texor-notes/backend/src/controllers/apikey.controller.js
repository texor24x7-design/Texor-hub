/**
 * Keys, from the inside: the screen where somebody wires up their own software.
 *
 * And the connect flow, which is how a third-party app gets permission to write
 * into *its users'* accounts rather than into its developer's. That flow is
 * deliberately small — the person is already signed in here with their Texor
 * account, so all that is needed is a page that says who is asking, a one-time
 * code, and an exchange.
 */
import { z } from 'zod';
import mongoose from 'mongoose';
import ApiKey from '../models/ApiKey.js';
import Connection from '../models/Connection.js';
import Label from '../models/Label.js';
import ApiError from '../utils/ApiError.js';
import { randomToken, sha256 } from '../utils/ids.js';
import { appLabelFor, createKey, isTrusted, keyFromToken, presentKey, revokeKey, USER_TOKEN_PREFIX } from '../services/apikey.service.js';

export const keySchema = z.object({
  appName: z.string().min(1, 'What is the app called?').max(60),
  mode: z.enum(['owner', 'user']).default('owner'),
  webhookUrl: z.url('That is not a URL.').optional(),
  redirectUris: z.array(z.url()).max(10).default([]),
});

export async function listKeys(req, res) {
  const keys = await ApiKey.find({ ownerTexorId: req.user.texorId }).sort({ createdAt: -1 }).exec();
  const labels = await Label.find({ _id: { $in: keys.map((key) => key.label).filter(Boolean) } }).lean().exec();
  const byId = new Map(labels.map((label) => [String(label._id), label]));

  const trusted = isTrusted(req.user.email);
  res.json({ keys: keys.map((key) => presentKey(key, { label: byId.get(String(key.label)), trusted })) });
}

export async function postKey(req, res) {
  const { key, token, label } = await createKey({
    user: req.user,
    appName: req.body.appName,
    mode: req.body.mode,
    webhookUrl: req.body.webhookUrl ?? '',
    redirectUris: req.body.redirectUris,
  });

  res.status(201).json({
    key: presentKey(key, { label, trusted: isTrusted(req.user.email) }),
    /**
     * The only response in the product that carries these. They are hashes in
     * the database a moment later, so there is no second chance to read them —
     * which the UI has to say at exactly this point.
     */
    token,
    webhookSecret: key.webhookSecret || undefined,
  });
}

export async function deleteKey(req, res) {
  await revokeKey({ id: req.params.id, ownerTexorId: req.user.texorId });
  res.json({ ok: true });
}

/**
 * The consent step: what the page at /connect needs to draw itself.
 *
 * Takes the key's public prefix rather than the key — the app puts this URL in
 * a browser, and a URL is not somewhere a credential belongs.
 */
export async function connectPrompt(req, res) {
  const key = await ApiKey.findOne({ prefix: String(req.query.app ?? ''), revokedAt: null }).exec();

  if (!key || key.mode !== 'user') throw ApiError.notFound('No app is asking for that.');

  const redirectUri = String(req.query.redirect_uri ?? '');
  if (!key.redirectUris.includes(redirectUri)) {
    throw ApiError.badRequest('That app did not register this address to come back to.');
  }

  res.json({ app: { name: key.appName, prefix: key.prefix }, redirectUri });
}

/**
 * Approving it.
 *
 * Creates the connection and hands back a one-time code. The app trades the
 * code for the token over HTTPS with its key, so the token itself never travels
 * through a browser's address bar or its history.
 */
const codes = new Map();
const CODE_TTL_MS = 5 * 60 * 1000;

export async function connectApprove(req, res) {
  const key = await ApiKey.findOne({ prefix: String(req.body.app ?? ''), revokedAt: null }).exec();
  if (!key || key.mode !== 'user') throw ApiError.notFound('No app is asking for that.');

  const redirectUri = String(req.body.redirectUri ?? '');
  if (!key.redirectUris.includes(redirectUri)) {
    throw ApiError.badRequest('That app did not register this address to come back to.');
  }

  const label = await appLabelFor({
    appName: key.appName,
    ownerTexorId: req.user.texorId,
    apiKeyId: key._id,
  });

  const token = `${USER_TOKEN_PREFIX}${randomToken(32)}`;

  await Connection.findOneAndUpdate(
    { apiKey: key._id, texorId: req.user.texorId },
    {
      $set: {
        tokenHash: sha256(token),
        email: req.user.email,
        name: req.user.displayName,
        label: label._id,
        revokedAt: null,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).exec();

  const code = randomToken(24);
  codes.set(code, { token, at: Date.now(), keyId: String(key._id) });

  // ponytail: codes live in this process's memory and are gone on restart,
  // which costs the person one click. A collection with a TTL index is the
  // upgrade if Notes ever runs as more than one process.
  for (const [value, entry] of codes) if (Date.now() - entry.at > CODE_TTL_MS) codes.delete(value);

  res.json({ redirectTo: `${redirectUri}${redirectUri.includes('?') ? '&' : '?'}code=${code}` });
}

/** The app, server to server, with its key in the header. */
export async function connectExchange(req, res) {
  const entry = codes.get(String(req.body.code ?? ''));
  codes.delete(String(req.body.code ?? ''));

  if (!entry || Date.now() - entry.at > CODE_TTL_MS) {
    throw ApiError.badRequest('That code has been used or has expired.');
  }
  if (entry.keyId !== String(req.apiKey._id)) {
    throw ApiError.forbidden('That code was issued to a different app.');
  }

  const connection = await Connection.findOne({ tokenHash: sha256(entry.token) }).lean().exec();

  res.json({
    userToken: entry.token,
    user: { texorId: connection.texorId, email: connection.email, name: connection.name },
  });
}

export const connectApproveSchema = z.object({
  app: z.string().min(1),
  redirectUri: z.string().min(1),
});

export const connectExchangeSchema = z.object({ code: z.string().min(1) });

/** Somebody taking an app's access away again, from their own settings. */
export async function listConnections(req, res) {
  const connections = await Connection.find({ texorId: req.user.texorId, revokedAt: null }).lean().exec();
  const keys = await ApiKey.find({ _id: { $in: connections.map((row) => row.apiKey) } }).lean().exec();
  const byId = new Map(keys.map((key) => [String(key._id), key]));

  res.json({
    connections: connections.map((row) => ({
      id: String(row._id),
      app: byId.get(String(row.apiKey))?.appName ?? 'An app',
      connectedAt: row.createdAt,
    })),
  });
}

export async function revokeConnection(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('No such connection.');

  const connection = await Connection.findOne({ _id: req.params.id, texorId: req.user.texorId }).exec();
  if (!connection) throw ApiError.notFound('No such connection.');

  connection.revokedAt = new Date();
  await connection.save();

  res.json({ ok: true });
}

export default {
  keySchema,
  listKeys,
  postKey,
  deleteKey,
  connectPrompt,
  connectApprove,
  connectApproveSchema,
  connectExchange,
  connectExchangeSchema,
  listConnections,
  revokeConnection,
};
