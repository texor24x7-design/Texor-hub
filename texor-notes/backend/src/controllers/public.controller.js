/**
 * The notes API other platforms call.
 *
 * Deliberately small. A note is a title, some blocks and a colour; an app sends
 * its own identifier for the thing the note is about, and everything else
 * follows from that:
 *
 *   · sending the same `externalId` twice is an update, not a duplicate — the
 *     partial unique index in `models/Note.js` is what makes that true even
 *     when two requests race
 *   · `external:<yourId>` works anywhere an id does, so an integration never
 *     has to store ours
 *
 * Errors are the same shape as everywhere else in the ecosystem, because it is
 * the same error handler: `{ error: { code, message, details } }`.
 */
import { z } from 'zod';
import mongoose from 'mongoose';
import Note from '../models/Note.js';
import NoteEvent from '../models/NoteEvent.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { blockInput } from './note.controller.js';
import { mentionsOf, noteStats, preview, sanitiseBlocks } from '../services/notes.service.js';
import { NOTE_COLOURS } from '../models/Note.js';
import { notifyKey } from '../services/webhook.service.js';

const ownerInput = z.object({
  texorId: z.string().min(1),
  email: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
}).optional();

export const apiNoteSchema = z.object({
  externalId: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  blocks: z.array(blockInput).optional(),
  colour: z.enum(NOTE_COLOURS).optional(),
  url: z.string().max(2000).optional(),
  owner: ownerInput,
});

