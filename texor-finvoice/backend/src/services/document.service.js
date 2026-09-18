/**
 * Quotations and invoices: drafting, the one-way steps that follow, and the
 * side effects those steps have on stock, warranties and what a customer owes.
 *
 * The irreversible steps — issuing and voiding an invoice, recording a payment —
 * each run in a single transaction. A half-issued invoice (number taken, stock
 * not moved) is exactly the kind of inconsistency nobody notices until the
 * GST return does not add up.
 */
import mongoose from 'mongoose';
import { z } from 'zod';
import Customer from '../models/Customer.js';
import Invoice from '../models/Invoice.js';
import Item from '../models/Item.js';
import Payment from '../models/Payment.js';
import Quotation from '../models/Quotation.js';
import Record from '../models/Record.js';
import Warranty from '../models/Warranty.js';
import { nextValue } from '../models/Counter.js';
import ApiError from '../utils/ApiError.js';
import { randomToken } from '../utils/ids.js';
import { india } from '../shared.js';
import { computeDocument } from '../../../frontend/src/lib/shared/tax.mjs';
import { moduleOf, parseBody, requireUsableModule } from './metadata.service.js';
import { can, hiddenFields } from './rbac.service.js';
import { escapeRegex } from './record.service.js';
import { record as audit } from './audit.service.js';
import Note from '../models/Note.js';
import * as stock from './stock.service.js';

/**
 * Credit and debit notes share one collection and are told apart by `noteKind`,
 * the same way products and services share `Item`. `where` is folded into every
 * query and every new document so the two can never leak into each other.
 */
const DOCUMENTS = {
  invoices: { model: Invoice },
  quotations: { model: Quotation },
  credit_notes: { model: Note, where: { noteKind: 'credit' } },
  debit_notes: { model: Note, where: { noteKind: 'debit' } },
};
const MODELS = Object.fromEntries(Object.entries(DOCUMENTS).map(([kind, d]) => [kind, d.model]));
const DAY = 24 * 60 * 60 * 1000;

export const isNote = (kind) => kind === 'credit_notes' || kind === 'debit_notes';
const scopeOf = (kind) => DOCUMENTS[kind]?.where ?? {};

const modelFor = (kind) => {
  const model = DOCUMENTS[kind]?.model;
  if (!model) throw ApiError.notFound('Unknown document type.');
  return model;
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY);

export function addDuration(date, duration, unit) {
  const d = new Date(date);
  if (unit === 'days') d.setDate(d.getDate() + duration);
  if (unit === 'months') d.setMonth(d.getMonth() + duration);
  if (unit === 'years') d.setFullYear(d.getFullYear() + duration);
  // A warranty "for a year" from 1 March covers up to and including 28 February.
  d.setDate(d.getDate() - 1);
  return d;
}

// ── numbering ─────────────────────────────────────────────────────────────────

export const DEFAULT_PREFIX = { invoices: 'INV', quotations: 'QT', credit_notes: 'CN', debit_notes: 'DN' };

export async function nextNumber(workspace, kind, date, { session } = {}) {
  const fy = india.financialYear(date, workspace.fyStartMonth ?? 4);
  const prefix = (workspace.preferences?.numbering?.[kind] ?? DEFAULT_PREFIX[kind] ?? 'DOC').toUpperCase();
  const seq = await nextValue(`num:${workspace._id}:${kind}:${fy}`, { session });
  const number = [prefix, fy, String(seq).padStart(4, '0')].filter(Boolean).join('/');
  return { number, fy };
}

// ── input ─────────────────────────────────────────────────────────────────────

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Not a valid reference.');

const lineInput = z.object({
  _id: objectId.optional(),
  item: objectId.nullable().default(null),
  variant: z.string().trim().max(80).default(''),
  description: z.string().trim().min(1, 'Describe this line.').max(500),
  hsn: z.string().trim().regex(/^[0-9]{0,8}$/, 'HSN/SAC codes are up to 8 digits.').default(''),
  quantity: z.number().min(0, 'Quantity cannot be negative.').max(1e7),
  unit: z.string().trim().max(30).default(''),
  priceMinor: z.number().int().min(0).max(1e13),
  discountPct: z.number().min(0).max(100).default(0),
  discountAmountMinor: z.number().int().min(0).max(1e13).nullish(),
  taxRate: z.number().min(0).max(100).default(0),
  cessRate: z.number().min(0).max(100).default(0),
  priceIncludesTax: z.boolean().default(false),
  serials: z.array(z.string().trim().min(1).max(60)).max(1000).default([]),
  custom: z.record(z.string(), z.any()).default({}),
});

const documentInput = z.object({
  lines: z.array(lineInput).min(1, 'Add at least one line.').max(300),
  discount: z.object({ type: z.enum(['percent', 'amount']), value: z.number().min(0) }).nullable().default(null),
  roundOff: z.boolean().optional(),
  design: z.string().max(40).optional(),
});

function parseDocument(workspace, kind, body, { hidden, partial = false }) {
  const header = parseBody(workspace, kind, body, { hidden, partial });
  const result = (partial ? documentInput.partial() : documentInput).safeParse(body ?? {});
  const issues = result.success ? [] : result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));

  const lines = result.success ? result.data.lines : undefined;
  if (lines) {
    lines.forEach((line, index) => {
      try {
        line.custom = parseBody(workspace, 'lines', { ...line, custom: line.custom }).custom;
      } catch (error) {
        for (const d of error.details ?? []) issues.push({ field: `lines.${index}.${d.field}`, message: d.message });
      }
    });
  }
  if (issues.length) throw ApiError.badRequest('Some fields need attention.', issues);
  return { ...header, ...result.data };
}

