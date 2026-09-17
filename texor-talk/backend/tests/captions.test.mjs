/**
 * Captions, end to end: real sockets, real audio frames, the real database.
 *
 * What this asserts is the *pipeline and its guarantees* rather than the
 * accuracy of the recogniser. Whisper's output is not a deterministic function
 * of a test fixture — it depends on the model file, the build flags and the
 * machine — so a suite that asserted particular words would fail for reasons
 * that have nothing to do with this code. Recognition itself is checked by
 * `npm run captions:check`, which speaks a real sentence through the real
 * engine and prints what came back.
 *
 * The guarantees below are the ones that would be serious to get wrong:
 * a muted person is never transcribed, a participant cannot start a recording,
 * a meeting that is not captioning ignores audio entirely, and a malformed
 * frame cannot take the meeting down.
 */
import mongoose from 'mongoose';
import { WebSocket } from 'ws';
import { createHash, randomBytes } from 'node:crypto';
import { connectForTests } from './db.mjs';

const FE = new URL('../../frontend/', import.meta.url).pathname.replace(/\/$/, '');
const { encodeAudioFrame } = await import(`${FE}/src/lib/captions.js`);

const API = process.env.TEST_API ?? 'http://localhost:4102';
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await connectForTests(process.env.MONGODB_URI);
const db = mongoose.connection.db;
for (const c of ['meetings', 'transcripts', 'auditevents', 'auditcounters', 'policies', 'users', 'sessions']) {
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
  return { texorId, email, displayName, cookie: `talk_sid=${token}` };
}

async function rest(user, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { cookie: user.cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return { status: res.status, headers: res.headers, body: JSON.parse(text) };
  } catch {
    return { status: res.status, headers: res.headers, body: text };
  }
}

/** A participant on the signalling socket. No media stack — none is needed. */
class Peer {
  constructor(user, code) {
    this.user = user;
    this.code = code;
    this.pending = new Map();
    this.nextId = 1;
    this.events = [];
  }

