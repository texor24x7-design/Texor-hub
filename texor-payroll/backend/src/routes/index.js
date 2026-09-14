import { Router } from 'express';
import { attachSession, requireUser } from '../middleware/session.js';
import { validate } from '../middleware/validate.js';
import { handleCallback, logout, me, startLogin } from '../controllers/auth.controller.js';
import {
  createEmployee,
  deleteEmployee,
  employeePatchSchema,
  employeeSchema,
  getEmployee,
  listEmployees,
  updateEmployee,
} from '../controllers/employee.controller.js';
import {
  approvePayRun,
  createPayRun,
  deletePayRun,
  getPayRun,
  getSummary,
  listPayRuns,
  markPaid,
  payRunSchema,
  recalculatePayRun,
} from '../controllers/payrun.controller.js';

export function createApiRouter() {
  const router = Router();

  router.use(attachSession);

  router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'payroll' }));

  // ── Texor SSO ───────────────────────────────────────────────────────────────
  router.get('/auth/login', startLogin);
  router.get('/auth/callback', handleCallback);
  router.post('/auth/logout', logout);
  router.get('/auth/me', me);

  // ── Employees ───────────────────────────────────────────────────────────────
  router.use('/employees', requireUser);
  router.get('/employees', listEmployees);
  router.post('/employees', validate(employeeSchema), createEmployee);
  router.get('/employees/:id', getEmployee);
  router.patch('/employees/:id', validate(employeePatchSchema), updateEmployee);
  router.delete('/employees/:id', deleteEmployee);

  // ── Pay runs ────────────────────────────────────────────────────────────────
  router.use('/pay-runs', requireUser);
  router.get('/pay-runs', listPayRuns);
  router.post('/pay-runs', validate(payRunSchema), createPayRun);
  router.get('/pay-runs/:id', getPayRun);
  router.post('/pay-runs/:id/recalculate', recalculatePayRun);
  router.post('/pay-runs/:id/approve', approvePayRun);
  router.post('/pay-runs/:id/mark-paid', markPaid);
  router.delete('/pay-runs/:id', deletePayRun);

  router.get('/summary', requireUser, getSummary);

  return router;
}

export default createApiRouter;
