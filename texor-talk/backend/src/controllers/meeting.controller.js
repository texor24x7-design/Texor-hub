/**
 * Meetings: scheduling them, joining them, running them.
 *
 * Access is recomputed from the meeting document on every single request. A
 * client that was told it is a host on Monday is not a host on Tuesday because
 * it says so — the only thing that decides is the document, read fresh.
 */
import { z } from 'zod';
import Meeting from '../models/Meeting.js';
import Knock from '../models/Knock.js';
import Channel from '../models/Channel.js';
import Message from '../models/Message.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { meetingInvite } from '../utils/ics.js';
import {
  ejectPeer, endRoom, refreshKnocks, updatePeerRole, updateRoomQuality,
} from '../media/signalling.js';
import { connectedTexorIds } from '../media/room.js';
import { availableTiers, effectiveTier, isTier, limitsFor } from '../services/quality.service.js';
import {
  GUEST_COOKIE,
  assertGuestScope,
  cleanGuestName,
  createGuestSession,
  guestCookieOptions,
  guestsAllowed,
  revokeGuest,
} from '../services/guest.service.js';
import { ACTIONS, record } from '../services/audit.service.js';
import {
  assertCanCreateMeeting,
  effectiveLobby,
  getPolicy,
  isExternalEmail,
  meetingDefaults,
} from '../services/policy.service.js';
import {
  KNOCK_TTL_MS,
  allocateCode,
  currentOccurrence,
  endMeeting,
  evaluateJoin,
  isAbandoned,
  joinWindow,
  markJoined,
  markLeft,
  markPresent,
  reapStaleAttendance,
  rollForward,
} from '../services/meeting.service.js';

// ── Schemas ──────────────────────────────────────────────────────────────────

const inviteeInput = z.object({
  email: z.email('That does not look like an email address.').toLowerCase(),
  name: z.string().max(120).default(''),
  texorId: z.string().nullish().default(null),
  role: z.enum(['cohost', 'participant']).default('participant'),
});

const recurrenceInput = z.object({
  freq: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly']).default('none'),
  interval: z.coerce.number().int().min(1).max(52).default(1),
  count: z.coerce.number().int().min(1).max(365).nullish().default(null),
  until: z.coerce.date().nullish().default(null),
});

/**
 * Zod 4 hands back a `.default()` value as-is rather than parsing it, so an
 * empty object default would arrive at the controller as `{}` with no `freq` —
 * and every read of `recurrence.freq` downstream would see undefined. Spelling
 * the whole shape out is what keeps "no recurrence" a real value.
 */
const NO_RECURRENCE = { freq: 'none', interval: 1, count: null, until: null };

const settingsInput = z.object({
  muteOnEntry: z.boolean().optional(),
  videoOffOnEntry: z.boolean().optional(),
  screenShare: z.enum(['everyone', 'hosts']).optional(),
  allowChat: z.boolean().optional(),
  allowExternalGuests: z.boolean().optional(),
});

export const createMeetingSchema = z
  .object({
    title: z.string().min(1, 'Give the meeting a name.').max(140),
    agenda: z.string().max(2000).default(''),
    scheduledStart: z.coerce.date().nullish().default(null),
    scheduledEnd: z.coerce.date().nullish().default(null),
    timezone: z.string().max(64).default('UTC'),
    access: z.enum(['invited', 'texor', 'anyone']).default('texor'),
    lobby: z.enum(['off', 'external', 'everyone']).optional(),
    invitees: z.array(inviteeInput).max(500).default([]),
    quality: z.enum(['saver', 'standard', 'high']).optional(),
    recurrence: recurrenceInput.default(NO_RECURRENCE),
    settings: settingsInput.default({}),
    channelId: z.string().nullish().default(null),
  })
  .refine((value) => !value.scheduledEnd || !value.scheduledStart || value.scheduledEnd > value.scheduledStart, {
    message: 'The meeting has to end after it starts.',
    path: ['scheduledEnd'],
  })
  // A recurring meeting with no first occurrence has nothing to recur from.
  .refine((value) => value.recurrence.freq === 'none' || Boolean(value.scheduledStart), {
    message: 'Pick a start time before making the meeting repeat.',
    path: ['scheduledStart'],
  });

export const updateMeetingSchema = z.object({
  title: z.string().min(1).max(140).optional(),
  agenda: z.string().max(2000).optional(),
  scheduledStart: z.coerce.date().nullish().optional(),
  scheduledEnd: z.coerce.date().nullish().optional(),
  timezone: z.string().max(64).optional(),
  access: z.enum(['invited', 'texor', 'anyone']).optional(),
  lobby: z.enum(['off', 'external', 'everyone']).optional(),
  quality: z.enum(['saver', 'standard', 'high']).optional(),
  recurrence: recurrenceInput.optional(),
  settings: settingsInput.optional(),
});

