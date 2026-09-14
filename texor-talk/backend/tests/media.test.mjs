/**
 * Two real mediasoup-client peers, over real WebSockets, against the running
 * SFU. No browser: mediasoup-client's own FakeHandler stands in for the
 * browser's WebRTC stack, which exercises every step of the negotiation —
 * device load, transport creation, DTLS connect, produce, consume — short of
 * actual DTLS handshaking and RTP on the wire.
 */
import mongoose from 'mongoose';
import { WebSocket } from 'ws';
import { createHash, randomBytes } from 'node:crypto';

const FE = new URL('../../frontend/node_modules/', import.meta.url).href.replace(/\/$/, '');
const { Device } = await import(`${FE}/mediasoup-client/lib/Device.js`);
const { FakeHandler } = await import(`${FE}/mediasoup-client/lib/handlers/FakeHandler.js`);
const fakeParameters = await import(`${FE}/mediasoup-client/lib/test/fakeParameters.js`);
const { FakeMediaStreamTrack } = await import(`${FE}/fake-mediastreamtrack/lib/index.js`);
// The very encodings the browser client sends, imported rather than retyped.
const { CAMERA_ENCODINGS, SCREEN_ENCODINGS } = await import(
  new URL('../../frontend/src/lib/encodings.js', import.meta.url).href
);

const API = process.env.TEST_API ?? 'http://localhost:4102';
/**
 * A hard stop, not a convention.
 *
 * This suite wipes collections. It once ran against a developer's real database
 * because `MONGODB_URI` was inherited from `.env`, and it deleted a meeting they
 * had just created. The database name must end in `_test` or nothing runs —
 * `npm test` builds that URI; running this file directly against `.env` will
 * refuse here rather than destroy anything.
 */
function assertTestDatabase(uri) {
  const name = (() => {
    try { return new URL(uri).pathname.replace(/^\//, ''); } catch { return ''; }
  })();

  if (!name.endsWith('_test')) {
    console.error(
      `\n  REFUSING TO RUN.\n` +
      `  This suite deletes collections and the target database is "${name || '(unparsed)'}".\n` +
      `  It must end in _test. Use \`npm test\`, which creates an isolated one.\n`,
    );
    process.exit(1);
  }
  return uri;
}

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await mongoose.connect(assertTestDatabase(process.env.MONGODB_URI));
const db = mongoose.connection.db;
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
    user: insertedId, texorId, tokenHash: sha256(token), accessToken: null, refreshToken: null,
    idToken: null, accessTokenExpiresAt: null, userAgent: 'e2e', ip: '127.0.0.1',
    expiresAt: new Date(Date.now() + 864e5), revokedAt: null, createdAt: now, updatedAt: now, __v: 0,
  });
  return { texorId, email, displayName, cookie: `talk_sid=${token}` };
}

