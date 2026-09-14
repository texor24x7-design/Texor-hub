import { Router } from 'express';
import { attachSession } from '../middleware/session.js';
import { apiLimiter } from '../middleware/rateLimit.js';
import createAuthRoutes from './auth.routes.js';
import createInteractionRoutes from './interaction.routes.js';
import createAccountRoutes from './account.routes.js';
import createAdminRoutes from './admin.routes.js';
import createConsoleRoutes from './console.routes.js';

/**
 * All application routes live under /api. Everything under /oidc belongs to
 * oidc-provider and is mounted separately in app.js.
 */
export function createApiRouter(provider) {
  const router = Router();

  router.use(apiLimiter);
  router.use(attachSession);

  router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'texor-accounts' }));

  router.use('/auth', createAuthRoutes(provider));
  router.use('/interaction', createInteractionRoutes(provider));
  router.use('/account', createAccountRoutes());
  router.use('/console', createConsoleRoutes());
  router.use('/admin', createAdminRoutes());

  return router;
}

export default createApiRouter;
