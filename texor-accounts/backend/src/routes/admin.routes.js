import { Router } from 'express';
import { requireAdmin } from '../middleware/session.js';
import { validate } from '../middleware/validate.js';
import {
  adminPatchSchema,
  getApps,
  getOneApp,
  listQuerySchema,
  patchApp,
  publishApp,
  rejectApp,
  reviewDecisionSchema,
} from '../controllers/admin.controller.js';

export function createAdminRoutes() {
  const router = Router();

  router.use(requireAdmin);

  router.get('/apps', validate(listQuerySchema, 'query'), getApps);
  router.get('/apps/:clientId', getOneApp);
  router.patch('/apps/:clientId', validate(adminPatchSchema), patchApp);

  // The review queue.
  router.post('/apps/:clientId/publish', validate(reviewDecisionSchema), publishApp);
  router.post('/apps/:clientId/reject', validate(reviewDecisionSchema), rejectApp);

  return router;
}

export default createAdminRoutes;