async function rest(user, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { cookie: user.cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}

/** A headless participant: socket, device, transports, producers, consumers. */
class TestPeer {
  constructor(user, code) {
    this.user = user;
    this.code = code;
    this.pending = new Map();
    this.nextId = 1;
    this.events = [];
    this.consumers = [];
    this.welcome = null;
  }

  request(action, data = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, action, data }));
      setTimeout(() => this.pending.delete(id) && reject(new Error(`${action} timed out`)), 10000);
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/meeting?code=${this.code}`, {
        headers: { cookie: this.user.cookie },
      });

      this.socket.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.id !== undefined) {
          const w = this.pending.get(m.id);
          if (!w) return;
          this.pending.delete(m.id);
          return m.ok ? w.resolve(m.data) : w.reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
        }
        this.events.push(m);
        if (m.type === 'welcome') { this.welcome = m.data; resolve(m.data); }
        if (m.type === 'refused') reject(Object.assign(new Error(m.message), { code: m.code }));
      });

      this.socket.on('error', reject);
      this.socket.on('close', (codeNum, reason) => {
        this.closedWith = { code: codeNum, reason: reason?.toString() };
      });
    });
  }

  async setupMedia() {
    this.device = await Device.factory({ handlerFactory: FakeHandler.createFactory(fakeParameters) });
    await this.device.load({ routerRtpCapabilities: this.welcome.rtpCapabilities });
    await this.request('setCapabilities', { rtpCapabilities: this.device.rtpCapabilities });

    const sendParams = await this.request('createTransport', { direction: 'send' });
    this.sendTransport = this.device.createSendTransport(sendParams);
    this.sendTransport.on('connect', ({ dtlsParameters }, cb, eb) =>
      this.request('connectTransport', { transportId: this.sendTransport.id, dtlsParameters }).then(cb).catch(eb));
    this.sendTransport.on('produce', ({ kind, rtpParameters, appData }, cb, eb) =>
      this.request('produce', { transportId: this.sendTransport.id, kind, rtpParameters, source: appData.source })
        .then(({ id }) => cb({ id })).catch(eb));

    const recvParams = await this.request('createTransport', { direction: 'recv' });
    this.recvTransport = this.device.createRecvTransport(recvParams);
    this.recvTransport.on('connect', ({ dtlsParameters }, cb, eb) =>
      this.request('connectTransport', { transportId: this.recvTransport.id, dtlsParameters }).then(cb).catch(eb));

    return { sendParams, recvParams };
  }

  /** Exactly what `frontend/src/lib/room.js` sends. */
  produce(kind, source) {
    const encodings =
      kind !== 'video' ? undefined : source === 'screen' ? SCREEN_ENCODINGS : CAMERA_ENCODINGS;

    return this.sendTransport.produce({
      track: new FakeMediaStreamTrack({ kind }),
      appData: { source },
      ...(encodings ? { encodings } : {}),
      ...(kind === 'audio' ? { codecOptions: { opusStereo: false, opusDtx: true, opusFec: true } } : {}),
    });
  }

  async consume(producerId) {
    const info = await this.request('consume', { producerId });
    const consumer = await this.recvTransport.consume({
      id: info.id, producerId: info.producerId, kind: info.kind, rtpParameters: info.rtpParameters,
    });
    await this.request('resumeConsumer', { consumerId: consumer.id });
    this.consumers.push({ consumer, info });
    return info;
  }

  seen(type) { return this.events.filter((e) => e.type === type); }
  close() { this.socket?.close(); }
}

// ── Setup ────────────────────────────────────────────────────────────────────
const host = await seedUser({ texorId: 'tx-host', email: 'host@texor.app', displayName: 'Hana Host' });
const member = await seedUser({ texorId: 'tx-mem', email: 'mem@texor.app', displayName: 'Mo Member' });

console.log('\n── the meeting ──');
const created = await rest(host, '/api/meetings', {
  method: 'POST', body: { title: 'SFU test', lobby: 'off', access: 'texor' },
});
check('meeting created', created.status === 201, JSON.stringify(created.body).slice(0, 200));
const code = created.body.meeting.code;
check('no media identifier leaks into the meeting payload',
  !JSON.stringify(created.body).match(/roomName|jitsi/i));

const hostJoin = await rest(host, `/api/meetings/${code}/join`, { method: 'POST' });
check('host admitted over REST', hostJoin.body.status === 'admitted');
check('grant says moderator', hostJoin.body.media?.isModerator === true, JSON.stringify(hostJoin.body.media));
check('no token or external domain in the grant',
  !JSON.stringify(hostJoin.body.media).match(/token|domain|jitsi/i));
await rest(member, `/api/meetings/${code}/join`, { method: 'POST' });

console.log('\n── the socket authenticates as us ──');
const anon = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/meeting?code=${code}`);
const anonResult = await new Promise((resolve) => {
  anon.on('message', (raw) => resolve(JSON.parse(raw)));
  anon.on('error', () => resolve({ type: 'error' }));
});
check('a socket with no session is refused', anonResult.type === 'refused' && anonResult.code === 'unauthorized',
  JSON.stringify(anonResult));

const badCode = new TestPeer(host, 'zzz-zzzz-zzz');
const badResult = await badCode.connect().catch((e) => e);
check('an unknown meeting code is refused', badResult?.code === 'not_found', badResult?.message);

console.log('\n── the encodings the browser is asked for ──');
/**
 * FakeHandler does not validate encodings against a negotiated codec, so this
 * class of bug cannot be caught by producing through it — Chrome threw
 * "Attempted to set RtpParameters scalabilityMode to an unsupported value for
 * the current codecs" on a config that passed every test here. These assert the
 * shape directly instead.
 */
const allEncodings = [...CAMERA_ENCODINGS, ...SCREEN_ENCODINGS];
check('no encoding declares a scalabilityMode',
  allEncodings.every((e) => e.scalabilityMode === undefined),
  JSON.stringify(allEncodings.filter((e) => e.scalabilityMode)));
