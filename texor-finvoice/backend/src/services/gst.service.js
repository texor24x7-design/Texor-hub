/**
 * The filing side of GST: reading a period out of the documents already stored.
 *
 * Pure read. Nothing here writes, nothing is cached, and no new collection backs
 * it — a return is a view of the invoices and notes of a month, so it can never
 * drift from them. Which return it is lives in `compliance/in/`, because the
 * shape of a return is a country's business, not Finvoice's.
 */
import Invoice from '../models/Invoice.js';
import Note from '../models/Note.js';
import ApiError from '../utils/ApiError.js';
import { buildGstr1, gstr1Sheets } from '../compliance/in/gstr1.js';

/** A `YYYY-MM` string as the half-open range of a calendar month. */
export function monthRange(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month ?? ''));
  if (!match) throw ApiError.badRequest('Pick a month to file for, as YYYY-MM.');
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) throw ApiError.badRequest('That is not a month.');
  const from = new Date(Date.UTC(year, index, 1));
  const to = new Date(Date.UTC(year, index + 1, 1));
  return { from, to };
}

export async function gstr1(req, month) {
  const { from, to } = monthRange(month);
  if (!req.workspace.gstin) {
    throw ApiError.badRequest('This business has no GSTIN, so it files no GST return. Add one in Settings → Business.');
  }

  const scope = { workspace: req.workspace._id, deletedAt: null, date: { $gte: from, $lt: to } };
  const [invoices, notes] = await Promise.all([
    Invoice.find(scope).select('number date status billTo placeOfSupply interState totals lines noteKind').lean(),
    Note.find({ ...scope, status: 'issued' }).select('number date status noteKind invoiceNumber billTo placeOfSupply interState totals lines').lean(),
  ]);

  return {
    month,
    from,
    to,
    gstin: req.workspace.gstin,
    business: req.workspace.legalName || req.workspace.name,
    ...buildGstr1(invoices, notes, req.workspace),
  };
}

export const gstr1Workbook = (data, workspace) => gstr1Sheets(data, { locale: workspace.locale ?? 'en-IN' });
