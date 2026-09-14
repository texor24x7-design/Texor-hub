/**
 * A conversation space.
 *
 * Membership is stored as an array of Texor account ids rather than local user
 * ids, so a channel can list someone who has been invited but has not opened
 * Talk yet — they exist in Texor before they exist here.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const channelSchema = new Schema(
  {
    slug: { type: String, required: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    topic: { type: String, default: '', maxlength: 300 },

    visibility: { type: String, enum: ['public', 'private'], default: 'public', index: true },

    createdBy: { type: String, required: true },
    memberTexorIds: { type: [String], default: [], index: true },

    lastMessageAt: { type: Date, default: null },
    messageCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

channelSchema.index({ slug: 1 }, { unique: true });

/** Public channels are readable by anyone signed in; private ones are not. */
channelSchema.methods.canBeReadBy = function canBeReadBy(texorId) {
  return this.visibility === 'public' || this.memberTexorIds.includes(texorId);
};

export const Channel = mongoose.model('Channel', channelSchema);
export default Channel;