// ── shaping ───────────────────────────────────────────────────────────────────

/** What an invoice still owes once payments and credit notes are taken off. */
export const amountDue = (doc) => Math.max((doc.totals?.totalMinor ?? 0) - (doc.amountPaidMinor ?? 0) - (doc.creditedMinor ?? 0), 0);

export function documentState(kind, doc) {
  if (kind === 'invoices') {
    const due = amountDue(doc);
    if (['issued', 'partial'].includes(doc.status) && doc.dueDate && new Date(doc.dueDate) < startOfToday() && due > 0) return 'overdue';
    // Settled by a credit note rather than by money. Not "paid", and not owing.
    if (['issued', 'partial'].includes(doc.status) && due === 0 && (doc.creditedMinor ?? 0) > 0) return 'credited';
    return doc.status;
  }
  if (doc.status === 'sent' && doc.validUntil && new Date(doc.validUntil) < startOfToday()) return 'expired';
  return doc.status;
}

export function serializeDocument(kind, doc, hidden = []) {
  const { searchText, deletedAt, workspace, __v, ...out } = doc;
  out.custom = { ...(doc.custom ?? {}) };
  for (const key of hidden) { delete out[key]; delete out.custom[key]; }
  out.state = documentState(kind, doc);
  if (kind === 'invoices') out.amountDueMinor = amountDue(doc);
  return out;
}

function editableFields(kind, status) {
  if (kind === 'invoices') {
    if (status === 'draft') return 'all';
    // The design is presentation, not a figure on the invoice, so it stays changeable.
    if (['issued', 'partial', 'paid'].includes(status)) return new Set(['dueDate', 'custom', 'design']);
    return new Set(['design']);
  }
  return ['draft', 'sent'].includes(status) ? 'all' : new Set(['design']);
}

async function loadItems(workspaceId, lines, { session } = {}) {
  const ids = [...new Set(lines.filter((l) => l.item).map((l) => String(l.item)))];
  if (!ids.length) return new Map();
  const items = await Item.find({ _id: { $in: ids }, workspace: workspaceId }).session(session ?? null).lean();
  const byId = new Map(items.map((i) => [String(i._id), i]));
  lines.forEach((line, index) => {
    if (line.item && !byId.has(String(line.item))) {
      throw ApiError.badRequest('Some fields need attention.', [{ field: `lines.${index}.item`, message: 'That item no longer exists.' }]);
    }
  });
  return byId;
}

/** Applies the tax engine to `doc` in place. */
function recompute(doc, workspace, items) {
  doc.lines.forEach((line, index) => {
    const item = line.item ? items.get(String(line.item)) : null;
    // A package is billed by expanding it into its parts, never as itself: a
    // single-price bundle would be a mixed supply, taxable in full at the
    // highest rate of any component. The editor expands on pick; this is the
    // guard for anything else that reaches the API.
    if (item?.kind === 'package') {
      throw ApiError.badRequest('Some fields need attention.', [{
        field: `lines.${index}.item`,
        message: `${item.name} is a package. Bill the products and services in it instead, each at its own GST rate.`,
      }]);
    }
    line.kind = item?.kind ?? 'custom';
  });
  const result = computeDocument({
    lines: doc.lines,
    sellerState: workspace.stateCode,
    placeOfSupply: doc.placeOfSupply,
    discount: doc.discount,
    roundOff: doc.roundOff,
    taxMode: doc.taxMode,
    currency: doc.currency,
  });
  doc.lines.forEach((line, i) => Object.assign(line, result.lines[i]));
  doc.totals = result.totals;
  doc.taxSummary = result.taxSummary;
  doc.interState = result.interState;
}

function customerSnapshot(customer) {
  return {
    name: customer.name,
    gstin: customer.gstin,
    stateCode: customer.stateCode,
    phone: customer.phone,
    email: customer.email,
    address: customer.billingAddress,
    shippingAddress: customer.shippingAddress,
  };
}

function sellerSnapshot(workspace) {
  return {
    name: workspace.name,
    legalName: workspace.legalName,
    gstin: workspace.gstin,
    pan: workspace.pan,
    stateCode: workspace.stateCode,
    phone: workspace.phone,
    email: workspace.email,
    address: workspace.address,
    logo: workspace.branding?.logo ?? null,
    signature: workspace.branding?.signature ?? null,
    bank: workspace.bank ?? {},
  };
}

async function findCustomer(workspaceId, id, { session } = {}) {
  const customer = await Customer.findOne({ _id: id, workspace: workspaceId, deletedAt: null }).session(session ?? null).lean();
  if (!customer) throw ApiError.badRequest('Some fields need attention.', [{ field: 'customer', message: 'Choose a customer.' }]);
  return customer;
}

const searchTextFor = (doc) => [doc.number, doc.billTo?.name, doc.billTo?.phone, doc.reference].filter(Boolean).join(' ').toLowerCase();

async function findDocument(req, kind, id, { session } = {}) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Document not found.');
  const filter = { _id: id, workspace: req.workspace._id, deletedAt: null, ...scopeOf(kind) };
  if (req.scope === 'own') filter.createdBy = req.user._id;
  const doc = await modelFor(kind).findOne(filter).session(session ?? null);
  if (!doc) throw ApiError.notFound(`${moduleOf(req.workspace, kind).labelSingular} not found.`);
  return doc;
}

const label = (req, kind) => moduleOf(req.workspace, kind).labelSingular;

// ── reads ─────────────────────────────────────────────────────────────────────

