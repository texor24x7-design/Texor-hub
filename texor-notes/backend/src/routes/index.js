import { Router } from 'express';
import { attachSession } from '../middleware/session.js';
import { handleCallback, logout, me, startLogin } from '../controllers/auth.controller.js';

export function createApiRouter() {
  const router = Router();

  router.use(attachSession);

  router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notes' }));

  // ── Texor SSO ───────────────────────────────────────────────────────────────
  router.get('/auth/login', startLogin);
  router.get('/auth/callback', handleCallback);
  router.post('/auth/logout', logout);
  router.get('/auth/me', me);

  return router;
}

export default createApiRouter;
