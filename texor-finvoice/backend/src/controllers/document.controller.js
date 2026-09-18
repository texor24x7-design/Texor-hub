import { z } from 'zod';
import * as documents from '../services/document.service.js';
import { stateName } from '../../../frontend/src/lib/shared/india.mjs';
import ApiError from '../utils/ApiError.js';
import Workspace from '../models/Workspace.js';
import { effectiveModules } from '../services/metadata.service.js';

const kindOf = (req) => req.params.kind;

export const list = async (req, res) => res.json(await documents.list(req, kindOf(req), req.query));
export const get = async (req, res) => res.json(await documents.get(req, kindOf(req), req.params.id));
export const create = async (req, res) => res.status(201).json({ document: await documents.create(req, kindOf(req), req.body) });
export const update = async (req, res) => res.json({ document: await documents.update(req, kindOf(req), req.params.id, req.body) });

export async function remove(req, res) {
  await documents.remove(req, kindOf(req), req.params.id);
  res.json({ ok: true });
}

export const issue = async (req, res) => res.json({ document: await documents.issueInvoice(req, req.params.id) });
export const issueNote = async (req, res) => res.json({ document: await documents.issueNote(req, req.params.kind, req.params.id) });
export const noteFromInvoice = async (req, res) => res.status(201).json({ document: await documents.noteFromInvoice(req, req.params.kind, req.params.id) });

export const voidSchema = z.object({ reason: z.string().trim().max(300).default('') });
export const voidInvoice = async (req, res) => res.json({ document: await documents.voidInvoice(req, req.params.id, req.body.reason) });

export async function quotationAction(req, res) {
  const { action } = req.params;
  if (action === 'convert') return res.status(201).json({ document: await documents.convertQuotation(req, req.params.id) });
  if (!['send', 'accept', 'decline'].includes(action)) throw ApiError.notFound('Unknown action.');
  return res.json({ document: await documents.transitionQuotation(req, req.params.id, action) });
}

export const fromRecord = async (req, res) => res.status(201).json({ document: await documents.invoiceFromRecord(req, req.params.module, req.params.id) });

export const recordPayment = async (req, res) => res.status(201).json(await documents.recordPayment(req, req.params.id, req.body));
export const deletePayment = async (req, res) => res.json(await documents.deletePayment(req, req.params.id));
export const listPayments = async (req, res) => res.json(await documents.listPayments(req, req.query));

/**
 * A document by its public token — what a customer opens from WhatsApp or
 * email. Returns only what is printed, plus the design and labels to print it.
 * Drafts and deleted documents are not reachable this way.
 */
export async function publicDocument(req, res) {
  const found = await documents.findPublic(req.params.token);
  if (!found || (found.kind === 'invoices' && found.doc.status === 'draft')) throw ApiError.notFound('This link is no longer available.');
  const { kind, doc } = found;

  const workspace = await Workspace.findById(doc.workspace).lean();
  if (!workspace) throw ApiError.notFound('This link is no longer available.');
  const modules = effectiveModules(workspace);
  const labels = (key) => {
    const m = modules.find((x) => x.key === key);
    return { label: m.label, labelSingular: m.labelSingular, fields: m.fields.filter((f) => !f.hidden).map(({ key: k, label, type, custom, printable, options }) => ({ key: k, label, type, custom, printable, options })) };
  };

  const { workspace: _w, createdBy, updatedBy, searchText, deletedAt, publicToken, paymentLink, ...document } = doc;
  const due = kind === 'invoices' ? documents.amountDue(doc) : 0;
  // Only offer the link while it is still for the right amount; a part payment
  // since it was raised would otherwise ask the customer for too much.
  document.payUrl = paymentLink?.url && due > 0 && paymentLink.amountMinor === due ? paymentLink.url : null;
  res.set('cache-control', 'private, no-store');
  res.set('x-robots-tag', 'noindex');
  res.json({
    kind,
    document: { ...document, state: documents.documentState(kind, doc), amountDueMinor: kind === 'invoices' ? documents.amountDue(doc) : undefined },
    module: labels(kind),
    lines: labels('lines'),
    business: {
      name: workspace.name, legalName: workspace.legalName, gstin: workspace.gstin, stateCode: workspace.stateCode, stateName: stateName(workspace.stateCode),
      address: workspace.address, phone: workspace.phone, email: workspace.email, website: workspace.website, pan: workspace.pan,
      branding: workspace.branding, bank: workspace.bank, currency: workspace.currency, locale: workspace.locale, industry: workspace.industry,
    },
    design: workspace.preferences?.designs?.[doc.design] ?? null,
    designKey: doc.design,
  });
}
