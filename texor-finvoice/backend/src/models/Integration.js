/**
 * A connection to somebody else's service, made by the business itself.
 *
 *   gmail           one member's own mailbox (OAuth, gmail.send only)
 *   smtp            the workspace's mail server
 *   whatsapp_cloud  the workspace's own WhatsApp Business number
 *
 * Secrets are stored encrypted (utils/crypto.js) and are never serialised.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const integrationSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    type: { type: String, enum: ['gmail', 'smtp', 'whatsapp_cloud', 'razorpay'], required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    account: { type: String, default: '' },
    config: { type: Schema.Types.Mixed, default: {} },
    secret: { type: String, default: null, select: false },
    status: { type: String, enum: ['connected', 'error'], default: 'connected' },
    lastError: { type: String, default: '' },
    connectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, minimize: false },
);

integrationSchema.index({ workspace: 1, type: 1, user: 1 }, { unique: true });

export const Integration = mongoose.model('Integration', integrationSchema);
export default Integration;
