/**
 * Guest access, and the wall around it.
 *
 * The feature is small; the boundary is not. A guest pass must open exactly one
 * meeting and nothing else in the product, so most of this file is about what a
 * guest *cannot* do.
 */
import mongoose from 'mongoose';
import { connectForTests } from './db.mjs';
import { createHash, randomBytes } from 'node:crypto';

const API = process.env.TEST_API ?? 'http://localhost:4102';
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

let pass = 0;
let fail = 0;
const check = (l, ok, x = '') => {
  ok ? (pass += 1, console.log(`  ok   ${l}`)) : (fail += 1, console.log(`  FAIL ${l} ${x}`));
};

await connectForTests(process.env.MONGODB_URI);
const db = mongoose.connection.db;
for (const c of ['meetings', 'knocks', 'guestsessions', 'users', 'sessions', 'auditevents', 'auditcounters', 'policies']) {
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
    user: insertedId, texorId, tokenHash: sha256(token), accessToken: null, refreshToken: null,
    idToken: null, accessTokenExpiresAt: null, userAgent: 'e2e', ip: '127.0.0.1',
    expiresAt: new Date(Date.now() + 864e5), revokedAt: null, createdAt: now, updatedAt: now, __v: 0,
  });
  return { cookie: `talk_sid=${token}`, texorId };
}

async function call(cookie, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { status: res.status, body: payload, setCookie };
}

const host = await seedUser({ texorId: 'tx-host', email: 'host@texor.app', displayName: 'Hana Host' });

const open = (await call(host.cookie, '/api/meetings', {
  method: 'POST', body: { title: 'Open day', access: 'anyone', lobby: 'off' },
})).body.meeting;
const closed = (await call(host.cookie, '/api/meetings', {
  method: 'POST', body: { title: 'Staff only', access: 'texor' },
})).body.meeting;

console.log('\n── what an anonymous visitor can see ──');
const preview = await call(null, `/api/meetings/${open.code}/guest`);
check('a preview is available with no credential', preview.status === 200);
check('it gives the title and host',
  preview.body.meeting.title === 'Open day' && Boolean(preview.body.meeting.hostName));
check('guests are allowed here', preview.body.guests.allowed === true, JSON.stringify(preview.body.guests));
/**
 * The host set `lobby: 'off'`, and this said so — while `forceLobbyForExternal`
 * quietly held the guest at the door anyway. Two screens promising a guest they
 * would walk straight in, and a knock either way.
 */
check('and are told the truth about the lobby they will actually meet',
  preview.body.guests.willWait === true, JSON.stringify(preview.body.guests));
check('it leaks no agenda, invitees, participants or join link',
  !('agenda' in preview.body.meeting) && !('invitees' in preview.body.meeting)
  && !('participants' in preview.body.meeting) && !('joinUrl' in preview.body.meeting),
  JSON.stringify(Object.keys(preview.body.meeting)));

const closedPreview = await call(null, `/api/meetings/${closed.code}/guest`);
check('a Texor-only meeting says guests are not allowed', closedPreview.body.guests.allowed === false);
check('and explains why', /Texor Account/i.test(closedPreview.body.guests.reason), closedPreview.body.guests.reason);

console.log('\n── taking a guest pass ──');
const refused = await call(null, `/api/meetings/${closed.code}/guest`, { method: 'POST', body: { name: 'Sneaky' } });
check('a Texor-only meeting refuses one', refused.status === 403, JSON.stringify(refused.body));

const taken = await call(null, `/api/meetings/${open.code}/guest`, { method: 'POST', body: { name: '  Sam Guest  ' } });
check('an open meeting issues one', taken.status === 201, JSON.stringify(taken.body));
check('the name is trimmed', taken.body.guest.displayName === 'Sam Guest', JSON.stringify(taken.body.guest));
check('the id is obviously not a Texor account', taken.body.guest.texorId.startsWith('guest:'));
check('a cookie is set', /talk_guest=/.test(taken.setCookie ?? ''));
check('and it is httpOnly', /HttpOnly/i.test(taken.setCookie ?? ''), taken.setCookie);

const guestCookie = (taken.setCookie ?? '').split(';')[0];