export async function list(req, kind, query = {}) {
  requireUsableModule(req.workspace, kind);
  const model = modelFor(kind);
  const filter = { workspace: req.workspace._id, deletedAt: null, ...scopeOf(kind) };
  if (req.scope === 'own') filter.createdBy = req.user._id;

  const today = startOfToday();
  const state = String(query.state ?? '');
  if (kind === 'invoices') {
    if (state === 'overdue') Object.assign(filter, { status: { $in: ['issued', 'partial'] }, dueDate: { $lt: today } });
    else if (state === 'unpaid') filter.status = { $in: ['issued', 'partial'] };
    else if (['draft', 'issued', 'partial', 'paid', 'void'].includes(state)) filter.status = state;
  } else if (isNote(kind)) {
    if (['draft', 'issued', 'void'].includes(state)) filter.status = state;
  } else if (state === 'expired') {
    Object.assign(filter, { status: 'sent', validUntil: { $lt: today } });
  } else if (['draft', 'sent', 'accepted', 'declined', 'converted'].includes(state)) {
    filter.status = state;
  }

  // Cast it: `find` would coerce the string itself, but an aggregation pipeline
  // does no casting, so the sums below would quietly match nothing.
  if (query.customer && mongoose.isValidObjectId(query.customer)) filter.customer = new mongoose.Types.ObjectId(String(query.customer));
  if (query.q) filter.searchText = { $regex: escapeRegex(String(query.q).toLowerCase().slice(0, 100)) };
  const from = query.from ? new Date(String(query.from)) : null;
  const to = query.to ? new Date(String(query.to)) : null;
  if (from && !Number.isNaN(from.getTime())) filter.date = { ...(filter.date ?? {}), $gte: from };
  if (to && !Number.isNaN(to.getTime())) filter.date = { ...(filter.date ?? {}), $lte: to };
  for (const [param, raw] of Object.entries(query)) {
    if (param.startsWith('f.') && raw !== '') filter[`custom.${param.slice(2)}`] = String(raw);
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const page = Math.max(Number(query.page) || 1, 1);
  const [docs, total, sums] = await Promise.all([
    model.find(filter).select('-lines -seller -taxSummary').sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    model.countDocuments(filter),
    model.aggregate([{ $match: filter }, { $group: { _id: null, totalMinor: { $sum: '$totals.totalMinor' }, paidMinor: { $sum: '$amountPaidMinor' }, creditedMinor: { $sum: '$creditedMinor' } } }]),
  ]);

  const hidden = hiddenFields(req.workspace, req.member, kind);
  return {
    documents: docs.map((d) => serializeDocument(kind, d, hidden)),
    total,
    page,
    limit,
    sums: { totalMinor: sums[0]?.totalMinor ?? 0, paidMinor: sums[0]?.paidMinor ?? 0, creditedMinor: sums[0]?.creditedMinor ?? 0 },
  };
}

export async function get(req, kind, id) {
  requireUsableModule(req.workspace, kind);
  const doc = (await findDocument(req, kind, id)).toObject();
  const related = {};
  if (kind === 'invoices') {
    related.payments = await Payment.find({ invoice: doc._id, workspace: req.workspace._id, deletedAt: null }).sort({ date: -1 }).lean();
    related.warranties = await Warranty.find({ invoice: doc._id, workspace: req.workspace._id, deletedAt: null }).select('itemName serial startDate endDate status').lean();
    if (doc.quotation) related.quotation = await Quotation.findById(doc.quotation).select('number').lean();
  } else if (doc.invoice) {
    related.invoice = await Invoice.findById(doc.invoice).select('number status').lean();
  }
  return { document: serializeDocument(kind, doc, hiddenFields(req.workspace, req.member, kind)), related };
}

// ── drafting ──────────────────────────────────────────────────────────────────

export async function create(req, kind, body, { source = null, quotation = null } = {}) {
  requireUsableModule(req.workspace, kind);
  const ws = req.workspace;
  const prefs = ws.preferences ?? {};
  const input = parseDocument(ws, kind, {
    date: new Date().toISOString(),
    ...body,
  }, { hidden: hiddenFields(ws, req.member, kind) });

  const customer = await findCustomer(ws._id, input.customer);
  const items = await loadItems(ws._id, input.lines);

  const doc = new (modelFor(kind))({
    ...input,
    ...scopeOf(kind),
    workspace: ws._id,
    placeOfSupply: input.placeOfSupply || customer.stateCode || customer.shippingAddress?.stateCode || ws.stateCode || '',
    billTo: customerSnapshot(customer),
    currency: ws.currency ?? 'INR',
    taxMode: ws.gstin ? 'gst' : 'none',
    roundOff: input.roundOff ?? prefs.roundOff ?? false,
    design: input.design ?? prefs.design ?? 'classic',
    terms: input.terms ?? (kind === 'quotations' ? prefs.quotationTerms ?? prefs.terms : prefs.terms) ?? '',
    source,
    quotation,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  if (kind === 'invoices' && !input.dueDate && Number.isFinite(prefs.dueDays)) doc.dueDate = addDays(doc.date, prefs.dueDays);
  if (kind === 'quotations' && !input.validUntil) doc.validUntil = addDays(doc.date, prefs.validityDays ?? 15);

  recompute(doc, ws, items);

  await mongoose.connection.transaction(async (session) => {
    if (kind === 'quotations') {
      Object.assign(doc, await nextNumber(ws, kind, doc.date, { session }));
      doc.publicToken = randomToken(24);
    }
    doc.searchText = searchTextFor(doc);
    await doc.save({ session });
  });

  await audit(req, { action: `${kind}.created`, module: kind, recordId: doc._id, summary: `Drafted ${label(req, kind).toLowerCase()} ${doc.number ?? ''} for ${doc.billTo.name}`.replace(/\s+/g, ' ') });
  return serializeDocument(kind, doc.toObject());
}

export async function update(req, kind, id, body) {
  requireUsableModule(req.workspace, kind);
  const ws = req.workspace;
  const doc = await findDocument(req, kind, id);
  const editable = editableFields(kind, doc.status);

  if (editable !== 'all') {
    const attempted = Object.keys(body ?? {});
    const printable = new Set(moduleOf(ws, kind).fields.filter((f) => f.custom && f.printable).map((f) => f.key));
    const blocked = attempted.filter((key) => !editable.has(key))
      .concat(Object.keys(body?.custom ?? {}).filter((key) => printable.has(key)).map((key) => `custom.${key}`));
    if (blocked.length) {
      throw ApiError.conflict(
        doc.status === 'void' || editable.size === 0
          ? `This ${label(req, kind).toLowerCase()} can no longer be changed.`
          : `An issued ${label(req, kind).toLowerCase()} keeps the figures it was issued with. Void it and issue a new one to change ${blocked.join(', ')}.`,
      );
    }
  }

  const input = parseDocument(ws, kind, body, { hidden: hiddenFields(ws, req.member, kind), partial: true });
  const { custom, ...rest } = input;

  if (rest.customer && String(rest.customer) !== String(doc.customer)) {
    const customer = await findCustomer(ws._id, rest.customer);
    doc.billTo = customerSnapshot(customer);
    if (!rest.placeOfSupply) rest.placeOfSupply = customer.stateCode || ws.stateCode || '';
  }
  doc.set(rest);
  if (custom) { doc.custom = { ...(doc.custom ?? {}), ...custom }; doc.markModified('custom'); }

  if (editable === 'all') recompute(doc, ws, await loadItems(ws._id, doc.lines));
  doc.searchText = searchTextFor(doc);
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, { action: `${kind}.updated`, module: kind, recordId: doc._id, summary: `Edited ${label(req, kind).toLowerCase()} ${doc.number ?? '(draft)'}`, metadata: { fields: Object.keys(body ?? {}) } });
  return serializeDocument(kind, doc.toObject());
}

export async function remove(req, kind, id) {
  const doc = await findDocument(req, kind, id);
  const deletable = kind === 'invoices' ? doc.status === 'draft' : doc.status !== 'converted';
  if (!deletable) {
    throw ApiError.conflict(kind === 'invoices'
      ? 'Issued invoices cannot be deleted — void it instead, so the number sequence stays unbroken.'
      : 'A converted quotation is part of its invoice\'s history and cannot be deleted.');
  }
  doc.deletedAt = new Date();
  await doc.save();
  await audit(req, { action: `${kind}.deleted`, module: kind, recordId: doc._id, summary: `Deleted ${label(req, kind).toLowerCase()} ${doc.number ?? '(draft)'}` });
}

// ── issuing and voiding ───────────────────────────────────────────────────────

function checkSerials(doc, items) {
  const issues = [];
  doc.lines.forEach((line, index) => {
    const item = line.item ? items.get(String(line.item)) : null;
    if (!item?.trackSerials) return;
    const serials = line.serials.map((s) => s.trim()).filter(Boolean);
    if (!Number.isInteger(line.quantity) || serials.length !== line.quantity) {
      issues.push({ field: `lines.${index}.serials`, message: `Enter ${line.quantity} serial number${line.quantity === 1 ? '' : 's'} for ${line.description}.` });
    } else if (new Set(serials).size !== serials.length) {
      issues.push({ field: `lines.${index}.serials`, message: `The same serial number is entered twice for ${line.description}.` });
    }
  });
  if (issues.length) throw ApiError.badRequest('Serial numbers are needed before issuing.', issues);
}

async function checkSerialsUnsold(doc, items, session) {
  for (const [index, line] of doc.lines.entries()) {
    const item = line.item ? items.get(String(line.item)) : null;
    if (!item?.trackSerials || !line.serials.length) continue;
    const clash = await Invoice.findOne({
      workspace: doc.workspace, _id: { $ne: doc._id }, status: { $in: ['issued', 'partial', 'paid'] },
      lines: { $elemMatch: { item: line.item, serials: { $in: line.serials } } },
    }).select('number lines.serials lines.item').session(session).lean();
    if (clash) {
      const sold = clash.lines.find((l) => String(l.item) === String(line.item))?.serials.find((s) => line.serials.includes(s));
      throw ApiError.conflict(`Serial ${sold} of ${line.description} was already sold on ${clash.number}.`, [{ field: `lines.${index}.serials`, message: `Already sold on ${clash.number}.` }]);
    }
  }
}

function warrantiesFor(doc, items, userId) {
  const rows = [];
  for (const line of doc.lines) {
    const item = line.item ? items.get(String(line.item)) : null;
    if (!item?.warranty) continue;
    const base = {
      workspace: doc.workspace,
      customer: doc.customer,
      item: item._id,
      itemName: [line.description, line.variant && !line.description.includes(line.variant) ? `(${line.variant})` : ''].filter(Boolean).join(' '),
      startDate: doc.date,
      endDate: addDuration(doc.date, item.warranty.duration, item.warranty.unit),
      scope: item.warranty.scope ?? 'parts_labour',
      includes: item.warranty.includes ?? [],
      excludes: item.warranty.excludes ?? [],
      transferable: item.warranty.transferable ?? false,
      coverage: item.warranty.coverage,
      source: 'invoice',
      invoice: doc._id,
      invoiceNumber: doc.number,
      createdBy: userId,
      updatedBy: userId,
    };
    const units = line.serials.length
      ? line.serials.map((serial) => ({ serial }))
      : Array.from({ length: Number.isInteger(line.quantity) && line.quantity <= 50 ? line.quantity : 1 }, () => ({ serial: '' }));
    for (const unit of units) {
      rows.push({ ...base, ...unit, searchText: `${base.itemName} ${unit.serial} ${doc.number} ${doc.billTo.name}`.toLowerCase() });
    }
  }
  return rows;
}

export async function issueInvoice(req, id) {
  const ws = req.workspace;
  let issued;

  await mongoose.connection.transaction(async (session) => {
    const doc = await findDocument(req, 'invoices', id, { session });
    if (doc.status !== 'draft') throw ApiError.conflict(`This invoice is already ${doc.status}.`);
    if (!doc.lines.length) throw ApiError.badRequest('Add at least one line before issuing.');

    const customer = await findCustomer(ws._id, doc.customer, { session });
    const items = await loadItems(ws._id, doc.lines, { session });
    checkSerials(doc, items);
    await checkSerialsUnsold(doc, items, session);

    // Everything the printed invoice depends on is frozen now.
    doc.billTo = customerSnapshot(customer);
    doc.seller = sellerSnapshot(ws);
    doc.taxMode = ws.gstin ? 'gst' : 'none';
    recompute(doc, ws, items);
    Object.assign(doc, await nextNumber(ws, 'invoices', doc.date, { session }));
    doc.status = 'issued';
    doc.issuedAt = new Date();
    doc.publicToken = randomToken(24);
    doc.searchText = searchTextFor(doc);
    doc.updatedBy = req.user._id;
    await doc.save({ session });

    for (const line of doc.lines) {
      const item = line.item ? items.get(String(line.item)) : null;
      if (item?.kind === 'product' && item.trackStock && line.quantity) {
        await stock.move({ workspace: ws._id, item: item._id, quantity: -line.quantity, reason: 'sale', serials: line.serials, invoice: doc._id, user: req.user._id }, { session });
      }
    }

    const warranties = warrantiesFor(doc, items, req.user._id);
    if (warranties.length) await Warranty.insertMany(warranties, { session });

    await Customer.updateOne({ _id: doc.customer }, { $inc: { receivableMinor: doc.totals.totalMinor } }, { session });
    if (doc.source?.record) await Record.updateOne({ _id: doc.source.record, workspace: ws._id }, { invoice: doc._id }, { session });
    if (doc.quotation) await Quotation.updateOne({ _id: doc.quotation, workspace: ws._id }, { status: 'converted', invoice: doc._id }, { session });

    issued = doc;
  });

  await audit(req, { action: 'invoices.issued', module: 'invoices', recordId: issued._id, summary: `Issued ${issued.number} for ${issued.billTo.name}`, metadata: { totalMinor: issued.totals.totalMinor } });
  return serializeDocument('invoices', issued.toObject());
}

/**
 * Issues a credit or debit note.
 *
 * A credit note reduces what the customer owes; a debit note adds to it. Both
 * move the customer's receivable, and a credit note can put returned goods back
 * on the shelf. All of it in one transaction, like issuing an invoice, so a
 * half-applied note is impossible.
 */
export async function issueNote(req, kind, id) {
  const ws = req.workspace;
  const sign = kind === 'credit_notes' ? -1 : 1;
  let issued;

  await mongoose.connection.transaction(async (session) => {
    const doc = await findDocument(req, kind, id, { session });
    if (doc.status !== 'draft') throw ApiError.conflict(`This note is already ${doc.status}.`);
    if (!doc.lines.length) throw ApiError.badRequest('Add at least one line before issuing.');

    const customer = await findCustomer(ws._id, doc.customer, { session });
    const items = await loadItems(ws._id, doc.lines, { session });

    let parent = null;
    if (doc.invoice) {
      parent = await Invoice.findOne({ _id: doc.invoice, workspace: ws._id, deletedAt: null }).session(session);
      if (!parent) throw ApiError.badRequest('The invoice this note belongs to no longer exists.');
      if (parent.status === 'void') throw ApiError.conflict('That invoice was voided, so a note against it would double-count.');
    }

    doc.billTo = customerSnapshot(customer);
    doc.seller = sellerSnapshot(ws);
    doc.taxMode = ws.gstin ? 'gst' : 'none';
    recompute(doc, ws, items);

    // A credit note cannot give back more than the invoice is still worth.
    if (parent && sign === -1) {
      const room = parent.totals.totalMinor - (parent.creditedMinor ?? 0);
      if (doc.totals.totalMinor > room) {
        throw ApiError.badRequest('Some fields need attention.', [{
          field: 'lines',
          message: `That is more than ${parent.number} still carries. At most ${(room / 100).toFixed(2)} can be credited.`,
        }]);
      }
    }

    Object.assign(doc, await nextNumber(ws, kind, doc.date, { session }));
    doc.status = 'issued';
    doc.issuedAt = new Date();
    doc.publicToken = randomToken(24);
    doc.searchText = searchTextFor(doc);
    doc.updatedBy = req.user._id;
    await doc.save({ session });

    // Returned goods go back on the shelf unless this was a price correction.
    if (sign === -1 && doc.restock) {
      for (const line of doc.lines) {
        const item = line.item ? items.get(String(line.item)) : null;
        if (item?.kind === 'product' && item.trackStock && line.quantity) {
          await stock.move({ workspace: ws._id, item: item._id, quantity: line.quantity, reason: 'return', serials: line.serials, invoice: doc.invoice ?? null, user: req.user._id }, { session });
        }
      }
    }

    if (parent) {
      parent.creditedMinor = (parent.creditedMinor ?? 0) + (sign === -1 ? doc.totals.totalMinor : -doc.totals.totalMinor);
      if (['issued', 'partial'].includes(parent.status) && parent.amountPaidMinor >= parent.totals.totalMinor - parent.creditedMinor) {
        parent.status = 'paid';
        parent.paidAt ??= new Date();
      }
      await parent.save({ session });
    }

    await Customer.updateOne({ _id: doc.customer }, { $inc: { receivableMinor: sign * doc.totals.totalMinor } }, { session });
    issued = doc;
  });

  await audit(req, { action: `${kind}.issued`, module: kind, recordId: issued._id, summary: `Issued ${issued.number} against ${issued.invoiceNumber || 'no invoice'}`, metadata: { totalMinor: issued.totals.totalMinor } });
  return serializeDocument(kind, issued.toObject());
}

/** Drafts a note that mirrors an invoice, so a full return is one click. */
export async function noteFromInvoice(req, kind, invoiceId) {
  requireUsableModule(req.workspace, kind);
  const invoice = await findDocument(req, 'invoices', invoiceId);
  if (invoice.status === 'draft') throw ApiError.conflict('Issue this invoice before raising a note against it.');
  if (invoice.status === 'void') throw ApiError.conflict('A void invoice has nothing to credit.');

  const body = {
    customer: String(invoice.customer),
    date: new Date().toISOString(),
    placeOfSupply: invoice.placeOfSupply,
    reference: invoice.number,
    discount: invoice.discount?.value ? { type: invoice.discount.type, value: invoice.discount.value } : null,
    roundOff: invoice.roundOff,
    lines: invoice.lines.map((l) => ({
      item: l.item ? String(l.item) : null, variant: l.variant, description: l.description, hsn: l.hsn,
      quantity: l.quantity, unit: l.unit, priceMinor: l.priceMinor, discountPct: l.discountPct,
      taxRate: l.taxRate, cessRate: l.cessRate, priceIncludesTax: l.priceIncludesTax, serials: [], custom: l.custom ?? {},
    })),
  };
  const draft = await create(req, kind, body);
  await modelFor(kind).updateOne({ _id: draft._id }, { $set: { invoice: invoice._id, invoiceNumber: invoice.number } });
  return { ...draft, invoice: String(invoice._id), invoiceNumber: invoice.number };
}

export async function voidInvoice(req, id, reason = '') {
  let voided;
  await mongoose.connection.transaction(async (session) => {
    const doc = await findDocument(req, 'invoices', id, { session });
    if (doc.status === 'draft') throw ApiError.conflict('A draft has no number yet — delete it instead.');
    if (doc.status === 'void') throw ApiError.conflict('This invoice is already void.');
    if (doc.amountPaidMinor > 0) throw ApiError.conflict('Remove the payments recorded against this invoice before voiding it.');

    const items = await loadItems(req.workspace._id, doc.lines, { session });
    for (const line of doc.lines) {
      const item = line.item ? items.get(String(line.item)) : null;
      if (item?.kind === 'product' && item.trackStock && line.quantity) {
        await stock.move({ workspace: req.workspace._id, item: item._id, quantity: line.quantity, reason: 'void', serials: line.serials, invoice: doc._id, note: `Voided ${doc.number}`, user: req.user._id }, { session });
      }
    }
    await Warranty.updateMany({ workspace: req.workspace._id, invoice: doc._id, status: 'active' }, { status: 'void' }, { session });
    await Customer.updateOne({ _id: doc.customer }, { $inc: { receivableMinor: -doc.totals.totalMinor } }, { session });

    doc.status = 'void';
    doc.voidedAt = new Date();
    doc.voidReason = reason;
    doc.updatedBy = req.user._id;
    await doc.save({ session });
    voided = doc;
  });

  await audit(req, { action: 'invoices.voided', module: 'invoices', recordId: voided._id, summary: `Voided ${voided.number}${reason ? `: ${reason}` : ''}` });
  return serializeDocument('invoices', voided.toObject());
}

// ── quotations ────────────────────────────────────────────────────────────────

const QUOTE_TRANSITIONS = { send: ['draft', 'sent'], accept: ['sent', 'draft'], decline: ['sent', 'draft'] };
const QUOTE_RESULT = { send: 'sent', accept: 'accepted', decline: 'declined' };

export async function transitionQuotation(req, id, action) {
  const doc = await findDocument(req, 'quotations', id);
  if (!QUOTE_TRANSITIONS[action]?.includes(doc.status)) throw ApiError.conflict(`A ${doc.status} quotation cannot be marked ${QUOTE_RESULT[action]}.`);
  doc.status = QUOTE_RESULT[action];
  if (action === 'send') doc.sentAt ??= new Date();
  else doc.decidedAt = new Date();
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: `quotations.${QUOTE_RESULT[action]}`, module: 'quotations', recordId: doc._id, summary: `Marked ${doc.number} ${QUOTE_RESULT[action]}` });
  return serializeDocument('quotations', doc.toObject());
}

