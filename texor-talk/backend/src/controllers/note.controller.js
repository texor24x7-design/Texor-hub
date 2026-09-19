/**
 * Meeting notes.
 *
 * Every note belongs to one meeting and one author. Those two facts do all the
 * work here: the meeting decides who can be tagged and who a shared note is
 * shared with, and the author decides everything else.
 */
import { z } from 'zod';
import Note from '../models/Note.js';
import Meeting from '../models/Meeting.js';
import ApiError from '../utils/ApiError.js';
import { isGuestId } from '../services/guest.service.js';
import {
  LIMITS,
  canRead,
  canWrite,
  mentionsOf,
  noteStats,
  preview,
  sanitiseBlocks,
} from '../services/notes.service.js';
import { pushDelete, pushNote } from '../services/notes-sync.service.js';

/**
 * The block schema is deliberately loose.
 *
 * Zod's job here is to reject something that is not a document at all — a
 * string where an array belongs, a number where text belongs. Deciding what is
 * *valid* is `sanitiseBlocks`, which clamps rather than refuses, because a mark
 * running one character past the end of its text is a keystroke racing a save,
 * not an attack, and losing somebody's paragraph over it would be indefensible.
 */
const markInput = z.object({
  // A plain string, not the enum. An unknown mark type is dropped by
  // `sanitiseMark`; rejecting the whole request here would mean a client one
  // version ahead of this server loses the paragraph it was attached to.
  type: z.string(),
  start: z.number(),
  end: z.number(),
  color: z.string().optional(),
  texorId: z.string().optional(),
  name: z.string().optional(),
}).loose();

const blockInput = z.object({
  // Likewise: an unknown block type becomes a paragraph rather than a 400, so
  // the text survives even when the structure around it is not understood.
  type: z.string().optional(),
  text: z.string().optional(),
  marks: z.array(markInput).optional(),
  done: z.boolean().optional(),
  speakerTexorId: z.string().optional(),
  speakerName: z.string().optional(),
  at: z.union([z.string(), z.date()]).nullish(),
}).loose();

export const createNoteSchema = z.object({
  meetingCode: z.string().min(1, 'A note belongs to a meeting.'),
  title: z.string().max(LIMITS.title).optional(),
  blocks: z.array(blockInput).optional(),
  visibility: z.enum(['private', 'meeting']).optional(),
});

export const updateNoteSchema = z.object({
  title: z.string().max(LIMITS.title).optional(),
  blocks: z.array(blockInput).optional(),
  visibility: z.enum(['private', 'meeting']).optional(),
  pinned: z.boolean().optional(),
});