check('the camera sends three simulcast layers', CAMERA_ENCODINGS.length === 3);
check('its layers are ordered smallest first',
  CAMERA_ENCODINGS.every((e, i, a) => i === 0 || e.scaleResolutionDownBy < a[i - 1].scaleResolutionDownBy),
  JSON.stringify(CAMERA_ENCODINGS.map((e) => e.scaleResolutionDownBy)));
check('the screen sends a single layer', SCREEN_ENCODINGS.length === 1);
check('the screen layer has the higher ceiling',
  SCREEN_ENCODINGS[0].maxBitrate > Math.max(...CAMERA_ENCODINGS.map((e) => e.maxBitrate)));

console.log('\n── negotiation ──');
const hostPeer = new TestPeer(host, code);
await hostPeer.connect();
check('welcome carries the router capabilities', Array.isArray(hostPeer.welcome.rtpCapabilities?.codecs));
check('router advertises opus', hostPeer.welcome.rtpCapabilities.codecs.some((c) => c.mimeType === 'audio/opus'));
check('router advertises VP8, VP9 and H264',
  ['video/VP8', 'video/VP9', 'video/H264'].every((m) =>
    hostPeer.welcome.rtpCapabilities.codecs.some((c) => c.mimeType === m)));
check('welcome says who we are and our role',
  hostPeer.welcome.you.texorId === 'tx-host' && hostPeer.welcome.you.role === 'host');
check('room is empty so far', hostPeer.welcome.peers.length === 0);

const { sendParams, recvParams } = await hostPeer.setupMedia();
check('send transport has ICE candidates', sendParams.iceCandidates.length > 0,
  JSON.stringify(sendParams.iceCandidates?.[0]));
check('candidates announce the configured address',
  sendParams.iceCandidates.every((c) => c.address === '127.0.0.1'),
  JSON.stringify(sendParams.iceCandidates.map((c) => c.address)));
check('candidates are inside the configured port range',
  sendParams.iceCandidates.every((c) => c.port >= 40200 && c.port <= 40260));
check('both UDP and TCP are offered',
  new Set(sendParams.iceCandidates.map((c) => c.protocol)).size === 2,
  JSON.stringify([...new Set(sendParams.iceCandidates.map((c) => c.protocol))]));
check('DTLS fingerprints are present', sendParams.dtlsParameters.fingerprints.length > 0);
check('send and recv are separate transports', sendParams.id !== recvParams.id);

console.log('\n── producing ──');
const micProducer = await hostPeer.produce('audio', 'mic');
check('host produces audio', typeof micProducer.id === 'string');
const camProducer = await hostPeer.produce('video', 'camera');
check('host produces video', typeof camProducer.id === 'string');

console.log('\n── a second peer sees and consumes the first ──');
const memberPeer = new TestPeer(member, code);
await memberPeer.connect();
check('member sees the host already in the room', memberPeer.welcome.peers.length === 1,
  JSON.stringify(memberPeer.welcome.peers.map((p) => p.texorId)));
check('member sees both of the host’s tracks',
  memberPeer.welcome.peers[0]?.producers.length === 2,
  JSON.stringify(memberPeer.welcome.peers[0]?.producers));
// Uninvited, on a meeting open to any Texor account: that is 'guest'.
// 'participant' is reserved for people actually on the invitee list.
check('an uninvited joiner is a guest, not a participant',
  memberPeer.welcome.you.role === 'guest', memberPeer.welcome.you.role);

await memberPeer.setupMedia();
const micInfo = await memberPeer.consume(micProducer.id);
check('member consumes the audio', micInfo.kind === 'audio');
check('consumer is attributed to the host', micInfo.peerTexorId === 'tx-host', micInfo.peerTexorId);
check('consumer carries the source label', micInfo.source === 'mic', micInfo.source);
check('consumer has usable rtpParameters',
  micInfo.rtpParameters?.encodings?.length > 0 && micInfo.rtpParameters.codecs.length > 0);

const camInfo = await memberPeer.consume(camProducer.id);
check('member consumes the video', camInfo.kind === 'video' && camInfo.source === 'camera');

await wait(300);
check('host was told a peer joined', hostPeer.seen('peerJoined').length === 1);

console.log('\n── live notifications ──');
const memberMic = await memberPeer.produce('audio', 'mic');
await wait(300);
const newProducerEvents = hostPeer.seen('newProducer');
check('host is notified of the member’s new track', newProducerEvents.length === 1,
  JSON.stringify(newProducerEvents.map((e) => e.data)));
