/**
 * The layer that makes every module customisable.
 *
 * A workspace stores only what people may change about a module — its names,
 * icon, order, whether it is on, how its fields are labelled and arranged, and
 * any fields they added. `effectiveModules` merges that over the registry at
 * read time, so a field the code later starts depending on appears in every
 * workspace without a migration, and nobody can edit away a property the code
 * relies on (a field's type, whether it can be deleted).
 */
import mongoose from 'mongoose';
import { z } from 'zod';
import { CORE_MODULES, CUSTOM_FIELD_TYPES, FIELD_TYPES, coreModule } from '../modules/registry.js';
import { india } from '../shared.js';
import ApiError from '../utils/ApiError.js';

/** Field properties a workspace may override on a system field. */
const EDITABLE_FIELD_PROPS = ['label', 'help', 'hidden', 'options', 'section', 'order', 'printable', 'default', 'placeholder'];
const MODULE_PROPS = ['enabled', 'label', 'labelSingular', 'icon', 'order', 'group'];

function mergeField(system, stored, index) {
  const merged = { ...system, custom: false, order: index };
  if (!stored) return merged;
  for (const prop of EDITABLE_FIELD_PROPS) if (stored[prop] !== undefined) merged[prop] = stored[prop];
  // A locked field's requiredness belongs to the code; others may only be tightened.
  if (!system.locked && stored.required === true) merged.required = true;
  if (system.locked) merged.hidden = false;
  return merged;
}

