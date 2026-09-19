import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import env from './config/env.js';
import { createApiRouter } from './routes/index.js';
import { receiveFromNotes } from './controllers/integration.controller.js';
import { errorHandler, notFound } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      /**
       * Disallowed origins return `false`, never an error.
       *
       * Omitting the Access-Control-Allow-Origin header is what actually
       * enforces the policy: the browser blocks the calling script from reading
       * the response. Throwing adds no protection and does real harm, because
       * this middleware also sees plain top-level navigations, which need no
       * CORS at all — the Texor sign-in callback is a cross-site redirect and
       * arrives with the literal Origin `null`.
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

  // The secret signs the short-lived PKCE transaction cookie.
  app.use(cookieParser(env.COOKIE_SECRET));
  /**
   * Edits made in Texor Notes, arriving back.
   *
   * Ahead of the JSON parser and with a raw one of its own, because the
   * signature is over the exact bytes Notes sent. One route, so nothing else
   * about how this app reads a request body has changed.
   */
  app.post('/api/integrations/notes', express.raw({ type: 'application/json', limit: '256kb' }), receiveFromNotes);

  app.use(express.json({ limit: '256kb' }));

  app.use('/api', createApiRouter());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
