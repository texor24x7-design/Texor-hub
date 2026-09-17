import { z } from 'zod';
import User from '../models/User.js';
import Workspace from '../models/Workspace.js';
import AuditEvent from '../models/AuditEvent.js';
import ApiError from '../utils/ApiError.js';
import { india } from '../shared.js';
import { record as audit } from '../services/audit.service.js';
import {
  applyModuleEdit, effectiveModules, fieldEditSchema, moduleKeyFromLabel,
} from '../services/metadata.service.js';
export { moduleEditSchema } from '../services/metadata.service.js';
import { bootstrap, createWorkspace, industryGallery, listForUser } from '../services/workspace.service.js';
import { coreModule } from '../modules/registry.js';
import mongoose from 'mongoose';

const address = z.object({
  line1: z.string().max(200).default(''),
  line2: z.string().max(200).default(''),
  city: z.string().max(100).default(''),
  stateCode: z.string().refine((v) => v === '' || india.isStateCode(v), 'Choose a state.').default(''),
  pincode: z.string().max(10).default(''),
  country: z.string().length(2).default('IN'),
});

const gstin = z.string().transform(india.normaliseGstin).superRefine((v, ctx) => {
  const message = india.gstinError(v);
  if (message) ctx.addIssue({ code: 'custom', message });
});

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, 'What is your business called?').max(120),
  legalName: z.string().trim().max(160).optional(),
  industry: z.string().min(1, 'Choose an industry.'),
  gstin: gstin.optional(),
  stateCode: z.string().refine((v) => v === '' || india.isStateCode(v), 'Choose a state.').optional(),
  address: address.optional(),
  phone: z.string().max(20).optional(),
  email: z.union([z.email('Enter a valid email address.'), z.literal('')]).optional(),
  currency: z.string().length(3).optional(),
  sample: z.boolean().default(false),
});

export const industries = (_req, res) => res.json({ industries: industryGallery() });

export async function listWorkspaces(req, res) {
  res.json(await listForUser(req.user));
}

export async function create(req, res) {
  const workspace = await createWorkspace(req.user, req.body);
  res.status(201).json({ workspace: { _id: workspace._id, slug: workspace.slug, name: workspace.name } });
}

export async function show(req, res) {
  if (String(req.user.lastWorkspace) !== String(req.workspace._id)) {
    await User.updateOne({ _id: req.user._id }, { lastWorkspace: req.workspace._id });
  }
  res.json(bootstrap(req.workspace, req.member, req.user));
}

// ── business profile & preferences ────────────────────────────────────────────

const imageKey = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).nullable();

export const businessSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160),
  gstin: gstin,
  stateCode: z.string().refine((v) => v === '' || india.isStateCode(v), 'Choose a state.'),
  pan: z.string().trim().toUpperCase().regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, 'Enter a valid PAN.'),
  address,
  phone: z.string().max(20),
  email: z.union([z.email('Enter a valid email address.'), z.literal('')]),
  website: z.union([z.url('Enter a full link, starting with https://'), z.literal('')]),
  currency: z.string().length(3),
  fyStartMonth: z.number().int().min(1).max(12),
  branding: z.object({ logo: imageKey, photo: imageKey, signature: imageKey, accent: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).partial(),
  bank: z.object({
    accountName: z.string().max(120), accountNumber: z.string().max(34), ifsc: z.string().toUpperCase().regex(/^([A-Z]{4}0[A-Z0-9]{6})?$/, 'Enter a valid IFSC.'),
    bankName: z.string().max(120), branch: z.string().max(120), upiId: z.string().regex(/^([\w.-]{2,256}@[a-zA-Z]{2,64})?$/, 'Enter a UPI ID like name@bank.'),
  }).partial(),
  /** Sent once, by the last onboarding step. */
  onboarded: z.literal(true),
}).partial();

