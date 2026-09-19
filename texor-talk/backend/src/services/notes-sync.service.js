/**
 * Meeting notes, mirrored into Texor Notes — and edits made there, brought back.
 *
 * Off unless `NOTES_API_ORIGIN` and `NOTES_API_KEY` are both set, and off is the
 * product exactly as it was. Nothing in Talk's own notes feature knows this file
 * exists: the note controller calls it after a response has already gone, and
 * every function here returns immediately when the feature is off.
 *
 * Three rules, and they are the whole of the design:
 *
 *   · **a note is saved whether or not Notes is up.** Nothing here is awaited
 *     by a request, and nothing here can throw into one.
 *   · **a note lands in the account of whoever wrote it.** The key is a
 *     trusted one, so each push names its owner; Bo's meeting note becomes
 *     Bo's note under Bo's "Texor Talk" label, even before Bo has opened Notes.
 *   · **a change that arrived from Notes is never sent back to it.** Otherwise
 *     the two products hand the same edit to each other until one falls over.
 *
 * The document crosses untransformed. Notes' blocks *are* Talk's blocks — the
 * model was lifted whole — which is why this file is a few functions and not a
 * mapping layer.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const TIMEOUT_MS = 4000;

async function send(path, method, body) {
  const response = await fetch(`${env.notesSync.origin}${path}`, {
    method,
    headers: {
      'x-api-key': env.notesSync.key,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`Texor Notes answered ${response.status}`);
}

/**
 * What a Talk note looks like to Notes.
 *
 * Kept separate from the push so the suite can check the shape without a
 * network, and so the one place that decides what crosses is easy to read.
 */
export function payloadFor(note, owner) {
  return {
    externalId: String(note._id),
    title: note.title || note.meetingTitle || 'Meeting notes',
    blocks: note.blocks,
    url: `${env.appOrigin}/notes/${note._id}`,
    owner: {
      texorId: note.ownerTexorId,
      email: owner?.email ?? '',
      name: note.ownerName || owner?.displayName || '',
      picture: note.ownerPicture || owner?.picture || '',
    },
  };
}

/**
 * Fire and forget, with the catch *inside*.
 *
 * A floating promise that rejects takes the process down under Node's default,
 * and this one rejects every time Notes restarts. A failed push is a log line.
 */
export function pushNote(note, owner) {
  if (!env.notesSync.enabled) return;

  send('/api/v1/notes', 'POST', payloadFor(note, owner))
    .catch((error) => logger.warn('notes push failed', { note: String(note._id), message: error.message }));
}

export function pushDelete(note) {
  if (!env.notesSync.enabled) return;

  // Named by Talk's own id, with the owner so a trusted key knows whose it is.
  send(`/api/v1/notes/external:${note._id}`, 'DELETE', {
    owner: { texorId: note.ownerTexorId, name: note.ownerName },
  }).catch((error) => logger.warn('notes delete push failed', { note: String(note._id), message: error.message }));
}

/**
 * Is this really Texor Notes?
 *
 * HMAC-SHA256 over the exact bytes that arrived, compared in constant time —
 * the same check Finvoice runs on Razorpay. No secret configured means no edit
 * from Notes is trusted, which is the safe way for a half-finished setup to
 * fail: the mirror works one way until the secret is filled in.
 */
export function verifySignature(rawBody, header) {
  const secret = env.notesSync.webhookSecret;
  if (!secret || !header || !rawBody) return false;

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));

  return a.length === b.length && timingSafeEqual(a, b);
}

export default { pushNote, pushDelete, payloadFor, verifySignature };
