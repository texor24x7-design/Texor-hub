/**
 * An invoice.
 *
 * Stored status is only what somebody did: draft → issued → partial / paid, or
 * void. "Overdue" is not stored; it is `dueDate` in the past on an invoice that
 * still has money owing, computed when read, so it cannot go stale the way the
 * old stored `overdue` status did (nothing ever set it).
 */
import mongoose from 'mongoose';
import { documentFields } from './document.shared.js';
import { recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const invoiceSchema = new Schema({
  ...documentFields(),
  status: { type: String, enum: ['draft', 'issued', 'partial', 'paid', 'void'], default: 'draft', index: true },
  // Which reminder offsets have already gone out, so a sweep never repeats one.
  remindedOffsets: { type: [Number], default: [] },
  dueDate: { type: Date, default: null },
  amountPaidMinor: { type: Number, default: 0, min: 0 },
  // Credit notes reduce what is owed without money moving; debit notes add to it.
  creditedMinor: { type: Number, default: 0 },
  issuedAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  voidedAt: { type: Date, default: null },
  voidReason: { type: String, default: '' },
  quotation: { type: Schema.Types.ObjectId, ref: 'Quotation', default: null },
  /** The Razorpay payment link raised for this invoice, if one was. */
  paymentLink: {
    type: new Schema({ id: String, url: String, amountMinor: Number, createdAt: Date }, { _id: false }),
    default: null,
  },
});

invoiceSchema.plugin(recordPlugin);
invoiceSchema.index({ workspace: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } });
invoiceSchema.index({ workspace: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ workspace: 1, customer: 1, date: -1 });
invoiceSchema.index({ workspace: 1, date: -1 });
invoiceSchema.index({ publicToken: 1 }, { unique: true, partialFilterExpression: { publicToken: { $type: 'string' } } });

export const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;