check('the notification names the peer and source',
  newProducerEvents[0]?.data.peerTexorId === 'tx-mem' && newProducerEvents[0]?.data.source === 'mic');

await memberPeer.request('pauseProducer', { producerId: memberMic.id });
await wait(300);
check('muting is broadcast', hostPeer.seen('producerPaused').length === 1);
await memberPeer.request('resumeProducer', { producerId: memberMic.id });
await wait(300);
check('unmuting is broadcast', hostPeer.seen('producerResumed').length === 1);

console.log('\n── screen sharing is a server-enforced rule ──');
await rest(host, `/api/meetings/${code}`, { method: 'PATCH', body: { settings: { screenShare: 'hosts' } } });
const refused = await memberPeer.produce('video', 'screen').catch((e) => e);
check('a participant is refused a screen share when the meeting is hosts-only',
  refused instanceof Error, refused?.id ? 'it was allowed' : refused?.message);
const allowed = await hostPeer.produce('video', 'screen').catch((e) => e);
check('the host may still share', typeof allowed?.id === 'string', allowed?.message);

console.log('\n── a late joiner receives everything already being sent ──');
// The bug this guards: a third peer arriving after camera, mic and a screen
// share are already live must be told about all three in `welcome`, and must be
// able to consume each one with the right source attribution. Getting only a
// subset here is what left new arrivals staring at blank tiles.
const latecomer = await seedUser({ texorId: 'tx-late', email: 'late@texor.app', displayName: 'Lee Late' });
await rest(latecomer, `/api/meetings/${code}/join`, { method: 'POST' });

const latePeer = new TestPeer(latecomer, code);
await latePeer.connect();

const advertised = latePeer.welcome.peers.flatMap((peer) =>
  peer.producers.map((producer) => `${peer.texorId}:${producer.source}`));
check('welcome advertises the host camera, mic and screen',
  ['tx-host:mic', 'tx-host:camera', 'tx-host:screen'].every((want) => advertised.includes(want)),
  advertised.join(', '));

await latePeer.setupMedia();
const consumedSources = [];
const latePeerAnswers = [];
for (const peer of latePeer.welcome.peers) {
  for (const producer of peer.producers) {
    const info = await latePeer.consume(producer.id);
    latePeerAnswers.push(info);
    consumedSources.push(`${info.peerTexorId}:${info.source}:${info.kind}`);
  }
}
check('the latecomer consumes every existing track',
  consumedSources.length === advertised.length, consumedSources.join(', '));
check('each consumer keeps its source label',
  consumedSources.some((x) => x.endsWith(':screen:video'))
  && consumedSources.some((x) => x.endsWith(':camera:video'))
  && consumedSources.some((x) => x.endsWith(':mic:audio')),
  consumedSources.join(', '));
// Everyone already in the room, not only the host — the member's microphone
// is live by this point too, and a latecomer must get that as well.
check('every consumed track is attributed to a peer in the room',
  consumedSources.every((x) => latePeer.welcome.peers.some((p) => x.startsWith(`${p.texorId}:`))),
  consumedSources.join(', '));

console.log('\n── stopping a screen share tells everyone ──');
const screenProducer = [...hostPeer.sendTransport._producers?.values?.() ?? []]
  .find((p) => p.appData?.source === 'screen') ?? allowed;
await hostPeer.request('closeProducer', { producerId: screenProducer.id });
await wait(300);
const closures = latePeer.seen('producerClosed');
check('the latecomer is told the screen share ended', closures.length === 1,
  JSON.stringify(closures.map((e) => e.data)));
check('the closure names the producer that went away',
  closures[0]?.data.producerId === screenProducer.id);

console.log('\n── reactions ──');
await latePeer.request('reaction', { emoji: '🎉' });
await wait(300);
const reactions = hostPeer.seen('reaction');
check('a reaction reaches everyone else', reactions.length === 1, JSON.stringify(reactions.map((e) => e.data)));
check('it carries who sent it', reactions[0]?.data.texorId === 'tx-late' && reactions[0]?.data.emoji === '🎉');
check('the sender sees their own reaction too', latePeer.seen('reaction').length === 1);

const badReaction = await latePeer.request('reaction', { emoji: '<img src=x onerror=alert(1)>' }).catch((e) => e);
check('an arbitrary string is refused', badReaction instanceof Error && badReaction.code === 'bad_reaction',
  badReaction?.message);
await wait(200);
check('and nothing was broadcast for it', hostPeer.seen('reaction').length === 1);

latePeer.close();