export const listMeetingsSchema = z.object({
  scope: z.enum(['upcoming', 'joined', 'past', 'live', 'all']).default('upcoming'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const guestSchema = z.object({ name: z.string().min(1).max(60) });
export const inviteeSchema = z.object({ invitees: z.array(inviteeInput).min(1).max(200) });
export const rsvpSchema = z.object({ response: z.enum(['accepted', 'declined', 'tentative']) });
export const knockDecisionSchema = z.object({ decision: z.enum(['admit', 'deny']) });
export const roleSchema = z.object({ role: z.enum(['cohost', 'participant']) });
export const transferSchema = z.object({ texorId: z.string().min(1) });

// ── Loading and presenting ───────────────────────────────────────────────────

/**
 * Loads a meeting by code, and brings its bookkeeping up to date first.
 *
 * The sweep and the roll-forward happen on read because there is no scheduler
 * in this product. Any request that touches a meeting pays a trivial cost to
 * make sure what it then reads is true — rather than the whole app depending
 * on a cron job that might not be running.
 */
async function loadMeeting(code) {
  const meeting = await Meeting.findOne({ code: String(code).toLowerCase().trim() }).exec();
  if (!meeting) throw ApiError.notFound('No meeting with that code.');

  /**
   * Anyone holding an open socket is present, whatever the timestamps say.
   *
   * This has to happen *before* the sweep, and it is the difference between a
   * meeting that survives and one that ends under everybody. `lastSeenAt` is
   * written periodically; a socket is a fact. Reaping on the timestamp alone
   * meant that any request touching the meeting — most often somebody new
   * joining — could declare a room full of connected people empty and end it.
   */
  const present = markPresent(meeting, connectedTexorIds(meeting.code));
  const stale = reapStaleAttendance(meeting);
  const rolled = rollForward(meeting);

  if (isAbandoned(meeting)) {
    await endMeeting({ meeting, reason: 'everyone left' });
  } else if (present || stale || rolled) {
    await meeting.save();
  }

  return meeting;
}

function requireHost(meeting, user) {
  if (!meeting.isHost(user.texorId)) {
    throw ApiError.forbidden('Only the host can do that.');
  }
}

/**
 * The client's view of a meeting.
 *
 * No media identifiers appear here, and none are needed: the SFU room is keyed
 * by the meeting code and guarded by the same `evaluateJoin` on the socket, so
 * there is nothing a client could learn from this payload that would get it
 * into a call it is not entitled to.
 */
function presentMeeting(meeting, user, { policy } = {}) {
  const role = meeting.roleOf(user.texorId, user.email);
  const isHost = role === 'host' || role === 'cohost';
  /**
   * A guest sees the meeting, not the guest list.
   *
   * They need enough to render the call — title, host, settings, who is in the
   * room — and none of the organisational detail around it. Who was *invited*
   * is a list of names and addresses belonging to the host's organisation, and
   * somebody who joined by typing a name into a box has no claim on it.
   */
  const isGuest = Boolean(user.isGuest);
  const occurrence = currentOccurrence(meeting);
  const window = joinWindow(meeting, occurrence);

  return {
    code: meeting.code,
    title: meeting.title,
    agenda: meeting.agenda,
    status: meeting.status,

    host: { texorId: meeting.hostTexorId, name: meeting.hostName, email: meeting.hostEmail },
    cohostTexorIds: meeting.cohostTexorIds,
    channel: meeting.channel ? meeting.channel.toString() : null,

    access: meeting.access,
    lobby: meeting.lobby,
    settings: meeting.settings,

    scheduledStart: meeting.scheduledStart,
    scheduledEnd: meeting.scheduledEnd,
    timezone: meeting.timezone,
    recurrence: meeting.recurrence,
    nextOccurrence: occurrence ? { start: occurrence.start, end: occurrence.end } : null,
    opensAt: window.opensAt,

    startedAt: meeting.startedAt,
    endedAt: meeting.endedAt,
    maxDurationMinutes: meeting.maxDurationMinutes,

    /**
     * The timer's inputs, rather than a number computed here.
     *
     * The client ticks once a second and the server is asked for a meeting
     * once; sending an elapsed figure would be stale before it was drawn. These
     * two describe the clock — banked time, and when the current stretch
     * started — so the browser can run it without asking again.
     */
    activeMs: meeting.activeMs ?? 0,
    activeSince: meeting.activeSince ?? null,
    maxParticipants: meeting.maxParticipants,

    quality: effectiveTier(meeting.quality, policy?.maxQuality),
    // Only a host can change it, so only a host is told what the options are.
    qualityOptions: isHost && policy ? availableTiers(policy.maxQuality) : undefined,
    qualityCeiling: isHost && policy ? policy.maxQuality : undefined,

    // Emails of other invitees are host-only: a meeting invite should not hand
    // every attendee the address book of everyone else who was asked.
    invitees: isGuest
      ? []
      : meeting.invitees.map((invitee) => ({
          name: invitee.name,
          role: invitee.role,
          response: invitee.response,
          texorId: invitee.texorId,
          email: isHost || invitee.texorId === user.texorId ? invitee.email : undefined,
        })),

    participants: meeting.liveAttendance().map((entry) => ({
      texorId: entry.texorId,
      name: entry.name,
      picture: entry.picture,
      role: entry.role,
      joinedAt: entry.firstJoinedAt,
    })),
    participantCount: meeting.liveAttendance().length,

    /**
     * Who is connected *right now*, which is not the same question.
     *
     * `participantCount` comes from the attendance rows, and those lag: a row
     * stays open until somebody says goodbye or until the reaper notices the
     * silence ninety seconds later. An open socket is the ground truth, so this
     * is what "is anyone in there" has to be answered with — it is why a room
     * everybody walked out of used to keep advertising itself as live.
     */
    presentCount: connectedTexorIds(meeting.code).length,

    attendance: isHost
      ? meeting.attendance.map((entry) => ({
          texorId: entry.texorId,
          name: entry.name,
          email: entry.email,
          role: entry.role,
          firstJoinedAt: entry.firstJoinedAt,
          leftAt: entry.leftAt,
          joins: entry.joins,
        }))
      : undefined,

    viewer: {
      role,
      isHost,
      isGuest,
      isExternal: isExternalEmail(user.email),
      canEdit: isHost,
      response:
        meeting.invitees.find((invitee) => invitee.texorId === user.texorId)?.response ?? null,
    },

    joinUrl: `${env.appOrigin}/meetings/${meeting.code}`,
    ...(policy ? { policy: { forceLobbyForExternal: policy.forceLobbyForExternal } } : {}),
  };
}

/**
 * What the browser is allowed to do once it opens the media socket.
 *
 * Advisory, and deliberately so — it tells the UI which controls to draw. Each
 * of these is checked again by the signalling layer when a track is actually
 * offered, which is the only place refusing it means anything.
 */
function mediaGrant(meeting, role, policy) {
  const isModerator = role === 'host' || role === 'cohost';
  /**
   * Resolved here, not in the browser.
   *
   * The client needs concrete numbers to configure its encoders, and those
   * numbers are the host's choice clamped by what the organisation allows. A
   * client that made its own decision could spend whatever it liked.
   */
  const tier = effectiveTier(meeting.quality, policy?.maxQuality);
  const limits = limitsFor(tier);

  return {
    role,
    isModerator,
    quality: {
      tier,
      name: limits.name,
      cameraBitrate: limits.cameraBitrate,
      cameraDegradation: limits.cameraDegradation,
      screenBitrate: limits.screenBitrate,
      screenFrameRate: limits.screenFrameRate,
      screenMaxHeight: limits.screenMaxHeight,
    },
    canShareScreen: meeting.settings.screenShare === 'everyone' || isModerator,
    allowChat: meeting.settings.allowChat,
    startMuted: meeting.settings.muteOnEntry && !isModerator,
    startCameraOff: meeting.settings.videoOffOnEntry,
  };
}

// ── Meetings ─────────────────────────────────────────────────────────────────

export async function listMeetings(req, res) {
  const { scope, limit } = req.query;

  // Anything the viewer hosts, co-hosts, was invited to, or has been in.
  const mine = {
    $or: [
      { hostTexorId: req.user.texorId },
      { cohostTexorIds: req.user.texorId },
      { 'invitees.texorId': req.user.texorId },
      { 'invitees.email': req.user.email?.toLowerCase() },
      { 'attendance.texorId': req.user.texorId },
    ],
  };

  const filters = {
    upcoming: { status: { $in: ['scheduled', 'live'] } },
    live: { status: 'live' },
    /**
     * Rooms this person has actually been inside, which is the set worth
     * showing them as "happening now". Narrowed below to the ones somebody is
     * in at this moment — a room is not live because a column says so.
     */
    joined: { 'attendance.texorId': req.user.texorId },
    past: { status: { $in: ['ended', 'cancelled'] } },
    all: {},
  };

  const meetings = await Meeting.find({ ...mine, ...filters[scope] })
    .sort(scope === 'past' ? { endedAt: -1, updatedAt: -1 } : { scheduledStart: 1, createdAt: -1 })
    .limit(limit)
    .exec();

  /**
   * Presence cannot be a query.
   *
   * Who is connected lives in this process's memory, not in Mongo, so the
   * occupied rooms have to be picked out after the fetch. This is also the
   * sweep that `listMeetings` never had: it goes straight to `Meeting.find`
   * rather than through `loadMeeting`, so nothing here ever reconciled status
   * against reality and an abandoned meeting was listed as live indefinitely.
   */
  const rows = scope === 'joined' || scope === 'live'
    ? meetings.filter((meeting) => connectedTexorIds(meeting.code).length > 0)
    : meetings;

  res.json({ meetings: rows.map((meeting) => presentMeeting(meeting, req.user)) });
}

/**
 * What a host is about to be bound by, before they create anything.
 *
 * The start-a-meeting dialog asks two questions whose answers the organisation
 * can override — `forceLobbyForExternal` holds outside guests in the lobby even
 * when the host turns the waiting room off, and `allowExternalGuests` can shut
 * guests out of an "anyone with the code" meeting altogether. Without this the
 * dialog could only guess, so it promised "everyone walks in" and the guest was
 * made to knock anyway, with nothing on screen explaining why.
 *
 * Read-only, and only the three rules the dialog has to tell the truth about.
 */
export async function getMeetingDefaults(req, res) {
  const policy = await getPolicy();
  const defaults = meetingDefaults(policy);

  res.json({
    defaults: {
      lobby: defaults.lobby,
      forceLobbyForExternal: policy.forceLobbyForExternal,
      allowExternalGuests: policy.allowExternalGuests,
    },
  });
}

export async function createMeeting(req, res) {
  const policy = await assertCanCreateMeeting(req.user);
  const defaults = meetingDefaults(policy);
  const body = req.body;

  let channel = null;
  if (body.channelId) {
    channel = await Channel.findById(body.channelId).exec();
    if (!channel) throw ApiError.notFound('That channel does not exist.');
    if (!channel.canBeReadBy(req.user.texorId)) {
      throw ApiError.forbidden('You are not a member of that channel.');
    }
  }

  const meeting = await Meeting.create({
    code: await allocateCode(),

    title: body.title,
    agenda: body.agenda,

    hostTexorId: req.user.texorId,
    hostName: req.user.displayName,
    hostEmail: req.user.email,

    channel: channel?._id ?? null,
    access: body.access,
    lobby: body.lobby ?? defaults.lobby,

    invitees: body.invitees,

    scheduledStart: body.scheduledStart,
    scheduledEnd: body.scheduledEnd,
    timezone: body.timezone,
    recurrence: body.recurrence,

    settings: { ...defaults.settings, ...body.settings },

    // Snapshotted from the policy in force today, so tightening the limit next
    // month does not retroactively shorten a meeting already in the calendar.
    maxDurationMinutes: defaults.maxDurationMinutes,
    maxParticipants: defaults.maxParticipants,

    createdBy: req.user.texorId,
  });

  await record({
    action: ACTIONS.MEETING_CREATED,
    actor: req.user,
    meeting,
    metadata: {
      title: meeting.title,
      access: meeting.access,
      lobby: meeting.lobby,
      scheduledStart: meeting.scheduledStart,
      recurrence: meeting.recurrence.freq,
      invitees: meeting.invitees.length,
      channel: channel?.slug ?? null,
    },
    req,
  });

  // A meeting started from a channel announces itself there, so the people in
  // the conversation get the link without anyone having to paste it.
  if (channel) {
    const message = await Message.create({
      channel: channel._id,
      authorTexorId: req.user.texorId,
      authorName: req.user.displayName,
      authorPicture: req.user.picture,
      body: `started a meeting — ${meeting.title}: ${env.appOrigin}/meetings/${meeting.code}`,
    });

    await Channel.updateOne(
      { _id: channel._id },
      { $set: { lastMessageAt: message.createdAt }, $inc: { messageCount: 1 } },
    );
  }

  res.status(201).json({ meeting: presentMeeting(meeting, req.user, { policy }) });
}

export async function getMeeting(req, res) {
  const meeting = await loadMeeting(req.params.code);
  assertGuestScope(req.user, meeting);
  const policy = await getPolicy();

  if (meeting.access === 'invited' && meeting.roleOf(req.user.texorId, req.user.email) === 'guest') {
    throw ApiError.forbidden('This meeting is for invited people only.');
  }

  res.json({ meeting: presentMeeting(meeting, req.user, { policy }) });
}

export async function updateMeeting(req, res) {
  const meeting = await loadMeeting(req.params.code);
  requireHost(meeting, req.user);

  const policy = await getPolicy();

  /**
   * A host may lower quality freely and raise it only to the organisation's
   * ceiling. Refused rather than silently clamped, because a host who asked for
   * High and got Standard without being told would reasonably conclude the
   * setting was broken.
   */
  if (req.body.quality && effectiveTier(req.body.quality, policy.maxQuality) !== req.body.quality) {
    throw ApiError.forbidden(
      `Your organisation's plan allows up to "${policy.maxQuality}" quality.`,
    );
  }

  const changed = {};

  for (const [key, value] of Object.entries(req.body)) {
    if (value === undefined) continue;

    if (key === 'settings') {
      meeting.settings = { ...meeting.settings.toObject(), ...value };
    } else if (key === 'recurrence') {
      meeting.recurrence = { ...meeting.recurrence.toObject(), ...value };
    } else {
      meeting[key] = value;
    }

    changed[key] = value;
  }

  if (meeting.scheduledEnd && meeting.scheduledStart && meeting.scheduledEnd <= meeting.scheduledStart) {
    throw ApiError.badRequest('The meeting has to end after it starts.', [
      { field: 'scheduledEnd', message: 'Must be after the start time.' },
    ]);
  }

  await meeting.save();

  /**
   * A quality change lands on the call that is already running.
   *
   * The same change can arrive from the bar during the call, and the two routes
   * have to end up in the same place — a host editing the settings page mid-
   * meeting should not have to make everyone rejoin for it to take effect. A
   * no-op when nobody is connected.
   */
  if (changed.quality) {
    await updateRoomQuality(meeting.code, changed.quality, req.user.displayName);
  }

  await record({
    action: ACTIONS.MEETING_UPDATED,
    actor: req.user,
    meeting,
    metadata: { changed: Object.keys(changed) },
    req,
  });

  res.json({ meeting: presentMeeting(meeting, req.user, { policy }) });
}

export async function cancelMeeting(req, res) {
  const meeting = await loadMeeting(req.params.code);
  requireHost(meeting, req.user);

  meeting.status = 'cancelled';
  // A cancelled recurring meeting cancels the whole series. Cancelling one
  // occurrence would need exception dates, which this version does not have —
  // moving a single week means editing the meeting, not cancelling it.
  meeting.endedAt = new Date();
  meeting.endedReason = 'cancelled by host';
  for (const entry of meeting.attendance) if (!entry.leftAt) entry.leftAt = meeting.endedAt;

  await Knock.updateMany(
    { meeting: meeting._id, status: 'waiting' },
    { $set: { status: 'denied', decidedAt: new Date() } },
  );
  await meeting.save();

  await record({ action: ACTIONS.MEETING_CANCELLED, actor: req.user, meeting, req });

  res.json({ meeting: presentMeeting(meeting, req.user) });
}

// ── Guests ───────────────────────────────────────────────────────────────────

/**
 * What an unauthenticated visitor is allowed to know about a meeting.
 *
 * Almost nothing, and that is the point: whoever is asking has proved nothing,
 * and the code may well have been forwarded to them by mistake. Enough to
 * render a join screen — the title, whether guests are welcome, whether they
 * will be held in the lobby — and not the agenda, the host's address, who is
 * invited or who is currently in the room.
 */
export async function guestPreview(req, res) {
  const meeting = await loadMeeting(req.params.code);
  const policy = await getPolicy();
  const { allowed, reason } = guestsAllowed(meeting, policy);

  res.json({
    meeting: {
      code: meeting.code,
      title: meeting.title,
      hostName: meeting.hostName,
      status: meeting.status,
    },
    guests: {
      allowed,
      reason: reason ?? null,
      /**
       * Worth saying before they type a name, not after — and it has to be the
       * rule that will actually be applied to *them*. This read `meeting.lobby`
       * alone, so a host who turned the waiting room off had their guests told
       * they would walk straight in, and then held at the door anyway by
       * `forceLobbyForExternal`. A guest has no account and is external by
       * definition, which is the question `effectiveLobby` answers.
       */
      willWait: allowed && effectiveLobby(meeting, policy, { isExternal: true }) !== 'off',
    },
  });
}

/**
 * Issues a guest pass for one meeting.
 *
 * The cookie this sets is scoped to this meeting and grants nothing else in the
 * product — see `guest.service.js` for why it is not a session.
 */
export async function joinAsGuest(req, res) {
  const meeting = await loadMeeting(req.params.code);
  const policy = await getPolicy();

  const { allowed, reason } = guestsAllowed(meeting, policy);
  if (!allowed) throw ApiError.forbidden(reason);

  // Somebody already signed in has no business taking a guest pass; it would
  // only downgrade them and confuse every record of who was in the room.
  if (req.user && !req.user.isGuest) {
    throw ApiError.badRequest('You are already signed in — join with your Texor Account.');
  }

  const name = cleanGuestName(req.body.name);
  const { token, guestId } = await createGuestSession({
    meeting,
    name,
    ip: req.ip ?? '',
    userAgent: req.get('user-agent') ?? '',
  });

  res.cookie(GUEST_COOKIE, token, guestCookieOptions());

  await record({
    action: ACTIONS.GUEST_ADMITTED_PASS,
    actor: { texorId: guestId, displayName: name, email: '' },
    meeting,
    metadata: { name },
    req,
  });

  res.status(201).json({ guest: { texorId: guestId, displayName: name, isGuest: true } });
}

export async function leaveAsGuest(req, res) {
  await revokeGuest(req.guestToken);
  res.clearCookie(GUEST_COOKIE, { ...guestCookieOptions(), maxAge: undefined });
  res.json({ ok: true });
}

// ── Joining ──────────────────────────────────────────────────────────────────

/**
 * Asks to join.
 *
 * Answers one of two ways: `admitted`, with everything needed to open the room,
 * or `waiting`, with a knock id to poll. The refusals come back as errors with
 * a code the frontend can act on — `too_early` shows a countdown rather than
 * the word "forbidden".
 */
export async function joinMeeting(req, res) {
  const meeting = await loadMeeting(req.params.code);
  assertGuestScope(req.user, meeting);
  const policy = await getPolicy();

  const { outcome, role } = await evaluateJoin({ meeting, user: req.user, policy });

  if (outcome === 'knock') {
    const expiresAt = new Date(Date.now() + KNOCK_TTL_MS);

    // Upsert, so hitting refresh on the waiting page does not queue a second
    // request in front of every host.
    const knock = await Knock.findOneAndUpdate(
      { meeting: meeting._id, texorId: req.user.texorId, status: 'waiting' },
      {
        $set: {
          name: req.user.displayName,
          email: req.user.email,
          picture: req.user.picture,
          isGuest: Boolean(req.user.isGuest),
          expiresAt,
        },
        $setOnInsert: { meeting: meeting._id, texorId: req.user.texorId, status: 'waiting' },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );

    // Straight to every host's call panel, rather than on the next tick.
    await refreshKnocks(meeting.code);

    await record({
      action: ACTIONS.LOBBY_KNOCKED,
      actor: req.user,
      meeting,
      metadata: { role },
      req,
    });

    return res.json({
      status: 'waiting',
      knockId: knock._id.toString(),
      expiresAt: knock.expiresAt,
      meeting: presentMeeting(meeting, req.user),
    });
  }

  const { started } = await markJoined({ meeting, user: req.user, role });

  if (started) {
    await record({ action: ACTIONS.MEETING_STARTED, actor: req.user, meeting, req });
  }
  await record({
    action: ACTIONS.MEETING_JOINED,
    actor: req.user,
    meeting,
    metadata: { role, external: isExternalEmail(req.user.email) },
    req,
  });

  return res.json({
    status: 'admitted',
    media: mediaGrant(meeting, role, policy),
    meeting: presentMeeting(meeting, req.user, { policy }),
  });
}

/** The waiting person polls this until a host decides. */
export async function getKnock(req, res) {
  const meeting = await loadMeeting(req.params.code);
  assertGuestScope(req.user, meeting);

  const knock = await Knock.findOne({ _id: req.params.knockId, meeting: meeting._id }).exec();
  // A knock that has aged out of the TTL index is simply gone, and that is an
  // answer in itself rather than an error.
  if (!knock) return res.json({ status: 'expired' });

  if (knock.texorId !== req.user.texorId) throw ApiError.forbidden('That is not your request.');

  if (knock.status !== 'admitted') {
    return res.json({ status: knock.status, expiresAt: knock.expiresAt });
  }

  // Admission is the host's decision; the checks still run, because the state
  // of the meeting can have moved on between the click and this poll.
  const policy = await getPolicy();
  const role = meeting.roleOf(req.user.texorId, req.user.email);

  if (meeting.status === 'ended' || meeting.status === 'cancelled') {
    return res.json({ status: 'expired' });
  }

  // The waiting client polls until it sees `admitted`, and can poll once more
  // before it navigates. Only the first of those is a join worth recording.
  const { wasPresent } = await markJoined({ meeting, user: req.user, role });

  if (!wasPresent) {
    await record({
      action: ACTIONS.MEETING_JOINED,
      actor: req.user,
      meeting,
      metadata: { role, viaLobby: true },
      req,
    });
  }

  return res.json({
    status: 'admitted',
    media: mediaGrant(meeting, role, policy),
    meeting: presentMeeting(meeting, req.user, { policy }),
  });
}

export async function cancelKnock(req, res) {
  const meeting = await loadMeeting(req.params.code);
  assertGuestScope(req.user, meeting);

  await Knock.deleteOne({
    _id: req.params.knockId,
    meeting: meeting._id,
    texorId: req.user.texorId,
  });

  // Somebody who gave up waiting should stop being offered for admission.
  await refreshKnocks(meeting.code);

  res.json({ ok: true });
}

/** The host's admit list. */
export async function listKnocks(req, res) {
  const meeting = await loadMeeting(req.params.code);
  requireHost(meeting, req.user);

  const knocks = await Knock.find({ meeting: meeting._id, status: 'waiting' })
    .sort({ createdAt: 1 })
    .lean();

  res.json({
    knocks: knocks.map((knock) => ({
      id: knock._id.toString(),
      name: knock.name,
      email: knock.email,
      picture: knock.picture,
      texorId: knock.texorId,
      // A guest is external whatever the domain configuration says.
      isExternal: Boolean(knock.isGuest) || isExternalEmail(knock.email),
      isGuest: Boolean(knock.isGuest),
      knockedAt: knock.createdAt,
    })),
  });
}

export async function decideKnock(req, res) {
  const meeting = await loadMeeting(req.params.code);
  requireHost(meeting, req.user);

  const admit = req.body.decision === 'admit';

  // Conditional on still being `waiting`, so two hosts clicking at once
  // produce one decision and one audit line rather than two of each.
  const knock = await Knock.findOneAndUpdate(
    { _id: req.params.knockId, meeting: meeting._id, status: 'waiting' },
    {
      $set: {
        status: admit ? 'admitted' : 'denied',
        decidedByTexorId: req.user.texorId,
        decidedByName: req.user.displayName,
        decidedAt: new Date(),
        // An admitted knock has to outlive the TTL long enough for the waiting
        // client's next poll to find it.
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    },
    { returnDocument: 'after' },
  );

  if (!knock) throw ApiError.notFound('That request is no longer waiting.');

  await record({
    action: admit ? ACTIONS.LOBBY_ADMITTED : ACTIONS.LOBBY_DENIED,
    actor: req.user,
    meeting,
    target: { texorId: knock.texorId, name: knock.name },
    req,
  });

  res.json({ ok: true, status: knock.status });
}

// ── In the call ──────────────────────────────────────────────────────────────

export async function leaveMeeting(req, res) {
  const meeting = await loadMeeting(req.params.code);
  assertGuestScope(req.user, meeting);
  const left = await markLeft({ meeting, texorId: req.user.texorId });

  if (left) {
    await record({ action: ACTIONS.MEETING_LEFT, actor: req.user, meeting, req });
  }

  res.json({ ok: true });
}

export async function endMeetingNow(req, res) {
  const meeting = await loadMeeting(req.params.code);
  requireHost(meeting, req.user);

  await endMeeting({ meeting, reason: `ended by ${req.user.displayName}` });
  endRoom(meeting.code, `${req.user.displayName} ended the meeting.`);

  await record({
    action: ACTIONS.MEETING_ENDED,
    actor: req.user,
    meeting,
    metadata: { reason: 'ended by host' },
    req,
  });

  res.json({ meeting: presentMeeting(meeting, req.user) });
}

/**
 * Removes someone from the meeting.
 *
 * Both halves happen here: the database blocks them from rejoining, and the SFU
 * drops their socket and closes their transports. Their media stops at our end
 * whether or not their browser cooperates, because the media server is this
 * process — there is nothing to ask nicely.
 */
export async function removeParticipant(req, res) {
  const meeting = await loadMeeting(req.params.code);
  requireHost(meeting, req.user);

  const { texorId } = req.params;

  if (texorId === meeting.hostTexorId) {
    throw ApiError.badRequest('The host cannot be removed from their own meeting.');
  }

  const entry = meeting.attendance.find((item) => item.texorId === texorId);

  if (!meeting.removedTexorIds.includes(texorId)) meeting.removedTexorIds.push(texorId);
  meeting.cohostTexorIds = meeting.cohostTexorIds.filter((id) => id !== texorId);
  if (entry && !entry.leftAt) entry.leftAt = new Date();

  await meeting.save();

  ejectPeer(meeting.code, texorId, `${req.user.displayName} removed you from the meeting.`);

  await record({
    action: ACTIONS.PARTICIPANT_REMOVED,
    actor: req.user,
    meeting,
    target: { texorId, name: entry?.name ?? '' },
    req,
  });

  res.json({ meeting: presentMeeting(meeting, req.user) });
}

/** Promotes someone to co-host, or puts them back. Host only — not co-hosts. */
export async function setParticipantRole(req, res) {
  const meeting = await loadMeeting(req.params.code);

  if (meeting.hostTexorId !== req.user.texorId) {
    throw ApiError.forbidden('Only the host can change roles.');
  }

  const { texorId } = req.params;
  if (texorId === meeting.hostTexorId) {
    throw ApiError.badRequest('The host already has every permission.');
  }

  const promote = req.body.role === 'cohost';

  meeting.cohostTexorIds = promote
    ? [...new Set([...meeting.cohostTexorIds, texorId])]
    : meeting.cohostTexorIds.filter((id) => id !== texorId);

  const invitee = meeting.invitees.find((item) => item.texorId === texorId);
  if (invitee) invitee.role = promote ? 'cohost' : 'participant';

  const entry = meeting.attendance.find((item) => item.texorId === texorId);
  if (entry) entry.role = promote ? 'cohost' : 'participant';

  await meeting.save();

  await record({
    action: promote ? ACTIONS.ROLE_GRANTED : ACTIONS.ROLE_REVOKED,
    actor: req.user,
    meeting,
    target: { texorId, name: entry?.name ?? invitee?.name ?? '' },
    metadata: { role: promote ? 'cohost' : 'participant' },
    req,
  });

  /**
   * Takes effect immediately, including for someone already in the call.
   *
   * This is what owning the media layer buys. When moderator status lived in a
   * token minted for somebody else's service, a promotion could not reach the
   * token the user was already holding and only applied on their next join.
   * Here the role is a field on their peer, and changing it is one assignment.
   */
  const appliedLive = updatePeerRole(meeting.code, texorId, promote ? 'cohost' : 'participant');

  res.json({ meeting: presentMeeting(meeting, req.user), appliedLive });
}

/**
 * Hands the meeting to somebody else.
 *
 * A meeting has exactly one host, and that host leaving should not mean the
 * meeting loses the ability to admit people, mute anyone or end cleanly. The
 * outgoing host becomes a co-host rather than a plain participant: they called
 * the meeting, and demoting them to nothing on the way out would be a strange
 * thing to do to them if they come back.
 */
export async function transferHost(req, res) {
  const meeting = await loadMeeting(req.params.code);

  if (meeting.hostTexorId !== req.user.texorId) {
    throw ApiError.forbidden('Only the host can hand the meeting over.');
  }

  const { texorId } = req.body;
  if (texorId === meeting.hostTexorId) {
    throw ApiError.badRequest('They are already the host.');
  }

  // Handing it to somebody who is not there leaves the meeting hostless the
  // moment the current host goes, which is the situation this exists to avoid.
  const present = meeting.attendance.find((entry) => entry.texorId === texorId && !entry.leftAt);
  if (!present) throw ApiError.badRequest('They are not in the meeting.');
  if (meeting.isRemoved(texorId)) throw ApiError.badRequest('They were removed from this meeting.');

  const previous = meeting.hostTexorId;
  meeting.hostTexorId = texorId;
  meeting.hostName = present.name;
  meeting.hostEmail = present.email ?? '';

  meeting.cohostTexorIds = [
    ...new Set([...meeting.cohostTexorIds.filter((id) => id !== texorId), previous]),
  ];

  const entry = meeting.attendance.find((item) => item.texorId === texorId);
  if (entry) entry.role = 'host';
  const outgoing = meeting.attendance.find((item) => item.texorId === previous);
  if (outgoing) outgoing.role = 'cohost';

  await meeting.save();

  // Live, both ways, so neither of them has to rejoin to get their controls.
  updatePeerRole(meeting.code, texorId, 'host');
  updatePeerRole(meeting.code, previous, 'cohost');

  await record({
    action: ACTIONS.HOST_TRANSFERRED,
    actor: req.user,
    meeting,
    target: { texorId, name: present.name },
    req,
  });

  res.json({ meeting: presentMeeting(meeting, req.user) });
}

// ── Invitations ──────────────────────────────────────────────────────────────

export async function addInvitees(req, res) {
  const meeting = await loadMeeting(req.params.code);
  requireHost(meeting, req.user);

  const policy = await getPolicy();
  const added = [];

  for (const invitee of req.body.invitees) {
    if (meeting.invitees.some((existing) => existing.email === invitee.email)) continue;

    if (isExternalEmail(invitee.email) && !policy.allowExternalGuests) {
      throw ApiError.forbidden(
        `${invitee.email} is outside the organisation, and your policy does not allow external guests.`,
      );
    }

    meeting.invitees.push(invitee);
    added.push(invitee.email);
  }

  await meeting.save();

  if (added.length) {
    await record({
      action: ACTIONS.INVITEE_ADDED,
      actor: req.user,
      meeting,
      metadata: { emails: added },
      req,
    });
  }

  res.json({ meeting: presentMeeting(meeting, req.user), added });
}

export async function removeInvitee(req, res) {
  const meeting = await loadMeeting(req.params.code);
  requireHost(meeting, req.user);

  const email = decodeURIComponent(req.params.email).toLowerCase();
  const before = meeting.invitees.length;

  meeting.invitees = meeting.invitees.filter((invitee) => invitee.email !== email);
  if (meeting.invitees.length === before) throw ApiError.notFound('That person is not invited.');

  await meeting.save();
  await record({
    action: ACTIONS.INVITEE_REMOVED,
    actor: req.user,
    meeting,
    metadata: { email },
    req,
  });

  res.json({ meeting: presentMeeting(meeting, req.user) });
}

export async function respondToInvite(req, res) {
  const meeting = await loadMeeting(req.params.code);

  const invitee = meeting.invitees.find(
    (item) => item.texorId === req.user.texorId || item.email === req.user.email?.toLowerCase(),
  );
  if (!invitee) throw ApiError.notFound('You are not on the invitation list for this meeting.');

  invitee.response = req.body.response;
  invitee.respondedAt = new Date();
  // Binds the invite to the account that answered it, so an invitation sent to
  // an address now resolves to a person for every later lookup.
  invitee.texorId = invitee.texorId ?? req.user.texorId;

  await meeting.save();
  await record({
    action: ACTIONS.INVITE_RESPONDED,
    actor: req.user,
    meeting,
    metadata: { response: invitee.response },
    req,
  });

  res.json({ meeting: presentMeeting(meeting, req.user) });
}

/** The calendar file. Served to anyone who can see the meeting. */
export async function downloadInvite(req, res) {
  const meeting = await loadMeeting(req.params.code);

  if (meeting.access === 'invited' && meeting.roleOf(req.user.texorId, req.user.email) === 'guest') {
    throw ApiError.forbidden('This meeting is for invited people only.');
  }

  const ics = meetingInvite({
    meeting,
    joinUrl: `${env.appOrigin}/meetings/${meeting.code}`,
    organizer: { name: meeting.hostName, email: meeting.hostEmail },
    // Every edit bumps the document version, which is exactly what SEQUENCE is
    // for — calendars use it to tell an update from a duplicate.
    sequence: meeting.__v ?? 0,
    method: meeting.status === 'cancelled' ? 'CANCEL' : 'REQUEST',
  });

  res.set('content-type', 'text/calendar; charset=utf-8');
  res.set('content-disposition', `attachment; filename="${meeting.code}.ics"`);
  res.send(ics);
}

export default {
  guestPreview,
  joinAsGuest,
  leaveAsGuest,
  listMeetings,
  createMeeting,
  getMeeting,
  updateMeeting,
  cancelMeeting,
  joinMeeting,
  getKnock,
  cancelKnock,
  listKnocks,
  decideKnock,
  leaveMeeting,
  endMeetingNow,
  removeParticipant,
  setParticipantRole,
  transferHost,
  addInvitees,
  removeInvitee,
  respondToInvite,
  downloadInvite,
};
