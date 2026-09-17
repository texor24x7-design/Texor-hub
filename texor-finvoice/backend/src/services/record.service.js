/**
 * One implementation of list / read / create / update / delete / export for
 * every record-shaped module — customers, products, services, warranties, staff,
 * and every module a workspace defines.
 *
 * What differs between them lives in `HOOKS`, keyed by module. What is the same
 * — tenancy, own-records scope, hidden fields, custom-field validation, search,
 * reference titles, the audit line — is written once here, so a new module
 * cannot forget any of it.
 */
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import Item from '../models/Item.js';
import Member from '../models/Member.js';
import Record from '../models/Record.js';
import Staff from '../models/Staff.js';
import Warranty from '../models/Warranty.js';
import ApiError from '../utils/ApiError.js';
import { isCustomModuleKey } from '../modules/registry.js';
import { india } from '../shared.js';
import { parseBody, requireUsableModule, searchTextOf } from './metadata.service.js';
import { hiddenFields } from './rbac.service.js';
import * as stock from './stock.service.js';
import { record as audit } from './audit.service.js';

const STORES = {
  customers: { model: Customer, base: {} },
  products: { model: Item, base: { kind: 'product' } },
  services: { model: Item, base: { kind: 'service' } },
  warranties: { model: Warranty, base: {} },
  staff: { model: Staff, base: {} },
};

export function storeFor(moduleKey) {
  if (isCustomModuleKey(moduleKey)) return { model: Record, base: { module: moduleKey } };
  const store = STORES[moduleKey];
  if (!store) throw ApiError.notFound('This module does not hold records.');
  return store;
}

export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DAY = 24 * 60 * 60 * 1000;
const EXPIRING_WITHIN = 30 * DAY;

const STRING_TYPES = new Set(['text', 'longtext', 'email', 'phone', 'url', 'gstin', 'state', 'select', 'time']);

// ── references ────────────────────────────────────────────────────────────────

/** How to show a linked record's name, by the module it lives in. */
const TITLE_SOURCES = {
  customers: { model: Customer, select: 'name phone', title: (d) => d.name, subtitle: (d) => d.phone },
  items: { model: Item, select: 'name kind', title: (d) => d.name },
  products: { model: Item, select: 'name kind', title: (d) => d.name },
  services: { model: Item, select: 'name kind', title: (d) => d.name },
  staff: { model: Staff, select: 'name designation', title: (d) => d.name, subtitle: (d) => d.designation },
  warranties: { model: Warranty, select: 'itemName serial', title: (d) => d.itemName, subtitle: (d) => d.serial },
};

function titleSource(refModule) {
  if (isCustomModuleKey(refModule)) return { model: Record, select: 'title module', title: (d) => d.title, extra: { module: refModule } };
  return TITLE_SOURCES[refModule] ?? null;
}

function referenceValues(module, values) {
  const found = [];
  for (const field of module.fields) {
    const value = field.custom ? values.custom?.[field.key] : values[field.key];
    if (!value) continue;
    if (field.type === 'reference') found.push([field.refModule, String(value), field]);
    if (field.type === 'items') for (const line of value) if (line.item) found.push(['items', String(line.item), field]);
  }
  return found;
}

/** `{ id: { title, subtitle, module } }` for every link in `docs`, scoped to the workspace. */
export async function resolveRefs(workspaceId, module, docs) {
  const wanted = new Map();
  for (const doc of docs) {
    for (const [refModule, id] of referenceValues(module, doc)) {
      if (!mongoose.isValidObjectId(id)) continue;
      if (!wanted.has(refModule)) wanted.set(refModule, new Set());
      wanted.get(refModule).add(id);
    }
  }

  const refs = {};
  await Promise.all([...wanted].map(async ([refModule, ids]) => {
    const source = titleSource(refModule);
    if (!source) return;
    const rows = await source.model
      .find({ _id: { $in: [...ids] }, workspace: workspaceId, ...(source.extra ?? {}) })
      .select(source.select).lean();
    for (const row of rows) {
      refs[row._id] = { title: source.title(row), subtitle: source.subtitle?.(row) ?? '', module: refModule === 'items' ? `${row.kind}s` : refModule };
    }
  }));
  return refs;
}

async function assertReferences(workspaceId, module, values) {
  const refs = await resolveRefs(workspaceId, module, [values]);
  for (const [, id, field] of referenceValues(module, values)) {
    if (!refs[id]) throw ApiError.badRequest('Some fields need attention.', [{ field: field.custom ? `custom.${field.key}` : field.key, message: `That ${field.label.toLowerCase()} no longer exists.` }]);
  }
  return refs;
}

