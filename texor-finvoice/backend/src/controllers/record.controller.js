import { z } from 'zod';
import * as records from '../services/record.service.js';
import { contentTypeOf, extensionOf, parse as parseSheetFile, toCsv, toXlsx } from '../services/sheet.service.js';
import Item from '../models/Item.js';
import Invoice from '../models/Invoice.js';
import { history as stockHistory, move as moveStock } from '../services/stock.service.js';
import { can } from '../services/rbac.service.js';
import { hiddenFields } from '../services/rbac.service.js';
import ApiError from '../utils/ApiError.js';
import mongoose from 'mongoose';
import { record as audit } from '../services/audit.service.js';

const moduleKey = (req) => req.params.module;
const MAX_IMPORT_ROWS = 2000;

export const list = async (req, res) => res.json(await records.list(req, moduleKey(req), req.query));
export const get = async (req, res) => res.json(await records.get(req, moduleKey(req), req.params.id));
export const create = async (req, res) => res.status(201).json(await records.create(req, moduleKey(req), req.body));
export const update = async (req, res) => res.json(await records.update(req, moduleKey(req), req.params.id, req.body));

export async function remove(req, res) {
  await records.remove(req, moduleKey(req), req.params.id);
  res.json({ ok: true });
}

/** The same rows as a `.xlsx` or a `.csv` — `?format=` picks, and everything else about them is identical. */
export async function exportSheet(req, res) {
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const { format: _f, ...query } = req.query;
  const rows = await records.exportRows(req, moduleKey(req), query);

  res.set('content-type', contentTypeOf(format));
  res.set('content-disposition', `attachment; filename="${moduleKey(req)}-${new Date().toISOString().slice(0, 10)}.${extensionOf(format)}"`);
  res.send(format === 'xlsx' ? await toXlsx(rows) : toCsv(rows));
}

/**
 * A spreadsheet read back as rows, so the browser can show what it found and ask
 * which column is which. Nothing is stored: the file is read and dropped.
 */
export async function parseSheet(req, res) {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw ApiError.badRequest('Choose a file to import.');
  let rows;
  try {
    rows = await parseSheetFile(req.body);
  } catch (error) {
    throw ApiError.badRequest(error.message?.startsWith('That is an old') ? error.message : 'That file could not be read as a spreadsheet. Save it as .xlsx or CSV and try again.');
  }
  if (rows.length < 2) throw ApiError.badRequest('That file has a heading row but nothing under it.');
  res.json({ rows: rows.slice(0, MAX_IMPORT_ROWS + 1).map((row) => row.slice(0, 60)), truncated: rows.length > MAX_IMPORT_ROWS + 1 });
}

export const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.any())).min(1).max(MAX_IMPORT_ROWS),
  updateExisting: z.boolean().default(true),
});

export const importRows = async (req, res) => res.json(await records.importRows(req, moduleKey(req), req.body.rows, { updateExisting: req.body.updateExisting }));

/**
 * The catalogue picker used by line items everywhere: products and services
 * together, limited to the kinds this person may view, with cost price removed
 * for roles that hide it.
 */
const RECENT_DAYS = 30;

/** Item ids by how often they were billed in the last 30 days, most first. */
async function recentlyBilled(workspace, limit) {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const rows = await Invoice.aggregate([
    { $match: { workspace, deletedAt: null, issuedAt: { $gte: since }, status: { $ne: 'void' } } },
    { $unwind: '$lines' },
    { $match: { 'lines.item': { $ne: null } } },
    { $group: { _id: '$lines.item', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
  return rows.map((r) => r._id);
}

/** The ranked items first, in rank order, then alphabetical fill up to `limit`. */
async function byRank(filter, ranked, limit, select) {
  const top = await Item.find({ ...filter, _id: { $in: ranked } }).select(select).lean();
  const rank = new Map(ranked.map((id, i) => [String(id), i]));
  top.sort((a, b) => rank.get(String(a._id)) - rank.get(String(b._id)));
  if (top.length >= limit) return top.slice(0, limit);
  const fill = await Item.find({ ...filter, _id: { $nin: top.map((i) => i._id) } })
    .sort({ name: 1 }).limit(limit - top.length).select(select).lean();
  return [...top, ...fill];
}

export async function searchItems(req, res) {
  const kinds = ['product', 'service', 'package'].filter((kind) => can(req.workspace, req.member, `${kind}s`, 'view'));
  if (!kinds.length) throw ApiError.forbidden('Your role cannot see the catalogue.');

  const filter = { workspace: req.workspace._id, deletedAt: null, kind: { $in: kinds } };
  const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 100);
  if (q) filter.$or = [{ searchText: { $regex: records.escapeRegex(q) } }, { barcode: q }];

  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const select = 'kind name sku barcode hsn unit priceMinor costMinor taxRate cessRate priceIncludesTax variants trackStock stock trackSerials warranty category image custom components packagePricing packageDiscountPct';

  // Browsing with no query: most shops sell the same few things all day, so lead
  // with what they actually billed recently instead of a cold alphabetical page.
  const ranked = q ? [] : await recentlyBilled(req.workspace._id, limit);
  const items = ranked.length
    ? await byRank(filter, ranked, limit, select)
    : await Item.find(filter).sort({ name: 1 }).limit(limit).select(select).lean();

  const hide = {
    product: hiddenFields(req.workspace, req.member, 'products'),
    service: hiddenFields(req.workspace, req.member, 'services'),
    package: hiddenFields(req.workspace, req.member, 'packages'),
  };
  for (const item of items) for (const key of hide[item.kind] ?? []) delete item[key];

  // A package is billed by expanding it, so the picker needs each component's
  // own price and tax — they are what the lines are built from.
  const componentIds = items.flatMap((i) => (i.components ?? []).map((c) => c.item).filter(Boolean));
  if (componentIds.length) {
    const parts = await Item.find({ _id: { $in: componentIds }, workspace: req.workspace._id, deletedAt: null }).select(select).lean();
    const byId = new Map(parts.map((p) => [String(p._id), p]));
    for (const item of items) {
      if (item.kind !== 'package') continue;
      item.components = (item.components ?? [])
        .map((c) => ({ ...c, item: byId.get(String(c.item)) ?? null }))
        .filter((c) => c.item);
    }
  }
  res.json({ items });
}

export const adjustStockSchema = z.object({
  quantity: z.number().refine((v) => v !== 0, 'Enter how many to add or remove.'),
  reason: z.enum(['adjustment', 'purchase', 'return']).default('adjustment'),
  note: z.string().max(300).default(''),
});

export async function adjustStock(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Product not found.');
  const item = await Item.findOne({ _id: req.params.id, workspace: req.workspace._id, deletedAt: null, kind: 'product' }).lean();
  if (!item) throw ApiError.notFound('Product not found.');
  if (!item.trackStock) throw ApiError.badRequest('Turn on stock tracking for this product first.');

  const movement = await moveStock({ workspace: req.workspace._id, item: item._id, ...req.body, user: req.user._id });
  await audit(req, { action: 'stock.adjusted', module: 'products', recordId: item._id, summary: `${req.body.quantity > 0 ? 'Added' : 'Removed'} ${Math.abs(req.body.quantity)} ${item.unit || 'units'} of ${item.name}` });
  res.json({ movement });
}

export async function stockMovements(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Product not found.');
  const exists = await Item.exists({ _id: req.params.id, workspace: req.workspace._id });
  if (!exists) throw ApiError.notFound('Product not found.');
  res.json({ movements: await stockHistory(req.workspace._id, req.params.id) });
}
