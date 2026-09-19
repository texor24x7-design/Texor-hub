import { Router } from 'express';
import { attachSession, requireUser } from '../middleware/session.js';
import { validate } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireApiKey } from '../middleware/apiKey.js';
import { handleCallback, logout, me, startLogin } from '../controllers/auth.controller.js';
import {
  connectApprove,
  connectApproveSchema,
  connectExchange,
  connectExchangeSchema,
  connectPrompt,
  deleteKey,
  keySchema,
  listConnections,
  listKeys,
  postKey,
  revokeConnection,
} from '../controllers/apikey.controller.js';
import {
  apiListSchema,
  apiNoteSchema,
  deleteApiNote,
  getApiNote,
  listApiNotes,
  patchApiNote,
  upsertApiNote,
  whoAmI,
} from '../controllers/public.controller.js';
import {
  listPeople,
  noteActivity,
  shareLabel,
  shareNote,
  shareSchema,
  unshareLabel,
  unshareNote,
} from '../controllers/share.controller.js';
import {
  createLabel,
  deleteLabel,
  labelPatchSchema,
  labelSchema,
  listLabels,
  updateLabel,
} from '../controllers/label.controller.js';
import {
  createNote,
  createNoteSchema,
  deleteNote,
  getNote,
  labelsSchema,
  listNotes,
  listNotesSchema,
  purgeNote,
  restoreNote,
  setNoteLabels,
  updateNote,
  updateNoteSchema,
} from '../controllers/note.controller.js';

export function createApiRouter() {
  const router = Router();

  router.use(attachSession);

  router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notes' }));

  // ── Texor SSO ───────────────────────────────────────────────────────────────
  router.get('/auth/login', startLogin);
  router.get('/auth/callback', handleCallback);
  router.post('/auth/logout', logout);
  router.get('/auth/me', me);

  // ── Notes ───────────────────────────────────────────────────────────────────
  router.use('/notes', requireUser);
  router.get('/notes', validate(listNotesSchema, 'query'), listNotes);
  router.post('/notes', validate(createNoteSchema), createNote);
  router.get('/notes/:id', getNote);
  router.patch('/notes/:id', validate(updateNoteSchema), updateNote);
  router.delete('/notes/:id', deleteNote);
  router.post('/notes/:id/restore', restoreNote);
  router.delete('/notes/:id/purge', purgeNote);
  router.put('/notes/:id/labels', validate(labelsSchema), setNoteLabels);
  router.get('/notes/:id/activity', noteActivity);
  router.post('/notes/:id/shares', validate(shareSchema), shareNote);
  router.delete('/notes/:id/shares/:email', unshareNote);

  // ── Labels ──────────────────────────────────────────────────────────────────
  router.use('/labels', requireUser);
  router.get('/labels', listLabels);
  router.post('/labels', validate(labelSchema), createLabel);
  router.patch('/labels/:id', validate(labelPatchSchema), updateLabel);
  router.delete('/labels/:id', deleteLabel);
  router.post('/labels/:id/shares', validate(shareSchema), shareLabel);
  router.delete('/labels/:id/shares/:email', unshareLabel);

  // ── People ──────────────────────────────────────────────────────────────────
  // Not a directory: see the controller for why this cannot enumerate anybody.
  router.use('/people', requireUser);
  router.get('/people', listPeople);

  // ── Keys, and the apps somebody has connected ───────────────────────────────
  router.use('/keys', requireUser);
  router.get('/keys', listKeys);
  router.post('/keys', validate(keySchema), postKey);
  router.delete('/keys/:id', deleteKey);

  router.use('/connections', requireUser);
  router.get('/connections', listConnections);
  router.delete('/connections/:id', revokeConnection);

  /**
   * The consent step of the connect flow.
   *
   * A signed-in person approving an app, so it is a session route and not an
   * API-key one. The app never sees this; it only sees where its user comes
   * back from.
   */
  router.get('/connect', requireUser, connectPrompt);
  router.post('/connect', requireUser, validate(connectApproveSchema), connectApprove);

  /**
   * ── The notes API ─────────────────────────────────────────────────────────
   *
   * Everything below this line is somebody else's software talking to us. It
   * authenticates with a key rather than a cookie, and it is rate limited per
   * key, because a retry loop with no backoff is a thing that exists.
   */
  const api = Router();

  api.use(rateLimit({ name: 'v1', limit: 600, windowMs: 60_000 }));
  api.use(requireApiKey);

  api.get('/me', whoAmI);
  api.post('/connect/exchange', validate(connectExchangeSchema), connectExchange);
  api.get('/notes', validate(apiListSchema, 'query'), listApiNotes);
  api.post('/notes', validate(apiNoteSchema), upsertApiNote);
  api.get('/notes/:id', getApiNote);
  api.patch('/notes/:id', validate(apiNoteSchema), patchApiNote);
  api.delete('/notes/:id', deleteApiNote);

  router.use('/v1', api);

  return router;
}

export default createApiRouter;
