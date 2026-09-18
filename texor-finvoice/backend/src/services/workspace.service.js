/**
 * Creating a workspace from an industry pack, and the workspace-level reads the
 * app boots from.
 */
import mongoose from 'mongoose';
import Item from '../models/Item.js';
import Member from '../models/Member.js';
import Record from '../models/Record.js';
import User from '../models/User.js';
import Workspace from '../models/Workspace.js';
import ApiError from '../utils/ApiError.js';
import { INDUSTRIES, industry } from '../industries/index.js';
import { MODULE_GROUPS } from '../modules/registry.js';
import { india } from '../shared.js';
import { randomToken } from '../utils/ids.js';
import { effectiveModules } from './metadata.service.js';
import { defaultRoles, permissionMap } from './rbac.service.js';
import env from '../config/env.js';

/** The stored `modules` array a pack starts a workspace with. */
export function modulesFromPack(pack) {
  const byKey = new Map();
  const entry = (key) => {
    if (!byKey.has(key)) byKey.set(key, { key, fields: [] });
    return byKey.get(key);
  };

  for (const [key, settings] of Object.entries(pack.modules ?? {})) {
    if (key.startsWith('c_')) continue;
    Object.assign(entry(key), settings);
  }
  for (const [moduleKey, overrides] of Object.entries(pack.fieldOverrides ?? {})) {
    for (const [key, override] of Object.entries(overrides)) entry(moduleKey).fields.push({ key, ...override });
  }
  for (const [moduleKey, fields] of Object.entries(pack.fields ?? {})) {
    fields.forEach((f, i) => entry(moduleKey).fields.push({ ...f, custom: true, order: 1000 + i }));
  }
  for (const custom of pack.customModules ?? []) {
    const { fields, ...settings } = custom;
    byKey.set(custom.key, {
      ...settings,
      custom: true,
      enabled: true,
      order: pack.modules?.[custom.key]?.order ?? 50,
      fields: fields.map((f, i) => ({ ...f, custom: true, order: i })),
    });
  }
  return [...byKey.values()];
}

export function industryGallery() {
  return INDUSTRIES.map((pack) => {
    const preview = { _id: 'preview', edition: 'lite', metadataVersion: 0, modules: modulesFromPack(pack) };
    return {
      key: pack.key,
      name: pack.name,
      tagline: pack.tagline,
      icon: pack.icon,
      accent: pack.accent,
      highlights: pack.highlights,
      hasSample: Object.keys(pack.sample ?? {}).length > 0,
      sidebar: effectiveModules(preview)
        .filter((m) => m.enabled && m.edition === 'lite' && m.page !== false && !['team', 'settings'].includes(m.key))
        .map((m) => ({ key: m.key, label: m.label, icon: m.icon })),
    };
  });
}

const slugify = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'business';

async function uniqueSlug(name) {
  const base = slugify(name);
  if (!(await Workspace.exists({ slug: base }))) return base;
  return `${base}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)}`;
}

async function seedSample(pack, workspace, user, session) {
  const sample = pack.sample ?? {};
  const common = { workspace: workspace._id, createdBy: user._id, updatedBy: user._id };
  const items = [
    ...(sample.products ?? []).map((p) => ({ ...p, kind: 'product' })),
    ...(sample.services ?? []).map((s) => ({ ...s, kind: 'service' })),
  ].map((i) => ({
    ...common, unit: '',
    // Sample prices follow the pack's pricing convention unless an item says otherwise.
    taxRate: pack.preferences?.taxRate ?? 0,
    priceIncludesTax: pack.preferences?.priceIncludesTax ?? false,
    ...i, custom: i.custom ?? {},
    priceMinor: i.priceMinor ?? i.variants?.[0]?.priceMinor ?? 0,
    searchText: [i.name, i.category, i.sku, i.barcode].filter(Boolean).join(' ').toLowerCase(),
  }));
  const inserted = items.length ? await Item.insertMany(items, { session }) : [];

  // Packages come second: they point at the items above, which only have ids
  // once those are in. A pack names its components, and they are resolved here.
  const byName = new Map(inserted.map((i) => [i.name, i]));
  const packages = (sample.packages ?? []).map((pkg) => {
    const components = (pkg.components ?? [])
      .map(({ name, quantity = 1, variant = '' }) => {
        const part = byName.get(name);
        return part ? { item: part._id, variant, description: part.name, quantity, priceMinor: part.priceMinor } : null;
      })
      .filter(Boolean);
    return {
      ...common, kind: 'package', unit: '', custom: {},
      packagePricing: 'fixed', packageDiscountPct: 0, priceMinor: 0,
      ...pkg, components,
      searchText: [pkg.name, pkg.category].filter(Boolean).join(' ').toLowerCase(),
    };
  }).filter((pkg) => pkg.components.length);
  if (packages.length) await Item.insertMany(packages, { session });

  for (const [module, rows] of Object.entries(sample.records ?? {})) {
    const titleField = pack.customModules.find((m) => m.key === module)?.titleField;
    await Record.insertMany(rows.map((row) => ({
      ...common, module, custom: row, title: String(row[titleField] ?? ''), searchText: String(row[titleField] ?? '').toLowerCase(),
    })), { session });
  }
}

