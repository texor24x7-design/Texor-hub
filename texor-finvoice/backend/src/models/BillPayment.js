/** Money paid to a vendor against a bill. The bill caches the sum in `amountPaidMinor`. */
import mongoose from 'mongoose';
import { recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const billPaymentSchema = new Schema({
  bill: { type: Schema.Types.ObjectId, ref: 'Bill', required: true, index: true },
  billNumber: { type: String, default: '' },
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
  date: { type: Date, required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  mode: { type: String, required: true },
  reference: { type: String, default: '' },
  note: { type: String, default: '' },
});

billPaymentSchema.plugin(recordPlugin);
billPaymentSchema.index({ workspace: 1, date: -1 });

export const BillPayment = mongoose.model('BillPayment', billPaymentSchema);
export default BillPayment;
