import { Router } from 'express';
import { attachSession, requireUser } from '../middleware/session.js';
import { validate } from '../middleware/validate.js';
import { handleCallback, logout, me, startLogin } from '../controllers/auth.controller.js';
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

  return router;
}

export default createApiRouter;
