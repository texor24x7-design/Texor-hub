import { z } from 'zod';
import * as records from '../services/record.service.js';
import Item from '../models/Item.js';
import { history as stockHistory, move as moveStock } from '../services/stock.service.js';
import { can } from '../services/rbac.service.js';
import { hiddenFields } from '../services/rbac.service.js';
import ApiError from '../utils/ApiError.js';
import mongoose from 'mongoose';
import { record as audit } from '../services/audit.service.js';

const moduleKey = (req) => req.params.module;

export const list = async (req, res) => res.json(await records.list(req, moduleKey(req), req.query));
export const get = async (req, res) => res.json(await records.get(req, moduleKey(req), req.params.id));
export const create = async (req, res) => res.status(201).json(await records.create(req, moduleKey(req), req.body));
export const update = async (req, res) => res.json(await records.update(req, moduleKey(req), req.params.id, req.body));

export async function remove(req, res) {
  await records.remove(req, moduleKey(req), req.params.id);
  res.json({ ok: true });
}

export async function exportCsv(req, res) {
  const csv = await records.exportCsv(req, moduleKey(req), req.query);
  res.set('content-type', 'text/csv; charset=utf-8');
  res.set('content-disposition', `attachment; filename="${moduleKey(req)}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}

export const importSchema = z.object({ rows: z.array(z.record(z.string(), z.any())).min(1).max(2000) });

export const importRows = async (req, res) => res.json(await records.importRows(req, moduleKey(req), req.body.rows));

/**
 * The catalogue picker used by line items everywhere: products and services
 * together, limited to the kinds this person may view, with cost price removed
 * for roles that hide it.
 */
export async function searchItems(req, res) {
  const kinds = ['product', 'service'].filter((kind) => can(req.workspace, req.member, `${kind}s`, 'view'));
  if (!kinds.length) throw ApiError.forbidden('Your role cannot see the catalogue.');

  const filter = { workspace: req.workspace._id, deletedAt: null, kind: { $in: kinds } };
  const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 100);
  if (q) filter.$or = [{ searchText: { $regex: records.escapeRegex(q) } }, { barcode: q }];

  const items = await Item.find(filter).sort({ name: 1 }).limit(Math.min(Number(req.query.limit) || 25, 100))
    .select('kind name sku barcode hsn unit priceMinor costMinor taxRate cessRate priceIncludesTax variants trackStock stock trackSerials warranty category image custom').lean();

  const hide = { product: hiddenFields(req.workspace, req.member, 'products'), service: hiddenFields(req.workspace, req.member, 'services') };
  for (const item of items) for (const key of hide[item.kind]) delete item[key];
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
