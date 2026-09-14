/**
 * A message in a channel.
 *
 * The author's display name and picture are denormalised at write time so that
 * rendering a thousand-message backlog is one query. `authorTexorId` remains
 * the source of truth if the two ever disagree.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    channel: { type: Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },

    authorTexorId: { type: String, required: true, index: true },
    authorName: { type: String, default: '' },
    authorPicture: { type: String, default: '' },

    body: { type: String, required: true, trim: true, maxlength: 4000 },

    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The only query that matters at scale: one channel's messages, newest first.
messageSchema.index({ channel: 1, createdAt: -1 });

export const Message = mongoose.model('Message', messageSchema);
export default Message;