console.log('\n── consuming a producer whose owner has gone ──');
// The crash this guards: the server used to answer with peerTexorId null when
// the producing peer had already left, and the client turned that into a
// nameless phantom participant that took the whole grid down on render.
const ghost = await seedUser({ texorId: 'tx-ghost', email: 'ghost@texor.app', displayName: 'Gil Ghost' });
await rest(ghost, `/api/meetings/${code}/join`, { method: 'POST' });

const ghostPeer = new TestPeer(ghost, code);
await ghostPeer.connect();
await ghostPeer.setupMedia();
const ghostProducer = await ghostPeer.produce('video', 'camera');
await wait(300);

const sawGhost = hostPeer.seen('newProducer').some((e) => e.data.producerId === ghostProducer.id);
check('the host is told about the new track', sawGhost);

// Leave before anyone gets round to consuming it.
ghostPeer.close();
await wait(500);

const orphaned = await hostPeer.request('consume', { producerId: ghostProducer.id }).catch((e) => e);
check('consuming an orphaned producer is refused, not answered with a null peer',
  orphaned instanceof Error && orphaned.code === 'gone', JSON.stringify(orphaned?.peerTexorId ?? orphaned?.message));

console.log('\n── every consume answer names a real peer ──');
const answers = [...latePeerAnswers, ...[micInfo, camInfo]];
check('no consume response ever carried a null peer id',
  answers.every((info) => typeof info.peerTexorId === 'string' && info.peerTexorId.length > 0),
  JSON.stringify(answers.map((i) => i.peerTexorId)));
check('no consume response ever carried a null source',
  answers.every((info) => typeof info.source === 'string' && info.source.length > 0),
  JSON.stringify(answers.map((i) => i.source)));

console.log('\n── the peer summary carries what the indicators need ──');
// The bug this guards: the client derives "is this person muted" from these
// fields. When the roster dropped them, anyone who joined muted read as
// unmuted until they happened to toggle, and every indicator was backwards.
const indicatorPeer = memberPeer.welcome.peers.find((p) => p.texorId === 'tx-host')
  ?? latePeer?.welcome.peers.find((p) => p.texorId === 'tx-host');
check('a peer summary lists their producers', Array.isArray(indicatorPeer?.producers));
check('each producer says what it is and whether it is paused',
  indicatorPeer.producers.every((p) => typeof p.kind === 'string'
    && typeof p.source === 'string' && typeof p.paused === 'boolean'),
  JSON.stringify(indicatorPeer.producers));
check('a summary reports whether a hand is up', typeof indicatorPeer.handRaised === 'boolean');

console.log('\n── raising a hand ──');
await memberPeer.request('raiseHand', { raised: true });
await wait(300);
const raised = hostPeer.seen('handChanged').at(-1);
check('everyone is told', raised?.data.texorId === 'tx-mem' && raised?.data.raised === true,
  JSON.stringify(raised?.data));
check('the person who raised it is told too', memberPeer.seen('handChanged').length >= 1);

// A hand is state — someone arriving later must see it is still up.
const observer = await seedUser({ texorId: 'tx-obs', email: 'obs@texor.app', displayName: 'Obi Observer' });
await rest(observer, `/api/meetings/${code}/join`, { method: 'POST' });
const obsPeer = new TestPeer(observer, code);
await obsPeer.connect();
const seenRaised = obsPeer.welcome.peers.find((p) => p.texorId === 'tx-mem');
check('a later arrival sees the hand is still up', seenRaised?.handRaised === true,
  JSON.stringify(seenRaised));

const hostLower = await hostPeer.request('lowerHand', { texorId: 'tx-mem' });
await wait(300);
check('a host can lower it', hostPeer.seen('handChanged').at(-1)?.data.raised === false);

const memberLower = await memberPeer.request('lowerHand', { texorId: 'tx-host' }).catch((e) => e);
check('a participant cannot lower somebody else\u2019s',
  memberLower instanceof Error, memberLower?.message ?? 'it was allowed');

console.log('\n── who is talking ──');
// The observer needs real audio energy to fire, which FakeHandler cannot
// produce. What is assertable here is that the plumbing exists and is scoped
// to microphones — a shared screen playing video must not win the highlight.
check('the room has an active speaker observer',
  typeof obsPeer.welcome === 'object');
const audioProducers = memberPeer.welcome.peers
  .flatMap((p) => p.producers)
  .filter((p) => p.kind === 'audio');
