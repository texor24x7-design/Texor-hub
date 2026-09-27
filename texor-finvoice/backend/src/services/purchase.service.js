/**
 * The buying side: vendors, their bills, and what is owed to them.
 *
 * A bill is the mirror of an invoice, so the tax engine is the same one — with
 * the parties the other way round. On a sale, this business is the seller and
 * the customer's state decides the split; on a purchase, the *vendor* is the
 * seller and this business's state is the place of supply. Get that backwards
 * and a local purchase claims IGST it was never charged.
 *
 * Recording a bill is one transaction, for the same reason issuing an invoice
 * is: goods land on the shelf, the vendor's balance moves, and neither may
 * happen without the other.
 */
import mongoose from 'mongoose';
import Bill from '../models/Bill.js';
import BillPayment from '../models/BillPayment.js';
import Item from '../models/Item.js';
import Vendor from '../models/Vendor.js';
import ApiError from '../utils/ApiError.js';
import { computeDocument } from '../../../frontend/src/lib/shared/tax.mjs';
import { escapeRegex } from './record.service.js';
import * as stock from './stock.service.js';
import { record as audit } from './audit.service.js';

const LIVE = ['recorded', 'partial', 'paid'];

export const amountDue = (bill) => Math.max((bill.totals?.totalMinor ?? 0) - (bill.amountPaidMinor ?? 0), 0);

function serialize(bill) {
  const { searchText, deletedAt, workspace, __v, ...out } = bill;
  out.amountDueMinor = amountDue(bill);
  out.state = bill.status === 'recorded' && bill.dueDate && new Date(bill.dueDate) < new Date() && amountDue(bill) > 0 ? 'overdue' : bill.status;
  return out;
}

async function findVendor(workspaceId, id, { session } = {}) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Choose a vendor.', [{ field: 'vendor', message: 'Choose a vendor.' }]);
  const vendor = await Vendor.findOne({ _id: id, workspace: workspaceId, deletedAt: null }).session(session ?? null).lean();
  if (!vendor) throw ApiError.badRequest('Choose a vendor.', [{ field: 'vendor', message: 'That vendor no longer exists.' }]);
  return vendor;
}

async function findBill(req, id, { session } = {}) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Bill not found.');
  const filter = { _id: id, workspace: req.workspace._id, deletedAt: null };
  if (req.scope === 'own') filter.createdBy = req.user._id;
  const bill = await Bill.findOne(filter).session(session ?? null);
  if (!bill) throw ApiError.notFound('Bill not found.');
  return bill;
}

/**
 * The tax on a purchase, worked out by the same engine that prices a sale — with
 * the vendor as the seller, because that is who charged it.
 */
function recompute(bill, workspace, vendor) {
  const result = computeDocument({
    lines: bill.lines,
    sellerState: vendor.stateCode || workspace.stateCode,
    placeOfSupply: workspace.stateCode,
    discount: bill.discount,
    roundOff: bill.roundOff,
    // No GSTIN on the supplier means no tax invoice, so nothing to claim.
    taxMode: vendor.gstin ? 'gst' : 'none',
    currency: bill.currency,
  });
  bill.lines.forEach((line, i) => Object.assign(line, result.lines[i]));
  bill.totals = result.totals;
  bill.taxSummary = result.taxSummary;
  bill.interState = result.interState;
}

const searchTextFor = (bill) => `${bill.number} ${bill.billFrom?.name ?? ''} ${bill.reference ?? ''}`.toLowerCase().slice(0, 2000);

/** Goods on a bill go onto the shelf; services and untracked items do not. */
async function applyStock(workspaceId, bill, sign, userId, session) {
  const ids = [...new Set(bill.lines.filter((l) => l.item).map((l) => String(l.item)))];
  if (!ids.length) return;
  const items = new Map((await Item.find({ _id: { $in: ids }, workspace: workspaceId }).session(session).lean()).map((i) => [String(i._id), i]));

  for (const line of bill.lines) {
    const item = line.item ? items.get(String(line.item)) : null;
    if (item?.kind !== 'product' || !item.trackStock || !line.quantity) continue;
    await stock.move({
      workspace: workspaceId,
      item: item._id,
      quantity: sign * Number(line.quantity),
      reason: sign > 0 ? 'purchase' : 'adjustment',
      note: sign > 0 ? `Bill ${bill.number}` : `Bill ${bill.number} voided`,
      user: userId,
    }, { session });
  }
}

