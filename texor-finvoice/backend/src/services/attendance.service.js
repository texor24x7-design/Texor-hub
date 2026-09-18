/**
 * Attendance: a manager's register for everyone, and check-in/out for staff who
 * sign in themselves.
 */
import mongoose from 'mongoose';
import { z } from 'zod';
import Attendance from '../models/Attendance.js';
import Staff from '../models/Staff.js';
import ApiError from '../utils/ApiError.js';
import { record as audit } from './audit.service.js';

export const STATUSES = ['present', 'absent', 'half_day', 'leave', 'holiday', 'week_off'];
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" for an instant, in the workspace's time zone. */
export const dayIn = (timezone, instant = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);

const minutesOfDay = (timezone, instant) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(instant).split(':').map(Number);
  return h * 60 + m;
};

/**
 * Ten minutes' grace after the shift starts, judged in the workspace's own time
 * zone. Exported so the rule can be tested at its boundaries without waiting
 * for a particular time of day to come round.
 */
export function isLate(staff, timezone, checkIn) {
  if (!staff.shiftStart || !checkIn) return false;
  const [h, m] = staff.shiftStart.split(':').map(Number);
  return minutesOfDay(timezone, checkIn) > h * 60 + m + 10;
}

const worked = (entry) => (entry.checkIn && entry.checkOut ? Math.max(Math.round((entry.checkOut - entry.checkIn) / 60000), 0) : 0);

async function activeStaff(workspaceId) {
  return Staff.find({ workspace: workspaceId, deletedAt: null, active: true }).select('name designation photo shiftStart shiftEnd member email phone').sort({ name: 1 }).lean();
}

export async function day(req, date) {
  const target = dayPattern.test(date ?? '') ? date : dayIn(req.workspace.timezone);
  const [staff, entries] = await Promise.all([activeStaff(req.workspace._id), Attendance.find({ workspace: req.workspace._id, date: target }).lean()]);
  const byStaff = new Map(entries.map((e) => [String(e.staff), e]));
  const rows = staff.map((s) => ({ staff: s, entry: byStaff.get(String(s._id)) ?? null }));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let unmarked = 0;
  for (const row of rows) { if (row.entry) counts[row.entry.status] += 1; else unmarked += 1; }
  return { date: target, today: dayIn(req.workspace.timezone), rows, counts: { ...counts, unmarked, late: entries.filter((e) => e.late).length } };
}

export async function register(req, month) {
  const target = /^\d{4}-\d{2}$/.test(month ?? '') ? month : dayIn(req.workspace.timezone).slice(0, 7);
  const [year, mon] = target.split('-').map(Number);
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const [staff, entries] = await Promise.all([
    activeStaff(req.workspace._id),
    Attendance.find({ workspace: req.workspace._id, date: { $gte: `${target}-01`, $lte: `${target}-${String(days).padStart(2, '0')}` } }).select('staff date status late minutes').lean(),
  ]);

  const grid = new Map(staff.map((s) => [String(s._id), {}]));
  for (const e of entries) {
    const marks = grid.get(String(e.staff));
    if (marks) marks[Number(e.date.slice(8))] = { status: e.status, late: e.late, minutes: e.minutes };
  }

  return {
    month: target,
    days,
    staff: staff.map((s) => {
      const marks = grid.get(String(s._id));
      const totals = { present: 0, half_day: 0, absent: 0, leave: 0, holiday: 0, week_off: 0, late: 0, minutes: 0 };
      for (const mark of Object.values(marks)) { totals[mark.status] += 1; if (mark.late) totals.late += 1; totals.minutes += mark.minutes ?? 0; }
      totals.payable = totals.present + totals.half_day / 2 + totals.holiday + totals.week_off + totals.leave;
      return { ...s, marks, totals };
    }),
  };
}

export const markSchema = z.object({
  status: z.enum(STATUSES),
  checkIn: z.coerce.date().nullable().optional(),
  checkOut: z.coerce.date().nullable().optional(),
  note: z.string().max(300).default(''),
});