console.log('\n── names cannot be used to misrepresent ──');
// Built by code point so the file itself stays free of control characters.
const RTL_OVERRIDE = String.fromCharCode(0x202e);
const NUL = String.fromCharCode(0);
const nastyName = `Ada${RTL_OVERRIDE}${NUL} Admin\n\n\nSpaced`;
const nasty = await call(null, `/api/meetings/${open.code}/guest`, { method: 'POST', body: { name: nastyName } });
check('control and bidi characters are stripped',
  !/[\u0000-\u001f\u202a-\u202e]/.test(nasty.body.guest.displayName),
  JSON.stringify(nasty.body.guest.displayName));
check('whitespace runs are collapsed',
  !/\s{2,}/.test(nasty.body.guest.displayName), JSON.stringify(nasty.body.guest.displayName));

const blank = await call(null, `/api/meetings/${open.code}/guest`, { method: 'POST', body: { name: '   ' } });
check('a blank name is refused', blank.status === 400, JSON.stringify(blank.body));

console.log('\n── who a guest is, according to the API ──');
// The bug this guards: /auth/me read `_id` off a guest, which has none, and
// answered 500. The frontend read that as "not signed in" and redirected to the
// sign-in page — immediately after somebody had successfully joined by name.
const who = await call(guestCookie, '/api/auth/me');
check('/auth/me does not fall over on a guest', who.status === 200, `HTTP ${who.status}`);
check('it returns the guest', who.body.user?.isGuest === true, JSON.stringify(who.body));
check('with the name they typed', who.body.user?.displayName === 'Sam Guest');
check('and the meeting the pass is for', who.body.user?.meetingCode === open.code,
  who.body.user?.meetingCode);
check('a guest is never an admin', who.body.user?.isAdmin === false);
check('no Texor account fields are invented',
  !who.body.user?.id && !who.body.user?.email, JSON.stringify(who.body.user));

const signedIn = await call(host.cookie, '/api/auth/me');
check('a real account is still marked as not a guest', signedIn.body.user?.isGuest === false);

console.log('\n── org policy holds guests at the door ──');
// The host set `lobby: 'off'`, but a guest has no account and is external by
// definition, and `forceLobbyForExternal` defaults on — policy tightens what a
// host chose, and never the other way round.
/**
 * Arriving before anybody else is a wait, not a refusal.
 *
 * It used to be a 409 saying to come back later, on the reasoning that no host
 * would ever see the knock. A room can be reopened by anyone allowed in now, so
 * the host turning up later finds this person still at the door — and the guest
 * is still held there, which is the part that matters.
 */
const beforeHost = await call(guestCookie, `/api/meetings/${open.code}/join`, { method: 'POST' });
check('with nobody there, a guest waits rather than being turned away',
  beforeHost.body.status === 'waiting', JSON.stringify(beforeHost.body).slice(0, 160));
check('and is certainly not let into an empty room',
  beforeHost.body.status !== 'admitted' && !beforeHost.body.media, JSON.stringify(beforeHost.body).slice(0, 160));

await call(host.cookie, `/api/meetings/${open.code}/join`, { method: 'POST' });

const knocked = await call(guestCookie, `/api/meetings/${open.code}/join`, { method: 'POST' });
check('once the host is in, the guest knocks rather than walking in',
  knocked.body.status === 'waiting', JSON.stringify(knocked.body).slice(0, 160));
check('a host who turned the lobby off cannot wave a guest past policy',
  knocked.body.status !== 'admitted');

const waiting = await call(host.cookie, `/api/meetings/${open.code}/knocks`);
check('the host sees them waiting, named as they typed it',
  waiting.body.knocks?.[0]?.name === 'Sam Guest', JSON.stringify(waiting.body.knocks));
check('and marked as being from outside', waiting.body.knocks?.[0]?.isExternal === true);