  request(action, data = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, action, data }));
      setTimeout(() => this.pending.delete(id) && reject(new Error(`${action} timed out`)), 10_000);
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/meeting?code=${this.code}`, {
        headers: { cookie: this.user.cookie },
      });

      this.socket.on('message', (raw) => {
        const message = JSON.parse(raw);
        if (message.id !== undefined) {
          const waiter = this.pending.get(message.id);
          if (!waiter) return;
          this.pending.delete(message.id);
          return message.ok
            ? waiter.resolve(message.data)
            : waiter.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
        }
        this.events.push(message);
        if (message.type === 'welcome') { this.welcome = message.data; resolve(message.data); }
        if (message.type === 'refused') reject(Object.assign(new Error(message.message), { code: message.code }));
      });

      this.socket.on('error', reject);
    });
  }

  /** An utterance, in exactly the bytes the browser would put on the wire. */
  sendAudio(samples, { utteranceId = '1', final = true } = {}) {
    this.socket.send(Buffer.from(encodeAudioFrame({ utteranceId, final }, samples)));
  }

  seen(type) { return this.events.filter((event) => event.type === type); }
  close() { this.socket?.close(); }
}

/** Two seconds of a tone — enough audio to be accepted, not enough to be words. */
function audio(seconds = 2, amplitude = 0.3) {
  const samples = new Float32Array(Math.round(16_000 * seconds));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 220 * index) / 16_000) * amplitude;
  }
  return samples;
}

// ── Setup ────────────────────────────────────────────────────────────────────
const host = await seedUser({ texorId: 'tx-cap-host', email: 'caphost@texor.app', displayName: 'Hana Host' });
const member = await seedUser({ texorId: 'tx-cap-mem', email: 'capmem@texor.app', displayName: 'Mo Member' });
const outsider = await seedUser({ texorId: 'tx-cap-out', email: 'capout@texor.app', displayName: 'Ora Outsider' });

console.log('\n── the server says whether it can caption at all ──');
{
  const status = await rest(host, '/api/captions');
  check('the status route answers', status.status === 200, JSON.stringify(status.body).slice(0, 200));
  check('it says whether the org allows captions', typeof status.body.captions?.allowed === 'boolean');
  check('and whether the engine is actually up', typeof status.body.captions?.available === 'boolean');
  check(
    'an unavailable engine comes with a reason somebody can act on',
    status.body.captions.available || Boolean(status.body.captions.reason),
    JSON.stringify(status.body.captions),
  );
  console.log(`       (recogniser ${status.body.captions.available ? 'up' : `down: ${status.body.captions.reason}`})`);
}

const created = await rest(host, '/api/meetings', {
  method: 'POST', body: { title: 'Captions test', lobby: 'off', access: 'texor' },
});
const code = created.body.meeting.code;
check('meeting created', created.status === 201, JSON.stringify(created.body).slice(0, 160));

check('a new meeting is not captioning', created.body.meeting.settings.captions === 'off', created.body.meeting.settings.captions);

await rest(host, `/api/meetings/${code}/join`, { method: 'POST' });
await rest(member, `/api/meetings/${code}/join`, { method: 'POST' });

const hostPeer = new Peer(host, code);
await hostPeer.connect();
const memberPeer = new Peer(member, code);
await memberPeer.connect();

console.log('\n── what the client is told on arrival ──');
{
  const captions = hostPeer.welcome.captions;
  check('the welcome carries the caption state', Boolean(captions), JSON.stringify(hostPeer.welcome).slice(0, 200));
  check('it starts off', captions.on === false);
  check('it says what rate audio must be sent at', captions.sampleRate === 16_000, String(captions.sampleRate));
  check('and how long one utterance may be', captions.maxUtteranceMs > 0, String(captions.maxUtteranceMs));
}

console.log('\n── a participant cannot start recording the room ──');
{
  let refused = null;
  await memberPeer.request('setCaptions', { on: true }).catch((error) => { refused = error; });
  check('turning captions on is host-only', refused?.code === 'forbidden', refused?.message);

  const meeting = await db.collection('meetings').findOne({ code });
  check('and the setting did not move', meeting.settings.captions === 'off', meeting.settings.captions);
}

console.log('\n── audio sent while the meeting is not captioning ──');
{
  memberPeer.sendAudio(audio());
  await wait(600);

  check('is not transcribed for anybody', hostPeer.seen('caption').length === 0);
  const transcript = await db.collection('transcripts').findOne({ meetingCode: code });
  check('and nothing is written down', transcript === null);
}

console.log('\n── the host turns captions on ──');
let captionsUp = false;
{
  const result = await hostPeer.request('setCaptions', { on: true }).catch((error) => error);

  if (result instanceof Error) {
    // A machine with no model is a legitimate configuration, and the refusal is
    // the designed behaviour rather than a failure — but the rest of this
    // section has nothing to run against.
    check('captions are refused with a reason when the engine is down', result.code === 'unavailable', result.message);
    console.log(`       (skipping the rest: ${result.message})`);
  } else {
    captionsUp = true;
    check('the host may turn them on', result.on === true);

    await wait(300);

    /**
     * Everybody is told, not just the host who pressed it. The notice *is* the
     * consent: from this moment everyone's speech is being transcribed.
     */
    const told = memberPeer.seen('captions').at(-1);
    check('everyone in the room is told', Boolean(told), JSON.stringify(memberPeer.events.map((e) => e.type)));
    check('including who turned them on', told?.data.changedBy === 'Hana Host', told?.data.changedBy);
    check('and whether a transcript is being kept', typeof told?.data.stored === 'boolean');

    const meeting = await db.collection('meetings').findOne({ code });
    check('the meeting records it', meeting.settings.captions === 'on');

    const transcript = await db.collection('transcripts').findOne({ meetingCode: code });
    check('a transcript is opened', Boolean(transcript));
    check('naming who started it', transcript?.startedByName === 'Hana Host', transcript?.startedByName);

    const audit = await db.collection('auditevents').findOne({ action: 'captions.started', meetingCode: code });
    check('and it is audited', Boolean(audit), 'no captions.started event');
    check('against the person who did it', audit?.actorTexorId === 'tx-cap-host');
  }
}

console.log('\n── a muted participant is never transcribed ──');
{
  /**
   * The strongest guarantee this feature makes, and the one that would be worst
   * to get wrong. The browser stops capturing on mute; this is the check that
   * makes it a guarantee rather than a convention — audio from a peer with no
   * live microphone producer is refused by the server whatever the client does.
   */
  const before = hostPeer.seen('caption').length;
  memberPeer.sendAudio(audio(3));
  await wait(1500);

  check(
    'audio from someone with no live microphone produces nothing',
    hostPeer.seen('caption').length === before,
    `${hostPeer.seen('caption').length} vs ${before}`,
  );

  const transcript = await db.collection('transcripts').findOne({ meetingCode: code });
  check('and nothing reaches the transcript', (transcript?.segments?.length ?? 0) === 0, String(transcript?.segments?.length));
}

console.log('\n── frames that are not ours ──');
{
  // Every one of these is something a malformed or hostile client could send,
  // and none of them may take the meeting down with it.
  memberPeer.socket.send(Buffer.alloc(0));
  memberPeer.socket.send(Buffer.from([0, 0, 0, 200, 1, 2, 3]));
  memberPeer.socket.send(Buffer.from('not a frame at all'));
  memberPeer.socket.send(Buffer.from([0xff, 0xff, 0xff, 0xff, 0, 0]));
  // Far longer than any utterance may be.
  memberPeer.sendAudio(audio(40));

  await wait(500);

  check('the socket is still open', memberPeer.socket.readyState === WebSocket.OPEN);

  const stillWorks = await memberPeer.request('raiseHand', { raised: true }).catch((error) => error);
  check('and the meeting still works', !(stillWorks instanceof Error), stillWorks?.message);
  await memberPeer.request('raiseHand', { raised: false }).catch(() => {});
}

console.log('\n── the stored transcript ──');
{
  /**
   * Written through the service rather than by talking at the recogniser, so
   * the assertions are about the storage rules and hold on every machine. What
   * the recogniser hears is checked by `npm run captions:check`.
   */
  const { appendSegment } = await import('../src/services/captions.service.js');
  const meetingStartedAt = (await db.collection('meetings').findOne({ code })).startedAt ?? new Date();

  await db.collection('transcripts').updateOne(
    { meetingCode: code },
    {
      $setOnInsert: {
        meetingCode: code, meetingTitle: 'Captions test', meetingStartedAt,
        segments: [], speakers: [], languages: [], deletedAt: null, truncated: false,
        meetingEndedAt: null, expiresAt: null, createdAt: new Date(), updatedAt: new Date(), __v: 0,
      },
    },
    { upsert: true },
  );

  const say = (speaker, text, language, offsetSeconds) => appendSegment({
    meetingCode: code,
    speaker,
    recognised: { text, language, confidence: 0.9 },
    startedAt: new Date(+meetingStartedAt + offsetSeconds * 1000),
    durationMs: 1500,
    meetingStartedAt,
  });

  const surya = { texorId: 'tx-cap-mem', name: 'surya', picture: '' };
  const john = { texorId: 'tx-cap-host', name: 'john', picture: '' };

  await say(surya, 'endhuko telidu.', 'te', 3);
  await say(john, "I don't know either.", 'en', 6);

  const transcript = await db.collection('transcripts').findOne({ meetingCode: code });
  check('utterances are stored in order', transcript.segments.length === 2, String(transcript.segments.length));
  check('each against the person who said it', transcript.segments[0].speakerName === 'surya');
  check('with the language it was detected in', transcript.segments[0].language === 'te');
  check('both languages are recorded on the meeting', transcript.languages.sort().join(',') === 'en,te', transcript.languages.join(','));
  check('and each speaker appears once', transcript.speakers.length === 2, String(transcript.speakers.length));

  // Offsets, not wall-clock: a reader three weeks later cannot place 14:42:07.
  check('offsets are measured from the start of the meeting', transcript.segments[0].offsetMs === 3000, String(transcript.segments[0].offsetMs));

  /**
   * Hallucinations never reach storage. A model handed silence answers with the
   * most common phrase in its training data, confidently — an unfiltered
   * transcript of a quiet meeting is page after page of exactly this.
   */
  await say(surya, '[BLANK_AUDIO]', 'en', 9);
  await say(surya, '  ', 'en', 10);
  const filtered = await db.collection('transcripts').findOne({ meetingCode: code });
  check('and noise is not stored', filtered.segments.length === 2, String(filtered.segments.length));

  /**
   * Several people talk at once, and each utterance finishes recognition on its
   * own schedule. Read-modify-write would drop whichever lost the race, in
   * silence — the reason the append is a `$push`.
   */
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      say(index % 2 ? surya : john, `overlapping line ${index}`, 'en', 20 + index)),
  );
  const raced = await db.collection('transcripts').findOne({ meetingCode: code });
  check('concurrent speakers do not overwrite each other', raced.segments.length === 14, String(raced.segments.length));
}

console.log('\n── reading it back ──');
{
  const mine = await rest(member, `/api/meetings/${code}/transcript`);
  check('somebody who was in the meeting can read it', mine.status === 200, String(mine.status));
  check('it comes back as the conversation', mine.body.transcript.text.startsWith('surya: endhuko telidu.'), JSON.stringify(mine.body.transcript?.text)?.slice(0, 120));
  check('with a word count', mine.body.transcript.words > 0, String(mine.body.transcript.words));

  /**
   * 404 rather than 403 for somebody who was not there. Meeting codes are
   * guessable by design, so a 403 would be a way to enumerate real meetings and
   * learn which of them were captioned.
   */
  const theirs = await rest(outsider, `/api/meetings/${code}/transcript`);
  check('somebody who was not there cannot', theirs.status === 404, String(theirs.status));
  check('and is not told the meeting exists', /No transcript/.test(JSON.stringify(theirs.body)), JSON.stringify(theirs.body));

  const file = await rest(host, `/api/meetings/${code}/transcript.txt`);
  check('it downloads as a file', file.status === 200, String(file.status));
  check('as plain text', /text\/plain/.test(file.headers.get('content-type')), file.headers.get('content-type'));
  check('named after the meeting', /filename=".*Captions test/.test(file.headers.get('content-disposition') ?? ''), file.headers.get('content-disposition'));
  check('containing the conversation', String(file.body).includes("john: I don't know either."), String(file.body).slice(0, 200));
  check('with timestamps to find a moment by', /\[\d+:\d\d\]/.test(String(file.body)), String(file.body).slice(0, 200));

  const exported = await db.collection('auditevents').findOne({ action: 'transcript.exported', meetingCode: code });
  check('and the export is audited', Boolean(exported), 'no transcript.exported event');
}

console.log('\n── a meeting with no transcript ──');
{
  const other = await rest(host, '/api/meetings', {
    method: 'POST', body: { title: 'Never captioned', lobby: 'off', access: 'texor' },
  });
  const quiet = await rest(host, `/api/meetings/${other.body.meeting.code}/transcript`);

  // Most meetings never caption. "Nobody turned it on" must not be reported the
  // same way as "something went wrong", or every client has to tell them apart.
  check('is not an error', quiet.status === 200, String(quiet.status));
  check('it simply has none', quiet.body.transcript === null, JSON.stringify(quiet.body));
}

console.log('\n── deleting it ──');
{
  const notOwner = await rest(member, `/api/meetings/${code}/transcript`, { method: 'DELETE' });
  check('a participant cannot delete the record', notOwner.status === 403, String(notOwner.status));

  const owner = await rest(host, `/api/meetings/${code}/transcript`, { method: 'DELETE' });
  check('the meeting owner can', owner.status === 200, JSON.stringify(owner.body));

  const gone = await rest(host, `/api/meetings/${code}/transcript`);
  check('and it stops being readable', gone.body.transcript === null, JSON.stringify(gone.body).slice(0, 120));

  // Soft-deleted, so the audit line above it still refers to something.
  const row = await db.collection('transcripts').findOne({ meetingCode: code });
  check('the row is kept, marked deleted', Boolean(row?.deletedAt), JSON.stringify(row?.deletedAt));
  check('and the deletion is audited', Boolean(await db.collection('auditevents').findOne({ action: 'transcript.deleted', meetingCode: code })));
}

console.log('\n── turning them off ──');
if (captionsUp) {
  await hostPeer.request('setCaptions', { on: false });

  /**
   * Long enough to catch the room ticker putting it back.
   *
   * The ticker refreshes its cached caption state from the meeting document
   * every five seconds, and it used to be able to apply a document it had read
   * *before* this change — announcing captions as back on, and leaving the
   * transcript accepting utterances after the host had stopped it. Waiting past
   * a full tick is what makes this assertion about that bug rather than about
   * the broadcast alone.
   */
  await wait(6000);

  const told = memberPeer.seen('captions').at(-1);
  check('everyone is told they stopped', told?.data.on === false, JSON.stringify(told?.data));
  check(
    'and nothing puts it back a tick later',
    memberPeer.seen('captions').filter((e) => e.data.on === true).length === 1,
    JSON.stringify(memberPeer.seen('captions').map((e) => e.data.on)),
  );

  const meeting = await db.collection('meetings').findOne({ code });
  check('and the meeting records it', meeting.settings.captions === 'off');
  check('the stop is audited too', Boolean(await db.collection('auditevents').findOne({ action: 'captions.stopped', meetingCode: code })));
} else {
  console.log('       (skipped: captions never came up)');
}

console.log('\n── the organisation can withdraw captions entirely ──');
{
  await db.collection('policies').updateOne({ key: 'org' }, { $set: { allowCaptions: false } }, { upsert: true });

  const fresh = await rest(host, '/api/meetings', {
    method: 'POST', body: { title: 'Policy test', lobby: 'off', access: 'texor' },
  });
  const freshCode = fresh.body.meeting.code;
  await rest(host, `/api/meetings/${freshCode}/join`, { method: 'POST' });

  const peer = new Peer(host, freshCode);
  await peer.connect();

  check('the client is told captions are not allowed', peer.welcome.captions.allowed === false, JSON.stringify(peer.welcome.captions));

  let refused = null;
  await peer.request('setCaptions', { on: true }).catch((error) => { refused = error; });
  // A host cannot switch on something the organisation has withdrawn.
  check('and even a host cannot turn them on', refused?.code === 'forbidden', refused?.message);

  peer.close();
  await db.collection('policies').updateOne({ key: 'org' }, { $set: { allowCaptions: true } });
}

hostPeer.close();
memberPeer.close();
await wait(300);
await mongoose.disconnect();

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
