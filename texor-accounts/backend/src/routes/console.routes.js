import { Router } from 'express';
import { requireUser } from '../middleware/session.js';
import { validate } from '../middleware/validate.js';
import {
  createAppSchema,
  deleteAppHandler,
  getApp,
  getScopes,
  listApps,
  patchApp,
  postApp,
  postRotateSecret,
  postSubmitForReview,
  putTestAccounts,
  testAccountsSchema,
  updateAppSchema,
} from '../controllers/console.controller.js';

/**
 * /api/console — self-service app registration.
 *
 * Open to any signed-in Texor Account. Ownership is enforced per app inside
 * the service, not by a role.
 */
export function createConsoleRoutes() {
  const router = Router();

  router.use(requireUser);

  router.get('/scopes', getScopes);

  router.get('/apps', listApps);
  router.post('/apps', validate(createAppSchema), postApp);

  router.get('/apps/:clientId', getApp);
  router.patch('/apps/:clientId', validate(updateAppSchema), patchApp);
  router.delete('/apps/:clientId', deleteAppHandler);

  router.post('/apps/:clientId/rotate-secret', postRotateSecret);
  router.put('/apps/:clientId/test-accounts', validate(testAccountsSchema), putTestAccounts);
  router.post('/apps/:clientId/submit-review', postSubmitForReview);

  return router;
}

export default createConsoleRoutes;
