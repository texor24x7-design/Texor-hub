/**
 * Somebody who works at the business — with or without a Texor account.
 *
 * A washer who never signs in is still on the attendance register. When a staff
 * record's email matches an active member, that member can check themselves in.
 */
import mongoose from 'mongoose';
import { recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const staffSchema = new Schema({
  name: { type: String, required: true, trim: true },
  photo: { type: String, default: null },
  designation: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '', lowercase: true, trim: true },
  joinedOn: { type: Date, default: null },
  shiftStart: { type: String, default: '' },
  shiftEnd: { type: String, default: '' },
  /** What they are paid, and on what basis. Empty `salaryKind` means unpaid here. */
  salaryKind: { type: String, enum: ['', 'monthly', 'daily'], default: '' },
  salaryMinor: { type: Number, default: 0, min: 0 },
  salaryBasis: { type: String, enum: ['days26', 'days30', 'worked'], default: 'days30' },

  active: { type: Boolean, default: true },
  member: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
});

staffSchema.plugin(recordPlugin);

export const Staff = mongoose.model('Staff', staffSchema);
export default Staff;