console.log('\n── with the override off, "everyone walks in" means it ──');
{
  // The one switch that makes the host's choice final, and the reason the
  // dialog now says which of the two is in force.
  await db.collection('policies').updateOne({}, { $set: { forceLobbyForExternal: false } });

  const walkIn = (await call(host.cookie, '/api/meetings', {
    method: 'POST', body: { title: 'Wide open', access: 'anyone', lobby: 'off' },
  })).body.meeting;

  const told = await call(null, `/api/meetings/${walkIn.code}/guest`);
  check('the preview stops promising a lobby', told.body.guests.willWait === false,
    JSON.stringify(told.body.guests));

  const pass = await call(null, `/api/meetings/${walkIn.code}/guest`, {
    method: 'POST', body: { name: 'Wanda Walkin' },
  });
  const cookie = (pass.setCookie ?? '').split(';')[0];
  await call(host.cookie, `/api/meetings/${walkIn.code}/join`, { method: 'POST' });

  const straightIn = await call(cookie, `/api/meetings/${walkIn.code}/join`, { method: 'POST' });
  check('and the guest walks in without knocking',
    straightIn.body.status === 'admitted', JSON.stringify(straightIn.body).slice(0, 160));

  await db.collection('policies').updateOne({}, { $set: { forceLobbyForExternal: true } });
}

console.log('\n── what a host is told before they choose ──');
{
  const { body, status } = await call(host.cookie, '/api/meetings/defaults');
  check('the defaults endpoint answers', status === 200, `HTTP ${status}`);
  check('with the waiting room a new meeting would get',
    body.defaults?.lobby === 'external', JSON.stringify(body.defaults));
  check('and the two org rules that can overrule the host',
    body.defaults?.forceLobbyForExternal === true && body.defaults?.allowExternalGuests === true,
    JSON.stringify(body.defaults));

  const anon = await call(null, '/api/meetings/defaults');
  check('and it is not open to anonymous callers', anon.status === 401, `HTTP ${anon.status}`);
}

console.log('\n── a guest can take part once admitted ──');
await call(host.cookie, `/api/meetings/${open.code}/knocks/${knocked.body.knockId}`, {
  method: 'POST', body: { decision: 'admit' },
});
const admitted = await call(guestCookie, `/api/meetings/${open.code}/knocks/${knocked.body.knockId}/status`);
check('they are let in', admitted.body.status === 'admitted', JSON.stringify(admitted.body).slice(0, 160));
check('their role is guest', admitted.body.media?.role === 'guest', admitted.body.media?.role);
check('they are not a moderator', admitted.body.media?.isModerator === false);
check('they cannot share their screen unless the meeting allows everyone',
  typeof admitted.body.media?.canShareScreen === 'boolean');

// Having been admitted once, they should not be asked again after a wobble.
await call(guestCookie, `/api/meetings/${open.code}/leave`, { method: 'POST' });
const back = await call(guestCookie, `/api/meetings/${open.code}/join`, { method: 'POST' });
check('coming back does not send them to the lobby again',
  back.body.status === 'admitted', JSON.stringify(back.body).slice(0, 120));

check('they can leave', (await call(guestCookie, `/api/meetings/${open.code}/leave`, { method: 'POST' })).status === 200);

console.log('\n── a guest can read their own meeting, but not its guest list ──');
// The bug this guards: the meeting screen calls this the moment it mounts, and
// blocking it meant a guest who had just joined was told "guests can only take
// part in the meeting they joined" — about the meeting they had joined.
const mine = await call(guestCookie, `/api/meetings/${open.code}`);
check('they can read it', mine.status === 200, `HTTP ${mine.status} ${JSON.stringify(mine.body).slice(0, 120)}`);
check('with enough to render the call',
  mine.body.meeting?.title === 'Open day' && typeof mine.body.meeting?.settings === 'object');
check('marked as a guest in the viewer block', mine.body.meeting?.viewer?.isGuest === true);
check('the invitee list is withheld',
  Array.isArray(mine.body.meeting.invitees) && mine.body.meeting.invitees.length === 0,
  JSON.stringify(mine.body.meeting.invitees));
check('attendance is withheld', mine.body.meeting.attendance === undefined);

// Opening one route must not have opened its neighbours.
for (const [path, what] of [
  [`/api/meetings/${open.code}/invite.ics`, 'the calendar invite'],
  [`/api/meetings/${open.code}/knocks`, 'the waiting list'],
]) {
  const res = await call(guestCookie, path);
  check(`its sub-resources stay closed — ${what}`, res.status === 403 || res.status === 401, `got ${res.status}`);
}

