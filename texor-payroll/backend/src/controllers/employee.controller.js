/**
 * The employee register.
 *
 * Scoped by `owner: req.user._id` on every query — payroll data is the most
 * sensitive thing in the ecosystem, so the ownership filter lives in the query
 * itself rather than in a check that could be refactored away.
 */
import { z } from 'zod';
import Employee from '../models/Employee.js';
import ApiError from '../utils/ApiError.js';

export const employeeSchema = z.object({
  firstName: z.string().min(1, 'Enter a first name.').max(80),
  lastName: z.string().min(1, 'Enter a last name.').max(80),
  email: z.email('Enter a valid email address.').or(z.literal('')).default(''),
  jobTitle: z.string().max(120).default(''),
  department: z.string().max(120).default(''),
  annualSalary: z.coerce.number().min(0, 'Salary cannot be negative.'),
  taxRate: z.coerce.number().min(0).max(100).default(20),
  pensionRate: z.coerce.number().min(0).max(100).default(0),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullable().optional(),
  status: z.enum(['active', 'on_leave', 'terminated']).default('active'),
});

export const employeePatchSchema = employeeSchema.partial();

export async function listEmployees(req, res) {
  const employees = await Employee.find({ owner: req.user._id })
    .sort({ status: 1, lastName: 1, firstName: 1 })
    .lean();

  res.json({ employees });
}

export async function getEmployee(req, res) {
  const employee = await Employee.findOne({ _id: req.params.id, owner: req.user._id }).exec();
  if (!employee) throw ApiError.notFound('Employee not found.');

  res.json({ employee });
}

export async function createEmployee(req, res) {
  const employee = await Employee.create({
    ...req.body,
    owner: req.user._id,
    ownerTexorId: req.user.texorId,
  });

  res.status(201).json({ employee });
}

export async function updateEmployee(req, res) {
  const employee = await Employee.findOne({ _id: req.params.id, owner: req.user._id }).exec();
  if (!employee) throw ApiError.notFound('Employee not found.');

  Object.assign(employee, req.body);
  await employee.save();

  res.json({ employee });
}

export async function deleteEmployee(req, res) {
  const result = await Employee.deleteOne({ _id: req.params.id, owner: req.user._id });
  if (result.deletedCount === 0) throw ApiError.notFound('Employee not found.');

  res.json({ ok: true });
}
