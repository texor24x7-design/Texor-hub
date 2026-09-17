import mongoose from 'mongoose';
import { addressSchema, recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const customerSchema = new Schema({
  name: { type: String, required: true, trim: true },
  kind: { type: String, default: 'individual' },
  phone: { type: String, default: '' },
  email: { type: String, default: '', lowercase: true, trim: true },
  gstin: { type: String, default: '', uppercase: true, trim: true },
  stateCode: { type: String, default: '' },
  billingAddress: { type: addressSchema, default: () => ({}) },
  shippingAddress: { type: addressSchema, default: () => ({}) },
  tags: { type: [String], default: [] },
  notes: { type: String, default: '' },

  /** Cached by the document services; the ledger is the truth. */
  receivableMinor: { type: Number, default: 0 },
});

customerSchema.plugin(recordPlugin);
customerSchema.index({ workspace: 1, phone: 1 });

export const Customer = mongoose.model('Customer', customerSchema);
export default Customer;
