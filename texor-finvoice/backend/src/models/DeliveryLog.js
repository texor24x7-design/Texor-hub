/** Every attempt to send a document, successful or not. */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const deliveryLogSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    kind: { type: String, enum: ['invoices', 'quotations', 'warranties'], required: true },
    document: { type: Schema.Types.ObjectId, required: true },
    channel: { type: String, enum: ['gmail', 'smtp', 'whatsapp_link', 'whatsapp_cloud'], required: true },
    to: { type: String, default: '' },
    subject: { type: String, default: '' },
    status: { type: String, enum: ['sent', 'failed', 'prepared'], required: true },
    error: { type: String, default: '' },
    providerId: { type: String, default: '' },
    /** Only in dry-run mode: what would have been sent. */
    preview: { type: Schema.Types.Mixed, default: null },
    sentBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    sentByName: { type: String, default: '' },
  },
  { timestamps: true },
);

deliveryLogSchema.index({ workspace: 1, document: 1, createdAt: -1 });

export const DeliveryLog = mongoose.model('DeliveryLog', deliveryLogSchema);
export default DeliveryLog;