function mergeFields(systemFields, storedFields = []) {
  const stored = new Map(storedFields.map((f) => [f.key, f]));
  const fields = systemFields.map((f, i) => mergeField(f, stored.get(f.key), i));
  storedFields.filter((f) => f.custom).forEach((f, i) => fields.push({ ...f, order: f.order ?? 1000 + i }));
  return fields.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** The workspace's modules, fully resolved, in sidebar order. */
export function effectiveModules(workspace) {
  const stored = new Map((workspace.modules ?? []).map((m) => [m.key, m]));

  const core = CORE_MODULES.map((definition, index) => {
    const saved = stored.get(definition.key) ?? {};
    const merged = { ...definition, custom: false, enabled: true, order: index * 10 };
    for (const prop of MODULE_PROPS) if (saved[prop] !== undefined) merged[prop] = saved[prop];
    merged.fields = mergeFields(definition.fields, saved.fields);
    merged.locked = definition.edition === 'pro' && workspace.edition !== 'pro';
    return merged;
  });

  const custom = (workspace.modules ?? [])
    .filter((m) => m.custom)
    .map((m) => {
      const fields = [...(m.fields ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      // Linking to a customer is a real column on the record, not a custom value.
      if (m.customerLink) fields.unshift({ key: 'customer', label: 'Customer', type: 'reference', refModule: 'customers', custom: false, locked: true, order: -1 });
      return { group: 'operations', actions: ['view', 'create', 'edit', 'delete', 'export'], edition: 'lite', enabled: true, ...m, locked: false, fields };
    });

  return [...core, ...custom].sort((a, b) => a.order - b.order);
}

export function moduleOf(workspace, key) {
  const module = effectiveModules(workspace).find((m) => m.key === key);
  if (!module) throw ApiError.notFound(`There is no ${key} module in this workspace.`);
  return module;
}

export function requireUsableModule(workspace, key) {
  const module = moduleOf(workspace, key);
  if (module.locked) throw new ApiError(402, 'upgrade_required', `${module.label} is part of Finvoice Pro.`);
  if (!module.enabled) throw ApiError.notFound(`${module.label} is switched off in this workspace.`);
  return module;
}

// ── validation ────────────────────────────────────────────────────────────────

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Not a valid reference.');
const optionalString = (max) => z.string().trim().max(max);

const addressShape = z.object({
  line1: optionalString(200).default(''),
  line2: optionalString(200).default(''),
  city: optionalString(100).default(''),
  stateCode: z.string().refine((v) => v === '' || india.isStateCode(v), 'Choose a state.').default(''),
  pincode: z.string().trim().regex(/^[0-9A-Za-z -]{0,10}$/, 'Enter a valid PIN code.').default(''),
  country: z.string().length(2).default('IN'),
});

const minorAmount = z.number().int('Amounts are sent in minor units.').min(0).max(1e13);

/** One zod type per field type. `required` is layered on afterwards. */
function baseType(field) {
  switch (field.type) {
    case 'text': return optionalString(500);
    case 'longtext': return optionalString(10000);
    case 'number': return z.number().finite();
    case 'currency': return minorAmount;
    case 'percent': return z.number().min(0).max(100);
    case 'date':
    case 'datetime': return z.coerce.date();
    case 'time': return z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.');
    case 'checkbox': return z.boolean();
    case 'email': return z.union([z.email('Enter a valid email address.'), z.literal('')]);
    case 'phone': return z.string().trim().regex(/^[+0-9 ()-]{0,20}$/, 'Enter a valid phone number.');
    case 'url': return z.union([z.url('Enter a full link, starting with https://'), z.literal('')]);
    case 'image':
    case 'file': return z.string().max(64);
    case 'reference': return objectId;
    case 'gstin': return z.string().transform(india.normaliseGstin).superRefine((v, ctx) => {
      const message = india.gstinError(v);
      if (message) ctx.addIssue({ code: 'custom', message });
    });
    case 'state': return z.string().refine((v) => v === '' || india.isStateCode(v), 'Choose a state.');
    case 'address': return addressShape;
    case 'select': {
      const values = (field.options ?? []).map((o) => o.value);
      return field.allowNew || values.length === 0
        ? optionalString(100)
        : z.string().refine((v) => v === '' || values.includes(v), `Choose one of the ${field.label.toLowerCase()} options.`);
    }
    case 'multiselect': return z.array(optionalString(100)).max(50);
    case 'items': return z.array(z.object({
      item: objectId.nullable().default(null),
      variant: z.string().max(64).nullable().default(null),
      description: optionalString(500),
      quantity: z.number().min(0).default(1),
      priceMinor: minorAmount.default(0),
    })).max(200);
    case 'variants': return z.array(z.object({
      _id: objectId.optional(),
      name: z.string().trim().min(1, 'Name each variant.').max(80),
      priceMinor: minorAmount,
      sku: optionalString(64).default(''),
    })).max(50);
    case 'warranty': return z.object({
      duration: z.number().int().min(1, 'A warranty lasts at least one day.').max(1200),
      unit: z.enum(['days', 'months', 'years']),
      coverage: optionalString(4000).default(''),
    });
    default: return z.any();
  }
}

const present = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

function fieldSchema(field, { partial }) {
  const schema = baseType(field);
  if (!field.required) return schema.nullable().optional();
  if (partial) return schema.optional();
  // Checked before the type, so a missing value says "required" rather than
  // "expected string, received undefined".
  return z.any().refine(present, `${field.label} is required.`).pipe(schema);
}

const compiled = new Map();
const MAX_COMPILED = 500;

/**
 * A zod schema for a module's body: `{ ...systemFields, custom: {...} }`.
 *
 * Read-only fields and fields the role may not see are dropped *before*
 * validation (see `writableFields`), so a client cannot set a product's stock
 * count or a hidden cost price by including it.
 */
export function validatorFor(workspace, moduleKey, { partial = false, hidden = [] } = {}) {
  const cacheKey = `${workspace._id}:${workspace.metadataVersion}:${moduleKey}:${partial}:${hidden.join(',')}`;
  if (compiled.has(cacheKey)) return compiled.get(cacheKey);

  const module = moduleOf(workspace, moduleKey);
  const system = {};
  const custom = {};

  for (const field of module.fields) {
    if (field.readOnly || hidden.includes(field.key)) continue;
    // Hidden-by-configuration optional fields are still accepted, so turning a
    // field off never makes existing records fail to save.
    const target = field.custom ? custom : system;
    target[field.key] = fieldSchema(field, { partial });
  }

  const schema = z.object({
    ...system,
    // `prefault`, not `default`: zod 4's default skips validation, which let a
    // body with no `custom` key skip every required custom field. A partial
    // update leaves `custom` absent so the service merges rather than replaces.
    custom: partial ? z.object(custom).partial().optional() : z.object(custom).prefault({}),
  });

  if (compiled.size >= MAX_COMPILED) compiled.delete(compiled.keys().next().value);
  compiled.set(cacheKey, schema);
  return schema;
}

export function parseBody(workspace, moduleKey, body, options) {
  const result = validatorFor(workspace, moduleKey, options).safeParse(body ?? {});
  if (!result.success) {
    throw ApiError.badRequest('Some fields need attention.', result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })));
  }
  return result.data;
}

