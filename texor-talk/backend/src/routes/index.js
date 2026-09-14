import { Router } from 'express';
import { attachSession, requireUser } from '../middleware/session.js';
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
  cancelKnock,
  cancelMeeting,
  createMeeting,
  createMeetingSchema,
  decideKnock,
  downloadInvite,
  endMeetingNow,
  getKnock,
  getMeeting,
  inviteeSchema,
  joinMeeting,
  knockDecisionSchema,
  leaveMeeting,
  listKnocks,
  listMeetings,
  listMeetingsSchema,
  removeInvitee,
  removeParticipant,
  respondToInvite,
  roleSchema,
  rsvpSchema,
  setParticipantRole,
  updateMeeting,
  updateMeetingSchema,
} from '../controllers/meeting.controller.js';
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

  // ── Meetings ────────────────────────────────────────────────────────────────
  router.use('/meetings', requireUser);
  router.get('/meetings', validate(listMeetingsSchema, 'query'), listMeetings);
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
  router.delete('/meetings/:code/participants/:texorId', removeParticipant);

  // Invitations.
  router.post('/meetings/:code/invitees', validate(inviteeSchema), addInvitees);
  router.delete('/meetings/:code/invitees/:email', removeInvitee);
  router.post('/meetings/:code/rsvp', validate(rsvpSchema), respondToInvite);

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
