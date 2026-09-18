/**
 * One warranty on one covered item — per unit, and per serial number when the
 * product tracks them, because that is what a customer brings back.
 *
 * `status` stores only what a person decided (active, void). Whether it has
 * expired, or is about to, is worked out from `endDate` when it is read, so it
 * can never be stale.
 */
import mongoose from 'mongoose';
import { recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const claimSchema = new Schema(
  {
    reportedAt: { type: Date, default: () => new Date() },
    issue: { type: String, required: true },
    photos: { type: [String], default: [] },
    status: { type: String, enum: ['open', 'in_progress', 'resolved', 'rejected'], default: 'open' },
    resolution: { type: String, default: '' },
    resolvedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: true, timestamps: true },
);

const warrantySchema = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  item: { type: Schema.Types.ObjectId, ref: 'Item', default: null },
  itemName: { type: String, required: true, trim: true },
  serial: { type: String, default: '', trim: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  scope: { type: String, enum: ['parts_labour', 'parts', 'labour', 'replacement', 'service'], default: 'parts_labour' },
  includes: { type: [String], default: [] },
  excludes: { type: [String], default: [] },
  transferable: { type: Boolean, default: false },
  coverage: { type: String, default: '' },
  status: { type: String, enum: ['active', 'void'], default: 'active' },
  source: { type: String, enum: ['manual', 'invoice'], default: 'manual' },
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
  invoiceNumber: { type: String, default: '' },
  claims: { type: [claimSchema], default: [] },
  shareToken: { type: String, default: null, index: true, sparse: true },
  expiryNudgedAt: { type: Date, default: null },
});

warrantySchema.plugin(recordPlugin);
warrantySchema.index({ workspace: 1, endDate: 1 });
warrantySchema.index({ workspace: 1, serial: 1 });

export const Warranty = mongoose.model('Warranty', warrantySchema);
export default Warranty;
