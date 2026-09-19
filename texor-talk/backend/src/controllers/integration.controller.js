/**
 * Edits made in Texor Notes, arriving back here.
 *
 * The inbound half of the mirror. A meeting note edited at notes.texor.app is
 * posted to this route, signed; it is applied to the Talk note it came from
 * and deliberately *not* pushed back out — a change that arrived from Notes
 * going straight back to Notes is the loop this whole design exists to avoid.
 *
 * Mounted in `app.js` ahead of the JSON parser, because the signature is over
 * the exact bytes that were sent and parsing first would throw them away.
 */
import mongoose from 'mongoose';
import Note from '../models/Note.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { mentionsOf, sanitiseBlocks } from '../services/notes.service.js';
import { verifySignature } from '../services/notes-sync.service.js';

export async function receiveFromNotes(req, res) {
  if (!verifySignature(req.body, req.get('x-notes-signature'))) {
    throw ApiError.unauthorized('That request is not signed by Texor Notes.');
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    throw ApiError.badRequest('That is not JSON.');
  }

  const externalId = payload?.note?.externalId;
  if (!externalId || !mongoose.isValidObjectId(externalId)) {
    throw ApiError.badRequest('No Talk note is named in that change.');
  }

  const note = await Note.findById(externalId).exec();

  // A 4xx, so Notes logs it once rather than retrying a note Talk has never had.
  if (!note) throw ApiError.notFound('Talk has no note with that id.');

  if (payload.event === 'note.deleted') {
    note.deletedAt = new Date();
  } else {
    if (typeof payload.note.title === 'string') note.title = payload.note.title.trim();
    if (Array.isArray(payload.note.blocks)) {
      // The server does not trust the other product's idea of a valid document
      // any more than it trusts a browser's.
      note.blocks = sanitiseBlocks(payload.note.blocks);
      note.mentionedTexorIds = mentionsOf(note.blocks).map((mention) => mention.texorId);
    }
    // Put back in Notes means put back here.
    note.deletedAt = null;
  }

  await note.save();

  logger.info('note updated from texor notes', { note: String(note._id), event: payload.event });

  res.json({ ok: true });
}

export default { receiveFromNotes };