// ── shaping ───────────────────────────────────────────────────────────────────

function formatForTitle(field, value, refs, workspace) {
  if (value == null || value === '') return '';
  if (field.type === 'reference') return refs[String(value)]?.title ?? '';
  if (field.type === 'datetime' || field.type === 'date') {
    return new Intl.DateTimeFormat(workspace.locale ?? 'en-IN', {
      dateStyle: 'medium', ...(field.type === 'datetime' ? { timeStyle: 'short' } : {}), timeZone: workspace.timezone ?? 'Asia/Kolkata',
    }).format(new Date(value));
  }
  if (field.type === 'select') return field.options?.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}

function titleOf(module, doc, refs, workspace) {
  const field = module.fields.find((f) => f.key === module.titleField) ?? module.fields.find((f) => f.type === 'text');
  if (!field) return '';
  return formatForTitle(field, field.custom ? doc.custom?.[field.key] : doc[field.key], refs, workspace).slice(0, 200);
}

/** A stored document as the API returns it: internals and role-hidden fields removed. */
export function serialize(module, doc, hidden = []) {
  const { searchText, deletedAt, workspace, __v, ...out } = doc;
  out.custom = { ...(doc.custom ?? {}) };
  for (const key of hidden) {
    delete out[key];
    delete out.custom[key];
  }
  return HOOKS[module.key]?.decorate?.(out) ?? out;
}

/** Field defaults for a new record, filled in before validation so a required field with a default passes. */
function withDefaults(module, body) {
  const data = { ...(body ?? {}), custom: { ...(body?.custom ?? {}) } };
  for (const field of module.fields) {
    if (field.default === undefined) continue;
    const bag = field.custom ? data.custom : data;
    if (bag[field.key] === undefined) bag[field.key] = field.default;
  }
  return data;
}

/** Nulls from the client become the model's empty value, so a cleared text field is '' rather than null. */
function normalise(module, data) {
  for (const field of module.fields) {
    if (!field.custom && data[field.key] === null && STRING_TYPES.has(field.type)) data[field.key] = '';
  }
  return data;
}

// ── module-specific behaviour ─────────────────────────────────────────────────

function warrantyStatus(w, now = Date.now()) {
  if (w.status === 'void') return 'void';
  const end = new Date(w.endDate).getTime();
  if (end < now) return 'expired';
  if (end - now <= EXPIRING_WITHIN) return 'expiring';
  return 'active';
}

const HOOKS = {
  customers: {
    beforeSave(data) {
      if (data.gstin && !data.stateCode) data.stateCode = india.stateFromGstin(data.gstin);
      // A GSTIN makes them a registered person, so the sale is B2B for GST whatever the form said.
      if (data.gstin) data.kind = 'business';
    },
  },
  products: {
    /** New items start with the workspace's tax convention when the form did not set one. */
    beforeSave(data, req, existing) {
      if (existing) return;
      const prefs = req.workspace.preferences ?? {};
      if (data.taxRate == null && prefs.taxRate != null) data.taxRate = prefs.taxRate;
      if (data.priceIncludesTax == null && prefs.priceIncludesTax != null) data.priceIncludesTax = prefs.priceIncludesTax;
    },
    async afterCreate(req, doc, body, session) {
      const opening = Number(body.openingStock);
      if (doc.trackStock && Number.isFinite(opening) && opening !== 0) {
        await stock.move({ workspace: req.workspace._id, item: doc._id, quantity: opening, reason: 'opening', user: req.user._id }, { session });
      }
    },
  },
  staff: {
    async beforeSave(data, req) {
      if (data.email === undefined) return;
      const member = data.email
        ? await Member.findOne({ workspace: req.workspace._id, email: data.email, status: 'active' }).select('_id').lean()
        : null;
      data.member = member?._id ?? null;
    },
  },
  warranties: {
    beforeSave(data, _req, existing) {
      const start = data.startDate ?? existing?.startDate;
      const end = data.endDate ?? existing?.endDate;
      if (start && end && new Date(end) < new Date(start)) {
        throw ApiError.badRequest('Some fields need attention.', [{ field: 'endDate', message: 'A warranty cannot end before it starts.' }]);
      }
    },
    decorate(w) {
      w.state = warrantyStatus(w);
      w.openClaims = (w.claims ?? []).filter((c) => c.status === 'open' || c.status === 'in_progress').length;
      return w;
    },
    listFilter(filter, query) {
      const now = new Date();
      const soon = new Date(Date.now() + EXPIRING_WITHIN);
      if (query.state === 'void') filter.status = 'void';
      if (query.state === 'expired') Object.assign(filter, { status: 'active', endDate: { $lt: now } });
      if (query.state === 'expiring') Object.assign(filter, { status: 'active', endDate: { $gte: now, $lte: soon } });
      if (query.state === 'active') Object.assign(filter, { status: 'active', endDate: { $gt: soon } });
      if (query.customer && mongoose.isValidObjectId(query.customer)) filter.customer = query.customer;
    },
  },
};
HOOKS.services = { beforeSave: HOOKS.products.beforeSave, afterCreate: HOOKS.products.afterCreate };
HOOKS.products.listFilter = (filter, query) => {
  if (query.lowStock === '1') filter.$expr = { $and: [{ $eq: ['$trackStock', true] }, { $ne: ['$lowStock', null] }, { $lte: ['$stock', '$lowStock'] }] };
};
HOOKS.customers.listFilter = (filter, query) => {
  if (query.receivable === '1') filter.receivableMinor = { $gt: 0 };
};

