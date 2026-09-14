/**
 * Pay runs.
 *
 * A run is calculated once, from the employee register as it stands at that
 * moment, and then frozen. Approving locks it: after that the figures are a
 * historical record and editing is refused rather than silently recalculated.
 */
import { z } from 'zod';
import Employee from '../models/Employee.js';
import PayRun from '../models/PayRun.js';
import ApiError from '../utils/ApiError.js';

export const payRunSchema = z.object({
  label: z.string().min(1, 'Give this run a label.').max(120),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  payDate: z.coerce.date(),
  frequency: z.enum(['weekly', 'fortnightly', 'monthly']).default('monthly'),
  currency: z.string().length(3).default('USD'),
});

export async function listPayRuns(req, res) {
  const payRuns = await PayRun.find({ owner: req.user._id })
    .sort({ payDate: -1 })
    .select('-payslips')
    .lean();

  res.json({ payRuns });
}

export async function getPayRun(req, res) {
  const payRun = await PayRun.findOne({ _id: req.params.id, owner: req.user._id }).exec();
  if (!payRun) throw ApiError.notFound('Pay run not found.');

  res.json({ payRun });
}

export async function createPayRun(req, res) {
  if (req.body.periodEnd < req.body.periodStart) {
    throw ApiError.badRequest('The period ends before it starts.', [
      { field: 'periodEnd', message: 'Must be on or after the start date.' },
    ]);
  }

  const employees = await Employee.find({ owner: req.user._id, status: 'active' }).exec();
  if (employees.length === 0) {
    throw ApiError.badRequest('Add at least one active employee before running payroll.');
  }

  const payRun = new PayRun({
    ...req.body,
    owner: req.user._id,
    ownerTexorId: req.user.texorId,
    payslips: PayRun.buildPayslips(employees, req.body.frequency),
  });

  payRun.recalculateTotals();
  await payRun.save();

  res.status(201).json({ payRun });
}

/** Recomputes a draft against the current register — useful after a pay rise. */
export async function recalculatePayRun(req, res) {
  const payRun = await PayRun.findOne({ _id: req.params.id, owner: req.user._id }).exec();
  if (!payRun) throw ApiError.notFound('Pay run not found.');
  if (payRun.status !== 'draft') {
    throw ApiError.conflict('This run has been approved and can no longer be recalculated.');
  }

  const employees = await Employee.find({ owner: req.user._id, status: 'active' }).exec();
  payRun.payslips = PayRun.buildPayslips(employees, payRun.frequency);
  payRun.recalculateTotals();
  await payRun.save();

  res.json({ payRun });
}

export async function approvePayRun(req, res) {
  const payRun = await PayRun.findOne({ _id: req.params.id, owner: req.user._id }).exec();
  if (!payRun) throw ApiError.notFound('Pay run not found.');
  if (payRun.status !== 'draft') throw ApiError.conflict('This run has already been approved.');

  payRun.status = 'approved';
  payRun.approvedAt = new Date();
  await payRun.save();

  res.json({ payRun });
}

export async function markPaid(req, res) {
  const payRun = await PayRun.findOne({ _id: req.params.id, owner: req.user._id }).exec();
  if (!payRun) throw ApiError.notFound('Pay run not found.');
  if (payRun.status !== 'approved') throw ApiError.conflict('Approve the run before marking it paid.');

  payRun.status = 'paid';
  await payRun.save();

  res.json({ payRun });
}

export async function deletePayRun(req, res) {
  const payRun = await PayRun.findOne({ _id: req.params.id, owner: req.user._id }).exec();
  if (!payRun) throw ApiError.notFound('Pay run not found.');
  if (payRun.status !== 'draft') {
    throw ApiError.conflict('Approved pay runs are a permanent record and cannot be deleted.');
  }

  await payRun.deleteOne();
  res.json({ ok: true });
}

export async function getSummary(req, res) {
  const [employees, lastRun] = await Promise.all([
    Employee.countDocuments({ owner: req.user._id, status: 'active' }),
    PayRun.findOne({ owner: req.user._id }).sort({ payDate: -1 }).select('-payslips').lean(),
  ]);

  const [payroll] = await Employee.aggregate([
    { $match: { owner: req.user._id, status: 'active' } },
    { $group: { _id: null, annual: { $sum: '$annualSalary' } } },
  ]);

  res.json({
    summary: {
      activeEmployees: employees,
      annualPayroll: payroll?.annual ?? 0,
      lastRun: lastRun ?? null,
    },
  });
}
