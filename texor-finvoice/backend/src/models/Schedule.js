/**
 * A recurring invoice: the body of an invoice plus when to raise it again.
 *
 * `template` is deliberately the same JSON a person would POST to create an
 * invoice, so each run goes through the ordinary create-and-issue path rather
 * than a second, quietly diverging one. It is validated on every run, which
 * also means a schedule whose product was deleted fails loudly instead of
 * issuing something wrong.
 */
import mongoose from 'mongoose';
import { recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const scheduleSchema = new Schema({
  title: { type: String, default: '', trim: true, maxlength: 120 },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  customerName: { type: String, default: '' },
  template: { type: Schema.Types.Mixed, required: true },

  every: {
    n: { type: Number, required: true, min: 1, max: 365 },
    unit: { type: String, enum: ['days', 'weeks', 'months', 'years'], default: 'months' },
  },
  nextRunAt: { type: Date, required: true, index: true },
  endsOn: { type: Date, default: null },
  dueDays: { type: Number, default: null, min: 0, max: 365 },

  autoSend: { type: Boolean, default: false },
  channel: { type: String, enum: ['smtp', 'whatsapp_cloud'], default: 'smtp' },

  status: { type: String, enum: ['active', 'paused', 'ended'], default: 'active', index: true },
  runCount: { type: Number, default: 0 },
  lastRunAt: { type: Date, default: null },
  lastInvoice: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
  lastError: { type: String, default: '' },
});

scheduleSchema.plugin(recordPlugin);
scheduleSchema.index({ status: 1, nextRunAt: 1 });

export const Schedule = mongoose.model('Schedule', scheduleSchema);
export default Schedule;