export async function mark(req, staffId, date, input) {
  if (!mongoose.isValidObjectId(staffId) || !dayPattern.test(date)) throw ApiError.badRequest('Choose a staff member and a day.');
  if (date > dayIn(req.workspace.timezone)) throw ApiError.badRequest('Attendance cannot be marked for a day that has not happened yet.');
  const staff = await Staff.findOne({ _id: staffId, workspace: req.workspace._id, deletedAt: null }).lean();
  if (!staff) throw ApiError.notFound('Staff member not found.');
  if (input.checkIn && input.checkOut && input.checkOut < input.checkIn) throw ApiError.badRequest('Check-out cannot be before check-in.');

  const set = { status: input.status, note: input.note, source: 'manager', markedBy: req.user._id };
  if (input.checkIn !== undefined) set.checkIn = input.checkIn;
  if (input.checkOut !== undefined) set.checkOut = input.checkOut;
  if (!['present', 'half_day'].includes(input.status)) Object.assign(set, { checkIn: null, checkOut: null });

  const entry = await Attendance.findOneAndUpdate({ workspace: req.workspace._id, staff: staff._id, date }, { $set: set }, { upsert: true, returnDocument: 'after' });
  entry.minutes = worked(entry);
  entry.late = isLate(staff, req.workspace.timezone, entry.checkIn);
  await entry.save();
  await audit(req, { action: 'attendance.marked', module: 'staff', recordId: staff._id, summary: `Marked ${staff.name} ${input.status.replace('_', ' ')} on ${date}` });
  return entry.toObject();
}

/** The staff record for the signed-in member, linking it by email the first time. */
async function ownStaff(req) {
  let staff = await Staff.findOne({ workspace: req.workspace._id, member: req.member._id, deletedAt: null, active: true }).lean();
  if (!staff && req.member.email) {
    staff = await Staff.findOneAndUpdate({ workspace: req.workspace._id, email: req.member.email, member: null, deletedAt: null, active: true }, { member: req.member._id }, { returnDocument: 'after' }).lean();
  }
  return staff;
}

export async function me(req) {
  const staff = await ownStaff(req);
  if (!staff) return { staff: null, entry: null };
  const today = dayIn(req.workspace.timezone);
  return { staff, today, entry: await Attendance.findOne({ workspace: req.workspace._id, staff: staff._id, date: today }).lean() };
}

export const checkSchema = z.object({
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000) }).nullable().default(null),
});

export async function check(req, direction, { location }) {
  const staff = await ownStaff(req);
  if (!staff) throw ApiError.badRequest('Your account is not linked to a staff record. Ask your manager to add your email to your staff profile.');
  const today = dayIn(req.workspace.timezone);
  const now = new Date();
  const existing = await Attendance.findOne({ workspace: req.workspace._id, staff: staff._id, date: today });

  if (direction === 'in') {
    if (existing?.checkIn) throw ApiError.conflict('You have already checked in today.');
    const entry = existing ?? new Attendance({ workspace: req.workspace._id, staff: staff._id, date: today });
    Object.assign(entry, { status: 'present', checkIn: now, source: 'self', location, late: isLate(staff, req.workspace.timezone, now), markedBy: req.user._id });
    await entry.save();
    await audit(req, { action: 'attendance.check_in', module: 'staff', recordId: staff._id, summary: `${staff.name} checked in` });
    return entry.toObject();
  }

  if (!existing?.checkIn) throw ApiError.conflict('Check in before checking out.');
  if (existing.checkOut) throw ApiError.conflict('You have already checked out today.');
  existing.checkOut = now;
  existing.minutes = worked(existing);
  await existing.save();
  await audit(req, { action: 'attendance.check_out', module: 'staff', recordId: staff._id, summary: `${staff.name} checked out` });
  return existing.toObject();
}

export async function registerCsv(req, month) {
  const data = await register(req, month);
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const short = { present: 'P', absent: 'A', half_day: 'H', leave: 'L', holiday: 'HO', week_off: 'WO' };
  const header = ['Name', 'Role', ...Array.from({ length: data.days }, (_, i) => String(i + 1)), 'Present', 'Half days', 'Leave', 'Absent', 'Late', 'Payable days', 'Hours'];
  const lines = [header.map(cell).join(',')];
  for (const s of data.staff) {
    lines.push([
      s.name, s.designation, ...Array.from({ length: data.days }, (_, i) => short[s.marks[i + 1]?.status] ?? ''),
      s.totals.present, s.totals.half_day, s.totals.leave, s.totals.absent, s.totals.late, s.totals.payable, (s.totals.minutes / 60).toFixed(1),
    ].map(cell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
