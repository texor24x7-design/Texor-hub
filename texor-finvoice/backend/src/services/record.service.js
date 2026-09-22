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
import Expense from '../models/Expense.js';
import Item from '../models/Item.js';
import Member from '../models/Member.js';
import Record from '../models/Record.js';
import Staff from '../models/Staff.js';
import Warranty from '../models/Warranty.js';
import Workspace from '../models/Workspace.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { isCustomModuleKey } from '../modules/registry.js';
import { india } from '../shared.js';
import { moduleOf, parseBody, requireUsableModule, searchTextOf } from './metadata.service.js';
import { hiddenFields } from './rbac.service.js';
import * as stock from './stock.service.js';
import { record as audit } from './audit.service.js';

const STORES = {
  customers: { model: Customer, base: {} },
  products: { model: Item, base: { kind: 'product' } },
  services: { model: Item, base: { kind: 'service' } },
  packages: { model: Item, base: { kind: 'package' } },
  warranties: { model: Warranty, base: {} },
  staff: { model: Staff, base: {} },
  expenses: { model: Expense, base: {} },
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

HOOKS.packages = {
  /**
   * A package is billed by expanding it into its parts, so the parts have to be
   * things that can stand as an invoice line. A package inside a package has no
   * sensible expansion, and a component that has been deleted would silently
   * vanish from the bill.
   */
  async beforeSave(data, req) {
    if (data.components === undefined) return;
    const ids = data.components.map((c) => c.item).filter(Boolean);
    if (!ids.length) {
      throw ApiError.badRequest('Some fields need attention.', [{ field: 'components', message: 'Add at least one product or service to the package.' }]);
    }
    const parts = await Item.find({ _id: { $in: ids }, workspace: req.workspace._id, deletedAt: null }).select('name kind priceMinor variants').lean();
    const byId = new Map(parts.map((p) => [String(p._id), p]));

    const missing = ids.filter((id) => !byId.has(String(id)));
    if (missing.length) {
      throw ApiError.badRequest('Some fields need attention.', [{ field: 'components', message: 'One of these items no longer exists. Remove it and pick another.' }]);
    }
    // Name the parts after the items when nobody typed anything, so the bill
    // reads properly however the package was created.
    for (const component of data.components) {
      if (!component.description) component.description = byId.get(String(component.item))?.name ?? '';
    }

    // A "package" that costs more than its parts is a data-entry slip, and it
    // would silently bill at no saving at all.
    if ((data.packagePricing ?? 'fixed') === 'fixed' && data.priceMinor != null) {
      const byIdFull = new Map(parts.map((p) => [String(p._id), p]));
      const worth = data.components.reduce((sum, c) => {
        const part = byIdFull.get(String(c.item));
        const variant = c.variant ? (part?.variants ?? []).find((v) => v.name === c.variant) : null;
        return sum + Math.round((Number(c.quantity) || 1) * Number(variant?.priceMinor ?? part?.priceMinor ?? 0));
      }, 0);
      if (data.priceMinor > worth) {
        throw ApiError.badRequest('Some fields need attention.', [{
          field: 'priceMinor',
          message: `The parts come to ${(worth / 100).toFixed(2)}. A package price above that would charge more than buying them separately.`,
        }]);
      }
    }

    const nested = parts.filter((p) => p.kind === 'package');
    if (nested.length) {
      throw ApiError.badRequest('Some fields need attention.', [{
        field: 'components',
        message: `${nested.map((p) => p.name).join(', ')} is itself a package. Add its products and services directly instead.`,
      }]);
    }
  },
};
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

/**
 * Where a field's free-text word list lives in preferences. Mirrors
 * `suggestionBucket` on the client; payment modes are deliberately absent
 * because that list is curated in settings rather than grown by typing.
 */
const WORD_LIST = { category: (moduleKey) => `preferences.categories.${moduleKey}`, unit: () => 'preferences.units', designation: () => 'preferences.designations' };

/**
 * A category, unit or staff role typed into a record joins the workspace's list,
 * so the next record offers it instead of everyone retyping it (and inventing a
 * second spelling). Never fails a save: the record is what matters.
 */
async function rememberWords(req, moduleKey, data) {
  const $addToSet = {};
  for (const [key, path] of Object.entries(WORD_LIST)) {
    const value = typeof data?.[key] === 'string' ? data[key].trim() : '';
    if (value) $addToSet[path(moduleKey)] = value;
  }
  if (!Object.keys($addToSet).length) return;
  try {
    await Workspace.updateOne({ _id: req.workspace._id }, { $addToSet });
  } catch (error) {
    logger.warn('could not remember a catalogue word', { error: error.message, module: moduleKey });
  }
}

/**
 * Recomputes the stored title and search text for one module's records.
 *
 * Both are denormalised when a record is saved, so a metadata change — picking a
 * different title field, relabelling a select's options — updates the column
 * header immediately while every existing record goes on showing what it showed
 * before. Only records saved *after* the change look right, which is exactly how
 * this was reported.
 *
 * It runs inline after a module edit: one module's records in one workspace,
 * rewritten in a single bulkWrite, on an action nobody performs in a loop.
 */
export async function retitle(workspace, moduleKey) {
  const module = moduleOf(workspace, moduleKey);
  let store;
  try { store = storeFor(moduleKey); } catch { return 0; } // a module that holds no records
  const { model, base } = store;

  const docs = await model.find({ workspace: workspace._id, deletedAt: null, ...base }).lean();
  if (!docs.length) return 0;

  const refs = await resolveRefs(workspace._id, module, docs);
  const ops = [];
  for (const doc of docs) {
    const title = model === Record ? titleOf(module, doc, refs, workspace) : doc.title;
    const searchText = `${title ?? ''} ${searchTextOf(module, doc)}`.trim();
    if (searchText === (doc.searchText ?? '') && title === doc.title) continue;
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { searchText, ...(model === Record ? { title } : {}) } } } });
  }
  if (ops.length) await model.bulkWrite(ops);
  return ops.length;
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

  await rememberWords(req, moduleKey, data);
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

  await rememberWords(req, moduleKey, data);
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

