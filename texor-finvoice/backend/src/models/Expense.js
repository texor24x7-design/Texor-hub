/**
 * Money out. Deliberately not accounting: one row, one amount, one category.
 *
 * It exists so "what did we spend" is answerable without a purchase ledger —
 * vendors, bills and a real payables side belong to Pro.
 */
import mongoose from 'mongoose';
import { recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const expenseSchema = new Schema({
  description: { type: String, required: true, trim: true, maxlength: 300 },
  date: { type: Date, required: true },
  amountMinor: { type: Number, required: true, min: 0 },
  category: { type: String, default: '', trim: true },
  vendor: { type: String, default: '', trim: true },
  mode: { type: String, default: '', trim: true },
  reference: { type: String, default: '', trim: true },
  note: { type: String, default: '' },
  attachment: { type: String, default: null },
});

expenseSchema.plugin(recordPlugin);
expenseSchema.index({ workspace: 1, date: -1 });
expenseSchema.index({ workspace: 1, category: 1 });

export const Expense = mongoose.model('Expense', expenseSchema);
export default Expense;
