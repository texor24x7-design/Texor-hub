/**
 * A supplier's invoice, as received.
 *
 * The same shape as one Finvoice sends, because it is the same document seen
 * from the other side — so it reuses `lineSchema` and the totals the tax engine
 * produces. Two things differ, and both matter:
 *
 *   · **the number is theirs.** Finvoice never allocates one. That is why the
 *     unique index below is on the vendor's number rather than a series of ours:
 *     recording the same bill twice is the classic way a payables figure goes
 *     wrong, and it is worth refusing rather than detecting later.
 *   · **the tax is input tax.** It was charged *to* this business, so it is
 *     credit to claim rather than money to remit.
 */
import mongoose from 'mongoose';
import { lineSchema, totalsSchema } from './document.shared.js';
import { addressSchema, recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const billSchema = new Schema({
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
  billFrom: {
    type: new Schema({
      name: { type: String, default: '' },
      gstin: { type: String, default: '' },
      stateCode: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      address: { type: addressSchema, default: () => ({}) },
    }, { _id: false }),
    default: () => ({}),
  },

  /** The supplier's own invoice number, exactly as printed on it. */
  number: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  dueDate: { type: Date, default: null },

  placeOfSupply: { type: String, default: '' },
  currency: { type: String, default: 'INR' },
  taxMode: { type: String, enum: ['gst', 'none'], default: 'gst' },
  /** True when the supplier is in another state, so the tax charged was IGST. */
  interState: { type: Boolean, default: false },

  lines: { type: [lineSchema], default: [] },
  discount: {
    type: new Schema({ type: { type: String, enum: ['percent', 'amount'], default: 'percent' }, value: { type: Number, default: 0, min: 0 } }, { _id: false }),
    default: null,
  },
  roundOff: { type: Boolean, default: false },
  totals: { type: totalsSchema, default: () => ({}) },
  taxSummary: { type: [Schema.Types.Mixed], default: [] },

  status: { type: String, enum: ['recorded', 'partial', 'paid', 'void'], default: 'recorded', index: true },
  amountPaidMinor: { type: Number, default: 0, min: 0 },
  paidAt: { type: Date, default: null },
  voidedAt: { type: Date, default: null },

  /** Whether this bill put its goods on the shelf. */
  stockApplied: { type: Boolean, default: false },

  reference: { type: String, default: '' },
  notes: { type: String, default: '' },
  attachment: { type: String, default: null },
});

billSchema.plugin(recordPlugin);
billSchema.index({ workspace: 1, date: -1 });
billSchema.index({ workspace: 1, status: 1, dueDate: 1 });
// The same supplier cannot hand you the same bill number twice.
billSchema.index({ workspace: 1, vendor: 1, number: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

export const Bill = mongoose.model('Bill', billSchema);
export default Bill;