export async function recordBill(req, body) {
  const ws = req.workspace;
  const vendor = await findVendor(ws._id, body.vendor);

  const bill = new Bill({
    workspace: ws._id,
    vendor: vendor._id,
    billFrom: {
      name: vendor.name, gstin: vendor.gstin, stateCode: vendor.stateCode,
      phone: vendor.phone, email: vendor.email, address: vendor.address,
    },
    number: String(body.number ?? '').trim(),
    date: body.date,
    dueDate: body.dueDate ?? null,
    placeOfSupply: ws.stateCode ?? '',
    currency: ws.currency ?? 'INR',
    lines: body.lines ?? [],
    discount: body.discount?.value ? body.discount : null,
    roundOff: Boolean(body.roundOff),
    reference: body.reference ?? '',
    notes: body.notes ?? '',
    attachment: body.attachment ?? null,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  if (!bill.number) throw ApiError.badRequest('Some fields need attention.', [{ field: 'number', message: "Enter the supplier's bill number." }]);
  if (!bill.lines.length) throw ApiError.badRequest('Some fields need attention.', [{ field: 'lines', message: 'Add at least one line.' }]);

  recompute(bill, ws, vendor);
  bill.searchText = searchTextFor(bill);
  bill.stockApplied = true;

  try {
    await mongoose.connection.transaction(async (session) => {
      await bill.save({ session });
      await applyStock(ws._id, bill, 1, req.user._id, session);
      await Vendor.updateOne({ _id: vendor._id }, { $inc: { payableMinor: bill.totals.totalMinor } }, { session });
    });
  } catch (error) {
    // The unique index is the duplicate guard; this turns it into something readable.
    if (error?.code === 11000) {
      throw ApiError.conflict(`Bill ${bill.number} from ${vendor.name} is already recorded.`, [{ field: 'number', message: 'Already recorded.' }]);
    }
    throw error;
  }

  await audit(req, { action: 'bills.recorded', module: 'bills', recordId: bill._id, summary: `Recorded bill ${bill.number} from ${vendor.name}`, metadata: { totalMinor: bill.totals.totalMinor } });
  return serialize(bill.toObject());
}

export async function listBills(req, query = {}) {
  const filter = { workspace: req.workspace._id, deletedAt: null };
  if (req.scope === 'own') filter.createdBy = req.user._id;

  const state = String(query.state ?? '');
  const now = new Date();
  if (state === 'unpaid') filter.status = { $in: ['recorded', 'partial'] };
  else if (state === 'overdue') Object.assign(filter, { status: { $in: ['recorded', 'partial'] }, dueDate: { $lt: now } });
  else if (['recorded', 'partial', 'paid', 'void'].includes(state)) filter.status = state;

  if (query.vendor && mongoose.isValidObjectId(query.vendor)) filter.vendor = new mongoose.Types.ObjectId(String(query.vendor));
  if (query.q) filter.searchText = { $regex: escapeRegex(String(query.q).toLowerCase().slice(0, 100)) };
  const from = query.from ? new Date(String(query.from)) : null;
  const to = query.to ? new Date(String(query.to)) : null;
  if (from && !Number.isNaN(from.getTime())) filter.date = { ...(filter.date ?? {}), $gte: from };
  if (to && !Number.isNaN(to.getTime())) filter.date = { ...(filter.date ?? {}), $lte: to };

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const page = Math.max(Number(query.page) || 1, 1);
  const [bills, total, sums] = await Promise.all([
    Bill.find(filter).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Bill.countDocuments(filter),
    Bill.aggregate([
      { $match: { ...filter, status: { $in: LIVE } } },
      { $group: { _id: null, totalMinor: { $sum: '$totals.totalMinor' }, paidMinor: { $sum: '$amountPaidMinor' }, inputTaxMinor: { $sum: '$totals.taxMinor' } } },
    ]),
  ]);

  const vendors = await Vendor.find({ _id: { $in: [...new Set(bills.map((b) => String(b.vendor)))] }, workspace: req.workspace._id }).select('name').lean();
  return {
    bills: bills.map(serialize),
    vendors: Object.fromEntries(vendors.map((v) => [v._id, v.name])),
    total,
    page,
    limit,
    sums: {
      totalMinor: sums[0]?.totalMinor ?? 0,
      paidMinor: sums[0]?.paidMinor ?? 0,
      inputTaxMinor: sums[0]?.inputTaxMinor ?? 0,
    },
  };
}

export async function getBill(req, id) {
  const bill = await findBill(req, id);
  const payments = await BillPayment.find({ bill: bill._id, workspace: req.workspace._id, deletedAt: null }).sort({ date: -1 }).lean();
  return { bill: serialize(bill.toObject()), payments };
}

/**
 * Voiding a bill: the goods come back off the shelf and the payable is undone.
 * Money already paid has to be dealt with first — an unrecorded payment is a
 * hole in the bank reconciliation, not a tidy-up.
 */
export async function voidBill(req, id) {
  let voided;
  await mongoose.connection.transaction(async (session) => {
    const bill = await findBill(req, id, { session });
    if (bill.status === 'void') throw ApiError.conflict('This bill is already void.');
    if (bill.amountPaidMinor > 0) throw ApiError.conflict('Remove the payments made against this bill before voiding it.');

    if (bill.stockApplied) await applyStock(req.workspace._id, bill, -1, req.user._id, session);
    await Vendor.updateOne({ _id: bill.vendor }, { $inc: { payableMinor: -bill.totals.totalMinor } }, { session });

    bill.status = 'void';
    bill.voidedAt = new Date();
    bill.stockApplied = false;
    bill.updatedBy = req.user._id;
    await bill.save({ session });
    voided = bill;
  });

  await audit(req, { action: 'bills.voided', module: 'bills', recordId: voided._id, summary: `Voided bill ${voided.number}` });
  return serialize(voided.toObject());
}

/** Paying a vendor. Capped the same way a customer's payment is, so a bill cannot be overpaid. */
export async function payBill(req, id, body) {
  const inputs = Array.isArray(body?.payments) ? body.payments : [body];
  const modes = req.workspace.preferences?.paymentModes ?? [];
  const made = [];
  let bill;

  await mongoose.connection.transaction(async (session) => {
    made.length = 0;
    const doc = await findBill(req, id, { session });
    if (!['recorded', 'partial'].includes(doc.status)) {
      throw ApiError.conflict(doc.status === 'void' ? 'A void bill cannot be paid.' : 'This bill is already paid.');
    }

    for (const input of inputs) {
      const amountMinor = Math.round(Number(input.amountMinor) || 0);
      const mode = String(input.mode ?? '').trim();
      if (amountMinor <= 0) throw ApiError.badRequest('Some fields need attention.', [{ field: 'amountMinor', message: 'Enter how much was paid.' }]);
      if (!mode || (modes.length && !modes.includes(mode))) {
        throw ApiError.badRequest('Some fields need attention.', [{ field: 'mode', message: 'Choose one of your payment modes.' }]);
      }

      bill = await Bill.findOneAndUpdate(
        { _id: doc._id, status: { $in: ['recorded', 'partial'] }, $expr: { $lte: [{ $add: ['$amountPaidMinor', amountMinor] }, '$totals.totalMinor'] } },
        [
          { $set: { amountPaidMinor: { $add: ['$amountPaidMinor', amountMinor] } } },
          { $set: {
            status: { $cond: [{ $gte: ['$amountPaidMinor', '$totals.totalMinor'] }, 'paid', 'partial'] },
            paidAt: { $cond: [{ $gte: ['$amountPaidMinor', '$totals.totalMinor'] }, new Date(), null] },
          } },
        ],
        // Mongoose refuses an array update without this — the sales side passes it too.
        { returnDocument: 'after', session, updatePipeline: true },
      );
      if (!bill) throw ApiError.badRequest('Some fields need attention.', [{ field: 'amountMinor', message: 'That is more than is still owed on this bill.' }]);

      const [payment] = await BillPayment.create([{
        workspace: req.workspace._id, bill: doc._id, billNumber: doc.number, vendor: doc.vendor,
        date: input.date ?? new Date(), amountMinor, mode, reference: input.reference ?? '', note: input.note ?? '',
        createdBy: req.user._id, updatedBy: req.user._id,
        searchText: `${doc.number} ${doc.billFrom?.name ?? ''} ${mode}`.toLowerCase(),
      }], { session });
      made.push(payment);
      await Vendor.updateOne({ _id: doc.vendor }, { $inc: { payableMinor: -amountMinor } }, { session });
    }
  });

  await audit(req, { action: 'bills.paid', module: 'bills', recordId: bill._id, summary: `Paid ${made.reduce((t, p) => t + p.amountMinor, 0) / 100} against bill ${bill.number}` });
  return { payments: made.map((p) => p.toObject()), bill: serialize(bill.toObject()) };
}

/** What was bought in a period, for the return and for the profit figure. */
export async function purchaseTotals(workspaceId, from, to) {
  const [row] = await Bill.aggregate([
    { $match: { workspace: workspaceId, deletedAt: null, status: { $in: LIVE }, date: { $gte: from, $lt: to } } },
    { $group: { _id: null, taxableMinor: { $sum: '$totals.taxableMinor' }, taxMinor: { $sum: '$totals.taxMinor' }, totalMinor: { $sum: '$totals.totalMinor' }, bills: { $sum: 1 } } },
  ]);
  return { taxableMinor: row?.taxableMinor ?? 0, inputTaxMinor: row?.taxMinor ?? 0, totalMinor: row?.totalMinor ?? 0, bills: row?.bills ?? 0 };
}
