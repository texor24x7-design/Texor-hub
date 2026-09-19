/**
 * Who is calling the notes API.
 *
 * A key identifies the app. Which *account* the call acts on depends on how the
 * key was set up, and that is the whole of the authorisation model here:
 *
 *   · `mode: 'owner'` — the person who made the key. An integration somebody
 *     runs for themselves.
 *   · `mode: 'user'`  — the person named by the connection token in
 *     `X-Notes-User`, who approved this app once in a page here.
 *   · a **trusted** key may instead name an account outright, which is how a
 *     first-party product files a note in the account of whoever wrote it.
 *
 * Whatever the route, `req.user` ends up looking exactly like a signed-in
 * person, so the controllers below do not have to know any of this happened.
 */
import ApiError from '../utils/ApiError.js';
import Connection from '../models/Connection.js';
import User from '../models/User.js';
import { sha256 } from '../utils/ids.js';
import { USER_TOKEN_PREFIX, appLabelFor, keyFromToken } from '../services/apikey.service.js';

/**
 * No timing-safe compare here, and none needed: the lookup is by the SHA-256 of
 * whatever was sent, so there is no secret being compared byte by byte.
 */
export async function requireApiKey(req, _res, next) {
  try {
    const presented = req.get('x-api-key');
    if (!presented) {
      throw ApiError.unauthorized('Send your key in the X-API-Key header.');
    }

    const key = await keyFromToken(presented);
    if (!key) throw ApiError.unauthorized('That API key is not valid.');

    const { user, label } = await accountFor(key, req);

    req.apiKey = key;
    req.user = user;
    req.actor = { texorId: user.texorId, viaApiKey: true };
    req.apiLabel = label;

    /**
     * Fire and forget. A "last used" stamp is worth a write, not a round trip
     * on somebody else's request path.
     *
     * ponytail: one write per call. Throttle to once a minute per key if it
     * ever shows up in a profile.
     */
    key.updateOne({ lastUsedAt: new Date() }).exec().catch(() => {});

    return next();
  } catch (error) {
    return next(error);
  }
}

/** The account this call acts on, and the label its notes belong under. */
async function accountFor(key, req) {
  const onBehalf = req.body?.owner;

  if (onBehalf) {
    if (!key.trusted) {
      throw ApiError.forbidden(
        'This key can only write notes into its own account. Ask an administrator about a trusted key.',
      );
    }
    if (!onBehalf.texorId) throw ApiError.badRequest('An owner needs a texorId.');

    /**
     * The person may never have opened Notes. A placeholder is created so the
     * note has an owner and a name to show, and the row is replaced by the real
     * profile the first time they sign in.
     */
    const user = await User.upsertPlaceholder({
      texorId: onBehalf.texorId,
      email: onBehalf.email,
      name: onBehalf.name,
      picture: onBehalf.picture,
    });

    const label = await appLabelFor({
      appName: key.appName,
      ownerTexorId: user.texorId,
      apiKeyId: key._id,
    });

    return { user, label };
  }

  if (key.mode === 'user') {
    const token = req.get('x-notes-user');
    if (!token || !token.startsWith(USER_TOKEN_PREFIX)) {
      throw ApiError.unauthorized('This key writes on behalf of a person. Send their connection token in X-Notes-User.');
    }

    const connection = await Connection.findOne({ tokenHash: sha256(token), revokedAt: null }).exec();
    if (!connection || String(connection.apiKey) !== String(key._id)) {
      throw ApiError.unauthorized('That connection is not valid any more.');
    }

    const user = await User.findOne({ texorId: connection.texorId }).exec();
    if (!user) throw ApiError.unauthorized('That connection has no account behind it.');

    return { user, label: connection.label ? { _id: connection.label } : null };
  }

  const user = await User.findOne({ texorId: key.ownerTexorId }).exec();
  if (!user) throw ApiError.unauthorized('That API key has no account behind it.');

  return { user, label: key.label ? { _id: key.label } : null };
}

export default requireApiKey;
