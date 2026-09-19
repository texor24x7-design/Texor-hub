/**
 * Notes.
 *
 * The document handling is Texor Talk's, unchanged — the same sanitiser, the
 * same clamp-don't-refuse philosophy. What is different is everything around
 * it: a note here belongs to a person rather than to a meeting, it can be
 * filed under labels, and it can be shared with people who then edit it.
 *
 * Two rules run through the whole file:
 *
 *   · **the document is replaced, never merged.** An autosave sends the whole
 *     note. Merging two versions of a rich document is a research problem, so
 *     instead a save carries the version it was made against and a stale one is
 *     refused rather than silently flattening somebody's paragraph.
 *   · **an unauthorised read is a 404.** A note you may not see must not
 *     confirm that it exists to somebody holding a guessed id.
 */
import { z } from 'zod';
import mongoose from 'mongoose';
import Note, { NOTE_COLOURS } from '../models/Note.js';
import Label from '../models/Label.js';
import NoteEvent from '../models/NoteEvent.js';
import ApiKey from '../models/ApiKey.js';
import { syncOut } from './public.controller.js';
import ApiError from '../utils/ApiError.js';
import { canWrite, isOwner, labelRolesFor, roleOf } from '../services/access.service.js';
import {
  LIMITS,
  mentionsOf,
  noteStats,
  preview,
  sanitiseBlocks,
} from '../services/notes.service.js';

/**
 * The block schema is deliberately loose.
 *
 * Zod's job here is to reject something that is not a document at all — a
 * string where an array belongs, a number where text belongs. Deciding what is
 * *valid* is `sanitiseBlocks`, which clamps rather than refuses, because a mark
 * running one character past the end of its text is a keystroke racing a save,
 * not an attack, and losing somebody's paragraph over it would be indefensible.
 */
export const markInput = z.object({
  // A plain string, not the enum. An unknown mark type is dropped by
  // `sanitiseMark`; rejecting the whole request here would mean a client one
  // version ahead of this server loses the paragraph it was attached to.
  type: z.string(),
  start: z.number(),
  end: z.number(),
  color: z.string().optional(),
  href: z.string().optional(),
  texorId: z.string().optional(),
  name: z.string().optional(),
}).loose();

export const blockInput = z.object({
  // Likewise: an unknown block type becomes a paragraph rather than a 400, so
  // the text survives even when the structure around it is not understood.
  type: z.string().optional(),
  text: z.string().optional(),
  marks: z.array(markInput).optional(),
  level: z.number().optional(),
  align: z.string().optional(),
  indent: z.number().optional(),
  done: z.boolean().optional(),
  speakerTexorId: z.string().optional(),
  speakerName: z.string().optional(),
  at: z.union([z.string(), z.date()]).nullish(),
}).loose();

export const createNoteSchema = z.object({
  title: z.string().max(LIMITS.title).optional(),
  blocks: z.array(blockInput).optional(),
  colour: z.enum(NOTE_COLOURS).optional(),
  labels: z.array(z.string()).max(20).optional(),
});

export const updateNoteSchema = z.object({
  title: z.string().max(LIMITS.title).optional(),
  blocks: z.array(blockInput).optional(),
  colour: z.enum(NOTE_COLOURS).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  /**
   * What the editor believed it was changing.
   *
   * Optional, because a colour change or a pin does not need to care. Sent by
   * anything that replaces the document.
   */
  version: z.number().int().positive().optional(),
});

export const listNotesSchema = z.object({
  scope: z.enum(['notes', 'shared', 'archive', 'trash']).default('notes'),
  label: z.string().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});