const COPIED_LINE_FIELDS = ['item', 'variant', 'description', 'hsn', 'quantity', 'unit', 'priceMinor', 'discountPct', 'discountAmountMinor', 'taxRate', 'cessRate', 'priceIncludesTax', 'serials', 'custom'];
const copyLine = (line) => Object.fromEntries(COPIED_LINE_FIELDS.map((k) => [k, k === 'item' && line.item ? String(line.item) : line[k]]));

export async function convertQuotation(req, id) {
  if (!can(req.workspace, req.member, 'invoices', 'create')) throw ApiError.forbidden('Your role cannot create invoices.');
  const quote = await findDocument(req, 'quotations', id);
  if (['converted', 'declined'].includes(quote.status)) throw ApiError.conflict(`A ${quote.status} quotation cannot become an invoice.`);
  if (quote.invoice) throw ApiError.conflict('This quotation already has an invoice.');

  const invoiceFields = new Set(moduleOf(req.workspace, 'invoices').fields.filter((f) => f.custom).map((f) => f.key));
  const invoice = await create(req, 'invoices', {
    customer: String(quote.customer),
    placeOfSupply: quote.placeOfSupply,
    reference: quote.number,
    notes: quote.notes,
    lines: quote.lines.map(copyLine),
    discount: quote.discount?.value ? { type: quote.discount.type, value: quote.discount.value } : null,
    roundOff: quote.roundOff,
    custom: Object.fromEntries(Object.entries(quote.custom ?? {}).filter(([k]) => invoiceFields.has(k))),
  }, { quotation: quote._id, source: { module: 'quotations', record: quote._id, title: quote.number } });

  quote.invoice = invoice._id;
  quote.status = 'converted';
  quote.decidedAt ??= new Date();
  await quote.save();
  return invoice;
}

