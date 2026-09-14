import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import {
  login,
  loginSchema,
  logout,
  me,
  signup,
  signupSchema,
} from '../controllers/auth.controller.js';
import { makeFederationController } from '../controllers/federation.controller.js';
import {
  emailSchema,
  postConfirmEmail,
  postForgotPassword,
  postResetPassword,
  resetSchema,
  tokenSchema,
} from '../controllers/verification.controller.js';
import { mailLimiter } from '../middleware/rateLimit.js';
import env from '../config/env.js';

export function createAuthRoutes(provider) {
  const router = Router();
  const federation = makeFederationController(provider);

  router.post('/signup', authLimiter, validate(signupSchema), signup);
  router.post('/login', authLimiter, validate(loginSchema), login);
  router.post('/logout', logout);
  router.get('/me', me);

  // Which of Google / Microsoft / LinkedIn this deployment has configured.
  // Read by the sign-in screen so it only renders buttons that work.
  router.get('/providers', federation.listProviders);

  // Federated sign-in. Both are full browser navigations, not fetches — the
  // user has to actually visit the upstream provider.
  router.get('/federated/:provider/start', authLimiter, federation.start);
  router.get('/federated/:provider/callback', federation.callback);

  // ── Email verification and password recovery ────────────────────────────
  // Confirming an address and resetting a password both work without a
  // session: the link in the inbox is the credential.
  router.post('/verify-email', validate(tokenSchema), postConfirmEmail);
  router.post('/forgot-password', mailLimiter, validate(emailSchema), postForgotPassword);
  router.post('/reset-password', authLimiter, validate(resetSchema), postResetPassword);

  // Where to send the browser to tear down the provider's session as well.
  router.get('/end-session-url', (_req, res) => {
    res.json({ endSessionUrl: `${env.issuer}/session/end` });
  });

  return router;
}

export default createAuthRoutes;
