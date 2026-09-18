/**
 * A credit or debit note.
 *
 * GST requires these as documents in their own right: an invoice that has been
 * issued cannot be edited or deleted to correct a return, a shortfall or a
 * price change — a note is raised against it, with its own number series.
 *
 * Both kinds share this schema because they are structurally identical; only
 * the sign of their effect differs. A credit note reduces what the customer
 * owes (and can put returned goods back on the shelf); a debit note increases it.
 */
import mongoose from 'mongoose';
import { documentFields } from './document.shared.js';
import { recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const noteSchema = new Schema({
  ...documentFields(),
  noteKind: { type: String, enum: ['credit', 'debit'], required: true, index: true },
  status: { type: String, enum: ['draft', 'issued', 'void'], default: 'draft', index: true },
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
  invoiceNumber: { type: String, default: '' },
  reason: { type: String, default: '', trim: true, maxlength: 300 },
  /** Put the returned goods back into stock. Off for a pure price correction. */
  restock: { type: Boolean, default: true },
  issuedAt: { type: Date, default: null },
  voidedAt: { type: Date, default: null },
  voidReason: { type: String, default: '' },
});

noteSchema.plugin(recordPlugin);
noteSchema.index({ workspace: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } });
noteSchema.index({ workspace: 1, noteKind: 1, date: -1 });
noteSchema.index({ workspace: 1, customer: 1, date: -1 });
noteSchema.index({ publicToken: 1 }, { unique: true, partialFilterExpression: { publicToken: { $type: 'string' } } });

export const Note = mongoose.model('Note', noteSchema);
export default Note;
