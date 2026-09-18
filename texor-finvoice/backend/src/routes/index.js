import express, { Router } from 'express';
import { attachSession, requireUser } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { authorize, loadWorkspace } from '../middleware/workspace.js';
import { handleCallback, logout, me, startLogin } from '../controllers/auth.controller.js';
import * as workspaces from '../controllers/workspace.controller.js';
import * as team from '../controllers/team.controller.js';
import * as records from '../controllers/record.controller.js';
import * as files from '../controllers/file.controller.js';
import * as docs from '../controllers/document.controller.js';
import * as designs from '../controllers/design.controller.js';
import * as integrations from '../controllers/integration.controller.js';
import { sendSchema, smtpSchema, whatsappSchema } from '../services/delivery.service.js';
import * as ops from '../controllers/operations.controller.js';
import { checkSchema, markSchema } from '../services/attendance.service.js';
import { claimSchema, claimUpdateSchema } from '../services/warranty.service.js';
import { designSchema } from '../services/design.service.js';
import { ALLOWED_TYPES } from '../services/file.service.js';
import { assertCan } from '../services/rbac.service.js';
import env from '../config/env.js';

const byParam = (req) => req.params.module;

export function createApiRouter() {
  const router = Router();

  router.use(attachSession);

  /**
   * Generous on purpose: these stop a runaway client or a scraper, not a person
   * working quickly. A signed-in caller is counted as themselves, everyone else
   * by IP — see `middleware/rateLimit.js`.
   */
  const limit = {
    auth: rateLimit({ name: 'auth', limit: 30, message: 'Too many sign-in attempts. Try again shortly.' }),
    publicDoc: rateLimit({ name: 'public-doc', limit: 120 }),
    publicPdf: rateLimit({ name: 'public-pdf', limit: 20, message: 'This document is being downloaded too often. Try again shortly.' }),
    file: rateLimit({ name: 'file', limit: 600 }),
    pdf: rateLimit({ name: 'pdf', limit: 60 }),
    deliver: rateLimit({ name: 'deliver', limit: 60, message: 'Too many sends in a row. Try again shortly.' }),
    upload: rateLimit({ name: 'upload', limit: 120 }),
    importing: rateLimit({ name: 'import', limit: 10, windowMs: 300_000, message: 'Imports are limited to ten every five minutes.' }),
  };

  router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'finvoice' }));

  // ── Texor SSO ───────────────────────────────────────────────────────────────
  router.get('/auth/login', limit.auth, startLogin);
  router.get('/auth/callback', limit.auth, handleCallback);
  router.post('/auth/logout', logout);
  router.get('/auth/me', me);

  // ── Public ──────────────────────────────────────────────────────────────────
  router.get('/files/:key', limit.file, files.download);
  router.get('/industries', workspaces.industries);
  router.get('/fonts/:file', designs.font);
  router.get('/integrations/gmail/callback', integrations.gmailCallback);
  router.get('/public/documents/:token', limit.publicDoc, docs.publicDocument);
  router.get('/public/documents/:token/html', limit.publicDoc, designs.publicHtml);
  router.get('/public/documents/:token/pdf', limit.publicPdf, designs.publicPdf);
  router.get('/public/warranties/:token', limit.publicDoc, ops.publicWarranty);

  // ── Workspaces ──────────────────────────────────────────────────────────────
  router.get('/workspaces', requireUser, workspaces.listWorkspaces);
  router.post('/workspaces', requireUser, validate(workspaces.createWorkspaceSchema), workspaces.create);

  const w = Router({ mergeParams: true });
  router.use('/w/:workspace', loadWorkspace, w);

  w.get('/', workspaces.show);
  w.patch('/settings/business', authorize('settings', 'edit'), validate(workspaces.businessSchema), workspaces.updateBusiness);
  w.patch('/settings/preferences', authorize('settings', 'edit'), validate(workspaces.preferencesSchema), workspaces.updatePreferences);
  w.put('/settings/edition', validate(workspaces.editionSchema), workspaces.setEdition);
  w.get('/settings/modules/all', authorize('settings', 'view'), workspaces.allModules);
  w.put('/settings/modules/order', authorize('settings', 'edit'), validate(workspaces.reorderSchema), workspaces.reorderModules);
  w.post('/settings/modules', authorize('settings', 'edit'), validate(workspaces.createModuleSchema), workspaces.createModule);
  w.put('/settings/modules/:key', authorize('settings', 'edit'), validate(workspaces.moduleEditSchema), workspaces.updateModule);
  w.delete('/settings/modules/:key', authorize('settings', 'edit'), workspaces.deleteModule);

  w.get('/activity', (req, _res, next) => {
    // A record's history is visible to whoever can see that module; the whole log is for settings viewers.
    assertCan(req.workspace, req.member, req.query.module && req.query.recordId ? String(req.query.module) : 'settings', 'view');
    next();
  }, workspaces.activity);

  w.get('/dashboard', authorize('dashboard', 'view'), ops.dashboard);
  w.get('/search', ops.search);

  // ── Team ────────────────────────────────────────────────────────────────────
  w.get('/team', authorize('team', 'view'), team.listMembers);
  w.post('/team/invites', authorize('team', 'edit'), validate(team.inviteSchema), team.invite);
  w.patch('/team/members/:id', authorize('team', 'edit'), validate(team.memberPatchSchema), team.updateMember);
  w.delete('/team/members/:id', authorize('team', 'edit'), team.removeMember);
  w.post('/team/roles', authorize('team', 'edit'), validate(team.roleSchema), team.createRole);
  w.put('/team/roles/:key', authorize('team', 'edit'), validate(team.roleSchema), team.updateRole);
  w.delete('/team/roles/:key', authorize('team', 'edit'), team.deleteRole);

  // ── Files ───────────────────────────────────────────────────────────────────
  w.post('/files', limit.upload, express.raw({ type: ALLOWED_TYPES, limit: env.uploadMaxBytes }), files.upload);

  // ── Catalogue helpers ───────────────────────────────────────────────────────
  w.get('/items', records.searchItems);
  w.get('/products/:id/stock', authorize('products', 'view'), records.stockMovements);
  w.post('/products/:id/stock', authorize('products', 'edit'), validate(records.adjustStockSchema), records.adjustStock);

  // ── Attendance ──────────────────────────────────────────────────────────────
  w.get('/attendance/me', ops.me);
  w.post('/attendance/me/check-in', validate(checkSchema), ops.checkIn);
  w.post('/attendance/me/check-out', validate(checkSchema), ops.checkOut);
  w.get('/attendance/day', authorize('staff', 'view'), ops.day);
  w.get('/attendance/register', authorize('staff', 'view'), ops.register);
  w.get('/attendance/register/export', authorize('staff', 'export'), ops.registerCsv);
  w.put('/attendance/:staff/:date', authorize('staff', 'approve'), validate(markSchema), ops.mark);

  // ── Warranty claims ─────────────────────────────────────────────────────────
  w.post('/warranties/:id/claims', authorize('warranties', 'edit'), validate(claimSchema), ops.addClaim);
  w.patch('/warranties/:id/claims/:claim', authorize('warranties', 'approve'), validate(claimUpdateSchema), ops.updateClaim);
  w.post('/warranties/:id/void', authorize('warranties', 'approve'), ops.voidWarranty);
  w.post('/warranties/:id/share', authorize('warranties', 'view'), ops.shareWarranty);

  // ── Record modules (customers, products, services, warranties, staff, custom) ──
  w.get('/records/:module', authorize(byParam, 'view'), records.list);
  w.get('/records/:module/export', authorize(byParam, 'export'), records.exportCsv);
  w.post('/records/:module/import', limit.importing, authorize(byParam, 'create'), validate(records.importSchema), records.importRows);
  w.post('/records/:module', authorize(byParam, 'create'), records.create);
  w.get('/records/:module/:id', authorize(byParam, 'view'), records.get);
  w.patch('/records/:module/:id', authorize(byParam, 'edit'), records.update);
  w.delete('/records/:module/:id', authorize(byParam, 'delete'), records.remove);

  // ── Quotations & invoices ───────────────────────────────────────────────────
  const docKind = (req, _res, next) => (['invoices', 'quotations'].includes(req.params.kind) ? next() : next('route'));
  const kindParam = (req) => req.params.kind;
  w.get('/documents/:kind', docKind, authorize(kindParam, 'view'), docs.list);
  w.post('/documents/:kind', docKind, authorize(kindParam, 'create'), docs.create);
  w.get('/documents/:kind/:id', docKind, authorize(kindParam, 'view'), docs.get);
  w.patch('/documents/:kind/:id', docKind, authorize(kindParam, 'edit'), docs.update);
  w.delete('/documents/:kind/:id', docKind, authorize(kindParam, 'delete'), docs.remove);

  w.get('/documents/:kind/:id/html', docKind, authorize(kindParam, 'view'), designs.html);
  w.get('/documents/:kind/:id/pdf', limit.pdf, docKind, authorize(kindParam, 'view'), designs.pdf);

  w.get('/documents/:kind/:id/compose', docKind, authorize(kindParam, 'view'), integrations.compose);
  w.post('/documents/:kind/:id/deliver', limit.deliver, docKind, authorize(kindParam, 'view'), validate(sendSchema), integrations.send);
  w.get('/documents/:kind/:id/deliveries', docKind, authorize(kindParam, 'view'), integrations.deliveries);

  // ── Integrations ────────────────────────────────────────────────────────────
  w.get('/integrations', integrations.list);
  w.get('/integrations/gmail/connect', integrations.connectGmail);
  w.put('/integrations/smtp', authorize('settings', 'edit'), validate(smtpSchema), integrations.saveSmtp);
  w.put('/integrations/whatsapp', authorize('settings', 'edit'), validate(whatsappSchema), integrations.saveWhatsapp);
  w.delete('/integrations/:id', integrations.remove);

  // ── Designs ─────────────────────────────────────────────────────────────────
  w.get('/designs', designs.list);
  w.put('/designs/:key', authorize('settings', 'edit'), validate(designSchema), designs.save);
  w.post('/designs/:key/duplicate', authorize('settings', 'edit'), designs.duplicate);
  w.delete('/designs/:key', authorize('settings', 'edit'), designs.remove);

  w.post('/documents/invoices/:id/issue', authorize('invoices', 'approve'), docs.issue);
  w.post('/documents/invoices/:id/void', authorize('invoices', 'approve'), validate(docs.voidSchema), docs.voidInvoice);
  w.post('/documents/quotations/:id/:action', authorize('quotations', 'approve'), docs.quotationAction);
  w.post('/records/:module/:id/invoice', authorize(byParam, 'view'), docs.fromRecord);

  // ── Payments ────────────────────────────────────────────────────────────────
  w.get('/payments', authorize('payments', 'view'), docs.listPayments);
  w.post('/documents/invoices/:id/payments', authorize('payments', 'create'), docs.recordPayment);
  w.delete('/payments/:id', authorize('payments', 'delete'), docs.deletePayment);

  return router;
}

export default createApiRouter;
