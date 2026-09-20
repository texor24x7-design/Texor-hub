import { Router } from 'express';
import { attachSession, requireParticipant, requireUser } from '../middleware/session.js';
import { validate } from '../middleware/validate.js';
import { handleCallback, logout, me, startLogin } from '../controllers/auth.controller.js';
import {
  channelSchema,
  createChannel,
  deleteMessage,
  getChannel,
  historyQuerySchema,
  joinChannel,
  leaveChannel,
  listChannels,
  listMessages,
  messageSchema,
  postMessage,
} from '../controllers/channel.controller.js';
import {
  addInvitees,
  breakoutsPatchSchema,
  breakoutsSchema,
  cancelKnock,
  closeBreakouts,
  cancelMeeting,
  createMeeting,
  createMeetingSchema,
  decideKnock,
  downloadInvite,
  endMeetingNow,
  getKnock,
  getMeeting,
  getMeetingDefaults,
  guestPreview,
  guestSchema,
  inviteeSchema,
  joinAsGuest,
  leaveAsGuest,
  joinMeeting,
  knockDecisionSchema,
  leaveMeeting,
  listKnocks,
  openBreakouts,
  listMeetings,
  listMeetingsSchema,
  removeInvitee,
  removeParticipant,
  respondToInvite,
  roleSchema,
  rsvpSchema,
  setParticipantRole,
  transferHost,
  transferSchema,
  updateBreakouts,
  updateMeeting,
  updateMeetingSchema,
} from '../controllers/meeting.controller.js';
import {
  createNote,
  createNoteSchema,
  deleteNote,
  getMeetingPeople,
  getNote,
  listNotes,
  listNotesSchema,
  updateNote,
  updateNoteSchema,
} from '../controllers/note.controller.js';
import {
  adminMeetingsSchema,
  auditQuerySchema,
  listAllMeetings,
  listAuditEvents,
  policySchema,
  readPolicy,
  requireAdmin,
  updatePolicy,
  verifyAuditLog,
} from '../controllers/admin.controller.js';