const otherMeeting = await call(guestCookie, `/api/meetings/${closed.code}`);
check('and a different meeting stays closed', otherMeeting.status === 403,
  `HTTP ${otherMeeting.status}`);

console.log('\n── and nothing else in the product ──');
const denied = [
  ['GET', '/api/meetings', 'list every meeting'],
  ['POST', '/api/meetings', 'create a meeting'],
  ['GET', '/api/channels', 'read channels'],
  ['GET', '/api/admin/policy', 'read org policy'],
  ['GET', '/api/admin/audit', 'read the audit log'],
  ['GET', `/api/meetings/${open.code}/invite.ics`, 'download the calendar invite'],
  ['POST', `/api/meetings/${open.code}/invitees`, 'invite people'],
  ['POST', `/api/meetings/${open.code}/end`, 'end the meeting'],
  ['DELETE', `/api/meetings/${open.code}`, 'cancel the meeting'],
  ['GET', `/api/meetings/${open.code}/knocks`, 'see the waiting list'],
];
for (const [method, path, what] of denied) {
  const res = await call(guestCookie, path, { method, body: method === 'POST' ? {} : undefined });
  check(`a guest cannot ${what}`, res.status === 401 || res.status === 403, `got ${res.status}`);
}

console.log('\n── a pass is for one meeting only ──');
const other = (await call(host.cookie, '/api/meetings', {
  method: 'POST', body: { title: 'Another open one', access: 'anyone', lobby: 'off' },
})).body.meeting;
const crossed = await call(guestCookie, `/api/meetings/${other.code}/join`, { method: 'POST' });
check('the pass does not open a different meeting', crossed.status === 403, JSON.stringify(crossed.body));

console.log('\n── a guest signing out ──');
{
  /**
   * The bug: this fell through to the ordinary logout, which builds an OIDC
   * end-session URL. A guest has no OIDC session and no id_token, so it sent
   * them to an identity provider that had never heard of them — and in
   * production, to whatever origin was configured there, which is not a place
   * a guest has any business being sent.
   *
   * A guest pass is a cookie. Revoking it is the whole of logging out.
   */
  const leaver = await call(null, `/api/meetings/${open.code}/guest`, {
    method: 'POST', body: { name: 'Gwen Going' },
  });
  const leaverCookie = (leaver.setCookie ?? '').split(';')[0];
  check('a guest pass is issued to sign out of', leaver.status === 201 || leaver.status === 200,
    String(leaver.status));

  const out = await call(leaverCookie, '/api/auth/logout', { method: 'POST' });
  check('logging out works for a guest', out.status === 200, JSON.stringify(out.body));
  check('it does not send them to an identity provider',
    !/end_session|id_token_hint|openid/i.test(out.body.redirectTo ?? ''), out.body.redirectTo);
  check('it sends them back to this product, not somewhere else',
    out.body.redirectTo === API, `${out.body.redirectTo} vs ${API}`);
  check('the guest cookie is cleared', /talk_guest=;|talk_guest=\s*;/.test(out.setCookie ?? ''),
    out.setCookie);

  // And the pass is genuinely dead, not merely forgotten by the browser.
  const after = await call(leaverCookie, '/api/auth/me');
  check('the pass no longer identifies anyone', after.body.user === null, JSON.stringify(after.body));
  const reuse = await call(leaverCookie, `/api/meetings/${open.code}`);
  check('and cannot be used to reach the meeting again', reuse.status === 401, String(reuse.status));
}

console.log('\n── policy closes the door ──');
const admin = await seedUser({ texorId: 'tx-admin', email: 'isuryakarthikvarma@gmail.com', displayName: 'Admin' });
await call(admin.cookie, '/api/admin/policy', { method: 'PUT', body: { allowExternalGuests: false } });

const afterPolicy = await call(null, `/api/meetings/${open.code}/guest`, { method: 'POST', body: { name: 'Late' } });
check('turning off external guests refuses new passes', afterPolicy.status === 403, JSON.stringify(afterPolicy.body));
check('and the preview agrees',
  (await call(null, `/api/meetings/${open.code}/guest`)).body.guests.allowed === false);

console.log(`\n${pass} passed, ${fail} failed`);
await mongoose.disconnect();
process.exit(fail === 0 ? 0 : 1);
