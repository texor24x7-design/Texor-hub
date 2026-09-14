import { Router } from 'express';
import { authLimiter } from '../middleware/rateLimit.js';
import { makeInteractionController } from '../controllers/interaction.controller.js';

export function createInteractionRoutes(provider) {
  const router = Router();
  const controller = makeInteractionController(provider);

  // The :uid in the path is informational — oidc-provider identifies the
  // interaction from its own cookie, which is what binds it to this browser.
  router.get('/:uid', controller.details);
  router.post('/:uid/login', authLimiter, controller.login);
  router.post('/:uid/confirm', controller.confirm);
  router.post('/:uid/abort', controller.abort);

  return router;
}

export default createInteractionRoutes;
