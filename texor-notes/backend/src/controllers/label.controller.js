/**
 * Labels.
 *
 * Flat, many per note, and shareable — sharing a label is how a team works on a
 * body of notes rather than on one note at a time.
 *
 * An app's label is locked. Every API key gets one named after the app and
 * every note that app creates is filed under it, which is how somebody who
 * wired up their CRM finds those notes here. Renaming it would break the one
 * thing it is for, so the name and the deletion are refused while the key
 * lives; the colour is theirs.
 */
import { z } from 'zod';
import mongoose from 'mongoose';
import Label from '../models/Label.js';
import Note from '../models/Note.js';
import ApiError from '../utils/ApiError.js';
import { NOTE_COLOURS } from '../models/Note.js';
import { labelRolesFor } from '../services/access.service.js';

export const labelSchema = z.object({
  name: z.string().min(1, 'Give the label a name.').max(60),
  colour: z.enum(NOTE_COLOURS).optional(),
});

export const labelPatchSchema = labelSchema.partial();

export function present(label, texorId, role = 'owner') {
  return {
    id: String(label._id),
    name: label.name,
    colour: label.colour,
    locked: label.locked,
    role,
    isMine: label.ownerTexorId === texorId,
    owner: label.ownerTexorId,
    shared: (label.shares ?? []).length > 0,
    shares: label.ownerTexorId === texorId
      ? (label.shares ?? []).map((share) => ({
          email: share.email, name: share.name, role: share.role, pending: !share.texorId,
        }))
      : undefined,
  };
}

export async function loadOwn(id, texorId) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Label not found.');

  const label = await Label.findOne({ _id: id, ownerTexorId: texorId }).exec();
  if (!label) throw ApiError.notFound('Label not found.');

  return label;
}

/**
 * Mine, and the ones shared with me.
 *
 * Both in one list because the sidebar draws them together — a label somebody
 * shared with you is a place your notes live too, and hiding it under a second
 * heading would be filing cabinets all the way down.
 */
export async function listLabels(req, res) {
  const me = req.user.texorId;

  const mine = await Label.find({ ownerTexorId: me }).sort({ name: 1 }).exec();
  const roles = await labelRolesFor(Label, me);

  const shared = roles.size
    ? await Label.find({ _id: { $in: [...roles.keys()].map((id) => new mongoose.Types.ObjectId(id)) } })
      .sort({ name: 1 })
      .exec()
    : [];

  res.json({
    labels: [
      ...mine.map((label) => present(label, me)),
      ...shared.map((label) => present(label, me, roles.get(String(label._id)))),
    ],
  });
}

export async function createLabel(req, res) {
  try {
    const label = await Label.create({
      ownerTexorId: req.user.texorId,
      name: req.body.name.trim(),
      colour: req.body.colour ?? 'default',
    });

    res.status(201).json({ label: present(label, req.user.texorId) });
  } catch (error) {
    /**
     * The unique index does the deciding, not a read-then-write here — two
     * browser tabs both checking first and both finding nothing is exactly how
     * a sidebar ends up with two labels of the same name. This only improves
     * the sentence the person reads.
     */
    if (error?.code === 11000) {
      throw new ApiError(409, 'conflict', 'You already have a label with that name.');
    }
    throw error;
  }
}

export async function updateLabel(req, res) {
  const label = await loadOwn(req.params.id, req.user.texorId);

  if (req.body.name !== undefined && req.body.name.trim() !== label.name) {
    if (label.locked) {
      throw ApiError.forbidden('This label belongs to an app. Its name is how that app finds its notes.');
    }
    label.name = req.body.name.trim();
  }

  if (req.body.colour !== undefined) label.colour = req.body.colour;

  await label.save();

  res.json({ label: present(label, req.user.texorId) });
}

/**
 * Deleting a label unfiles its notes. It never deletes them.
 *
 * A label is a view onto notes, not a container for them, and a product where
 * tidying up the sidebar can destroy a week of writing is a product people stop
 * tidying.
 */
export async function deleteLabel(req, res) {
  const label = await loadOwn(req.params.id, req.user.texorId);

  if (label.locked) {
    throw ApiError.forbidden('This label belongs to an app. Revoke its key first.');
  }

  await Note.updateMany({ labels: label._id }, { $pull: { labels: label._id } }).exec();
  await Label.deleteOne({ _id: label._id }).exec();

  res.json({ ok: true });
}

export default {
  labelSchema,
  labelPatchSchema,
  listLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  loadOwn,
  present,
};