export async function updateBusiness(req, res) {
  const { branding, bank, onboarded, ...rest } = req.body;
  const $set = { ...rest };
  if (rest.gstin && !rest.stateCode) $set.stateCode = india.stateFromGstin(rest.gstin);
  for (const [key, value] of Object.entries(branding ?? {})) $set[`branding.${key}`] = value;
  for (const [key, value] of Object.entries(bank ?? {})) $set[`bank.${key}`] = value;
  if (onboarded) $set.onboardedAt = new Date();

  const workspace = await Workspace.findByIdAndUpdate(req.workspace._id, { $set }, { returnDocument: 'after' }).lean();
  await audit(req, { action: 'settings.business', module: 'settings', summary: 'Updated business profile', metadata: { fields: Object.keys($set) } });
  res.json(bootstrap(workspace, req.member, req.user));
}

export const preferencesSchema = z.object({
  taxRate: z.number().min(0).max(100),
  priceIncludesTax: z.boolean(),
  units: z.array(z.string().trim().min(1).max(30)).max(50),
  paymentModes: z.array(z.string().trim().min(1).max(40)).min(1, 'Keep at least one payment mode.').max(30),
  designations: z.array(z.string().trim().min(1).max(40)).max(50),
  numbering: z.object({
    // GST caps an invoice number at 16 characters: PREFX/26-27/0001 is 16.
    invoices: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{0,5}$/, 'Up to 5 letters, digits or hyphens.'),
    quotations: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{0,5}$/, 'Up to 5 letters, digits or hyphens.'),
  }).partial(),
  dueDays: z.number().int().min(0).max(365),
  validityDays: z.number().int().min(0).max(365),
  terms: z.string().max(4000),
  quotationTerms: z.string().max(4000),
  roundOff: z.boolean(),
  design: z.string().max(40),
  dashboard: z.array(z.string().max(60)).max(20),
  walkInCustomer: z.string().max(60),
  messages: z.record(z.string(), z.string().max(2000)),
}).partial();

export async function updatePreferences(req, res) {
  const $set = Object.fromEntries(Object.entries(req.body).map(([key, value]) => [`preferences.${key}`, value]));
  const workspace = await Workspace.findByIdAndUpdate(req.workspace._id, { $set }, { returnDocument: 'after' }).lean();
  await audit(req, { action: 'settings.preferences', module: 'settings', summary: 'Updated preferences', metadata: { fields: Object.keys(req.body) } });
  res.json(bootstrap(workspace, req.member, req.user));
}

export const editionSchema = z.object({ edition: z.enum(['lite', 'pro']) });

export async function setEdition(req, res) {
  if (req.member.role !== 'owner') throw ApiError.forbidden('Only the owner can change the edition.');
  const { edition } = req.body;
  const workspace = await Workspace.findByIdAndUpdate(req.workspace._id, { edition, $inc: { metadataVersion: 1 } }, { returnDocument: 'after' }).lean();
  await audit(req, { action: 'settings.edition', module: 'settings', summary: `Switched to Finvoice ${edition === 'pro' ? 'Pro' : 'Lite'}` });
  res.json(bootstrap(workspace, req.member, req.user));
}

// ── modules & fields ──────────────────────────────────────────────────────────

/**
 * Writes `modules` only if nobody else changed them since this request read the
 * workspace — two admins editing fields at once get a conflict, not a silent
 * overwrite of one person's work.
 */