/** Text used for search: the title plus every short text-like value. */
export function searchTextOf(module, values) {
  const parts = [];
  for (const field of module.fields) {
    const value = field.custom ? values.custom?.[field.key] : values[field.key];
    if (value == null) continue;
    if (['text', 'email', 'phone', 'gstin', 'select'].includes(field.type)) parts.push(String(value));
    if (field.type === 'multiselect' && Array.isArray(value)) parts.push(value.join(' '));
  }
  return parts.join(' ').toLowerCase().slice(0, 2000);
}

// ── editing the metadata itself ───────────────────────────────────────────────

const optionShape = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(100),
  color: z.string().max(20).optional(),
});

export const fieldEditSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, 'Keys start with a letter and use letters, digits and _.'),
  label: z.string().trim().min(1).max(80),
  // Any type is accepted so system fields can be sent back as they were read;
  // `applyModuleEdit` restricts what a *custom* field may be.
  type: z.enum(FIELD_TYPES).optional(),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
  help: z.string().max(300).optional(),
  placeholder: z.string().max(120).optional(),
  section: z.string().max(60).optional(),
  printable: z.boolean().optional(),
  allowNew: z.boolean().optional(),
  options: z.array(optionShape).max(200).optional(),
  refModule: z.string().max(40).optional(),
  default: z.any().optional(),
  custom: z.boolean().optional(),
});

export const moduleEditSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  labelSingular: z.string().trim().min(1).max(60).optional(),
  icon: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
  enabled: z.boolean().optional(),
  group: z.string().max(40).optional(),
  titleField: z.string().max(40).optional(),
  boardField: z.string().max(40).nullable().optional(),
  customerLink: z.boolean().optional(),
  fields: z.array(fieldEditSchema).max(150).optional(),
});

/** Replaces one module's stored settings. Returns the new `modules` array. */
export function applyModuleEdit(workspace, key, edit) {
  const modules = [...(workspace.modules ?? [])];
  const index = modules.findIndex((m) => m.key === key);
  const existing = index >= 0 ? { ...modules[index] } : { key };
  const definition = coreModule(key);

  if (!definition && !existing.custom) throw ApiError.notFound('No such module.');
  if (definition && ['dashboard', 'settings', 'team'].includes(key) && edit.enabled === false) {
    throw ApiError.badRequest(`${definition.label} cannot be switched off.`);
  }

  const next = { ...existing };
  for (const prop of [...MODULE_PROPS, 'titleField', 'boardField', 'customerLink']) {
    if (edit[prop] !== undefined) next[prop] = edit[prop];
  }

  if (edit.fields) {
    const systemKeys = new Set((definition?.fields ?? []).map((f) => f.key));
    const seen = new Set();
    next.fields = edit.fields.map((f, order) => {
      if (seen.has(f.key)) throw ApiError.badRequest(`Two fields use the key "${f.key}".`);
      seen.add(f.key);
      if (systemKeys.has(f.key)) {
        const stored = { key: f.key, order };
        for (const prop of [...EDITABLE_FIELD_PROPS, 'required']) if (f[prop] !== undefined) stored[prop] = f[prop];
        stored.order = order;
        return stored;
      }
      if (!CUSTOM_FIELD_TYPES.includes(f.type)) throw ApiError.badRequest(`Choose a type for "${f.label}".`);
      if (f.type === 'reference' && !f.refModule) throw ApiError.badRequest(`Choose what "${f.label}" links to.`);
      return { ...f, custom: true, order };
    });

    // System fields that were left out keep their stored state; they cannot be deleted.
    for (const systemKey of systemKeys) {
      if (!seen.has(systemKey)) {
        const kept = (existing.fields ?? []).find((f) => f.key === systemKey) ?? { key: systemKey };
        next.fields.push({ ...kept, order: next.fields.length });
      }
    }
  }

  if (index >= 0) modules[index] = next; else modules.push(next);
  return modules;
}

export const moduleKeyFromLabel = (label) =>
  `c_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'module'}`;