export const listNotesSchema = z.object({
  // mine        — notes I wrote
  // mentions    — notes someone else wrote that tag me, and shared
  // shared      — notes other people shared with a meeting I was in
  scope: z.enum(['mine', 'mentions', 'shared', 'all']).default('mine'),
  meetingCode: z.string().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Whether somebody took part in a meeting.
 *
 * Attendance rather than the invitee list: being invited to a meeting you never
 * turned up to should not hand you the notes other people took in it.
 */
function wasInMeeting(meeting, texorId) {
  if (!meeting || !texorId) return false;
  if (meeting.hostTexorId === texorId) return true;
  return meeting.attendance.some((entry) => entry.texorId === texorId);
}

/**
 * Who can be tagged in a note about this meeting.
 *
 * Built from attendance first — the people actually in the room are the ones
 * you want to tag while typing — then topped up with invitees who have a Texor
 * account, so writing up a meeting afterwards can still name somebody who was
 * expected and did not make it.
 *
 * Guests are excluded — a name typed into a box for one call, with no account
 * behind it, so a mention of one could never resolve to a person. They are
 * spotted by their id, **not** by `role === 'guest'`: that role is what
 * `Meeting.roleOf` returns for any colleague who was not explicitly invited,
 * which in an open `texor` meeting is almost everybody in the room.
 */
function taggablePeople(meeting) {
  const people = new Map();

  for (const entry of meeting.attendance ?? []) {
    if (!entry.texorId || isGuestId(entry.texorId)) continue;
    people.set(entry.texorId, {
      texorId: entry.texorId,
      name: entry.name || entry.email || 'Someone',
      picture: entry.picture || '',
      attended: true,
    });
  }

  for (const invitee of meeting.invitees ?? []) {
    if (!invitee.texorId || people.has(invitee.texorId)) continue;
    people.set(invitee.texorId, {
      texorId: invitee.texorId,
      name: invitee.name || invitee.email,
      picture: '',
      attended: false,
    });
  }

  if (meeting.hostTexorId && !people.has(meeting.hostTexorId)) {
    people.set(meeting.hostTexorId, {
      texorId: meeting.hostTexorId,
      name: meeting.hostName || 'Host',
      picture: '',
      attended: false,
    });
  }

  // People who were there first, then alphabetically — a picker that puts the
  // person who just spoke near the top beats one sorted by database order.
  return [...people.values()].sort(
    (left, right) => Number(right.attended) - Number(left.attended) || left.name.localeCompare(right.name),
  );
}

/** A note as a list row: everything needed to draw it, and no document. */
function presentSummary(note, texorId) {
  return {
    id: String(note._id),
    meetingCode: note.meetingCode,
    meetingTitle: note.meetingTitle,
    meetingStartedAt: note.meetingStartedAt,
    title: note.title,
    preview: preview(note.blocks),
    stats: noteStats(note.blocks),
    mentions: (note.mentionedTexorIds ?? []).length,
    mentionsMe: (note.mentionedTexorIds ?? []).includes(texorId),
    visibility: note.visibility,
    pinned: note.pinned,
    isMine: note.ownerTexorId === texorId,
    owner: { texorId: note.ownerTexorId, name: note.ownerName, picture: note.ownerPicture },
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/** A note in full, for opening it. */
function presentNote(note, texorId, { people } = {}) {
  return {
    ...presentSummary(note, texorId),
    blocks: note.blocks,
    canEdit: canWrite(note, texorId),
    people,
  };
}

/** Loads a note and settles read access in one place. */
async function loadReadable(id, user) {
  const note = await Note.findOne({ _id: id, deletedAt: null }).exec().catch(() => null);
  if (!note) throw ApiError.notFound('Note not found.');

  const meeting = await Meeting.findOne({ code: note.meetingCode }).exec();

  if (!canRead(note, user.texorId, { wasInMeeting: wasInMeeting(meeting, user.texorId) })) {
    // Deliberately a 404 rather than a 403. Somebody else's private note should
    // not confirm its own existence to a stranger holding a guessed id.
    throw ApiError.notFound('Note not found.');
  }

  return { note, meeting };
}

export async function listNotes(req, res) {
  const { scope, meetingCode, q, limit } = req.query;
  const me = req.user.texorId;

  const filters = {
    mine: { ownerTexorId: me },
    // Shared by somebody else, and it names me. A private note that tags me is
    // not in here: tagging is a reference, not a grant.
    mentions: { ownerTexorId: { $ne: me }, mentionedTexorIds: me, visibility: 'meeting' },
    shared: { ownerTexorId: { $ne: me }, visibility: 'meeting' },
    all: { $or: [{ ownerTexorId: me }, { visibility: 'meeting' }] },
  };

  const filter = { deletedAt: null, ...filters[scope] };
  if (meetingCode) filter.meetingCode = meetingCode.toLowerCase().trim();
  if (q) filter.$text = { $search: q };

  const notes = await Note.find(filter).sort({ pinned: -1, updatedAt: -1 }).limit(limit).exec();

  /**
   * Anything not my own has to be checked against the meeting it came from.
   *
   * `visibility: 'meeting'` means "shared with that room", not "public", so the
   * query narrows and this decides. Meetings are fetched once each rather than
   * once per note, because a busy meeting produces many notes.
   */
  const foreign = notes.filter((note) => note.ownerTexorId !== me);
  const meetings = new Map();

  if (foreign.length > 0) {
    const found = await Meeting.find({ code: { $in: [...new Set(foreign.map((n) => n.meetingCode))] } })
      .select('code hostTexorId attendance')
      .exec();
    for (const meeting of found) meetings.set(meeting.code, meeting);
  }

  const visible = notes.filter(
    (note) =>
      note.ownerTexorId === me
      || canRead(note, me, { wasInMeeting: wasInMeeting(meetings.get(note.meetingCode), me) }),
  );

  res.json({ notes: visible.map((note) => presentSummary(note, me)) });
}

export async function getNote(req, res) {
  const { note, meeting } = await loadReadable(req.params.id, req.user);

  res.json({
    note: presentNote(note, req.user.texorId, {
      // Only the author needs the tagging list; nobody else can type into it.
      people: canWrite(note, req.user.texorId) && meeting ? taggablePeople(meeting) : undefined,
    }),
  });
}

/**
 * The people taggable in a meeting, without opening a note.
 *
 * The in-call panel needs this before a note exists, and the live roster is not
 * enough on its own — somebody who spoke and dropped off ten minutes ago is
 * exactly the person you want to attribute a quote to.
 */
export async function getMeetingPeople(req, res) {
  const meeting = await Meeting.findOne({ code: String(req.params.code).toLowerCase().trim() }).exec();
  if (!meeting) throw ApiError.notFound('No meeting with that code.');

  if (!wasInMeeting(meeting, req.user.texorId)) {
    throw ApiError.forbidden('You were not in that meeting.');
  }

  res.json({ people: taggablePeople(meeting) });
}

export async function createNote(req, res) {
  const code = String(req.body.meetingCode).toLowerCase().trim();
  const meeting = await Meeting.findOne({ code }).exec();
  if (!meeting) throw ApiError.notFound('No meeting with that code.');

  /**
   * You may only take notes on a meeting you were in.
   *
   * Without this, the meeting code — which is guessable by design, the way a
   * phone number is — would be enough to attach a note to somebody else's
   * meeting and have it appear in its shared notes.
   */
  if (!wasInMeeting(meeting, req.user.texorId)) {
    throw ApiError.forbidden('You can only take notes in a meeting you took part in.');
  }

  const blocks = sanitiseBlocks(req.body.blocks);

  const note = await Note.create({
    meetingCode: code,
    meetingTitle: meeting.title,
    meetingStartedAt: meeting.startedAt ?? meeting.scheduledStart ?? null,
    ownerTexorId: req.user.texorId,
    ownerName: req.user.displayName,
    ownerPicture: req.user.picture,
    title: (req.body.title ?? '').trim(),
    blocks,
    mentionedTexorIds: mentionsOf(blocks).map((mention) => mention.texorId),
    visibility: req.body.visibility ?? 'private',
  });

  res.status(201).json({
    note: presentNote(note, req.user.texorId, { people: taggablePeople(meeting) }),
  });

  // After the response, never before it: see notes-sync.service.js. A no-op
  // unless this deployment is wired to Texor Notes.
  pushNote(note, req.user);
}

/**
 * Saving a note.
 *
 * This is an autosave endpoint — it is called while somebody is typing, so it
 * has to be cheap and it has to be a full replacement of what it is given
 * rather than a merge. Merging half-documents from two racing saves is how an
 * editor loses a paragraph.
 */
export async function updateNote(req, res) {
  const { note, meeting } = await loadReadable(req.params.id, req.user);

  if (!canWrite(note, req.user.texorId)) {
    throw ApiError.forbidden('This note belongs to someone else.');
  }

  if (req.body.title !== undefined) note.title = req.body.title.trim();
  if (req.body.visibility !== undefined) note.visibility = req.body.visibility;
  if (req.body.pinned !== undefined) note.pinned = req.body.pinned;

  if (req.body.blocks !== undefined) {
    note.blocks = sanitiseBlocks(req.body.blocks);
    note.mentionedTexorIds = mentionsOf(note.blocks).map((mention) => mention.texorId);
  }

  await note.save();

  res.json({
    note: presentNote(note, req.user.texorId, {
      people: meeting ? taggablePeople(meeting) : undefined,
    }),
  });

  // Only a change to the document is worth a round trip — a pin or a sharing
  // toggle is Talk's business, not the note's.
  if (req.body.title !== undefined || req.body.blocks !== undefined) pushNote(note, req.user);
}

/** Soft delete, so an autosave racing a delete cannot resurrect the note. */
export async function deleteNote(req, res) {
  const note = await Note.findOne({ _id: req.params.id, deletedAt: null }).exec().catch(() => null);
  if (!note) throw ApiError.notFound('Note not found.');

  if (!canWrite(note, req.user.texorId)) {
    throw ApiError.forbidden('This note belongs to someone else.');
  }

  note.deletedAt = new Date();
  await note.save();

  res.json({ ok: true });

  // The copy in Notes goes to its owner's trash there, not into the void.
  pushDelete(note);
}

export default {
  createNoteSchema,
  updateNoteSchema,
  listNotesSchema,
  listNotes,
  getNote,
  getMeetingPeople,
  createNote,
  updateNote,
  deleteNote,
};
