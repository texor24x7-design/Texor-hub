import { Router } from 'express';
import { attachSession, requireUser } from '../middleware/session.js';
import { validate } from '../middleware/validate.js';
import { handleCallback, logout, me, startLogin } from '../controllers/auth.controller.js';
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  getSummary,
  invoicePatchSchema,
  invoiceSchema,
  listInvoices,
  listQuerySchema,
  updateInvoice,
} from '../controllers/invoice.controller.js';

export function createApiRouter() {
  const router = Router();

  router.use(attachSession);

  router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'finvoice' }));

  // ── Texor SSO ───────────────────────────────────────────────────────────────
  router.get('/auth/login', startLogin);
  router.get('/auth/callback', handleCallback);
  router.post('/auth/logout', logout);
  router.get('/auth/me', me);

  // ── Invoices ────────────────────────────────────────────────────────────────
  router.use('/invoices', requireUser);
  router.get('/invoices', validate(listQuerySchema, 'query'), listInvoices);
  router.post('/invoices', validate(invoiceSchema), createInvoice);
  router.get('/invoices/:id', getInvoice);
  router.patch('/invoices/:id', validate(invoicePatchSchema), updateInvoice);
  router.delete('/invoices/:id', deleteInvoice);

  router.get('/summary', requireUser, getSummary);

  return router;
}

export default createApiRouter;
