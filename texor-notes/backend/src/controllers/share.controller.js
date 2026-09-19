/**
 * Sharing, and the people you can share with.
 *
 * Sharing is by email, always — including with somebody who has never opened
 * this product. Their share waits with `texorId: null` until they sign in, and
 * `User.upsertFromClaims` claims it for them on the way past. There is no
 * invitation token and no mail server in that path, which is the reason it can
 * exist at all in a first version.
 *
 * There is no directory to search. Texor Account does not publish one, and this
 * product deliberately does not build a way to enumerate everybody in an
 * organisation — so the picker suggests people you already share with, and
 * anything else is typed as an address.
 */
import { z } from 'zod';
import Note from '../models/Note.js';
import Label from '../models/Label.js';
import NoteEvent from '../models/NoteEvent.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import { sharedIdsOf } from '../services/notes.service.js';
import { actorOf, loadNote, presentNote } from './note.controller.js';
import { loadOwn, present as presentLabel } from './label.controller.js';

export const shareSchema = z.object({
  email: z.email('That does not look like an email address.'),
  role: z.enum(['viewer', 'editor']).default('viewer'),
});

/**
 * Attaches a share to a note or a label, whichever it was handed.
 *
 * The two are the same operation on the same subdocument, so they are the same
 * function — a second copy would be the one that forgets to keep
 * `sharedTexorIds` in step.
 */
async function addShare(document, { email, role }, actor) {
  const address = email.toLowerCase().trim();

  if (address === (actor.email ?? '').toLowerCase()) {
    throw ApiError.badRequest('That is your own address — you already have this.');
  }

  // Already there: change the role rather than adding them twice.
  const existing = (document.shares ?? []).find((share) => share.email === address);

  if (existing) {
    existing.role = role;
  } else {
    const person = await User.findOne({ email: address }).select('texorId displayName').lean().exec();

    document.shares.push({
      texorId: person?.texorId ?? null,
      email: address,
      name: person?.displayName ?? '',
      role,
      addedByTexorId: actor.texorId,
      addedAt: new Date(),
    });
  }

  document.sharedTexorIds = sharedIdsOf(document.shares);
  await document.save();

  return address;
}

export async function shareNote(req, res) {
  const actor = actorOf(req);
  const { note, role } = await loadNote(req.params.id, actor, { need: 'own' });

  const email = await addShare(note, req.body, { ...actor, email: req.user.email });

  await NoteEvent.record({
    note: note._id,
    actor: { texorId: actor.texorId, name: req.user.displayName },
    action: 'shared',
    detail: email,
  });

  res.json({ note: presentNote(note, actor, role) });
}

export async function unshareNote(req, res) {
  const actor = actorOf(req);
  const address = String(req.params.email).toLowerCase();

  const { note, role } = await loadNote(req.params.id, actor);

  /**
   * The owner may remove anybody; anybody may remove themselves.
   *
   * The second half matters more than it looks: without it, leaving a note
   * somebody shared with you means asking them to do it, and a note you did not
   * want sits in your list for ever.
   */
  const removingSelf = address === String(req.user.email).toLowerCase();
  if (role !== 'owner' && !removingSelf) {
    throw ApiError.forbidden('Only the owner of a note can remove other people from it.');
  }

  note.shares = (note.shares ?? []).filter((share) => share.email !== address);
  note.sharedTexorIds = sharedIdsOf(note.shares);
  await note.save();

  await NoteEvent.record({
    note: note._id,
    actor: { texorId: actor.texorId, name: req.user.displayName },
    action: 'unshared',
    detail: address,
  });

  res.json(removingSelf && role !== 'owner' ? { ok: true } : { note: presentNote(note, actor, role) });
}

export async function shareLabel(req, res) {
  const label = await loadOwn(req.params.id, req.user.texorId);

  await addShare(label, req.body, { texorId: req.user.texorId, email: req.user.email });

  res.json({ label: presentLabel(label, req.user.texorId) });
}

export async function unshareLabel(req, res) {
  const address = String(req.params.email).toLowerCase();
  const label = await loadOwn(req.params.id, req.user.texorId);

  label.shares = (label.shares ?? []).filter((share) => share.email !== address);
  label.sharedTexorIds = sharedIdsOf(label.shares);
  await label.save();

  res.json({ label: presentLabel(label, req.user.texorId) });
}

/**
 * Who can be tagged or shared with.
 *
 * Everybody this person already shares something with, in either direction,
 * plus an exact match on an address. Not a directory: you cannot list the
 * organisation, and typing three letters cannot tell you who works here.
 */
export async function listPeople(req, res) {
  const me = req.user.texorId;
  const query = String(req.query.q ?? '').trim().toLowerCase();

  const [mine, sharedWithMe, labels] = await Promise.all([
    Note.find({ ownerTexorId: me, 'shares.0': { $exists: true } }).select('shares').lean().exec(),
    Note.find({ sharedTexorIds: me }).select('ownerTexorId shares').lean().exec(),
    Label.find({ $or: [{ ownerTexorId: me }, { sharedTexorIds: me }] }).select('ownerTexorId shares').lean().exec(),
  ]);

  const people = new Map();
  const add = (texorId, email, name) => {
    if (!email || texorId === me) return;
    if (!people.has(email)) people.set(email, { texorId: texorId ?? null, email, name: name ?? '' });
  };

  for (const document of [...mine, ...sharedWithMe, ...labels]) {
    for (const share of document.shares ?? []) add(share.texorId, share.email, share.name);
  }

  // The owners of things shared with me, who are people I work with by any
  // reasonable definition but appear in nobody's share list.
  const ownerIds = [...new Set([...sharedWithMe, ...labels].map((d) => d.ownerTexorId).filter((id) => id && id !== me))];
  if (ownerIds.length) {
    const owners = await User.find({ texorId: { $in: ownerIds } }).select('texorId email displayName').lean().exec();
    for (const owner of owners) add(owner.texorId, owner.email, owner.displayName);
  }

  /**
   * An exact address always resolves, whether or not you have met.
   *
   * This is what makes "share with a colleague" work on the first try without
   * publishing a list of everybody who has an account.
   */
  if (query.includes('@')) {
    const person = await User.findOne({ email: query }).select('texorId email displayName').lean().exec();
    if (person) add(person.texorId, person.email, person.displayName);
    else people.set(query, { texorId: null, email: query, name: '' });
  }

  const matches = [...people.values()]
    .filter((person) => !query
      || person.email.includes(query)
      || person.name.toLowerCase().includes(query))
    .sort((left, right) => (left.name || left.email).localeCompare(right.name || right.email))
    .slice(0, 12);

  res.json({ people: matches });
}

export async function noteActivity(req, res) {
  const actor = actorOf(req);
  const { note } = await loadNote(req.params.id, actor);

  const events = await NoteEvent.find({ note: note._id }).sort({ at: -1 }).limit(50).lean().exec();

  res.json({
    activity: events.map((event) => ({
      at: event.at,
      action: event.action,
      detail: event.detail,
      actor: { texorId: event.actorTexorId, name: event.actorName },
    })),
  });
}

export default {
  shareSchema,
  shareNote,
  unshareNote,
  shareLabel,
  unshareLabel,
  listPeople,
  noteActivity,
};
