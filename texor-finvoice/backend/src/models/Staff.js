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
  active: { type: Boolean, default: true },
  member: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
});

staffSchema.plugin(recordPlugin);

export const Staff = mongoose.model('Staff', staffSchema);
export default Staff;
