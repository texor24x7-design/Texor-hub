/**
 * The admin console's API: policy, the audit log, and a view of every meeting
 * in the organisation rather than just the caller's own.
 *
 * Every route here runs behind `requireAdmin`. Admin is not a flag on a user
 * document that could be granted by any other code path — it is membership of
 * the env allowlist or of the policy's admin list, checked per request.
 */
import { z } from 'zod';
import AuditEvent from '../models/AuditEvent.js';
import Meeting from '../models/Meeting.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { ACTIONS, record, verifyChain } from '../services/audit.service.js';
import { workerStats } from '../media/worker.js';
import { getPolicy, isAdmin } from '../services/policy.service.js';

export const policySchema = z.object({
  whoCanCreateMeetings: z.enum(['anyone', 'allowlist']).optional(),
  creatorAllowlist: z.array(z.string().min(1)).max(2000).optional(),
  allowExternalGuests: z.boolean().optional(),
  forceLobbyForExternal: z.boolean().optional(),
  lobbyDefault: z.enum(['off', 'external', 'everyone']).optional(),
  maxDurationMinutes: z.coerce.number().int().min(0).max(24 * 60).optional(),
  maxParticipants: z.coerce.number().int().min(0).max(1000).optional(),
  defaultMuteOnEntry: z.boolean().optional(),
  defaultVideoOffOnEntry: z.boolean().optional(),
  screenShareDefault: z.enum(['everyone', 'hosts']).optional(),
  maxQuality: z.enum(['saver', 'standard', 'high']).optional(),
  allowBreakouts: z.boolean().optional(),
  maxBreakoutRooms: z.coerce.number().int().min(1).max(100).optional(),
  adminTexorIds: z.array(z.string().min(1)).max(200).optional(),
});

export const auditQuerySchema = z.object({
  action: z.string().max(60).optional(),
  actorTexorId: z.string().max(120).optional(),
  meetingCode: z.string().max(20).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  // Cursor rather than a page number: the log only ever grows at the head, and
  // offset paging would shift every row under the reader between clicks.
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const adminMeetingsSchema = z.object({
  status: z.enum(['scheduled', 'live', 'ended', 'cancelled', 'all']).default('live'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function requireAdmin(req, _res, next) {
  try {
    if (!(await isAdmin(req.user))) {
      throw ApiError.forbidden('This is an admin-only area of Texor Talk.');
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

const presentPolicy = (policy) => ({
  whoCanCreateMeetings: policy.whoCanCreateMeetings,
  creatorAllowlist: policy.creatorAllowlist,
  allowExternalGuests: policy.allowExternalGuests,
  forceLobbyForExternal: policy.forceLobbyForExternal,
  lobbyDefault: policy.lobbyDefault,
  maxDurationMinutes: policy.maxDurationMinutes,
  maxParticipants: policy.maxParticipants,
  defaultMuteOnEntry: policy.defaultMuteOnEntry,
  defaultVideoOffOnEntry: policy.defaultVideoOffOnEntry,
  screenShareDefault: policy.screenShareDefault,
  maxQuality: policy.maxQuality,
  allowBreakouts: policy.allowBreakouts,
  maxBreakoutRooms: policy.maxBreakoutRooms,
  adminTexorIds: policy.adminTexorIds,
  updatedAt: policy.updatedAt,
  updatedBy: policy.updatedByName,
});

export async function readPolicy(_req, res) {
  const policy = await getPolicy();

  res.json({
    policy: presentPolicy(policy),
    // Shown in the console so an admin can see which rules come from
    // deployment config and therefore cannot be edited here.
    environment: {
      adminEmails: env.adminEmails,
      orgEmailDomains: env.orgEmailDomains,
      joinEarlyMinutes: env.MEETING_JOIN_EARLY_MINUTES,
      media: {
        announcedAddress: env.media.announcedAddress,
        isLocalOnly: env.media.isLocalOnly,
        rtcPortRange: `${env.media.rtcMinPort}-${env.media.rtcMaxPort}`,
        workers: await workerStats(),
      },
    },
  });
}

export async function updatePolicy(req, res) {
  const policy = await getPolicy();

  // Recorded before the write so the audit line can say what actually changed
  // rather than only what the new state is.
  const before = presentPolicy(policy);
  const changed = [];

  for (const [key, value] of Object.entries(req.body)) {
    if (value === undefined) continue;
    if (JSON.stringify(before[key]) === JSON.stringify(value)) continue;
    policy[key] = value;
    changed.push(key);
  }

  if (changed.length === 0) return res.json({ policy: before, changed });

  policy.updatedByTexorId = req.user.texorId;
  policy.updatedByName = req.user.displayName;
  await policy.save();

  await record({
    action: ACTIONS.POLICY_UPDATED,
    actor: req.user,
    metadata: {
      changed,
      from: Object.fromEntries(changed.map((key) => [key, before[key]])),
      to: Object.fromEntries(changed.map((key) => [key, policy[key]])),
    },
    req,
  });

  res.json({ policy: presentPolicy(policy), changed });
}

export async function listAuditEvents(req, res) {
  const { action, actorTexorId, meetingCode, since, until, before, limit } = req.query;

  const filter = {};
  if (action) filter.action = action;
  if (actorTexorId) filter.actorTexorId = actorTexorId;
  if (meetingCode) filter.meetingCode = meetingCode.toLowerCase();
  if (before) filter.seq = { $lt: before };
  if (since || until) {
    filter.at = { ...(since ? { $gte: since } : {}), ...(until ? { $lte: until } : {}) };
  }

  const events = await AuditEvent.find(filter).sort({ seq: -1 }).limit(limit).lean();

  res.json({
    events: events.map((event) => ({
      seq: event.seq,
      at: event.at,
      action: event.action,
      actor: { texorId: event.actorTexorId, name: event.actorName, email: event.actorEmail },
      meetingCode: event.meetingCode,
      target: event.targetTexorId
        ? { texorId: event.targetTexorId, name: event.targetName }
        : null,
      metadata: event.metadata,
      ip: event.ip,
      hash: event.hash,
    })),
    // Null when the page came back short, which is how the client knows it has
    // reached the end rather than having to ask for an empty page to find out.
    nextBefore: events.length === limit ? events.at(-1).seq : null,
  });
}

/** Re-hashes the whole log and reports whether it still adds up. */
export async function verifyAuditLog(_req, res) {
  res.json({ verification: await verifyChain() });
}

/** Every meeting in the organisation, not only the caller's own. */
export async function listAllMeetings(req, res) {
  const { status, limit } = req.query;

  const meetings = await Meeting.find(status === 'all' ? {} : { status })
    .sort({ startedAt: -1, scheduledStart: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  res.json({
    meetings: meetings.map((meeting) => ({
      code: meeting.code,
      title: meeting.title,
      status: meeting.status,
      host: { texorId: meeting.hostTexorId, name: meeting.hostName, email: meeting.hostEmail },
      access: meeting.access,
      lobby: meeting.lobby,
      scheduledStart: meeting.scheduledStart,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      recurrence: meeting.recurrence?.freq ?? 'none',
      participantCount: meeting.attendance.filter((entry) => !entry.leftAt).length,
      attendedCount: meeting.attendance.length,
    })),
  });
}

export default {
  requireAdmin,
  readPolicy,
  updatePolicy,
  listAuditEvents,
  verifyAuditLog,
  listAllMeetings,
};
