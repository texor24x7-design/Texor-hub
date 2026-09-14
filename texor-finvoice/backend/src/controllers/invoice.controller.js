/**
 * Invoice CRUD.
 *
 * Every query is scoped by `owner: req.user._id`. That scoping is the only
 * thing standing between one Texor account's invoices and another's, so it
 * belongs in the query itself rather than in a post-fetch check that a later
 * refactor could drop.
 */
import { z } from 'zod';
import Invoice from '../models/Invoice.js';
import ApiError from '../utils/ApiError.js';

const lineItemSchema = z.object({
  description: z.string().min(1, 'Describe what you are billing for.').max(300),
  quantity: z.coerce.number().min(0).default(1),
  unitPrice: z.coerce.number().min(0).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});

export const invoiceSchema = z.object({
  number: z.string().min(1, 'Give the invoice a number.').max(40),
  client: z.object({
    name: z.string().min(1, 'Who is this invoice for?').max(200),
    email: z.email('Enter a valid email address.').or(z.literal('')).default(''),
    address: z.string().max(500).default(''),
  }),
  lineItems: z.array(lineItemSchema).min(1, 'Add at least one line item.'),
  currency: z.string().length(3).default('USD'),
  notes: z.string().max(2000).default(''),
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'void']).default('draft'),
});

export const invoicePatchSchema = invoiceSchema.partial();

export const listQuerySchema = z.object({
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'void']).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listInvoices(req, res) {
  const { status, search, limit } = req.query;

  const filter = { owner: req.user._id };
  if (status) filter.status = status;
  if (search) {
    // Escaped so a customer name containing regex characters is matched
    // literally rather than blowing up or matching everything.
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { number: { $regex: safe, $options: 'i' } },
      { 'client.name': { $regex: safe, $options: 'i' } },
    ];
  }

  const invoices = await Invoice.find(filter).sort({ issueDate: -1, createdAt: -1 }).limit(limit).lean();

  res.json({ invoices });
}

export async function getInvoice(req, res) {
  const invoice = await Invoice.findOne({ _id: req.params.id, owner: req.user._id }).exec();
  if (!invoice) throw ApiError.notFound('Invoice not found.');

  res.json({ invoice });
}

export async function createInvoice(req, res) {
  const existing = await Invoice.findOne({ owner: req.user._id, number: req.body.number }).exec();
  if (existing) {
    throw ApiError.conflict(`You already have an invoice numbered ${req.body.number}.`, [
      { field: 'number', message: 'This number is already used.' },
    ]);
  }

  const invoice = await Invoice.create({
    ...req.body,
    owner: req.user._id,
    texorId: req.user.texorId,
  });

  res.status(201).json({ invoice });
}

export async function updateInvoice(req, res) {
  const invoice = await Invoice.findOne({ _id: req.params.id, owner: req.user._id }).exec();
  if (!invoice) throw ApiError.notFound('Invoice not found.');

  Object.assign(invoice, req.body);

  // Recording payment is a status change with a timestamp; keep the two in step.
  if (req.body.status === 'paid' && !invoice.paidAt) invoice.paidAt = new Date();
  if (req.body.status && req.body.status !== 'paid') invoice.paidAt = null;

  await invoice.save();

  res.json({ invoice });
}

export async function deleteInvoice(req, res) {
  const result = await Invoice.deleteOne({ _id: req.params.id, owner: req.user._id });
  if (result.deletedCount === 0) throw ApiError.notFound('Invoice not found.');

  res.json({ ok: true });
}

/** Headline numbers for the dashboard. */
export async function getSummary(req, res) {
  const [summary] = await Invoice.aggregate([
    { $match: { owner: req.user._id } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        outstanding: {
          $sum: { $cond: [{ $in: ['$status', ['sent', 'overdue']] }, '$total', 0] },
        },
        paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$total', 0] } },
        draft: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
      },
    },
  ]);

  res.json({
    summary: summary
      ? { count: summary.count, outstanding: summary.outstanding, paid: summary.paid, draft: summary.draft }
      : { count: 0, outstanding: 0, paid: 0, draft: 0 },
  });
}
