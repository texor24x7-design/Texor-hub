import { Router } from 'express';
import { requireUser } from '../middleware/session.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import {
  changePasswordSchema,
  deleteAllSessions,
  deleteConnectedApp,
  deleteSession,
  getConnectedApps,
  getProfile,
  getSessions,
  patchProfile,
  postPassword,
  profileSchema,
} from '../controllers/account.controller.js';
import { deleteIdentity, getIdentities } from '../controllers/federation.controller.js';
import { postSendVerification } from '../controllers/verification.controller.js';
import {
  deletePicture,
  getUploadSignature,
  getUploadStatus,
  pictureSchema,
  putPicture,
} from '../controllers/upload.controller.js';
import { mailLimiter } from '../middleware/rateLimit.js';

export function createAccountRoutes() {
  const router = Router();

  router.use(requireUser);

  router.get('/profile', getProfile);
  router.patch('/profile', validate(profileSchema), patchProfile);

  router.post('/password', authLimiter, validate(changePasswordSchema), postPassword);

  router.get('/sessions', getSessions);
  router.delete('/sessions', deleteAllSessions);
  router.delete('/sessions/:id', deleteSession);

  router.get('/connected-apps', getConnectedApps);
  router.delete('/connected-apps/:grantId', deleteConnectedApp);

  // Google / Microsoft / LinkedIn connections on this account.
  router.get('/identities', getIdentities);
  router.delete('/identities/:provider', deleteIdentity);

  // Confirming the address on the account.
  router.post('/send-verification', mailLimiter, postSendVerification);

  // Profile picture. The file goes straight from the browser to Cloudinary;
  // only the signature and the result pass through here.
  router.get('/picture/status', getUploadStatus);
  router.get('/picture/signature', getUploadSignature);
  router.put('/picture', validate(pictureSchema), putPicture);
  router.delete('/picture', deletePicture);

  return router;
}

export default createAccountRoutes;