const hooksFor = (module) => HOOKS[module.key] ?? {};

// ── operations ────────────────────────────────────────────────────────────────

function filterValue(field, raw) {
  if (field.type === 'checkbox') return raw === 'true';
  if (field.type === 'reference') return mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(raw) : undefined;
  if (field.type === 'number' || field.type === 'currency') return Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  if (field.type === 'multiselect') return { $in: String(raw).split(',') };
  return String(raw);
}

const SORTABLE = new Set(['updatedAt', 'createdAt', 'name', 'title', 'endDate', 'startDate', 'stock', 'priceMinor', 'receivableMinor']);

export async function list(req, moduleKey, query = {}) {
  const module = requireUsableModule(req.workspace, moduleKey);
  const { model, base } = storeFor(moduleKey);

  const filter = { workspace: req.workspace._id, deletedAt: null, ...base };
  if (req.scope === 'own') filter.createdBy = req.user._id;

  if (query.q) filter.searchText = { $regex: escapeRegex(String(query.q).toLowerCase().slice(0, 100)) };

  for (const [param, raw] of Object.entries(query)) {
    if (!param.startsWith('f.') || raw === '') continue;
    const field = module.fields.find((f) => f.key === param.slice(2));
    if (!field) continue;
    const value = filterValue(field, raw);
    if (value !== undefined) filter[field.custom ? `custom.${field.key}` : field.key] = value;
  }
  hooksFor(module).listFilter?.(filter, query);

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
  const page = Math.max(Number(query.page) || 1, 1);
  const sortKey = String(query.sort ?? '-updatedAt');
  const sortField = sortKey.replace(/^-/, '');
  const sort = SORTABLE.has(sortField) ? { [sortField]: sortKey.startsWith('-') ? -1 : 1, _id: -1 } : { updatedAt: -1 };

  const [docs, total] = await Promise.all([
    model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    model.countDocuments(filter),
  ]);

  const hidden = hiddenFields(req.workspace, req.member, moduleKey);
  return {
    records: docs.map((doc) => serialize(module, doc, hidden)),
    refs: await resolveRefs(req.workspace._id, module, docs),
    total,
    page,
    limit,
  };
}

async function findOwned(req, moduleKey, id, { session } = {}) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Record not found.');
  const { model, base } = storeFor(moduleKey);
  const filter = { _id: id, workspace: req.workspace._id, deletedAt: null, ...base };
  if (req.scope === 'own') filter.createdBy = req.user._id;
  const doc = await model.findOne(filter).session(session ?? null);
  if (!doc) throw ApiError.notFound('Record not found.');
  return doc;
}

export async function get(req, moduleKey, id) {
  const module = requireUsableModule(req.workspace, moduleKey);
  const doc = (await findOwned(req, moduleKey, id)).toObject();
  return {
    record: serialize(module, doc, hiddenFields(req.workspace, req.member, moduleKey)),
    refs: await resolveRefs(req.workspace._id, module, [doc]),
  };
}

