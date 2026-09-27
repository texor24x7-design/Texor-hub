/**
 * Someone the business buys from.
 *
 * Deliberately the mirror of `Customer`, down to the cached balance: what is
 * owed *to* a vendor is the same kind of fact as what a customer owes, and the
 * bills behind it are the truth either way.
 */
import mongoose from 'mongoose';
import { addressSchema, recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const vendorSchema = new Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, default: '' },
  email: { type: String, default: '', lowercase: true, trim: true },
  gstin: { type: String, default: '', uppercase: true, trim: true },
  stateCode: { type: String, default: '' },
  address: { type: addressSchema, default: () => ({}) },
  /** How long they give you to pay, in days — the mirror of a customer's due days. */
  paymentTerms: { type: Number, default: null, min: 0, max: 365 },
  accountNumber: { type: String, default: '' },
  ifsc: { type: String, default: '' },
  notes: { type: String, default: '' },

  /** Cached by the purchase service; the bills are the truth. */
  payableMinor: { type: Number, default: 0 },
});

vendorSchema.plugin(recordPlugin);
vendorSchema.index({ workspace: 1, phone: 1 });
vendorSchema.index({ workspace: 1, gstin: 1 });

export const Vendor = mongoose.model('Vendor', vendorSchema);
export default Vendor;