/**
 * A draft invoice from a job card, appointment or project.
 *
 * The module's `toInvoice` says which items fields become lines, which linked
 * field picks the price variant (a job card's vehicle type), and which values
 * land in the invoice's own fields (the vehicle number).
 */
export async function invoiceFromRecord(req, moduleKey, recordId) {
  if (!can(req.workspace, req.member, 'invoices', 'create')) throw ApiError.forbidden('Your role cannot create invoices.');
  const module = requireUsableModule(req.workspace, moduleKey);
  const mapping = module.toInvoice;
  if (!mapping) throw ApiError.badRequest(`${module.label} cannot be turned into invoices.`);
  if (!mongoose.isValidObjectId(recordId)) throw ApiError.notFound('Record not found.');

  const record = await Record.findOne({ _id: recordId, workspace: req.workspace._id, module: moduleKey, deletedAt: null }).lean();
  if (!record) throw ApiError.notFound('Record not found.');
  if (!record.customer) throw ApiError.badRequest(`Link this ${module.labelSingular.toLowerCase()} to a customer first.`);
  if (record.invoice) {
    const existing = await Invoice.findOne({ _id: record.invoice, deletedAt: null }).select('number status').lean();
    if (existing && existing.status !== 'void') throw ApiError.conflict(`This ${module.labelSingular.toLowerCase()} is already billed on ${existing.number ?? 'a draft invoice'}.`, [{ field: 'invoice', message: String(existing._id) }]);
  }

  // Resolve "vehicle.regNo"-style paths through one reference.
  const linked = new Map();
  const resolve = async (path) => {
    if (path === '_id') return String(record._id);
    const [first, rest] = path.split('.');
    if (!rest) return record.custom?.[first];
    const refId = record.custom?.[first];
    if (!refId || !mongoose.isValidObjectId(refId)) return undefined;
    if (!linked.has(refId)) linked.set(refId, await Record.findOne({ _id: refId, workspace: req.workspace._id }).lean());
    const target = linked.get(refId);
    const value = target?.custom?.[rest];
    const refModule = module.fields.find((f) => f.key === first)?.refModule;
    const option = refModule && moduleOf(req.workspace, refModule).fields.find((f) => f.key === rest)?.options?.find((o) => o.value === value);
    return option?.label ?? value;
  };

  const variantName = mapping.variantFrom ? await resolve(mapping.variantFrom) : null;
  const rawLines = (mapping.items ?? []).flatMap((key) => record.custom?.[key] ?? []);
  if (!rawLines.length) throw ApiError.badRequest(`Add some work to this ${module.labelSingular.toLowerCase()} before billing it.`);

  const items = await loadItems(req.workspace._id, rawLines.filter((l) => l.item));
  const prefs = req.workspace.preferences ?? {};
  const lines = rawLines.map((l) => {
    const item = l.item ? items.get(String(l.item)) : null;
    const variant = item?.variants?.find((v) => v.name === (l.variant || variantName));
    return {
      item: item ? String(item._id) : null,
      variant: variant?.name ?? '',
      description: l.description || item?.name || 'Item',
      hsn: item?.hsn ?? '',
      quantity: l.quantity ?? 1,
      unit: item?.unit ?? '',
      // A matched variant wins: the price copied onto a job card when the item was picked is the
      // catalogue default (the first variant), not the price for this vehicle.
      priceMinor: variant?.priceMinor ?? (l.priceMinor || item?.priceMinor || 0),
      taxRate: item?.taxRate ?? prefs.taxRate ?? 0,
      cessRate: item?.cessRate ?? 0,
      priceIncludesTax: item?.priceIncludesTax ?? prefs.priceIncludesTax ?? false,
    };
  });

  const custom = {};
  for (const [field, path] of Object.entries(mapping.fields ?? {})) {
    const value = await resolve(path);
    if (value !== undefined && value !== null && value !== '') custom[field] = value;
  }

  const invoice = await create(req, 'invoices', { customer: String(record.customer), lines, custom }, {
    source: { module: moduleKey, record: record._id, title: record.title },
  });
  await Record.updateOne({ _id: record._id }, { invoice: invoice._id });
  return invoice;
}