export async function create(req, moduleKey, body) {
  const module = requireUsableModule(req.workspace, moduleKey);
  const { model, base } = storeFor(moduleKey);
  const hidden = hiddenFields(req.workspace, req.member, moduleKey);
  const data = normalise(module, parseBody(req.workspace, moduleKey, withDefaults(module, body), { hidden }));

  await hooksFor(module).beforeSave?.(data, req, null);
  const refs = await assertReferences(req.workspace._id, module, data);

  const created = await mongoose.connection.transaction(async (session) => {
    const doc = new model({ ...data, ...base, workspace: req.workspace._id, createdBy: req.user._id, updatedBy: req.user._id });
    if (model === Record) doc.title = titleOf(module, data, refs, req.workspace);
    doc.searchText = `${doc.title ?? ''} ${searchTextOf(module, data)}`.trim();
    await doc.save({ session });
    await hooksFor(module).afterCreate?.(req, doc, body, session);
    return doc;
  });

  const fresh = await model.findById(created._id).lean();
  await audit(req, { action: 'record.created', module: moduleKey, recordId: created._id, summary: `Created ${module.labelSingular.toLowerCase()} ${fresh.title || fresh.name || fresh.itemName || ''}`.trim() });
  return { record: serialize(module, fresh, hidden), refs };
}

export async function update(req, moduleKey, id, body) {
  const module = requireUsableModule(req.workspace, moduleKey);
  const { model } = storeFor(moduleKey);
  const hidden = hiddenFields(req.workspace, req.member, moduleKey);
  const data = normalise(module, parseBody(req.workspace, moduleKey, body, { partial: true, hidden }));

  const doc = await findOwned(req, moduleKey, id);
  await hooksFor(module).beforeSave?.(data, req, doc);

  const { custom, ...system } = data;
  const changed = Object.keys(system);
  doc.set(system);
  if (custom) {
    doc.custom = { ...(doc.custom ?? {}), ...custom };
    doc.markModified('custom');
    changed.push(...Object.keys(custom).map((k) => `custom.${k}`));
  }

  const merged = doc.toObject();
  const refs = await assertReferences(req.workspace._id, module, merged);
  if (model === Record) doc.title = titleOf(module, merged, refs, req.workspace);
  doc.searchText = `${doc.title ?? ''} ${searchTextOf(module, merged)}`.trim();
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, { action: 'record.updated', module: moduleKey, recordId: doc._id, summary: `Updated ${module.labelSingular.toLowerCase()}`, metadata: { fields: changed } });
  return { record: serialize(module, doc.toObject(), hidden), refs };
}

export async function remove(req, moduleKey, id) {
  const module = requireUsableModule(req.workspace, moduleKey);
  const doc = await findOwned(req, moduleKey, id);
  doc.deletedAt = new Date();
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: 'record.deleted', module: moduleKey, recordId: doc._id, summary: `Deleted ${module.labelSingular.toLowerCase()}` });
}

// ── CSV ───────────────────────────────────────────────────────────────────────

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  // Leading =, +, - or @ is a formula to a spreadsheet; prefix it so a customer
  // named "=HYPERLINK(...)" is exported as text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

function exportValue(field, value, refs, workspace) {
  if (value == null) return '';
  switch (field.type) {
    case 'currency': return (value / 100).toFixed(2);
    case 'reference': return refs[String(value)]?.title ?? '';
    case 'multiselect': return value.join('; ');
    case 'checkbox': return value ? 'Yes' : 'No';
    case 'address': return [value.line1, value.line2, value.city, india.stateName(value.stateCode), value.pincode].filter(Boolean).join(', ');
    case 'items': return value.map((l) => `${l.quantity} × ${l.description}`).join('; ');
    case 'variants': return value.map((v) => `${v.name}: ${(v.priceMinor / 100).toFixed(2)}`).join('; ');
    case 'warranty': return `${value.duration} ${value.unit}`;
    case 'date': case 'datetime': case 'select': return formatForTitle(field, value, refs, workspace);
    case 'image': case 'file': return '';
    default: return value;
  }
}

export async function exportCsv(req, moduleKey, query) {
  const module = requireUsableModule(req.workspace, moduleKey);
  const hidden = new Set(hiddenFields(req.workspace, req.member, moduleKey));
  const { records, refs } = await list(req, moduleKey, { ...query, limit: 500, page: 1 });
  // Exports are capped at 500 per page; the client asks for further pages.
  const fields = module.fields.filter((f) => !hidden.has(f.key) && !['image', 'file'].includes(f.type));
  const lines = [fields.map((f) => csvCell(f.label)).join(',')];
  for (const record of records) {
    lines.push(fields.map((f) => csvCell(exportValue(f, f.custom ? record.custom?.[f.key] : record[f.key], refs, req.workspace))).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Rows arrive already mapped to field keys by the browser. Valid rows are inserted; the rest are reported. */
export async function importRows(req, moduleKey, rows) {
  const results = { created: 0, errors: [] };
  for (const [index, row] of rows.entries()) {
    try {
      await create(req, moduleKey, row);
      results.created += 1;
    } catch (error) {
      results.errors.push({ row: index + 1, message: error.message, details: error.details ?? [] });
    }
  }
  return results;
}
