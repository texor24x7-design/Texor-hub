/**
 * A record in a module somebody defined — a car wash's vehicles and job cards,
 * a restaurant's tables. Everything but the bookkeeping lives in `custom`.
 */
import mongoose from 'mongoose';
import { recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const recordSchema = new Schema({
  module: { type: String, required: true },
  title: { type: String, default: '' },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
});

recordSchema.plugin(recordPlugin);
recordSchema.index({ workspace: 1, module: 1, deletedAt: 1, updatedAt: -1 });
recordSchema.index({ workspace: 1, customer: 1 });

export const Record = mongoose.model('Record', recordSchema);
export default Record;