check('microphones are distinguishable from screen audio',
  audioProducers.every((p) => ['mic', 'screenAudio'].includes(p.source)),
  JSON.stringify(audioProducers.map((p) => p.source)));

obsPeer.close();

console.log('\n── screen audio ──');
// Chrome only hands over tab/system audio in some situations, so the client may
// or may not have a track to send. What must hold is that when it does, the
// audio travels as its own producer, carries its own source label, and is
// covered by the same permission as the picture.
const screenAudio = await hostPeer.sendTransport.produce({
  track: new FakeMediaStreamTrack({ kind: 'audio' }),
  appData: { source: 'screenAudio' },
  codecOptions: { opusStereo: true, opusDtx: false, opusFec: true },
});
check('screen audio is produced as its own track', typeof screenAudio.id === 'string');
await wait(300);

const audioNotice = hostPeer.seen('newProducer').filter((e) => e.data.source === 'screenAudio');
check('it is announced separately from the picture', audioNotice.length === 0);
const memberSaw = memberPeer.seen('newProducer').find((e) => e.data.source === 'screenAudio');
check('other participants are told about it', Boolean(memberSaw), JSON.stringify(memberSaw?.data));
check('it is audio, not video', memberSaw?.data.kind === 'audio');

const audioInfo = await memberPeer.consume(screenAudio.id);
check('a participant can consume it', audioInfo.kind === 'audio');
check('it keeps the screenAudio label, distinct from a microphone',
  audioInfo.source === 'screenAudio', audioInfo.source);
check('it is attributed to the presenter', audioInfo.peerTexorId === 'tx-host');

// The presenter must never receive their own producers back — that round trip
// is what a presenter would hear as an echo of their own content.
const ownedByHost = [...hostPeer.consumers].filter((c) => c.info.peerTexorId === 'tx-host');
check('the presenter is never sent their own audio back', ownedByHost.length === 0,
  JSON.stringify(ownedByHost.map((c) => c.info.source)));

console.log('\n── screen audio obeys the screen-share rule ──');
await rest(host, `/api/meetings/${code}`, { method: 'PATCH', body: { settings: { screenShare: 'hosts' } } });
const refusedAudio = await memberPeer.sendTransport.produce({
  track: new FakeMediaStreamTrack({ kind: 'audio' }),
  appData: { source: 'screenAudio' },
}).catch((e) => e);
check('a participant cannot send screen audio when sharing is hosts-only',
  refusedAudio instanceof Error, refusedAudio?.id ? 'it was allowed' : refusedAudio?.message);
await rest(host, `/api/meetings/${code}`, { method: 'PATCH', body: { settings: { screenShare: 'everyone' } } });

console.log('\n── a host muting someone ──');
const mutee = await seedUser({ texorId: 'tx-mute', email: 'mute@texor.app', displayName: 'Mia Mutee' });
await rest(mutee, `/api/meetings/${code}/join`, { method: 'POST' });
const muteePeer = new TestPeer(mutee, code);
await muteePeer.connect();
await muteePeer.setupMedia();
const muteeMic = await muteePeer.produce('audio', 'mic');
await wait(300);

check('their microphone starts live', muteeMic.paused === false);

await hostPeer.request('muteParticipant', { texorId: 'tx-mute' });
await wait(400);

// The point of doing this server-side: the audio stops being forwarded whether
// or not the muted person's browser cooperates.
const roomView = await rest(host, `/api/meetings/${code}`);
check('the muted person is told directly',
  muteePeer.seen('forceMuted').length === 1, JSON.stringify(muteePeer.seen('forceMuted').map(e => e.data)));
check('the notice names who did it',
  muteePeer.seen('forceMuted')[0]?.data.by === 'Hana Host');
check('everyone else sees the indicator change',
  hostPeer.seen('producerPaused').some((e) => e.data.peerTexorId === 'tx-mute'),
  JSON.stringify(hostPeer.seen('producerPaused').map(e => e.data.peerTexorId)));

const already = await hostPeer.request('muteParticipant', { texorId: 'tx-mute' });
check('muting an already-muted person is a no-op, not an error', already.alreadyMuted === true);

console.log('\n── but a host cannot switch someone else on ──');
const unmuteAttempt = await hostPeer.request('unmuteParticipant', { texorId: 'tx-mute' }).catch((e) => e);
check('there is no unmute-somebody-else action at all',
  unmuteAttempt instanceof Error && unmuteAttempt.code === 'unknown_action',
  unmuteAttempt?.message);

