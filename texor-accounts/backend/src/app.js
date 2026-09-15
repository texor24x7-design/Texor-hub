/**
 * Express application assembly.
 *
 * Two things share this server:
 *   /oidc/*  — oidc-provider, mounted as a Koa callback
 *   /api/*   — our own account and admin API
 *
 * The mount path is taken from the issuer URL so the two can never drift: the
 * provider builds public URLs from the issuer's path segment, and Express must
 * strip that same segment before handing the request over.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import env from './config/env.js';
import { createApiRouter } from './routes/index.js';
import { errorHandler, notFound } from './middleware/error.js';

const OIDC_MOUNT_PATH = new URL(env.issuer).pathname.replace(/\/$/, '') || '/';

export function createApp(provider) {
  const app = express();

  // Required for correct req.ip and secure cookies behind a proxy or CDN.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The provider serves its own minimal HTML (the logout confirmation);
      // a strict default CSP would block its inline submit script.
      contentSecurityPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  app.use(
    cors({
      /**
       * Disallowed origins return `false`, never an error.
       *
       * Omitting the Access-Control-Allow-Origin header is what actually
       * enforces the policy: the browser blocks the calling script from reading
       * the response. Throwing adds no protection and does real harm, because
       * this middleware also sees plain top-level navigations, which need no
       * CORS at all — a cross-site redirect, which is exactly what an OAuth
       * callback is, arrives with the literal Origin `null`. Rejecting that
       * turned a working Google sign-in into a 500.
       */
      origin(origin, callback) {
        // Same-origin requests, server-to-server calls and most navigations
        // carry no Origin header whatsoever.
        if (!origin) return callback(null, true);
        return callback(null, env.corsOrigins.includes(origin));
      },
      credentials: true,
    }),
  );

  // The signing secrets are shared with oidc-provider's cookie config; the
  // federated sign-in transaction cookie relies on them.
  app.use(cookieParser(env.cookieKeys));

  // The OIDC provider parses its own bodies; only /api gets Express parsers.
  app.use('/api', express.json({ limit: '100kb' }));
  app.use('/api', express.urlencoded({ extended: false, limit: '100kb' }));

  app.use('/api', createApiRouter(provider));

  // Mounted last so /api wins for any overlapping path.
  //
  // The provider registers its routes unprefixed ('/auth', '/token', …) and
  // adds the issuer's path segment only when *generating* URLs. Mounting it
  // here lets Express strip '/oidc' before Koa matches, so the two halves agree.
  app.use(OIDC_MOUNT_PATH, provider.callback());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;

//test commit