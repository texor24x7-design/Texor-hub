/** Money received against an invoice. The invoice caches the sum in `amountPaidMinor`. */
import mongoose from 'mongoose';
import { recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const paymentSchema = new Schema({
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
  invoiceNumber: { type: String, default: '' },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  date: { type: Date, required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  mode: { type: String, required: true },
  reference: { type: String, default: '' },
  note: { type: String, default: '' },
});

paymentSchema.plugin(recordPlugin);
paymentSchema.index({ workspace: 1, date: -1 });
paymentSchema.index({ workspace: 1, mode: 1, date: -1 });

export const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
