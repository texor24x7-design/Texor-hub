/**
 * Channels and messages.
 *
 * Read access is checked against the channel on every call rather than trusted
 * from a previous request, so a user removed from a private channel loses
 * access immediately rather than at their next page load.
 */
import { z } from 'zod';
import Channel from '../models/Channel.js';
import Message from '../models/Message.js';
import ApiError from '../utils/ApiError.js';

const slugify = (value) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export const channelSchema = z.object({
  name: z.string().min(1, 'Give the channel a name.').max(80),
  topic: z.string().max(300).default(''),
  visibility: z.enum(['public', 'private']).default('public'),
});

export const messageSchema = z.object({
  body: z.string().min(1, 'Write something first.').max(4000),
});

export const historyQuerySchema = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Loads a channel and enforces read access in one place. */
async function loadReadable(channelId, texorId) {
  const channel = await Channel.findById(channelId).exec();
  if (!channel) throw ApiError.notFound('Channel not found.');
  if (!channel.canBeReadBy(texorId)) throw ApiError.forbidden('You are not a member of this channel.');
  return channel;
}

export async function listChannels(req, res) {
  const channels = await Channel.find({
    $or: [{ visibility: 'public' }, { memberTexorIds: req.user.texorId }],
  })
    .sort({ lastMessageAt: -1, name: 1 })
    .lean();

  res.json({
    channels: channels.map((channel) => ({
      ...channel,
      isMember: channel.memberTexorIds.includes(req.user.texorId),
    })),
  });
}

export async function createChannel(req, res) {
  const slug = slugify(req.body.name);
  if (!slug) throw ApiError.badRequest('That name cannot be turned into a channel address.');

  const existing = await Channel.findOne({ slug }).exec();
  if (existing) throw ApiError.conflict(`There is already a #${slug} channel.`, [
    { field: 'name', message: 'A channel with this name already exists.' },
  ]);

  const channel = await Channel.create({
    ...req.body,
    slug,
    createdBy: req.user.texorId,
    memberTexorIds: [req.user.texorId],
  });

  res.status(201).json({ channel });
}

export async function getChannel(req, res) {
  const channel = await loadReadable(req.params.id, req.user.texorId);
  res.json({
    channel: { ...channel.toObject(), isMember: channel.memberTexorIds.includes(req.user.texorId) },
  });
}

export async function joinChannel(req, res) {
  const channel = await Channel.findById(req.params.id).exec();
  if (!channel) throw ApiError.notFound('Channel not found.');
  if (channel.visibility === 'private') {
    throw ApiError.forbidden('This channel is private — ask a member to add you.');
  }

  // $addToSet keeps a double-click from adding the same member twice.
  await Channel.updateOne({ _id: channel._id }, { $addToSet: { memberTexorIds: req.user.texorId } });

  res.json({ ok: true });
}

export async function leaveChannel(req, res) {
  await Channel.updateOne({ _id: req.params.id }, { $pull: { memberTexorIds: req.user.texorId } });
  res.json({ ok: true });
}

export async function listMessages(req, res) {
  await loadReadable(req.params.id, req.user.texorId);

  const filter = { channel: req.params.id, deletedAt: null };
  if (req.query.before) filter.createdAt = { $lt: req.query.before };

  const messages = await Message.find(filter)
    .sort({ createdAt: -1 })
    .limit(req.query.limit)
    .lean();

  // Query newest-first for the index, hand back oldest-first for rendering.
  res.json({ messages: messages.reverse() });
}

export async function postMessage(req, res) {
  const channel = await loadReadable(req.params.id, req.user.texorId);

  if (!channel.memberTexorIds.includes(req.user.texorId)) {
    throw ApiError.forbidden('Join the channel before posting.');
  }

  const message = await Message.create({
    channel: channel._id,
    authorTexorId: req.user.texorId,
    authorName: req.user.displayName,
    authorPicture: req.user.picture,
    body: req.body.body,
  });

  await Channel.updateOne(
    { _id: channel._id },
    { $set: { lastMessageAt: message.createdAt }, $inc: { messageCount: 1 } },
  );

  res.status(201).json({ message });
}

/** Soft delete — the message stays for audit, but stops being served. */
export async function deleteMessage(req, res) {
  const message = await Message.findOne({
    _id: req.params.messageId,
    channel: req.params.id,
    authorTexorId: req.user.texorId,
  }).exec();

  if (!message) throw ApiError.notFound('Message not found, or it is not yours to delete.');

  message.deletedAt = new Date();
  await message.save();

  res.json({ ok: true });
}
