import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import Workspace from '../models/Workspace.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { BUILTIN_DESIGNS, cloneDesign } from '../../../frontend/src/lib/shared/designs.mjs';
import { record as audit } from '../services/audit.service.js';
import * as documents from '../services/document.service.js';
import { designsOf, pdfFilename, renderInput, toHtml, toPdf } from '../services/design.service.js';
import { bootstrap } from '../services/workspace.service.js';

export const list = (req, res) => res.json({ designs: designsOf(req.workspace), defaultDesign: req.workspace.preferences?.design ?? 'classic' });

export async function save(req, res) {
  const key = req.params.key;
  if (!/^[a-z0-9_-]{1,40}$/.test(key)) throw ApiError.badRequest('Invalid design key.');
  const workspace = await Workspace.findByIdAndUpdate(req.workspace._id, { $set: { [`preferences.designs.${key}`]: { ...req.body, key } } }, { returnDocument: 'after' }).lean();
  await audit(req, { action: 'settings.design', module: 'settings', summary: `Saved the ${req.body.name} design` });
  res.json({ designs: designsOf(workspace), ...bootstrap(workspace, req.member, req.user) });
}

export async function duplicate(req, res) {
  const source = designsOf(req.workspace).find((d) => d.key === req.params.key);
  if (!source) throw ApiError.notFound('Design not found.');
  const key = `custom_${Date.now().toString(36)}`;
  const { builtin, edited, ...design } = cloneDesign(source);
  const copy = { ...design, key, name: `${source.name} copy`.slice(0, 60) };
  const workspace = await Workspace.findByIdAndUpdate(req.workspace._id, { $set: { [`preferences.designs.${key}`]: copy } }, { returnDocument: 'after' }).lean();
  res.status(201).json({ key, designs: designsOf(workspace) });
}

/** Deleting a built-in resets it; deleting a custom design removes it. */
export async function remove(req, res) {
  const key = req.params.key;
  if (!/^[a-z0-9_-]{1,40}$/.test(key)) throw ApiError.badRequest('Invalid design key.');
  const update = { $unset: { [`preferences.designs.${key}`]: '' } };
  if (!BUILTIN_DESIGNS[key] && req.workspace.preferences?.design === key) update.$set = { 'preferences.design': 'classic' };
  const workspace = await Workspace.findByIdAndUpdate(req.workspace._id, update, { returnDocument: 'after' }).lean();
  res.json({ designs: designsOf(workspace), ...bootstrap(workspace, req.member, req.user) });
}

async function loadForRender(req) {
  const { document } = await documents.get(req, req.params.kind, req.params.id);
  return renderInput(req.workspace, req.params.kind, document, { designKey: req.query.design ? String(req.query.design) : undefined });
}

export async function html(req, res) {
  const input = await loadForRender(req);
  res.set('content-type', 'text/html; charset=utf-8');
  res.set('content-security-policy', "default-src 'none'; img-src 'self' data: " + env.apiOrigin + "; style-src 'unsafe-inline'; font-src " + env.apiOrigin);
  res.send(toHtml(input, `${env.apiOrigin}/api`));
}

export async function pdf(req, res) {
  const input = await loadForRender(req);
  sendPdf(res, await toPdf(input), pdfFilename(req.params.kind, input.document, req.workspace), req.query.download === '1');
}

export async function publicPdf(req, res) {
  const found = await documents.findPublic(req.params.token);
  if (!found || (found.kind === 'invoices' && found.doc.status === 'draft')) throw ApiError.notFound('This link is no longer available.');
  const workspace = await Workspace.findById(found.doc.workspace).lean();
  const input = await renderInput(workspace, found.kind, found.doc);
  sendPdf(res, await toPdf(input), pdfFilename(found.kind, found.doc, workspace), req.query.download === '1');
}

export async function publicHtml(req, res) {
  const found = await documents.findPublic(req.params.token);
  if (!found || (found.kind === 'invoices' && found.doc.status === 'draft')) throw ApiError.notFound('This link is no longer available.');
  const workspace = await Workspace.findById(found.doc.workspace).lean();
  const input = await renderInput(workspace, found.kind, { ...found.doc, state: documents.documentState(found.kind, found.doc) });
  res.set('content-type', 'text/html; charset=utf-8');
  res.set('content-security-policy', "default-src 'none'; img-src 'self' data: " + env.apiOrigin + "; style-src 'unsafe-inline'; font-src " + env.apiOrigin);
  res.set('x-robots-tag', 'noindex');
  res.send(toHtml(input, `${env.apiOrigin}/api`));
}

function sendPdf(res, buffer, filename, download) {
  res.set({
    'content-type': 'application/pdf',
    'content-length': String(buffer.length),
    'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    'cache-control': 'private, no-store',
    'cross-origin-resource-policy': 'cross-origin',
  });
  res.send(buffer);
}

// ── fonts ─────────────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
const FONT_DIRS = ['inter', 'source-serif-4', 'jetbrains-mono'].map((name) => path.join(path.dirname(require.resolve(`@fontsource/${name}/package.json`)), 'files'));

export function font(req, res) {
  const file = req.params.file;
  if (!/^[a-z0-9-]+-(latin|latin-ext)-(400|700)-normal\.woff2$/.test(file)) throw ApiError.notFound('Font not found.');
  const found = FONT_DIRS.map((dir) => path.join(dir, file)).find((candidate) => fs.existsSync(candidate));
  if (!found) throw ApiError.notFound('Font not found.');
  res.set({ 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' });
  fs.createReadStream(found).pipe(res);
}