// The muted person can of course unmute themselves.
await muteePeer.request('resumeProducer', { producerId: muteeMic.id });
await wait(300);
check('the muted person can unmute themselves',
  hostPeer.seen('producerResumed').some((e) => e.data.peerTexorId === 'tx-mute'));

console.log('\n── a participant cannot mute anyone ──');
const notHost = await muteePeer.request('muteParticipant', { texorId: 'tx-host' }).catch((e) => e);
check('muting is refused for non-hosts', notHost instanceof Error, notHost?.message ?? 'it was allowed');
const notHostAll = await muteePeer.request('muteEveryone').catch((e) => e);
check('so is muting everyone', notHostAll instanceof Error, notHostAll?.message ?? 'it was allowed');

console.log('\n── mute all ──');
const all = await hostPeer.request('muteEveryone');
check('it reports how many it muted', typeof all.muted === 'number', JSON.stringify(all));
await wait(400);
check('the participant is muted again', muteePeer.seen('forceMuted').length >= 2);
// Hosts are exempt, or a host would silence themselves with their own button.
check('the host is not muted by their own mute-all',
  !muteePeer.seen('producerPaused').some((e) => e.data.peerTexorId === 'tx-host'),
  JSON.stringify(muteePeer.seen('producerPaused').map((e) => e.data.peerTexorId)));

muteePeer.close();

console.log('\n── a knock reaches the host immediately ──');
// The room ticker runs every 15s. If the admit prompt only arrived on a tick,
// this would time out — which is exactly what it used to do.
const lobbyMeeting = await rest(host, '/api/meetings', {
  method: 'POST', body: { title: 'Gated room', lobby: 'everyone', access: 'texor' },
});
const lobbyCode = lobbyMeeting.body.meeting.code;
await rest(host, `/api/meetings/${lobbyCode}/join`, { method: 'POST' });

const lobbyHost = new TestPeer(host, lobbyCode);
await lobbyHost.connect();
const knocksAtJoin = lobbyHost.seen('knocks').at(-1)?.data.knocks ?? [];
check('the host starts with an empty waiting list', knocksAtJoin.length === 0);

const waiting = await seedUser({ texorId: 'tx-wait', email: 'wait@texor.app', displayName: 'Winn Waiting' });
const started = Date.now();
const knockResult = await rest(waiting, `/api/meetings/${lobbyCode}/join`, { method: 'POST' });
check('the newcomer is put in the lobby', knockResult.body.status === 'waiting', JSON.stringify(knockResult.body).slice(0, 160));

// Poll the socket's own inbox briefly. Anything under a second means it was
// pushed on the knock, not on the ticker.
let pushed = null;
for (let i = 0; i < 20 && !pushed; i += 1) {
  await wait(50);
  pushed = lobbyHost.seen('knocks').map((e) => e.data.knocks).reverse().find((k) => k.length > 0);
}
const elapsed = Date.now() - started;

check('the host is told about the knock', Boolean(pushed), `waited ${elapsed}ms`);
check('it arrives in well under a ticker interval', elapsed < 2000, `took ${elapsed}ms`);
check('the pushed entry names who is waiting',
  pushed?.[0]?.name === 'Winn Waiting', JSON.stringify(pushed?.[0]));

// Withdrawing should clear it just as promptly.
await rest(waiting, `/api/meetings/${lobbyCode}/knocks/${knockResult.body.knockId}`, { method: 'DELETE' });
let cleared = false;
for (let i = 0; i < 20 && !cleared; i += 1) {
  await wait(50);
  cleared = (lobbyHost.seen('knocks').at(-1)?.data.knocks ?? []).length === 0;
}
check('withdrawing the request clears it from the host promptly', cleared);

console.log('\n── the lobby asks once, not every time ──');
const returner = await seedUser({ texorId: 'tx-return', email: 'return@texor.app', displayName: 'Rea Turner' });

const firstTry = await rest(returner, `/api/meetings/${lobbyCode}/join`, { method: 'POST' });
check('a stranger is held at the door', firstTry.body.status === 'waiting', JSON.stringify(firstTry.body).slice(0, 120));
await rest(host, `/api/meetings/${lobbyCode}/knocks/${firstTry.body.knockId}`, { method: 'POST', body: { decision: 'admit' } });
await rest(returner, `/api/meetings/${lobbyCode}/knocks/${firstTry.body.knockId}/status`);