// ── payments ──────────────────────────────────────────────────────────────────

export async function recordPayment(req, invoiceId, body) {
  const input = parseBody(req.workspace, 'payments', { date: new Date().toISOString(), ...body }, { hidden: [] });
  const modes = req.workspace.preferences?.paymentModes ?? [];
  if (modes.length && !modes.includes(input.mode)) {
    throw ApiError.badRequest('Some fields need attention.', [{ field: 'mode', message: 'Choose one of your payment modes.' }]);
  }

  let payment;
  let invoice;
  await mongoose.connection.transaction(async (session) => {
    const doc = await findDocument(req, 'invoices', invoiceId, { session });
    if (!['issued', 'partial'].includes(doc.status)) {
      throw ApiError.conflict(doc.status === 'draft' ? 'Issue this invoice before recording a payment.' : `This invoice is ${doc.status}.`);
    }

    // Atomic and capped: two cashiers recording the same payment at once cannot overpay the invoice.
    invoice = await Invoice.findOneAndUpdate(
      { _id: doc._id, status: { $in: ['issued', 'partial'] }, $expr: { $lte: [{ $add: ['$amountPaidMinor', input.amountMinor] }, { $subtract: ['$totals.totalMinor', '$creditedMinor'] }] } },
      [
        { $set: { amountPaidMinor: { $add: ['$amountPaidMinor', input.amountMinor] } } },
        { $set: {
          status: { $cond: [{ $gte: ['$amountPaidMinor', { $subtract: ['$totals.totalMinor', '$creditedMinor'] }] }, 'paid', 'partial'] },
          paidAt: { $cond: [{ $gte: ['$amountPaidMinor', { $subtract: ['$totals.totalMinor', '$creditedMinor'] }] }, new Date(), null] },
        } },
      ],
      { returnDocument: 'after', session, updatePipeline: true },
    );
    if (!invoice) {
      throw ApiError.badRequest('Some fields need attention.', [{ field: 'amountMinor', message: 'That is more than is still owed on this invoice.' }]);
    }

    [payment] = await Payment.create([{
      ...input, workspace: req.workspace._id, invoice: doc._id, invoiceNumber: doc.number, customer: doc.customer,
      createdBy: req.user._id, updatedBy: req.user._id, searchText: `${doc.number} ${doc.billTo.name} ${input.mode} ${input.reference ?? ''}`.toLowerCase(),
    }], { session });
    await Customer.updateOne({ _id: doc.customer }, { $inc: { receivableMinor: -input.amountMinor } }, { session });
  });

  await audit(req, { action: 'payments.recorded', module: 'payments', recordId: payment._id, summary: `Recorded ${input.mode} payment on ${invoice.number}`, metadata: { amountMinor: input.amountMinor, invoice: String(invoice._id) } });
  return { payment: payment.toObject(), invoice: serializeDocument('invoices', invoice.toObject()) };
}