export function createApiRouter() {
  const router = Router();

  router.use(attachSession);

  router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'talk' }));

  // ── Texor SSO ───────────────────────────────────────────────────────────────
  router.get('/auth/login', startLogin);
  router.get('/auth/callback', handleCallback);
  router.post('/auth/logout', logout);
  router.get('/auth/me', me);

  // ── Channels and messages ───────────────────────────────────────────────────
  router.use('/channels', requireUser);
  router.get('/channels', listChannels);
  router.post('/channels', validate(channelSchema), createChannel);
  router.get('/channels/:id', getChannel);
  router.post('/channels/:id/join', joinChannel);
  router.post('/channels/:id/leave', leaveChannel);

  router.get('/channels/:id/messages', validate(historyQuerySchema, 'query'), listMessages);
  router.post('/channels/:id/messages', validate(messageSchema), postMessage);
  router.delete('/channels/:id/messages/:messageId', deleteMessage);

  // ── Guests ──────────────────────────────────────────────────────────────────
  /**
   * The only two routes reachable with no credential at all, and the only ones
   * that must be declared before the blanket `requireUser` below.
   *
   * `guestPreview` is deliberately thin — enough to draw a join screen for
   * somebody who has proved nothing, and no more.
   */
  router.get('/meetings/:code/guest', guestPreview);
  router.post('/meetings/:code/guest', validate(guestSchema), joinAsGuest);

  // ── Meetings ────────────────────────────────────────────────────────────────
  /**
   * A Texor Account is required for everything under /meetings **except** the
   * few routes below that a guest needs to take part in the one meeting they
   * were let into. Those are listed explicitly and each re-checks, once the
   * meeting is loaded, that the guest's pass is for that meeting.
   *
   * The default is the strict one on purpose: a route added here later is
   * closed to guests unless somebody deliberately opens it.
   */
  /**
   * Paths under /meetings a guest may reach, matched against `req.path`, which
   * inside this mount is everything after `/meetings`.
   */
  const GUEST_ROUTES = [
    // The meeting itself, and only itself — `/^\/[^/]+$/` cannot match any
    // sub-resource, so the invite file, the waiting list and the invitee list
    // all stay closed. `present()` further reduces what a guest is shown.
    ['GET', /^\/[^/]+$/],
    ['POST', /^\/[^/]+\/join$/],
    ['GET', /^\/[^/]+\/knocks\/[^/]+\/status$/],
    ['DELETE', /^\/[^/]+\/knocks\/[^/]+$/],
    ['POST', /^\/[^/]+\/leave$/],
    ['POST', /^\/[^/]+\/guest\/leave$/],
  ];

  router.use('/meetings', (req, res, next) => {
    const openToGuests = GUEST_ROUTES.some(
      ([method, pattern]) => method === req.method && pattern.test(req.path),
    );
    return openToGuests ? requireParticipant(req, res, next) : requireUser(req, res, next);
  });

  router.post('/meetings/:code/guest/leave', leaveAsGuest);
  router.get('/meetings', validate(listMeetingsSchema, 'query'), listMeetings);
  // Before `/meetings/:code`, or the code parameter swallows it.
  router.get('/meetings/defaults', getMeetingDefaults);
  router.post('/meetings', validate(createMeetingSchema), createMeeting);

  router.get('/meetings/:code', getMeeting);
  router.patch('/meetings/:code', validate(updateMeetingSchema), updateMeeting);
  router.delete('/meetings/:code', cancelMeeting);
  router.get('/meetings/:code/invite.ics', downloadInvite);

  // Getting in, and the waiting room on both sides of the door.
  router.post('/meetings/:code/join', joinMeeting);
  router.get('/meetings/:code/knocks', listKnocks);
  router.post('/meetings/:code/knocks/:knockId', validate(knockDecisionSchema), decideKnock);
  router.get('/meetings/:code/knocks/:knockId/status', getKnock);
  router.delete('/meetings/:code/knocks/:knockId', cancelKnock);

  // In the call. Presence itself lives on the media socket at /ws/meeting —
  // a connection that is open is a participant who is present, which is more
  // truthful than a timer and removes the ghost a crashed browser used to leave.
  router.post('/meetings/:code/leave', leaveMeeting);
  router.post('/meetings/:code/end', endMeetingNow);
  router.post('/meetings/:code/participants/:texorId/role', validate(roleSchema), setParticipantRole);
  router.post('/meetings/:code/host', validate(transferSchema), transferHost);
  router.delete('/meetings/:code/participants/:texorId', removeParticipant);

  // Host only, via the same `requireHost` every other meeting edit uses — which
  // covers co-hosts and whoever is standing in while the host is away.
  router.post('/meetings/:code/breakouts', validate(breakoutsSchema), openBreakouts);
  router.patch('/meetings/:code/breakouts', validate(breakoutsPatchSchema), updateBreakouts);
  router.delete('/meetings/:code/breakouts', closeBreakouts);

  // Invitations.
  router.post('/meetings/:code/invitees', validate(inviteeSchema), addInvitees);
  router.delete('/meetings/:code/invitees/:email', removeInvitee);
  router.post('/meetings/:code/rsvp', validate(rsvpSchema), respondToInvite);

  // Who can be tagged in a note about this meeting. Not in GUEST_ROUTES, so a
  // guest cannot enumerate the people in a meeting they were let into.
  router.get('/meetings/:code/people', getMeetingPeople);

  // ── Notes ───────────────────────────────────────────────────────────────────
  /**
   * `requireUser`, so a guest cannot reach any of this.
   *
   * A guest is a name typed into a box, with no account behind it and a pass
   * that expires in hours. A note they wrote would belong to nobody the moment
   * that pass lapsed, and could never appear in a Notes section they have no
   * way to sign back in to.
   */
  router.use('/notes', requireUser);
  router.get('/notes', validate(listNotesSchema, 'query'), listNotes);
  router.post('/notes', validate(createNoteSchema), createNote);
  router.get('/notes/:id', getNote);
  router.patch('/notes/:id', validate(updateNoteSchema), updateNote);
  router.delete('/notes/:id', deleteNote);

  // ── Administration ──────────────────────────────────────────────────────────
  router.use('/admin', requireUser, requireAdmin);
  router.get('/admin/policy', readPolicy);
  router.put('/admin/policy', validate(policySchema), updatePolicy);
  router.get('/admin/audit', validate(auditQuerySchema, 'query'), listAuditEvents);
  router.get('/admin/audit/verify', verifyAuditLog);
  router.get('/admin/meetings', validate(adminMeetingsSchema, 'query'), listAllMeetings);

  return router;
}

export default createApiRouter;
