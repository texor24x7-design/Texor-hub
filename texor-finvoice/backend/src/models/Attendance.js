/**
 * One staff member's attendance on one day.
 *
 * `date` is the calendar day in the workspace's time zone, stored as
 * "YYYY-MM-DD". A Date would put a 00:30 IST check-in on the previous UTC day.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const attendanceSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    staff: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: ['present', 'absent', 'half_day', 'leave', 'holiday', 'week_off'], required: true },
    checkIn: { type: Date, default: null },
    checkOut: { type: Date, default: null },
    minutes: { type: Number, default: 0 },
    late: { type: Boolean, default: false },
    source: { type: String, enum: ['self', 'manager'], default: 'manager' },
    note: { type: String, default: '' },
    location: {
      type: new Schema({ lat: Number, lng: Number, accuracy: Number }, { _id: false }),
      default: null,
    },
    markedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

attendanceSchema.index({ workspace: 1, staff: 1, date: 1 }, { unique: true });
attendanceSchema.index({ workspace: 1, date: 1 });

export const Attendance = mongoose.model('Attendance', attendanceSchema);
export default Attendance;