export async function deletePayment(req, paymentId) {
  if (!mongoose.isValidObjectId(paymentId)) throw ApiError.notFound('Payment not found.');
  let invoice;
  await mongoose.connection.transaction(async (session) => {
    const payment = await Payment.findOne({ _id: paymentId, workspace: req.workspace._id, deletedAt: null }).session(session);
    if (!payment) throw ApiError.notFound('Payment not found.');
    payment.deletedAt = new Date();
    await payment.save({ session });

    invoice = await Invoice.findOneAndUpdate(
      { _id: payment.invoice, workspace: req.workspace._id },
      [
        { $set: { amountPaidMinor: { $max: [0, { $subtract: ['$amountPaidMinor', payment.amountMinor] }] } } },
        { $set: { status: { $cond: [{ $gt: ['$amountPaidMinor', 0] }, 'partial', 'issued'] }, paidAt: null } },
      ],
      { returnDocument: 'after', session, updatePipeline: true },
    );
    await Customer.updateOne({ _id: payment.customer }, { $inc: { receivableMinor: payment.amountMinor } }, { session });
  });
  await audit(req, { action: 'payments.deleted', module: 'payments', recordId: paymentId, summary: `Removed a payment from ${invoice.number}` });
  return { invoice: serializeDocument('invoices', invoice.toObject()) };
}