/** A note as a list row: everything needed to draw it, and no document. */
export function presentSummary(note, actor, role) {
  return {
    id: String(note._id),
    title: note.title,
    preview: preview(note.blocks),
    stats: noteStats(note.blocks),
    colour: note.colour,
    labels: (note.labels ?? []).map(String),
    pinned: note.pinned,
    archived: Boolean(note.archivedAt),
    deletedAt: note.deletedAt,
    version: note.version,
    role,
    isMine: note.ownerTexorId === actor.texorId,
    shared: (note.shares ?? []).length > 0,
    sharedWith: (note.shares ?? []).length,
    mentionsMe: (note.mentionedTexorIds ?? []).includes(actor.texorId),
    owner: { texorId: note.ownerTexorId, name: note.ownerName, picture: note.ownerPicture },
    source: note.source?.app && note.source.app !== 'web'
      ? { app: note.source.app, url: note.source.url || '' }
      : null,
    lastEditedBy: note.lastEditedBy?.texorId ? note.lastEditedBy : null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/** A note in full, for opening it. */
export function presentNote(note, actor, role) {
  return {
    ...presentSummary(note, actor, role),
    blocks: note.blocks,
    canEdit: role === 'owner' || role === 'editor',
    canShare: role === 'owner',
    shares: role === 'owner'
      ? (note.shares ?? []).map((share) => ({
          email: share.email,
          name: share.name,
          role: share.role,
          pending: !share.texorId,
        }))
      : undefined,
  };
}

/** Loads a note and settles access in one place. */
export async function loadNote(id, actor, { need = 'read' } = {}) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Note not found.');

  const note = await Note.findById(id).exec();
  if (!note) throw ApiError.notFound('Note not found.');

  const labelRoles = await labelRolesFor(Label, actor.texorId);
  const role = roleOf(note, actor, { labelRoles });

  // Deliberately a 404 rather than a 403: a note you cannot read should not
  // confirm its own existence to a stranger holding a guessed id.
  if (!role) throw ApiError.notFound('Note not found.');

  /**
   * A note in the trash is readable by its owner — they have to be able to list
   * it and get it back — but not writable by anybody.
   *
   * This is the autosave that was already in flight when delete was pressed. It
   * arrives a second later, and without this it quietly recreates the document
   * its owner had just thrown away.
   */
  if (need === 'write' && note.deletedAt) throw ApiError.notFound('Note not found.');

  if (need === 'write' && !canWrite(note, actor, { labelRoles })) {
    throw ApiError.forbidden('You can read this note but not change it.');
  }
  if (need === 'own' && !isOwner(note, actor)) {
    throw ApiError.forbidden('Only the owner of a note can do that.');
  }

  return { note, role };
}

/** The actor behind a request — a signed-in person, or an API key acting as one. */
export const actorOf = (req) => req.actor ?? { texorId: req.user.texorId, viaApiKey: false };

export async function listNotes(req, res) {
  const actor = actorOf(req);
  const me = actor.texorId;
  const { scope, label, q, limit } = req.query;

  const labelRoles = await labelRolesFor(Label, me);
  const sharedLabelIds = [...labelRoles.keys()].map((id) => new mongoose.Types.ObjectId(id));

  /**
   * "Shared with me" is two things at once.
   *
   * A note somebody handed me directly, and a note filed under a label somebody
   * shared. The second is why this is an `$or` and not a single index lookup —
   * and why the label ids are fetched first rather than joined: there are a
   * handful of them, and a handful of ids in an `$in` is cheaper than every
   * alternative.
   */
  const filters = {
    notes: { ownerTexorId: me, deletedAt: null, archivedAt: null },
    shared: {
      ownerTexorId: { $ne: me },
      deletedAt: null,
      $or: [{ sharedTexorIds: me }, ...(sharedLabelIds.length ? [{ labels: { $in: sharedLabelIds } }] : [])],
    },
    archive: { ownerTexorId: me, deletedAt: null, archivedAt: { $ne: null } },
    trash: { ownerTexorId: me, deletedAt: { $ne: null } },
  };

  let filter = { ...filters[scope] };

  /**
   * A label is its own scope.
   *
   * Asking for "the notes under this label" has to include the ones somebody
   * else owns and shared through that very label — filtering by owner first
   * would show an empty page on a label that is full. So the query narrows to
   * the label, and `roleOf` below decides what the person may actually see,
   * which is the same division of labour the rest of this function uses.
   */
  if (label) {
    if (!mongoose.isValidObjectId(label)) throw ApiError.badRequest('That is not a label id.');
    filter = {
      labels: new mongoose.Types.ObjectId(label),
      deletedAt: null,
      ...(scope === 'archive' ? { archivedAt: { $ne: null } } : { archivedAt: null }),
    };
  }

  if (q) filter.$text = { $search: q };

  const notes = await Note.find(filter)
    .sort(scope === 'trash' ? { deletedAt: -1 } : { pinned: -1, updatedAt: -1 })
    .limit(limit)
    .exec();

  res.json({
    notes: notes
      .map((note) => ({ note, role: roleOf(note, actor, { labelRoles }) }))
      // The query narrows; the access rules decide. Belt and braces, and cheap.
      .filter((row) => row.role !== null)
      .map((row) => presentSummary(row.note, actor, row.role)),
  });
}

export async function getNote(req, res) {
  const actor = actorOf(req);
  const { note, role } = await loadNote(req.params.id, actor);
  res.json({ note: presentNote(note, actor, role) });
}

export async function createNote(req, res) {
  const actor = actorOf(req);
  const blocks = sanitiseBlocks(req.body.blocks);

  const labels = await ownedLabelIds(req.body.labels, actor.texorId);

  const note = await Note.create({
    ownerTexorId: actor.texorId,
    ownerName: req.user.displayName,
    ownerPicture: req.user.picture,
    title: (req.body.title ?? '').trim(),
    blocks,
    colour: req.body.colour ?? 'default',
    labels,
    mentionedTexorIds: mentionsOf(blocks).map((mention) => mention.texorId),
    lastEditedBy: { texorId: actor.texorId, name: req.user.displayName, at: new Date() },
  });

  await NoteEvent.record({
    note: note._id,
    actor: { texorId: actor.texorId, name: req.user.displayName },
    action: 'created',
    detail: actor.viaApiKey ? req.apiKey?.appName ?? '' : '',
  });

  res.status(201).json({ note: presentNote(note, actor, 'owner') });
}

export async function updateNote(req, res) {
  const actor = actorOf(req);
  const { note, role } = await loadNote(req.params.id, actor, { need: 'write' });

  const body = req.body;
  const replacingDocument = body.blocks !== undefined || body.title !== undefined;

  /**
   * The conflict guard.
   *
   * Only for a save that replaces the document — pinning a note or changing its
   * colour cannot lose anybody's words, and refusing those would make a shared
   * note feel broken for no benefit. The current document rides along with the
   * refusal so the editor can show both versions rather than just apologising.
   */
  if (replacingDocument && body.version !== undefined && body.version !== note.version) {
    throw new ApiError(409, 'stale_version', 'Somebody else saved this note while you were typing.', {
      version: note.version,
      lastEditedBy: note.lastEditedBy,
      note: presentNote(note, actor, role),
    });
  }

  if (body.title !== undefined) note.title = body.title.trim();

  if (body.blocks !== undefined) {
    note.blocks = sanitiseBlocks(body.blocks);
    note.mentionedTexorIds = mentionsOf(note.blocks).map((mention) => mention.texorId);
  }

  if (body.colour !== undefined) note.colour = body.colour;
  if (body.pinned !== undefined) note.pinned = body.pinned;
  if (body.archived !== undefined) note.archivedAt = body.archived ? new Date() : null;

  if (replacingDocument) {
    note.version += 1;
    note.lastEditedBy = { texorId: actor.texorId, name: req.user.displayName, at: new Date() };
  }

  await note.save();

  /**
   * One row per burst of typing, not one per save — see `NoteEvent.record`. A
   * colour change is not an edit of the document and does not claim to be.
   */
  if (replacingDocument || body.archived !== undefined) {
    await NoteEvent.record({
      note: note._id,
      actor: { texorId: actor.texorId, name: req.user.displayName },
      action: body.archived === true ? 'archived' : body.archived === false ? 'restored' : 'edited',
    });
  }

  res.json({ note: presentNote(note, actor, role) });

  /**
   * The other half of two-way sync, after the response rather than before it.
   *
   * A note that came from an app is edited here, and that app is told. Only for
   * a change made *here* — an edit that arrived over the API does not come back
   * through this function, which is what stops the two products handing the
   * same edit to each other for ever.
   */
  if (replacingDocument && !actor.viaApiKey) syncOut(note, { ApiKey });
}

/**
 * Deleting is moving to the trash.
 *
 * Soft, and not only to be kind: an autosave already in flight when somebody
 * hits delete would otherwise recreate the document it was saving.
 */
export async function deleteNote(req, res) {
  const actor = actorOf(req);
  const { note } = await loadNote(req.params.id, actor, { need: 'own' });

  note.deletedAt = new Date();
  await note.save();

  await NoteEvent.record({
    note: note._id,
    actor: { texorId: actor.texorId, name: req.user.displayName },
    action: 'trashed',
  });

  res.json({ ok: true, deletedAt: note.deletedAt });

  if (!actor.viaApiKey) syncOut(note, { ApiKey });
}

export async function restoreNote(req, res) {
  const actor = actorOf(req);
  const { note, role } = await loadNote(req.params.id, actor, { need: 'own' });

  note.deletedAt = null;
  await note.save();

  res.json({ note: presentNote(note, actor, role) });
}

/** Out of the trash and gone. The one destructive route in the product. */
export async function purgeNote(req, res) {
  const actor = actorOf(req);
  const { note } = await loadNote(req.params.id, actor, { need: 'own' });

  if (!note.deletedAt) throw ApiError.badRequest('Move the note to the trash first.');

  await Note.deleteOne({ _id: note._id }).exec();
  await NoteEvent.deleteMany({ note: note._id }).exec();

  res.json({ ok: true });
}

/**
 * Only the caller's own labels, and only ones that exist.
 *
 * Filing a note under somebody else's label would otherwise share it with
 * everybody that label is shared with — the permission model runs through
 * labels, so an unchecked id here is an escalation, not a tidiness problem.
 */
export async function ownedLabelIds(ids, texorId) {
  if (!ids?.length) return [];

  const valid = ids.filter((id) => mongoose.isValidObjectId(id));
  if (!valid.length) return [];

  const labels = await Label.find({ _id: { $in: valid }, ownerTexorId: texorId }).select('_id').lean().exec();
  return labels.map((label) => label._id);
}

export async function setNoteLabels(req, res) {
  const actor = actorOf(req);
  const { note, role } = await loadNote(req.params.id, actor, { need: 'own' });

  note.labels = await ownedLabelIds(req.body.labels, actor.texorId);
  await note.save();

  await NoteEvent.record({
    note: note._id,
    actor: { texorId: actor.texorId, name: req.user.displayName },
    action: 'labelled',
  });

  res.json({ note: presentNote(note, actor, role) });
}

export const labelsSchema = z.object({ labels: z.array(z.string()).max(20).default([]) });

export default {
  createNoteSchema,
  updateNoteSchema,
  listNotesSchema,
  labelsSchema,
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  restoreNote,
  purgeNote,
  setNoteLabels,
};