async function saveModules(req, modules) {
  const workspace = await Workspace.findOneAndUpdate(
    { _id: req.workspace._id, metadataVersion: req.workspace.metadataVersion },
    { $set: { modules }, $inc: { metadataVersion: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!workspace) throw ApiError.conflict('Someone else changed these settings a moment ago. Reload and try again.');
  return workspace;
}

/** Every module, including switched-off ones, for the settings screens. */
export const allModules = (req, res) => res.json({ modules: effectiveModules(req.workspace) });

export async function updateModule(req, res) {
  const edit = req.body;
  const modules = applyModuleEdit(req.workspace, req.params.key, edit);
  const workspace = await saveModules(req, modules);
  await audit(req, { action: 'settings.module', module: req.params.key, summary: `Updated the ${req.params.key} module`, metadata: { props: Object.keys(edit) } });
  res.json(bootstrap(workspace, req.member, req.user));
}

export const reorderSchema = z.object({
  modules: z.array(z.object({ key: z.string().max(40), order: z.number().int(), group: z.string().max(40).optional() })).max(100),
});

export async function reorderModules(req, res) {
  const known = new Set(effectiveModules(req.workspace).map((m) => m.key));
  const modules = [...(req.workspace.modules ?? [])];
  for (const { key, order, group } of req.body.modules) {
    if (!known.has(key)) continue;
    const index = modules.findIndex((m) => m.key === key);
    const next = { ...(index >= 0 ? modules[index] : { key }), order, ...(group ? { group } : {}) };
    if (index >= 0) modules[index] = next; else modules.push(next);
  }
  const workspace = await saveModules(req, modules);
  res.json(bootstrap(workspace, req.member, req.user));
}

export const createModuleSchema = z.object({
  label: z.string().trim().min(1).max(60),
  labelSingular: z.string().trim().min(1).max(60),
  icon: z.string().regex(/^[a-z0-9-]{1,60}$/).default('blocks'),
  group: z.string().max(40).default('operations'),
  customerLink: z.boolean().default(false),
  fields: z.array(fieldEditSchema).max(150).default([]),
});

export async function createModule(req, res) {
  const input = req.body;
  let key = moduleKeyFromLabel(input.label);
  const existing = new Set(effectiveModules(req.workspace).map((m) => m.key));
  for (let n = 2; existing.has(key); n += 1) key = `${moduleKeyFromLabel(input.label)}_${n}`;

  const fields = input.fields.length ? input.fields : [{ key: 'name', label: 'Name', type: 'text', required: true }];
  const modules = [...(req.workspace.modules ?? []), {
    key, custom: true, enabled: true, label: input.label, labelSingular: input.labelSingular, icon: input.icon,
    group: input.group, customerLink: input.customerLink, order: 55, titleField: fields[0].key,
    fields: fields.map((f, order) => ({ ...f, custom: true, order })),
  }];
  const workspace = await saveModules(req, modules);
  await audit(req, { action: 'settings.module_created', module: key, summary: `Created the ${input.label} module` });
  res.status(201).json({ key, ...bootstrap(workspace, req.member, req.user) });
}

export async function deleteModule(req, res) {
  if (coreModule(req.params.key)) throw ApiError.badRequest('Built-in modules can be switched off, not deleted.');
  const modules = (req.workspace.modules ?? []).filter((m) => m.key !== req.params.key);
  if (modules.length === (req.workspace.modules ?? []).length) throw ApiError.notFound('No such module.');
  // Records stay in the database (soft-deleted with the module) so an accident is recoverable by support.
  await mongoose.model('Record').updateMany({ workspace: req.workspace._id, module: req.params.key, deletedAt: null }, { deletedAt: new Date() });
  const workspace = await saveModules(req, modules);
  await audit(req, { action: 'settings.module_deleted', module: req.params.key, summary: `Deleted the ${req.params.key} module` });
  res.json(bootstrap(workspace, req.member, req.user));
}

// ── activity ──────────────────────────────────────────────────────────────────

export async function activity(req, res) {
  const filter = { workspace: req.workspace._id };
  if (req.query.recordId && mongoose.isValidObjectId(req.query.recordId)) filter.recordId = req.query.recordId;
  if (req.query.module) filter.module = String(req.query.module);
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  if (before && !Number.isNaN(before.getTime())) filter.at = { $lt: before };
  const events = await AuditEvent.find(filter).sort({ at: -1 }).limit(50).lean();
  res.json({ events });
}