export async function listPayments(req, query = {}) {
  const filter = { workspace: req.workspace._id, deletedAt: null };
  if (req.scope === 'own') filter.createdBy = req.user._id;
  if (query.mode) filter.mode = String(query.mode);
  if (query.customer && mongoose.isValidObjectId(query.customer)) filter.customer = query.customer;
  if (query.q) filter.searchText = { $regex: escapeRegex(String(query.q).toLowerCase().slice(0, 100)) };
  const from = query.from ? new Date(String(query.from)) : null;
  const to = query.to ? new Date(String(query.to)) : null;
  if (from && !Number.isNaN(from.getTime())) filter.date = { ...(filter.date ?? {}), $gte: from };
  if (to && !Number.isNaN(to.getTime())) filter.date = { ...(filter.date ?? {}), $lte: to };

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const page = Math.max(Number(query.page) || 1, 1);
  const [payments, total, byMode] = await Promise.all([
    Payment.find(filter).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Payment.countDocuments(filter),
    Payment.aggregate([{ $match: filter }, { $group: { _id: '$mode', amountMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } }, { $sort: { amountMinor: -1 } }]),
  ]);
  const customers = await Customer.find({ _id: { $in: [...new Set(payments.map((p) => String(p.customer)))] }, workspace: req.workspace._id }).select('name').lean();
  return {
    payments: payments.map(({ searchText, workspace, __v, ...p }) => p),
    customers: Object.fromEntries(customers.map((c) => [c._id, c.name])),
    byMode: byMode.map((m) => ({ mode: m._id, amountMinor: m.amountMinor, count: m.count })),
    total,
    page,
    limit,
  };
}

// ── public links ──────────────────────────────────────────────────────────────

export async function findPublic(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  for (const [kind, model] of Object.entries(MODELS)) {
    const doc = await model.findOne({ publicToken: token, deletedAt: null }).lean();
    if (doc) {
      // First open by the customer. Only ever set once, so it means "when they first saw it".
      if (!doc.viewedAt) {
        const viewedAt = new Date();
        await model.updateOne({ _id: doc._id, viewedAt: null }, { $set: { viewedAt } });
        doc.viewedAt = viewedAt;
      }
      return { kind, doc };
    }
  }
  return null;
}