export const apiListSchema = z.object({
  externalId: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** What an integration gets back. Their identifier first — it is the one they know. */
function present(note) {
  return {
    id: String(note._id),
    externalId: note.source?.externalId ?? null,
    title: note.title,
    blocks: note.blocks,
    colour: note.colour,
    preview: preview(note.blocks),
    stats: noteStats(note.blocks),
    owner: { texorId: note.ownerTexorId, name: note.ownerName },
    url: `${env.appOrigin}/notes/${note._id}`,
    deletedAt: note.deletedAt,
    version: note.version,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/**
 * A key sees the notes it created, and nothing else in the account.
 *
 * An integration was given somewhere to put notes, not a window onto everything
 * its owner has ever written.
 */
const scope = (req) => ({ 'source.apiKey': req.apiKey._id, ownerTexorId: req.user.texorId });

async function find(req) {
  const raw = String(req.params.id);

  const filter = raw.startsWith('external:')
    ? { ...scope(req), 'source.externalId': raw.slice('external:'.length) }
    : mongoose.isValidObjectId(raw)
      ? { ...scope(req), _id: raw }
      : null;

  if (!filter) throw ApiError.notFound('No note with that id.');

  const note = await Note.findOne(filter).exec();
  if (!note) throw ApiError.notFound('No note with that id.');

  return note;
}

/** One call to check the wiring before debugging anything else. */
export async function whoAmI(req, res) {
  res.json({
    app: req.apiKey.appName,
    mode: req.apiKey.mode,
    trusted: req.apiKey.trusted,
    owner: { texorId: req.user.texorId, email: req.user.email, name: req.user.displayName },
    label: req.apiLabel ? String(req.apiLabel._id) : null,
    webhook: Boolean(req.apiKey.webhookUrl),
  });
}

export async function listApiNotes(req, res) {
  const filter = { ...scope(req), deletedAt: null };
  if (req.query.externalId) filter['source.externalId'] = req.query.externalId;

  const notes = await Note.find(filter).sort({ updatedAt: -1 }).limit(req.query.limit).exec();

  res.json({ notes: notes.map(present) });
}

export async function getApiNote(req, res) {
  res.json({ note: present(await find(req)) });
}

export async function upsertApiNote(req, res) {
  const body = req.body;
  const blocks = sanitiseBlocks(body.blocks);
  const mentions = mentionsOf(blocks).map((mention) => mention.texorId);
  const labels = req.apiLabel ? [req.apiLabel._id] : [];

  /**
   * No external id means no way to say "the same note again", so it is a new
   * one every time — which is the right behaviour for an app that just wants to
   * drop something in, and the reason `externalId` is worth a paragraph in the
   * documentation.
   */
  if (!body.externalId) {
    const note = await Note.create({
      ownerTexorId: req.user.texorId,
      ownerName: req.user.displayName,
      ownerPicture: req.user.picture,
      title: (body.title ?? '').trim(),
      blocks,
      colour: body.colour ?? 'default',
      labels,
      mentionedTexorIds: mentions,
      source: { app: req.apiKey.appName, apiKey: req.apiKey._id, externalId: null, url: body.url ?? '' },
    });

    await NoteEvent.record({
      note: note._id,
      actor: { texorId: req.user.texorId, name: req.apiKey.appName },
      action: 'created',
      detail: req.apiKey.appName,
    });

    return res.status(201).json({ note: present(note) });
  }

  const existing = await Note.findOne({
    'source.apiKey': req.apiKey._id,
    'source.externalId': body.externalId,
  }).exec();

  if (!existing) {
    const note = await Note.create({
      ownerTexorId: req.user.texorId,
      ownerName: req.user.displayName,
      ownerPicture: req.user.picture,
      title: (body.title ?? '').trim(),
      blocks,
      colour: body.colour ?? 'default',
      labels,
      mentionedTexorIds: mentions,
      source: {
        app: req.apiKey.appName,
        apiKey: req.apiKey._id,
        externalId: body.externalId,
        url: body.url ?? '',
      },
    });

    await NoteEvent.record({
      note: note._id,
      actor: { texorId: req.user.texorId, name: req.apiKey.appName },
      action: 'created',
      detail: req.apiKey.appName,
    });

    return res.status(201).json({ note: present(note) });
  }

  if (body.title !== undefined) existing.title = body.title.trim();
  if (body.blocks !== undefined) {
    existing.blocks = blocks;
    existing.mentionedTexorIds = mentions;
  }
  if (body.colour !== undefined) existing.colour = body.colour;
  if (body.url !== undefined) existing.source.url = body.url;

  /**
   * An update from the app that owns this note brings it back to life.
   *
   * Somebody trashed the copy here, then edited the original over there. The
   * edit is the newer intent, and quietly dropping it would look like the sync
   * had stopped working.
   */
  existing.deletedAt = null;

  existing.version += 1;
  existing.lastEditedBy = { texorId: req.user.texorId, name: req.apiKey.appName, at: new Date() };

  await existing.save();

  await NoteEvent.record({
    note: existing._id,
    actor: { texorId: req.user.texorId, name: req.apiKey.appName },
    action: 'synced',
    detail: req.apiKey.appName,
  });

  return res.json({ note: present(existing) });
}

/**
 * An update addressed by id rather than by the app's own identifier.
 *
 * The same work as the second half of `upsertApiNote`, and deliberately not
 * shared with it: that one has to decide whether the note exists at all, this
 * one already has it in its hand.
 */
export async function patchApiNote(req, res) {
  const note = await find(req);
  const body = req.body;

  if (body.title !== undefined) note.title = body.title.trim();
  if (body.blocks !== undefined) {
    note.blocks = sanitiseBlocks(body.blocks);
    note.mentionedTexorIds = mentionsOf(note.blocks).map((mention) => mention.texorId);
  }
  if (body.colour !== undefined) note.colour = body.colour;
  if (body.url !== undefined) note.source.url = body.url;

  note.deletedAt = null;
  note.version += 1;
  note.lastEditedBy = { texorId: req.user.texorId, name: req.apiKey.appName, at: new Date() };

  await note.save();

  await NoteEvent.record({
    note: note._id,
    actor: { texorId: req.user.texorId, name: req.apiKey.appName },
    action: 'synced',
    detail: req.apiKey.appName,
  });

  res.json({ note: present(note) });
}

export async function deleteApiNote(req, res) {
  const note = await find(req);

  // Soft, like every other delete here: it lands in the owner's trash, where
  // they can get it back. An app losing its copy is not a reason for a person
  // to lose theirs.
  note.deletedAt = new Date();
  await note.save();

  await NoteEvent.record({
    note: note._id,
    actor: { texorId: req.user.texorId, name: req.apiKey.appName },
    action: 'trashed',
    detail: req.apiKey.appName,
  });

  res.json({ ok: true });
}

/**
 * Tell the app that made a note that somebody changed it here.
 *
 * Called from the internal routes after a save, never from the API routes — a
 * change that arrived from an app must not be posted straight back to it.
 */
export function syncOut(note, { ApiKey }) {
  if (!note.source?.apiKey) return;

  ApiKey.findById(note.source.apiKey).exec()
    .then((key) => {
      if (!key || key.revokedAt) return;
      notifyKey(key, {
        event: note.deletedAt ? 'note.deleted' : 'note.updated',
        note: present(note),
      });
    })
    .catch(() => {});
}

export default {
  apiNoteSchema,
  apiListSchema,
  whoAmI,
  listApiNotes,
  getApiNote,
  upsertApiNote,
  patchApiNote,
  deleteApiNote,
  syncOut,
};
