/**
 * A quotation (or estimate, or proposal — whatever the workspace calls it).
 *
 * "Expired" is derived from `validUntil` on a sent quotation, like an
 * invoice's overdue.
 */
import mongoose from 'mongoose';
import { documentFields } from './document.shared.js';
import { recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const quotationSchema = new Schema({
  ...documentFields(),
  status: { type: String, enum: ['draft', 'sent', 'accepted', 'declined', 'converted'], default: 'draft', index: true },
  validUntil: { type: Date, default: null },
  decidedAt: { type: Date, default: null },
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
});

quotationSchema.plugin(recordPlugin);
quotationSchema.index({ workspace: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } });
quotationSchema.index({ workspace: 1, customer: 1, date: -1 });
quotationSchema.index({ publicToken: 1 }, { unique: true, partialFilterExpression: { publicToken: { $type: 'string' } } });

export const Quotation = mongoose.model('Quotation', quotationSchema);
export default Quotation;
