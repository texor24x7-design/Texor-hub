import { Router } from 'express';
import { attachSession, requireUser } from '../middleware/session.js';
import { validate } from '../middleware/validate.js';
import { handleCallback, logout, me, startLogin } from '../controllers/auth.controller.js';
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

  return router;
}

export default createApiRouter;