// ── spreadsheets ──────────────────────────────────────────────────────────────

function exportValue(field, value, refs, workspace) {
  if (value == null) return '';
  switch (field.type) {
    // Numbers stay numbers: a column of prices that a spreadsheet cannot sum is
    // not much of an export.
    case 'currency': return Number((value / 100).toFixed(2));
    case 'number': case 'percent': return Number(value);
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

const PAGE = 500;
/** A whole catalogue, not one page of it — but not so much that one click can exhaust the server. */
const EXPORT_MAX = 20000;

/** The module's records as rows of cell values, headings first, ready for any file format. */
export async function exportRows(req, moduleKey, query) {
  const module = requireUsableModule(req.workspace, moduleKey);
  const hidden = new Set(hiddenFields(req.workspace, req.member, moduleKey));
  const fields = module.fields.filter((f) => !hidden.has(f.key) && !['image', 'file'].includes(f.type));

  const rows = [fields.map((f) => f.label)];
  for (let page = 1; rows.length <= EXPORT_MAX; page += 1) {
    const { records, refs } = await list(req, moduleKey, { ...query, limit: PAGE, page });
    for (const record of records) {
      rows.push(fields.map((f) => exportValue(f, f.custom ? record.custom?.[f.key] : record[f.key], refs, req.workspace)));
    }
    if (records.length < PAGE) break;
  }
  return rows;
}

// ── importing ─────────────────────────────────────────────────────────────────

/**
 * How an imported row is recognised as one that already exists, in the order
 * tried. A module missing from here can only ever create.
 *
 * ponytail: matched one row at a time, case-insensitively, so a 2000-row file is
 * 2000 indexed lookups per key. Batch them per column if imports get slow.
 */
const MATCH_ON = {
  products: ['sku', 'barcode', 'name'],
  services: ['sku', 'name'],
  packages: ['sku', 'name'],
  customers: ['phone', 'email', 'gstin', 'name'],
  staff: ['phone', 'email', 'name'],
};

async function findExisting(req, moduleKey, row) {
  const keys = MATCH_ON[moduleKey];
  if (!keys) return null;
  const { model, base } = storeFor(moduleKey);
  for (const key of keys) {
    const value = typeof row[key] === 'string' ? row[key].trim() : row[key];
    if (!value) continue;
    const filter = { workspace: req.workspace._id, deletedAt: null, ...base, [key]: new RegExp(`^${escapeRegex(String(value))}$`, 'i') };
    if (req.scope === 'own') filter.createdBy = req.user._id;
    const doc = await model.findOne(filter).select('_id stock trackStock name').lean();
    if (doc) return doc;
  }
  return null;
}

/**
 * Stock from a spreadsheet. `stock` is what is on the shelf now — a stocktake —
 * and `addStock` is a delivery being received. Both become ledger rows rather
 * than a written-over number, so the count still adds up afterwards.
 */
async function applyStock(req, moduleKey, existing, counted, received) {
  if (moduleKey !== 'products') return;
  const quantity = Number.isFinite(received) && received !== 0
    ? received
    : (Number.isFinite(counted) ? counted - (existing.stock ?? 0) : NaN);
  if (!Number.isFinite(quantity) || quantity === 0) return;

  // `move` only touches an item that is tracking stock, so its refusal — rather
  // than a flag read before the row was applied — is what says the count cannot
  // land. The row may have switched tracking on a moment ago.
  const movement = await stock.move({
    workspace: req.workspace._id,
    item: existing._id,
    quantity,
    reason: Number.isFinite(received) && received !== 0 ? 'purchase' : 'adjustment',
    note: 'Imported',
    user: req.user._id,
  });
  if (!movement) throw ApiError.badRequest('Turn on stock tracking for this product before importing a count for it.');
}

/**
 * Rows arrive already mapped to field keys by the browser. A row that matches a
 * record already here updates it — importing the same price list twice is meant
 * to correct prices, not to double the catalogue — unless the person said not
 * to. Whatever a row cannot do is reported against its line number.
 */
export async function importRows(req, moduleKey, rows, { updateExisting = true } = {}) {
  const results = { created: 0, updated: 0, errors: [] };
  for (const [index, row] of rows.entries()) {
    const { stock: counted, addStock, ...values } = row;
    try {
      const existing = updateExisting ? await findExisting(req, moduleKey, values) : null;
      if (existing) {
        await update(req, moduleKey, existing._id, values);
        results.updated += 1;
        await applyStock(req, moduleKey, existing, Number(counted), Number(addStock));
      } else {
        // Nothing to count against yet, so either column is simply the opening count.
        await create(req, moduleKey, { ...values, openingStock: counted ?? addStock });
        results.created += 1;
      }
    } catch (error) {
      results.errors.push({ row: index + 1, message: error.message, details: error.details ?? [] });
    }
  }
  return results;
}
