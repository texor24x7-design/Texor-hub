/**
 * A person's seat in a workspace.
 *
 * Invitations are members with no `user` yet. They are claimed by the first
 * sign-in whose *verified* email matches — never an unverified one, or anyone
 * could register the address and walk into the business.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const memberSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: '' },
    picture: { type: String, default: '' },
    role: { type: String, required: true },
    status: { type: String, enum: ['invited', 'active', 'disabled'], default: 'invited', index: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    joinedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

memberSchema.index({ workspace: 1, email: 1 }, { unique: true });

export const Member = mongoose.model('Member', memberSchema);
export default Member;
