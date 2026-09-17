/**
 * Document designs a workspace can use, and turning a document into HTML or PDF
 * with one of them.
 */
import QRCode from 'qrcode';
import { z } from 'zod';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { BLOCK_TYPES, BUILTIN_DESIGNS, CONDITIONS, FONTS, PAGE_SIZES, cloneDesign } from '../../../frontend/src/lib/shared/designs.mjs';
import { renderDocument, upiLink } from '../../../frontend/src/lib/shared/render.mjs';
import { effectiveModules } from './metadata.service.js';
import { resolveRefs } from './record.service.js';
import { htmlToPdf } from './pdf.service.js';

export function designsOf(workspace) {
  const saved = workspace.preferences?.designs ?? {};
  const builtins = Object.values(BUILTIN_DESIGNS).map((d) => ({ ...(saved[d.key] ?? cloneDesign(d)), key: d.key, builtin: true, edited: Boolean(saved[d.key]) }));
  const custom = Object.entries(saved).filter(([key]) => !BUILTIN_DESIGNS[key]).map(([key, d]) => ({ ...d, key, builtin: false, edited: true }));
  return [...builtins, ...custom];
}

export function resolveDesign(workspace, key) {
  const saved = workspace.preferences?.designs ?? {};
  const chosen = key || workspace.preferences?.design || 'classic';
  return saved[chosen] ?? BUILTIN_DESIGNS[chosen] ?? BUILTIN_DESIGNS.classic;
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const style = z.object({
  align: z.enum(['left', 'center', 'right']).optional(),
  fontSize: z.number().min(5).max(40).optional(),
  color: hex.optional(),
  background: hex.optional(),
  bold: z.boolean().optional(),
  uppercase: z.boolean().optional(),
  paddingX: z.number().min(0).max(40).optional(),
  paddingY: z.number().min(0).max(40).optional(),
  marginTop: z.number().min(0).max(60).optional(),
  borderTop: z.boolean().optional(),
  borderBottom: z.boolean().optional(),
  dashed: z.boolean().optional(),
}).partial();

const blockShape = z.lazy(() => z.object({
  id: z.string().max(80),
  type: z.enum(BLOCK_TYPES),
  props: z.record(z.string(), z.any()).default({}),
  style: style.default({}),
  when: z.enum(CONDITIONS.map((c) => c.value)).default(''),
  children: z.array(z.array(blockShape).max(20)).max(4).optional(),
}));

export const designSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(200).default(''),
  page: z.object({
    size: z.enum(PAGE_SIZES.map((s) => s.value)),
    margin: z.number().min(0).max(30),
    font: z.enum(FONTS.map((f) => f.value)),
    fontSize: z.number().min(6).max(14),
    accent: z.union([hex, z.literal('brand')]),
    text: hex,
    muted: hex,
    border: hex,
  }),
  blocks: z.array(blockShape).max(60),
}).refine((d) => JSON.stringify(d).length < 60000, 'This design is too large.');

/** Everything `renderDocument` needs, for a stored document. */
export async function renderInput(workspace, kind, document, { designKey } = {}) {
  const modules = effectiveModules(workspace);
  const pick = (key) => {
    const m = modules.find((x) => x.key === key);
    return { label: m.label, labelSingular: m.labelSingular, fields: m.fields };
  };
  const module = pick(kind);

  // Printable reference fields (a table, a project) need their titles.
  const refModule = { fields: module.fields.filter((f) => f.custom && f.type === 'reference') };
  const refs = await resolveRefs(workspace._id, refModule, [document]);

  const seller = document.seller?.name ? document.seller : { name: workspace.name, bank: workspace.bank };
  const amountDue = kind === 'invoices' ? Math.max(document.totals.totalMinor - (document.amountPaidMinor ?? 0), 0) : document.totals.totalMinor;
  const link = kind === 'invoices' && document.status !== 'draft'
    ? upiLink({ upiId: seller.bank?.upiId ?? workspace.bank?.upiId, payee: seller.legalName || seller.name, amountMinor: amountDue, reference: document.number, currency: document.currency })
    : null;
  const upiQr = link ? await QRCode.toDataURL(link, { margin: 0, width: 240, errorCorrectionLevel: 'M' }) : null;

  const api = `http://127.0.0.1:${env.PORT}/api`;
  return {
    design: resolveDesign(workspace, designKey ?? document.design),
    kind,
    document,
    business: {
      name: workspace.name, legalName: workspace.legalName, gstin: workspace.gstin, stateCode: workspace.stateCode, address: workspace.address,
      phone: workspace.phone, email: workspace.email, website: workspace.website, pan: workspace.pan,
      branding: workspace.branding, bank: workspace.bank, currency: workspace.currency, locale: workspace.locale,
    },
    module,
    lines: pick('lines'),
    refs,
    assets: { upiQr },
    apiBase: api,
  };
}

/** HTML for a browser: assets resolve against the public API origin. */
export function toHtml(input, publicApiBase) {
  return renderDocument({ ...input, assets: { ...input.assets, fileUrl: (key) => `${publicApiBase}/files/${encodeURIComponent(key)}`, fontBase: `${publicApiBase}/fonts` } });
}

export async function toPdf(input) {
  const html = renderDocument({ ...input, assets: { ...input.assets, fileUrl: (key) => `${input.apiBase}/files/${encodeURIComponent(key)}`, fontBase: `${input.apiBase}/fonts` } });
  const size = PAGE_SIZES.find((s) => s.value === input.design.page?.size);
  try {
    return await htmlToPdf(html, { allowedOrigin: input.apiBase, thermalWidthMm: size?.height === null ? size.width : null });
  } catch (error) {
    throw new ApiError(503, 'pdf_unavailable', `The PDF could not be generated right now (${error.message.split('\n')[0]}).`);
  }
}

export const pdfFilename = (kind, document, workspace) => `${(document.number ?? `draft-${kind.slice(0, -1)}`).replace(/[^\w-]+/g, '-')}-${workspace.name.replace(/[^\w-]+/g, '-')}.pdf`.slice(0, 120);