export async function createWorkspace(user, input) {
  const pack = industry(input.industry);
  if (!pack) throw ApiError.badRequest('Choose an industry.', [{ field: 'industry', message: 'Choose an industry.' }]);

  const gstin = india.normaliseGstin(input.gstin);
  const stateCode = india.stateFromGstin(gstin) || input.stateCode || '';

  const workspace = await mongoose.connection.transaction(async (session) => {
    const [created] = await Workspace.create([{
      slug: await uniqueSlug(input.name),
      name: input.name,
      legalName: input.legalName ?? '',
      industry: pack.key,
      owner: user._id,
      gstin,
      stateCode,
      address: { ...(input.address ?? {}), stateCode: input.address?.stateCode || stateCode },
      phone: input.phone ?? '',
      email: input.email ?? user.email,
      currency: input.currency ?? 'INR',
      branding: { accent: pack.accent },
      modules: modulesFromPack(pack),
      roles: defaultRoles(),
      preferences: structuredClone(pack.preferences),
    }], { session });

    await Member.create([{
      workspace: created._id, user: user._id, email: user.email, name: user.displayName, picture: user.picture,
      role: 'owner', status: 'active', joinedAt: new Date(),
    }], { session });

    if (input.sample) await seedSample(pack, created, user, session);
    await User.updateOne({ _id: user._id }, { lastWorkspace: created._id }, { session });
    return created;
  });

  return workspace;
}

/**
 * Accepts every pending invitation addressed to this person — but only when
 * Texor has verified that the address is theirs.
 */
export async function claimInvites(user) {
  if (!user.emailVerified || !user.email) return 0;
  const result = await Member.updateMany(
    { email: user.email.toLowerCase(), status: 'invited', user: null },
    { $set: { user: user._id, status: 'active', joinedAt: new Date(), name: user.displayName, picture: user.picture } },
  );
  return result.modifiedCount;
}

export async function listForUser(user) {
  await claimInvites(user);
  const memberships = await Member.find({ user: user._id, status: 'active' }).lean();
  const workspaces = await Workspace.find({ _id: { $in: memberships.map((m) => m.workspace) } })
    .select('slug name industry edition branding.logo branding.accent updatedAt').lean();
  const roleByWorkspace = new Map(memberships.map((m) => [String(m.workspace), m.role]));

  const pendingForUnverified = user.emailVerified ? 0 : await Member.countDocuments({ email: user.email, status: 'invited', user: null });

  return {
    workspaces: workspaces.map((w) => ({ ...w, role: roleByWorkspace.get(String(w._id)), industryName: industry(w.industry)?.name ?? w.industry })),
    lastWorkspace: user.lastWorkspace,
    unverifiedInvites: pendingForUnverified,
  };
}

/** Everything the app shell needs to draw the workspace for this member. */
export function bootstrap(workspace, member, user) {
  const modules = effectiveModules(workspace);
  const permissions = permissionMap(workspace, member, modules.map((m) => m.key));
  const visible = modules.filter((m) => m.enabled && (m.locked || permissions[m.key].actions.includes('view')));
  const role = (workspace.roles ?? []).find((r) => r.key === member.role);

  const { modules: _stored, roles: _roles, ...details } = workspace;

  return {
    workspace: details,
    modules: visible,
    groups: MODULE_GROUPS,
    permissions,
    hiddenFields: member.role === 'owner' ? {} : role?.hiddenFields ?? {},
    member: { _id: member._id, role: member.role, roleName: role?.name ?? member.role, name: member.name || user.displayName, email: member.email },
    features: { gmail: env.gmailEnabled },
    industry: (({ key, name, icon, accent }) => ({ key, name, icon, accent }))(industry(workspace.industry) ?? INDUSTRIES.at(-1)),
  };
}
