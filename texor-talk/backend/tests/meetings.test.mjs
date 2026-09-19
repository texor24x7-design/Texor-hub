/**
 * End-to-end exercise of the meeting API.
 *
 * Texor Account is not running here, so sessions are seeded straight into Mongo
 * the same way auth.controller would have. Everything after that is real HTTP.
 */
import mongoose from 'mongoose';
import { connectForTests } from './db.mjs';
import { createHash, randomBytes } from 'node:crypto';

const API = process.env.TEST_API ?? 'http://localhost:4102';


const sha256 = (v) => createHash('sha256').update(v).digest('hex');

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  ok   ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label} ${extra}`); }
};

await connectForTests(process.env.MONGODB_URI);
const db = mongoose.connection.db;

// Clean slate for the collections this script touches.
for (const c of ['meetings', 'knocks', 'auditevents', 'auditcounters', 'policies', 'users', 'sessions']) {
  await db.collection(c).deleteMany({}).catch(() => {});
}

async function seedUser({ texorId, email, displayName }) {
  const now = new Date();
  const { insertedId } = await db.collection('users').insertOne({
    texorId, email, displayName, picture: '', status: 'active', statusText: '',
    lastSeenAt: now, createdAt: now, updatedAt: now, __v: 0,
  });
  const token = randomBytes(32).toString('base64url');
  await db.collection('sessions').insertOne({
    user: insertedId, texorId, tokenHash: sha256(token),
    accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null,
    userAgent: 'e2e', ip: '127.0.0.1',
    expiresAt: new Date(Date.now() + 864e5), revokedAt: null,
    createdAt: now, updatedAt: now, __v: 0,
  });
  return { texorId, email, displayName, cookie: `talk_sid=${token}` };
}

async function call(user, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { cookie: user.cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { status: res.status, body: payload, headers: res.headers };
}

const host = await seedUser({ texorId: 'tx-host', email: 'host@texor.app', displayName: 'Hana Host' });
const member = await seedUser({ texorId: 'tx-mem', email: 'mem@texor.app', displayName: 'Mo Member' });
const guest = await seedUser({ texorId: 'tx-guest', email: 'guest@outside.com', displayName: 'Gina Guest' });
const admin = await seedUser({ texorId: 'tx-admin', email: 'isuryakarthikvarma@gmail.com', displayName: 'Admin' });

console.log('\n── identity ──');
const meAdmin = await call(admin, '/api/auth/me');
check('admin is flagged admin via ADMIN_EMAILS', meAdmin.body.user?.isAdmin === true, JSON.stringify(meAdmin.body));
const meHost = await call(host, '/api/auth/me');
check('ordinary user is not admin', meHost.body.user?.isAdmin === false);
check('unauthenticated meeting list is 401', (await (await fetch(`${API}/api/meetings`)).status) === 401);

console.log('\n── create an instant meeting ──');
const created = await call(host, '/api/meetings', {
  method: 'POST',
  body: { title: 'Daily standup', agenda: 'what moved', access: 'texor' },
});
check('created', created.status === 201, JSON.stringify(created.body).slice(0, 300));
const code = created.body.meeting?.code;
check('code looks like xxx-xxxx-xxx', /^[bcdfghjkmnpqrstvwxyz]{3}-[bcdfghjkmnpqrstvwxyz]{4}-[bcdfghjkmnpqrstvwxyz]{3}$/.test(code ?? ''), code);
check('roomName is never exposed', !JSON.stringify(created.body).includes('texor-') || !created.body.meeting.roomName);
check('viewer is host', created.body.meeting?.viewer?.isHost === true);

console.log('\n── join, lobby, admit ──');
const hostJoin = await call(host, `/api/meetings/${code}/join`, { method: 'POST' });
check('host admitted straight away', hostJoin.body.status === 'admitted', JSON.stringify(hostJoin.body).slice(0, 200));
check('grant marks the host a moderator', hostJoin.body.media?.isModerator === true, JSON.stringify(hostJoin.body.media));
check('grant lets the host share their screen', hostJoin.body.media?.canShareScreen === true);
check('host is not muted on entry', hostJoin.body.media?.startMuted === false);
check('the grant names no external service and carries no token',
  !JSON.stringify(hostJoin.body.media).match(/token|domain|jitsi|roomName/i), JSON.stringify(hostJoin.body.media));
check('meeting went live', hostJoin.body.meeting?.status === 'live');

/**
 * "People outside your organisation knock" means outsiders.
 *
 * The lobby defaults to 'external' and ORG_EMAIL_DOMAINS is empty here, so
 * nobody with an account counts as outside — an uninvited colleague walks in.
 * It used to hold them too, because roleOf calls anybody not on the invite
 * list a 'guest', and the label said nothing of the kind.
 */
const walkIn = await call(member, `/api/meetings/${code}/join`, { method: 'POST' });
check('an uninvited colleague walks in when nobody counts as outside',
  walkIn.body.status === 'admitted', JSON.stringify(walkIn.body).slice(0, 200));
await call(member, `/api/meetings/${code}/leave`, { method: 'POST' });

// The host tightens the door. The pass the colleague earned under the looser
// rule goes with it, so coming back means knocking.
const tightened = await call(host, `/api/meetings/${code}`, { method: 'PATCH', body: { lobby: 'everyone' } });
check('the host can switch to everyone knocks', tightened.body.meeting?.lobby === 'everyone');

const memberJoin = await call(member, `/api/meetings/${code}/join`, { method: 'POST' });
check('and then the same colleague has to knock',
  memberJoin.body.status === 'waiting', JSON.stringify(memberJoin.body).slice(0, 200));
const knockId = memberJoin.body.knockId;

const knockList = await call(host, `/api/meetings/${code}/knocks`);
check('host sees one waiting', knockList.body.knocks?.length === 1, JSON.stringify(knockList.body));
check('non-host cannot see the admit list', (await call(member, `/api/meetings/${code}/knocks`)).status === 403);

const waiting = await call(member, `/api/meetings/${code}/knocks/${knockId}/status`);
check('waiting person sees waiting', waiting.body.status === 'waiting');
check('a third party cannot poll someone else’s knock', (await call(guest, `/api/meetings/${code}/knocks/${knockId}/status`)).status === 403);

const admit = await call(host, `/api/meetings/${code}/knocks/${knockId}`, { method: 'POST', body: { decision: 'admit' } });
check('host admits', admit.status === 200 && admit.body.status === 'admitted', JSON.stringify(admit.body));
const afterAdmit = await call(member, `/api/meetings/${code}/knocks/${knockId}/status`);
check('admitted member now gets a media grant', afterAdmit.body.status === 'admitted' && !!afterAdmit.body.media);
check('admitted member is not a moderator', afterAdmit.body.media?.isModerator === false);
check('admitted member is muted on entry', afterAdmit.body.media?.startMuted === true);
check('double-deciding a knock is a 404', (await call(host, `/api/meetings/${code}/knocks/${knockId}`, { method: 'POST', body: { decision: 'deny' } })).status === 404);

console.log('\n── roles and removal ──');
check('the heartbeat endpoint is gone — presence lives on the socket',
  (await call(member, `/api/meetings/${code}/heartbeat`, { method: 'POST' })).status === 404);
const roster = await call(host, `/api/meetings/${code}`);
check('attendance shows both people', roster.body.meeting.participantCount === 2,
  JSON.stringify(roster.body.meeting.participants));

const promote = await call(host, `/api/meetings/${code}/participants/tx-mem/role`, { method: 'POST', body: { role: 'cohost' } });
check('host promotes to co-host', promote.status === 200 && promote.body.meeting.cohostTexorIds.includes('tx-mem'));
// Nobody is on a media socket in this suite, so there is no live peer to move.
check('promotion reports whether it reached a live call', promote.body.appliedLive === false);
check('co-host cannot change roles', (await call(member, `/api/meetings/${code}/participants/tx-guest/role`, { method: 'POST', body: { role: 'cohost' } })).status === 403);
check('host cannot be removed', (await call(host, `/api/meetings/${code}/participants/tx-host`, { method: 'DELETE' })).status === 400);

const removed = await call(host, `/api/meetings/${code}/participants/tx-mem`, { method: 'DELETE' });
check('host removes a participant', removed.status === 200);
const rejoin = await call(member, `/api/meetings/${code}/join`, { method: 'POST' });
check('removed participant cannot rejoin', rejoin.status === 403, JSON.stringify(rejoin.body));

console.log('\n── scheduling and ics ──');
const start = new Date(Date.now() + 3 * 864e5);
const sched = await call(host, '/api/meetings', {
  method: 'POST',
  body: {
    title: 'Weekly review, Ops & Eng', agenda: 'Roadmap; risks, and budget',
    scheduledStart: start.toISOString(),
    scheduledEnd: new Date(start.getTime() + 45 * 6e4).toISOString(),
    timezone: 'Europe/London',
    recurrence: { freq: 'weekly', interval: 1, count: 8 },
    invitees: [{ email: 'mem@texor.app', name: 'Mo Member', texorId: 'tx-mem', role: 'participant' }],
    access: 'invited',
  },
});
check('scheduled meeting created', sched.status === 201, JSON.stringify(sched.body).slice(0, 300));
const scode = sched.body.meeting?.code;
check('next occurrence computed', !!sched.body.meeting?.nextOccurrence?.start);
check('opensAt is 15 minutes before', new Date(sched.body.meeting.opensAt).getTime() === start.getTime() - 15 * 6e4);

const early = await call(member, `/api/meetings/${scode}/join`, { method: 'POST' });
check('too early to join is a 425', early.status === 425 && early.body.error?.code === 'too_early', JSON.stringify(early.body));
check('uninvited user cannot even read an invite-only meeting', (await call(guest, `/api/meetings/${scode}`)).status === 403);

const ics = await call(host, `/api/meetings/${scode}/invite.ics`);
const icsText = ics.body;
check('ics is served as text/calendar', ics.headers.get('content-type')?.includes('text/calendar'));
check('ics has CRLF endings', typeof icsText === 'string' && icsText.includes('\r\n') && !/[^\r]\n/.test(icsText));
check('ics has a stable uid', icsText.includes(`UID:${scode}@talk.texor.app`));
check('ics carries the weekly rule with a count', /RRULE:FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU);COUNT=8/.test(icsText), icsText.match(/RRULE:.*/)?.[0]);
check('ics escapes the comma in the summary', icsText.includes('SUMMARY:Weekly review\\, Ops & Eng'), icsText.match(/SUMMARY:.*/)?.[0]);
check('ics escapes the semicolon in the description', icsText.includes('Roadmap\\; risks\\, and budget'));
check('ics lists the attendee', icsText.includes('mailto:mem@texor.app'));
check('ics names the organiser', icsText.includes('ORGANIZER;CN=Hana Host:mailto:host@texor.app'));
check('no ics line exceeds 75 octets', icsText.split('\r\n').every((l) => Buffer.byteLength(l, 'utf8') <= 75), icsText.split('\r\n').find((l) => Buffer.byteLength(l) > 75));

const rsvp = await call(member, `/api/meetings/${scode}/rsvp`, { method: 'POST', body: { response: 'accepted' } });
check('invitee can rsvp', rsvp.status === 200 && rsvp.body.meeting.viewer.response === 'accepted', JSON.stringify(rsvp.body).slice(0,200));
check('a stranger cannot rsvp', (await call(guest, `/api/meetings/${scode}/rsvp`, { method: 'POST', body: { response: 'accepted' } })).status === 404);

console.log('\n── invitee privacy ──');
await call(host, `/api/meetings/${scode}/invitees`, { method: 'POST', body: { invitees: [{ email: 'someone@else.com', name: 'Else' }] } });
const asHost = await call(host, `/api/meetings/${scode}`);
const asMember = await call(member, `/api/meetings/${scode}`);
check('host sees every invitee email', asHost.body.meeting.invitees.every((i) => !!i.email));
check('a participant does not see other invitees’ emails', asMember.body.meeting.invitees.filter((i) => i.email).length === 1, JSON.stringify(asMember.body.meeting.invitees));

console.log('\n── validation ──');
check('a meeting needs a title', (await call(host, '/api/meetings', { method: 'POST', body: { title: '' } })).status === 400);
check('end must follow start', (await call(host, '/api/meetings', { method: 'POST', body: { title: 'x', scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() - 6e4).toISOString() } })).status === 400);
check('recurring needs a start', (await call(host, '/api/meetings', { method: 'POST', body: { title: 'x', recurrence: { freq: 'daily' } } })).status === 400);
check('unknown code is a 404', (await call(host, '/api/meetings/zzz-zzzz-zzz')).status === 404);

console.log('\n── admin: policy ──');
check('non-admin is refused the policy', (await call(host, '/api/admin/policy')).status === 403);
const pol = await call(admin, '/api/admin/policy');
check('admin reads the policy', pol.status === 200 && pol.body.policy.lobbyDefault === 'external');
check('policy reports the deployment config', pol.body.environment.joinEarlyMinutes === 15);
check('deployment reports our own SFU, not a third party',
  pol.body.environment.media?.announcedAddress === '127.0.0.1'
  && pol.body.environment.media?.rtcPortRange === '40200-40260',
  JSON.stringify(pol.body.environment.media).slice(0, 200));
check('deployment reports live media workers',
  Array.isArray(pol.body.environment.media?.workers) && pol.body.environment.media.workers.length > 0,
  `${pol.body.environment.media?.workers?.length} workers`);
check('a local announced address is flagged', pol.body.environment.media?.isLocalOnly === true);

const put = await call(admin, '/api/admin/policy', { method: 'PUT', body: { whoCanCreateMeetings: 'allowlist', creatorAllowlist: ['tx-host'], maxDurationMinutes: 45 } });
check('policy updated', put.status === 200 && put.body.changed.length === 3, JSON.stringify(put.body.changed));
check('a no-op update changes nothing', (await call(admin, '/api/admin/policy', { method: 'PUT', body: { maxDurationMinutes: 45 } })).body.changed.length === 0);

check('allowlisted user can still create', (await call(host, '/api/meetings', { method: 'POST', body: { title: 'allowed' } })).status === 201);
const blocked = await call(member, '/api/meetings', { method: 'POST', body: { title: 'blocked' } });
check('non-allowlisted user is blocked from creating', blocked.status === 403, JSON.stringify(blocked.body));
check('an admin is never blocked from creating', (await call(admin, '/api/meetings', { method: 'POST', body: { title: 'admin made' } })).status === 201);

const limited = await call(host, '/api/meetings', { method: 'POST', body: { title: 'inherits the limit' } });
check('new meeting inherits the duration limit', limited.body.meeting.maxDurationMinutes === 45);
check('the earlier meeting kept its old limit', (await call(host, `/api/meetings/${code}`)).body.meeting.maxDurationMinutes === 0);

console.log('\n── admin: audit log ──');
const audit = await call(admin, '/api/admin/audit?limit=200');
const actions = audit.body.events.map((e) => e.action);
check('audit log is populated', audit.body.events.length >= 15, String(audit.body.events.length));
for (const a of ['meeting.created', 'meeting.started', 'meeting.joined', 'lobby.knocked', 'lobby.admitted', 'participant.removed', 'role.granted', 'invite.responded', 'invitee.added', 'policy.updated']) {
  check(`audit recorded ${a}`, actions.includes(a));
}
check('audit is newest-first and gapless', audit.body.events.every((e, i, arr) => i === 0 || arr[i - 1].seq === e.seq + 1));
check('non-admin cannot read the audit log', (await call(host, '/api/admin/audit')).status === 403);
check('policy change records what it changed', audit.body.events.find((e) => e.action === 'policy.updated')?.metadata?.changed?.includes('maxDurationMinutes'));

const verify = await call(admin, '/api/admin/audit/verify');
check('chain verifies clean', verify.body.verification.ok === true, JSON.stringify(verify.body.verification));
check('verification reports a head hash', typeof verify.body.verification.head === 'string');

// Tamper with a row behind the API's back and make sure verification notices.
const victim = await db.collection('auditevents').findOne({ action: 'participant.removed' });
await db.collection('auditevents').updateOne({ _id: victim._id }, { $set: { actorTexorId: 'tx-somebody-else' } });
const tampered = await call(admin, '/api/admin/audit/verify');
check('an edited row is detected', tampered.body.verification.ok === false && tampered.body.verification.tamperedSeqs.includes(victim.seq), JSON.stringify(tampered.body.verification));
await db.collection('auditevents').updateOne({ _id: victim._id }, { $set: { actorTexorId: victim.actorTexorId } });
check('restoring the row clears the finding', (await call(admin, '/api/admin/audit/verify')).body.verification.ok === true);

const deleted = await db.collection('auditevents').findOne({ action: 'lobby.admitted' });
await db.collection('auditevents').deleteOne({ _id: deleted._id });
const gapped = await call(admin, '/api/admin/audit/verify');
check('a deleted row leaves a detected gap', gapped.body.verification.ok === false && gapped.body.verification.missingSeqs.includes(deleted.seq), JSON.stringify(gapped.body.verification));

console.log('\n── admin: meetings ──');
const all = await call(admin, '/api/admin/meetings?status=all&limit=100');
check('admin sees every meeting, not just their own', all.body.meetings.length >= 5, String(all.body.meetings.length));
check('admin meeting rows never leak the room name', !JSON.stringify(all.body).includes('roomName'));

console.log('\n── ending ──');
const ended = await call(host, `/api/meetings/${code}/end`, { method: 'POST' });
check('host ends the meeting', ended.status === 200 && ended.body.meeting.status === 'ended');
check('attendance is closed out', ended.body.meeting.attendance.every((a) => !!a.leftAt), JSON.stringify(ended.body.meeting.attendance));
check('the clock stops when it ends', ended.body.meeting.activeSince === null, String(ended.body.meeting.activeSince));

/**
 * An ended meeting is idle, not finished.
 *
 * This used to be a 410 for everybody but the host, which meant a link shared
 * with ten people stopped working the moment the room emptied out — and the
 * only way back in was for the one person who owned it to go first. A room is
 * a place; walking into an empty one is allowed, and doing so opens it again.
 */
// `guest` here is an uninvited account, so the lobby holds them — but it holds
// them at the door rather than turning them away, which is the change.
const reopened = await call(guest, `/api/meetings/${code}/join`, { method: 'POST' });
check('an ended meeting no longer refuses people outright',
  reopened.status === 200 && reopened.body.status === 'waiting',
  `${reopened.status} ${JSON.stringify(reopened.body).slice(0, 160)}`);

// Somebody the room admits reopens it by walking in.
const reopenedByMember = await call(host, `/api/meetings/${code}/join`, { method: 'POST' });
check('and somebody allowed in reopens it', reopenedByMember.body.status === 'admitted',
  JSON.stringify(reopenedByMember.body).slice(0, 160));

const afterReopen = await call(host, `/api/meetings/${code}`);
check('and it is live again', afterReopen.body.meeting.status === 'live', afterReopen.body.meeting.status);
check('with the time it had ended at cleared',
  afterReopen.body.meeting.endedAt === null, String(afterReopen.body.meeting.endedAt));

// The rules that actually protect a meeting are untouched by that.
const cancelledMeeting = await call(host, '/api/meetings', { method: 'POST', body: { title: 'cancelled' } });
const cancelledCode = cancelledMeeting.body.meeting.code;
await call(host, `/api/meetings/${cancelledCode}`, { method: 'DELETE' });
const refused = await call(guest, `/api/meetings/${cancelledCode}/join`, { method: 'POST' });
check('but a cancelled meeting is still refused', refused.status === 410, String(refused.status));

console.log('\n── quality: the host chooses, the plan decides how far ──');
const hq = await call(host, '/api/meetings', { method: 'POST', body: { title: 'quality' } });
const hqCode = hq.body.meeting.code;
check('a new meeting starts at standard, not at the ceiling', hq.body.meeting.quality === 'standard', hq.body.meeting.quality);

const hqView = await call(host, `/api/meetings/${hqCode}`);
check('the host is told the ceiling', hqView.body.meeting.qualityCeiling === 'high', String(hqView.body.meeting.qualityCeiling));
check('the host is offered every tier under it', hqView.body.meeting.qualityOptions?.length === 3);
check('each option is named for a person to read', hqView.body.meeting.qualityOptions?.every((t) => t.id && t.name && t.blurb));
check('each option says what it costs relative to standard', hqView.body.meeting.qualityOptions?.every((t) => t.relativeCost > 0));

const memberView = await call(member, `/api/meetings/${hqCode}`);
check('a non-host is not shown the ceiling', memberView.body.meeting.qualityCeiling === undefined);
check('a non-host is not offered the choice', memberView.body.meeting.qualityOptions === undefined);

const raised = await call(host, `/api/meetings/${hqCode}`, { method: 'PATCH', body: { quality: 'high' } });
check('the host can raise quality within the plan', raised.status === 200 && raised.body.meeting.quality === 'high', JSON.stringify(raised.body).slice(0, 160));
check('a non-host cannot change quality', (await call(member, `/api/meetings/${hqCode}`, { method: 'PATCH', body: { quality: 'saver' } })).status === 403);
check('an unknown tier is refused', (await call(host, `/api/meetings/${hqCode}`, { method: 'PATCH', body: { quality: 'ultra' } })).status === 400);

await call(admin, '/api/admin/policy', { method: 'PUT', body: { maxQuality: 'standard' } });
const overCeiling = await call(host, `/api/meetings/${hqCode}`, { method: 'PATCH', body: { quality: 'high' } });
check('the plan refuses a tier above its ceiling', overCeiling.status === 403, `${overCeiling.status} ${JSON.stringify(overCeiling.body)}`);
check('and the refusal names the plan rather than the number',
  /standard/.test(overCeiling.body.error?.message ?? ''), JSON.stringify(overCeiling.body));

const clamped = await call(host, `/api/meetings/${hqCode}`);
check('a meeting stored above the new ceiling still opens', clamped.status === 200);
check('and it is offered only what the plan now allows', clamped.body.meeting.qualityOptions?.length === 2);
check('the host can still lower it', (await call(host, `/api/meetings/${hqCode}`, { method: 'PATCH', body: { quality: 'saver' } })).body.meeting.quality === 'saver');

const afterCap = await call(host, '/api/meetings', { method: 'POST', body: { title: 'after the cap' } });
check('a new meeting under a standard ceiling still starts at standard', afterCap.body.meeting.quality === 'standard');
await call(admin, '/api/admin/policy', { method: 'PUT', body: { maxQuality: 'saver' } });
const saverEra = await call(host, '/api/meetings', { method: 'POST', body: { title: 'saver era' } });
check('a saver ceiling makes saver the default too', saverEra.body.meeting.quality === 'saver', saverEra.body.meeting.quality);
check('a saver ceiling offers the host nothing to raise to',
  (await call(host, `/api/meetings/${saverEra.body.meeting.code}`)).body.meeting.qualityOptions?.length === 1);
await call(admin, '/api/admin/policy', { method: 'PUT', body: { maxQuality: 'high' } });

console.log(`\n${pass} passed, ${fail} failed`);
await mongoose.disconnect();
process.exit(fail === 0 ? 0 : 1);