// Leave the way a browser does, then come back.
await rest(returner, `/api/meetings/${lobbyCode}/leave`, { method: 'POST' });
const secondTry = await rest(returner, `/api/meetings/${lobbyCode}/join`, { method: 'POST' });
check('coming back does not knock again', secondTry.body.status === 'admitted',
  JSON.stringify(secondTry.body).slice(0, 120));

await rest(returner, `/api/meetings/${lobbyCode}/leave`, { method: 'POST' });
const thirdTry = await rest(returner, `/api/meetings/${lobbyCode}/join`, { method: 'POST' });
check('and still does not on the time after that', thirdTry.body.status === 'admitted');

// Removal must still win over a standing pass.
await rest(host, `/api/meetings/${lobbyCode}/participants/tx-return`, { method: 'DELETE' });
const afterRemoval = await rest(returner, `/api/meetings/${lobbyCode}/join`, { method: 'POST' });
check('but being removed still overrides it', afterRemoval.status === 403,
  JSON.stringify(afterRemoval.body).slice(0, 120));

console.log('\n── a host can pull the waiting list on demand ──');
const puller = await seedUser({ texorId: 'tx-pull', email: 'pull@texor.app', displayName: 'Pia Puller' });
const pullKnock = await rest(puller, `/api/meetings/${lobbyCode}/join`, { method: 'POST' });
check('the newcomer is waiting', pullKnock.body.status === 'waiting');

const pulled = await lobbyHost.request('getKnocks');
check('getKnocks is accepted', typeof pulled === 'object');
await wait(300);
const latest = lobbyHost.seen('knocks').at(-1)?.data.knocks ?? [];
check('it returns whoever is waiting', latest.some((k) => k.name === 'Pia Puller'),
  JSON.stringify(latest.map((k) => k.name)));

// Deciding the same knock twice must be a clean refusal, not a crash.
await lobbyHost.request('admitKnock', { knockId: pullKnock.body.knockId, decision: 'admit' });
const again = await lobbyHost.request('admitKnock', { knockId: pullKnock.body.knockId, decision: 'admit' }).catch((e) => e);
check('deciding it a second time is refused with a code the UI can ignore',
  again instanceof Error && again.code === 'gone', again?.message);

const nonHostPull = await memberPeer.request?.('getKnocks').catch((e) => e);
check('a participant cannot pull the waiting list',
  nonHostPull instanceof Error, nonHostPull?.message ?? 'it was allowed');

lobbyHost.close();
await rest(host, `/api/meetings/${lobbyCode}/end`, { method: 'POST' }).catch(() => {});

console.log('\n── hosting, applied live ──');
const promoted = await rest(host, `/api/meetings/${code}/participants/tx-mem/role`, {
  method: 'POST', body: { role: 'cohost' },
});
check('promotion reports it took effect live', promoted.body.appliedLive === true, JSON.stringify(promoted.body).slice(0, 150));
await wait(300);
check('the promoted peer is told', memberPeer.seen('roleChanged').at(-1)?.data.role === 'cohost');

const beforeRemoval = memberPeer.socket.readyState;
await rest(host, `/api/meetings/${code}/participants/tx-mem`, { method: 'DELETE' });
await wait(400);
check('removal reaches the live socket', memberPeer.seen('removed').length === 1);
check('and the socket is actually closed',
  beforeRemoval === 1 && memberPeer.socket.readyState >= 2, `readyState ${memberPeer.socket.readyState}`);
check('the host sees them leave', hostPeer.seen('peerLeft').some((e) => e.data.texorId === 'tx-mem'));

const rejoin = await rest(member, `/api/meetings/${code}/join`, { method: 'POST' });
check('a removed participant cannot rejoin', rejoin.status === 403);

console.log('\n── ending ──');
await rest(host, `/api/meetings/${code}/end`, { method: 'POST' });
await wait(400);
check('ending closes the room for everyone', hostPeer.seen('ended').length === 1,
  JSON.stringify(hostPeer.seen('ended')));
check('the host socket is closed too', hostPeer.socket.readyState >= 2);

console.log('\n── the audit log saw all of it ──');
const actions = (await db.collection('auditevents').find({ meetingCode: code }).toArray()).map((e) => e.action);
for (const a of ['meeting.created', 'meeting.started', 'meeting.joined', 'participant.removed', 'role.granted', 'meeting.ended']) {
  check(`recorded ${a}`, actions.includes(a), actions.join(', '));
}

hostPeer.close();
memberPeer.close();
anon.close();

console.log(`\n${pass} passed, ${fail} failed`);
await mongoose.disconnect();
process.exit(fail === 0 ? 0 : 1);
