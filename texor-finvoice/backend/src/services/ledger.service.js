/**
 * What a customer owes, and how it got that way.
 *
 * Two read-side questions every business asks and no part of Finvoice could
 * answer: "show me everything between these dates" and "how old is the money?"
 * Both are derived from the documents that already exist — nothing new is
 * stored, so a statement can never drift from the invoices behind it.
 */
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import Invoice from '../models/Invoice.js';
import Note from '../models/Note.js';
import Payment from '../models/Payment.js';
import ApiError from '../utils/ApiError.js';
import { amountDue } from './document.service.js';

const DAY = 86400000;
/** Anything that is not a draft and not void has a real effect on the balance. */
const LIVE = ['issued', 'partial', 'paid'];

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

/**
 * Every movement on a customer's account, oldest first.
 * Debits (invoices, debit notes) raise the balance; credits (payments, credit
 * notes) lower it.
 */
async function movements(workspaceId, customerId, before) {
  const scope = { workspace: workspaceId, customer: customerId, deletedAt: null };
  const upTo = before ? { $lte: before } : undefined;

  const [invoices, payments, notes] = await Promise.all([
    Invoice.find({ ...scope, status: { $in: LIVE }, ...(upTo ? { date: upTo } : {}) })
      .select('number date totals.totalMinor').sort({ date: 1 }).lean(),
    Payment.find({ ...scope, ...(upTo ? { date: upTo } : {}) })
      .select('date amountMinor mode invoiceNumber reference').sort({ date: 1 }).lean(),
    Note.find({ ...scope, status: 'issued', ...(upTo ? { date: upTo } : {}) })
      .select('number date noteKind totals.totalMinor invoiceNumber').sort({ date: 1 }).lean(),
  ]);

  const rows = [
    ...invoices.map((d) => ({ date: d.date, kind: 'invoice', id: String(d._id), ref: d.number, description: 'Invoice', debitMinor: d.totals.totalMinor, creditMinor: 0 })),
    ...payments.map((p) => ({ date: p.date, kind: 'payment', id: String(p._id), ref: p.reference || p.invoiceNumber || '', description: `Payment${p.mode ? ` · ${p.mode}` : ''}`, debitMinor: 0, creditMinor: p.amountMinor })),
    ...notes.map((n) => ({
      date: n.date,
      kind: n.noteKind === 'credit' ? 'credit_note' : 'debit_note',
      id: String(n._id),
      ref: n.number,
      description: `${n.noteKind === 'credit' ? 'Credit' : 'Debit'} note${n.invoiceNumber ? ` · against ${n.invoiceNumber}` : ''}`,
      debitMinor: n.noteKind === 'debit' ? n.totals.totalMinor : 0,
      creditMinor: n.noteKind === 'credit' ? n.totals.totalMinor : 0,
    })),
  ];
  rows.sort((a, b) => new Date(a.date) - new Date(b.date) || a.kind.localeCompare(b.kind));
  return rows;
}

/** How overdue the outstanding money is, as of `asOf`. */
export function bucketsFor(invoices, asOf = new Date()) {
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 };
  let total = 0;
  for (const invoice of invoices) {
    const due = amountDue(invoice);
    if (due <= 0) continue;
    total += due;
    const age = invoice.dueDate ? Math.floor((startOfDay(asOf) - startOfDay(invoice.dueDate)) / DAY) : 0;
    if (age <= 0) buckets.current += due;
    else if (age <= 30) buckets.d30 += due;
    else if (age <= 60) buckets.d60 += due;
    else if (age <= 90) buckets.d90 += due;
    else buckets.older += due;
  }
  return { ...buckets, totalMinor: total };
}

export async function agingFor(workspaceId, { customer = null, asOf = new Date() } = {}) {
  const filter = { workspace: workspaceId, deletedAt: null, status: { $in: ['issued', 'partial'] } };
  if (customer) filter.customer = customer;
  const invoices = await Invoice.find(filter).select('dueDate totals.totalMinor amountPaidMinor creditedMinor').lean();
  return bucketsFor(invoices, asOf);
}

export async function statement(req, customerId, query = {}) {
  if (!mongoose.isValidObjectId(customerId)) throw ApiError.notFound('Customer not found.');
  const customer = await Customer.findOne({ _id: customerId, workspace: req.workspace._id, deletedAt: null }).select('name phone email gstin billingAddress receivableMinor').lean();
  if (!customer) throw ApiError.notFound('Customer not found.');

  const to = query.to ? endOfDay(new Date(String(query.to))) : endOfDay(new Date());
  const from = query.from ? startOfDay(new Date(String(query.from))) : startOfDay(new Date(to.getTime() - 89 * DAY));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw ApiError.badRequest('Those dates do not make sense.');
  if (from > to) throw ApiError.badRequest('The start date is after the end date.');

  const all = await movements(req.workspace._id, customer._id, to);
  const opening = all.filter((r) => new Date(r.date) < from).reduce((sum, r) => sum + r.debitMinor - r.creditMinor, 0);

  let balance = opening;
  const rows = all.filter((r) => new Date(r.date) >= from).map((r) => {
    balance += r.debitMinor - r.creditMinor;
    return { ...r, balanceMinor: balance };
  });

  return {
    customer,
    from,
    to,
    openingMinor: opening,
    closingMinor: balance,
    totals: {
      debitMinor: rows.reduce((s, r) => s + r.debitMinor, 0),
      creditMinor: rows.reduce((s, r) => s + r.creditMinor, 0),
    },
    rows,
    aging: await agingFor(req.workspace._id, { customer: customer._id, asOf: to }),
  };
}

/** The same statement as a spreadsheet, for a customer who asks for one. */
export function statementCsv(data, currency = 'INR') {
  const money = (minor) => (minor / 100).toFixed(2);
  const lines = [['Date', 'Document', 'Reference', 'Debit', 'Credit', 'Balance'].join(',')];
  const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  lines.push([quote(data.from.toISOString().slice(0, 10)), quote('Opening balance'), '', '', '', money(data.openingMinor)].join(','));
  for (const row of data.rows) {
    lines.push([
      quote(new Date(row.date).toISOString().slice(0, 10)), quote(row.description), quote(row.ref),
      row.debitMinor ? money(row.debitMinor) : '', row.creditMinor ? money(row.creditMinor) : '', money(row.balanceMinor),
    ].join(','));
  }
  lines.push([quote(data.to.toISOString().slice(0, 10)), quote('Closing balance'), '', money(data.totals.debitMinor), money(data.totals.creditMinor), money(data.closingMinor)].join(','));
  return `${lines.join('\n')}\n`;
}
