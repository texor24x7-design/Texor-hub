/**
 * Two real mediasoup-client peers, over real WebSockets, against the running
 * SFU. No browser: mediasoup-client's own FakeHandler stands in for the
 * browser's WebRTC stack, which exercises every step of the negotiation —
 * device load, transport creation, DTLS connect, produce, consume — short of
 * actual DTLS handshaking and RTP on the wire.
 */
import mongoose from 'mongoose';
import { connectForTests } from './db.mjs';
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

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await connectForTests(process.env.MONGODB_URI);
const db = mongoose.connection.db;
for (const c of ['meetings', 'knocks', 'callmessages', 'auditevents', 'auditcounters', 'policies', 'users', 'sessions']) {
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
  constructor(user, code, room = null) {
    this.user = user;
    this.code = code;
    // Which room of the meeting to ask for. null sends no `room` parameter at
    // all, which is how a client says "wherever I belong".
    this.room = room;
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
      const query = `code=${this.code}${this.room === null ? '' : `&room=${encodeURIComponent(this.room)}`}`;
      this.socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/meeting?${query}`, {
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

console.log('\n── the host changes the quality of a call already running ──');
/**
 * The whole point of doing this over the socket rather than on a settings page
 * is that it lands on people who are already in the meeting. So the assertions
 * are about who hears about it and what the server does before telling them.
 */
const beforeQuality = muteePeer.seen('quality').length;
const tierRaise = await hostPeer.request('setQuality', { tier: 'high' });
check('the host is told which tier took effect', tierRaise.tier === 'high', JSON.stringify(tierRaise));
await wait(400);

const told = muteePeer.seen('quality');
check('everyone in the room is told, not just the host',
  told.length === beforeQuality + 1, String(told.length));
check('the host is told too — their own senders have to move as well',
  hostPeer.seen('quality').length >= 1);

const qualityMsg = told[told.length - 1]?.data ?? {};
check('the announcement carries the tier', qualityMsg.tier === 'high');
check('and the numbers a client needs to re-aim its senders',
  qualityMsg.cameraBitrate > 0 && qualityMsg.screenBitrate > 0 && qualityMsg.screenFrameRate > 0,
  JSON.stringify(qualityMsg));
check('and a name to show, not just an id', typeof qualityMsg.name === 'string' && qualityMsg.name.length > 0);
check('and who did it', qualityMsg.changedBy === 'Hana Host');

check('the meeting remembers it, so a rejoin gets the same tier',
  (await rest(host, `/api/meetings/${code}`)).body.meeting.quality === 'high');

console.log('\n── and it is the host who may do it ──');
const notHostQuality = await muteePeer.request('setQuality', { tier: 'saver' }).catch((e) => e);
check('a participant cannot change what the meeting costs',
  notHostQuality instanceof Error, notHostQuality?.tier ? 'it was allowed' : notHostQuality?.message);
const nonsense = await hostPeer.request('setQuality', { tier: 'ultra' }).catch((e) => e);
check('an unknown tier is refused rather than coerced',
  nonsense instanceof Error, nonsense?.tier ?? nonsense?.message);

await db.collection('policies').updateOne({ key: 'org' }, { $set: { maxQuality: 'standard' } }, { upsert: true });
const overPlan = await hostPeer.request('setQuality', { tier: 'high' }).catch((e) => e);
check('the plan ceiling applies here too, not only on the settings page',
  overPlan instanceof Error, overPlan?.tier ? 'it was allowed' : overPlan?.message);
check('and the refusal names the plan', /standard/.test(overPlan?.message ?? ''), overPlan?.message);
// Read from the database, not the API: the API reports the *effective* tier,
// which is now clamped to the lowered ceiling. What is stored is untouched, so
// raising the plan again restores the host's choice rather than losing it.
check('a refused change leaves the stored tier where it was',
  (await db.collection('meetings').findOne({ code }))?.quality === 'high');
check('but the meeting reports the clamped tier while the plan is lower',
  (await rest(host, `/api/meetings/${code}`)).body.meeting.quality === 'standard');

const lowered = await hostPeer.request('setQuality', { tier: 'saver' });
check('lowering is always allowed', lowered.tier === 'saver');
await db.collection('policies').updateOne({ key: 'org' }, { $set: { maxQuality: 'high' } });

muteePeer.close();

console.log('\n── a meeting does not end under people who are still in it ──');
/**
 * The bug: presence moved onto the socket but nothing refreshed `lastSeenAt`,
 * so everyone looked departed after the timeout and the next request to touch
 * the meeting reaped them and ended it.
 *
 * Simulated by ageing `lastSeenAt` directly rather than waiting 90 seconds —
 * the ticker should have written over it before anything reads it.
 */
const survivor = await seedUser({ texorId: 'tx-stay', email: 'stay@texor.app', displayName: 'Stan Stay' });
const stayMeeting = await rest(survivor, '/api/meetings', {
  method: 'POST', body: { title: 'Long one', lobby: 'off', access: 'texor' },
});
const stayCode = stayMeeting.body.meeting.code;

await rest(survivor, `/api/meetings/${stayCode}/join`, { method: 'POST' });
const stayPeer = new TestPeer(survivor, stayCode);
await stayPeer.connect();

const meetings = mongoose.connection.db.collection('meetings');
const ageBy = async (ms) => {
  const doc = await meetings.findOne({ code: stayCode });
  const old = new Date(Date.now() - ms);
  await meetings.updateOne(
    { _id: doc._id },
    { $set: { 'attendance.$[].lastSeenAt': old, startedAt: old } },
  );
};

// Older than MEETING_HEARTBEAT_TIMEOUT_SECONDS (90s), as it would be after a
// couple of quiet minutes on a call.
await ageBy(5 * 60_000);

// Read it immediately, with no tick in between — the open socket alone must
// be enough to keep them counted as present.
const stillLive = await rest(survivor, `/api/meetings/${stayCode}`);
check('a stale timestamp does not end a meeting somebody is connected to',
  stillLive.body.meeting.status === 'live', stillLive.body.meeting.status);
check('and they are still counted as in the call',
  stillLive.body.meeting.participantCount === 1, String(stillLive.body.meeting.participantCount));

// Somebody joining is the most common trigger — it calls loadMeeting, which
// reaps. With presence refreshed, it must not take the meeting down.
const joiner = await seedUser({ texorId: 'tx-joiner', email: 'joiner@texor.app', displayName: 'Jo Joiner' });
await ageBy(5 * 60_000);
const joined = await rest(joiner, `/api/meetings/${stayCode}/join`, { method: 'POST' });
check('a newcomer joining does not end the meeting',
  joined.body.status === 'admitted', JSON.stringify(joined.body).slice(0, 140));
check('the original participant is still there',
  (await rest(survivor, `/api/meetings/${stayCode}`)).body.meeting.status === 'live');

// And the sweep must still work when somebody genuinely goes.
stayPeer.close();
await wait(500);
const left = await rest(survivor, `/api/meetings/${stayCode}`);
check('a socket that closes still removes them',
  !left.body.meeting.participants.some((p) => p.texorId === 'tx-stay'),
  JSON.stringify(left.body.meeting.participants.map((p) => p.texorId)));

console.log('\n── the roster converges even when a delta is missed ──');
/**
 * The bug: `peerJoined` is a single delivery and `send` drops it silently if
 * that socket is not open at the instant it fires. One participant then had a
 * permanently wrong roster — two people saw three participants and the third
 * saw two, for the rest of the call.
 */
const a = await seedUser({ texorId: 'tx-ra', email: 'ra@texor.app', displayName: 'Ana Roster' });
const b = await seedUser({ texorId: 'tx-rb', email: 'rb@texor.app', displayName: 'Ben Roster' });
const c = await seedUser({ texorId: 'tx-rc', email: 'rc@texor.app', displayName: 'Cal Roster' });

const rosterMeeting = await rest(a, '/api/meetings', {
  method: 'POST', body: { title: 'Roster', lobby: 'off', access: 'texor' },
});
const rCode = rosterMeeting.body.meeting.code;
for (const u of [a, b, c]) await rest(u, `/api/meetings/${rCode}/join`, { method: 'POST' });

const peerA = new TestPeer(a, rCode);
await peerA.connect();
const peerB = new TestPeer(b, rCode);
await peerB.connect();

check('everyone present at connect time is in the welcome',
  peerB.welcome.peers.some((p) => p.texorId === 'tx-ra'),
  JSON.stringify(peerB.welcome.peers.map((p) => p.texorId)));

// Drop B's incoming messages, so it misses the delta the way a socket mid
// reconnect would, then let a third person arrive.
const swallowed = [];
const realPush = peerB.events.push.bind(peerB.events);
peerB.events.push = (event) => {
  if (event?.type === 'peerJoined') { swallowed.push(event); return peerB.events.length; }
  return realPush(event);
};

const peerC = new TestPeer(c, rCode);
await peerC.connect();
await wait(500);

check('B did indeed miss the join notification', swallowed.length >= 1,
  `swallowed ${swallowed.length}`);
check('A, which did not miss it, sees three',
  peerA.seen('peerJoined').length >= 1);

// The reconciliation pass runs on the room ticker.
peerB.events.push = realPush;
await wait(6500);

const reconciled = peerB.seen('roster').at(-1)?.data.peers ?? [];
const ids = reconciled.map((p) => p.texorId);
check('B is sent an authoritative roster', reconciled.length > 0, JSON.stringify(ids));
check('and it contains the participant whose delta was lost', ids.includes('tx-rc'), JSON.stringify(ids));
check('along with everyone else, and not itself',
  ids.includes('tx-ra') && !ids.includes('tx-rb'), JSON.stringify(ids));

// Leaving must converge too, not just joining.
peerC.close();
await wait(6500);
const afterLeave = peerB.seen('roster').at(-1)?.data.peers ?? [];
check('someone who leaves drops out of the roster',
  !afterLeave.some((p) => p.texorId === 'tx-rc'), JSON.stringify(afterLeave.map((p) => p.texorId)));

peerA.close();
peerB.close();

console.log('\n── a profile photo travels with the peer ──');
// A tile with the camera off shows a face rather than two letters, so the photo
// has to reach the client the same way the name does.
const withPhoto = await seedUser({ texorId: 'tx-pic', email: 'pic@texor.app', displayName: 'Pia Picture' });
await mongoose.connection.db.collection('users').updateOne(
  { texorId: 'tx-pic' },
  { $set: { picture: 'https://example.test/pia.jpg' } },
);
await rest(withPhoto, `/api/meetings/${code}/join`, { method: 'POST' });
const picPeer = new TestPeer(withPhoto, code);
await picPeer.connect();
await wait(400);

const asSeen = hostPeer.seen('peerJoined').map((e) => e.data.peer).find((p) => p.texorId === 'tx-pic')
  ?? (hostPeer.seen('roster').at(-1)?.data.peers ?? []).find((p) => p.texorId === 'tx-pic');
check('the photo reaches other participants', asSeen?.picture === 'https://example.test/pia.jpg',
  JSON.stringify(asSeen?.picture));

const rosterCopy = (picPeer.welcome.peers ?? [])[0];
check('and is present on everyone in the welcome', 'picture' in (rosterCopy ?? {}),
  JSON.stringify(Object.keys(rosterCopy ?? {})));

const attendance = (await rest(host, `/api/meetings/${code}`)).body.meeting.participants
  .find((p) => p.texorId === 'tx-pic');
check('the REST roster carries it too', attendance?.picture === 'https://example.test/pia.jpg',
  JSON.stringify(attendance));

// Guests have none, and the client falls back to initials.
check('somebody without one gets an empty string rather than undefined',
  (picPeer.welcome.peers ?? []).every((p) => typeof p.picture === 'string'),
  JSON.stringify((picPeer.welcome.peers ?? []).map((p) => p.picture)));

picPeer.close();

console.log('\n── handing the meeting over ──');
const alice = await seedUser({ texorId: 'tx-ho', email: 'ho@texor.app', displayName: 'Alice Owner' });
const bob = await seedUser({ texorId: 'tx-hb', email: 'hb@texor.app', displayName: 'Bob Next' });
const carol = await seedUser({ texorId: 'tx-hc', email: 'hc@texor.app', displayName: 'Carol Bystander' });

const owned = await rest(alice, '/api/meetings', {
  method: 'POST', body: { title: 'Handover', lobby: 'off', access: 'texor' },
});
const hCode = owned.body.meeting.code;
for (const u of [alice, bob, carol]) await rest(u, `/api/meetings/${hCode}/join`, { method: 'POST' });

const aPeer = new TestPeer(alice, hCode);
await aPeer.connect();
const bPeer = new TestPeer(bob, hCode);
await bPeer.connect();
await wait(300);

check('only the host may hand over',
  (await rest(bob, `/api/meetings/${hCode}/host`, { method: 'POST', body: { texorId: 'tx-hc' } })).status === 403);
check('handing it to somebody not in the meeting is refused',
  (await rest(alice, `/api/meetings/${hCode}/host`, { method: 'POST', body: { texorId: 'tx-nobody' } })).status === 400);
check('handing it to yourself is refused',
  (await rest(alice, `/api/meetings/${hCode}/host`, { method: 'POST', body: { texorId: 'tx-ho' } })).status === 400);

const handed = await rest(alice, `/api/meetings/${hCode}/host`, { method: 'POST', body: { texorId: 'tx-hb' } });
check('the host can hand over to someone present', handed.status === 200, JSON.stringify(handed.body).slice(0, 140));
check('the meeting records the new host', handed.body.meeting.host.texorId === 'tx-hb',
  JSON.stringify(handed.body.meeting.host));
check('the outgoing host stays a co-host rather than being demoted to nothing',
  handed.body.meeting.cohostTexorIds.includes('tx-ho'),
  JSON.stringify(handed.body.meeting.cohostTexorIds));

await wait(400);
check('the new host is told live, without rejoining',
  bPeer.seen('roleChanged').at(-1)?.data.role === 'host',
  JSON.stringify(bPeer.seen('roleChanged').map((e) => e.data.role)));
check('and the outgoing host is moved down live too',
  aPeer.seen('roleChanged').at(-1)?.data.role === 'cohost',
  JSON.stringify(aPeer.seen('roleChanged').map((e) => e.data.role)));

// The new host must actually be able to host.
const nowHosts = await rest(bob, `/api/meetings/${hCode}/knocks`);
check('the new host can see the waiting list', nowHosts.status === 200, `HTTP ${nowHosts.status}`);
check('the old host can still act as a co-host',
  (await rest(alice, `/api/meetings/${hCode}/knocks`)).status === 200);

aPeer.close();
bPeer.close();
await rest(bob, `/api/meetings/${hCode}/end`, { method: 'POST' }).catch(() => {});

console.log('\n── two people sharing at once ──');
// Both shares must exist as separate producers, each attributed to its owner,
// so a client can list them and choose. Previously the second was consumed and
// then never shown, with no way to reach it.
const sharerA = await seedUser({ texorId: 'tx-sa', email: 'sa@texor.app', displayName: 'Sam A' });
const sharerB = await seedUser({ texorId: 'tx-sb', email: 'sb@texor.app', displayName: 'Sid B' });
const viewer = await seedUser({ texorId: 'tx-sv', email: 'sv@texor.app', displayName: 'Vic Viewer' });

const shareMeeting = await rest(sharerA, '/api/meetings', {
  method: 'POST', body: { title: 'Two screens', lobby: 'off', access: 'texor' },
});
const sCode = shareMeeting.body.meeting.code;
for (const u of [sharerA, sharerB, viewer]) await rest(u, `/api/meetings/${sCode}/join`, { method: 'POST' });

const peerSA = new TestPeer(sharerA, sCode); await peerSA.connect(); await peerSA.setupMedia();
const peerSB = new TestPeer(sharerB, sCode); await peerSB.connect(); await peerSB.setupMedia();
const peerSV = new TestPeer(viewer, sCode); await peerSV.connect(); await peerSV.setupMedia();

const screenA = await peerSA.produce('video', 'screen');
const screenB = await peerSB.produce('video', 'screen');
await wait(500);

const announced = peerSV.seen('newProducer').filter((e) => e.data.source === 'screen');
check('the viewer is told about both', announced.length === 2,
  JSON.stringify(announced.map((e) => e.data.peerTexorId)));
check('each is attributed to its own owner',
  new Set(announced.map((e) => e.data.peerTexorId)).size === 2,
  JSON.stringify(announced.map((e) => e.data.peerTexorId)));

const infoA = await peerSV.consume(screenA.id);
const infoB = await peerSV.consume(screenB.id);
check('both can be consumed at the same time',
  infoA.source === 'screen' && infoB.source === 'screen');
check('and stay distinguishable by owner',
  infoA.peerTexorId === 'tx-sa' && infoB.peerTexorId === 'tx-sb',
  `${infoA.peerTexorId} / ${infoB.peerTexorId}`);

// The roster is what a late joiner reconciles from, so both must appear there.
const rosterShares = (peerSV.seen('roster').at(-1)?.data.peers ?? [])
  .flatMap((p) => (p.producers ?? []).filter((x) => x.source === 'screen').map(() => p.texorId));
check('both appear in the authoritative roster', rosterShares.length === 2, JSON.stringify(rosterShares));

// One stopping must not disturb the other.
await peerSA.request('closeProducer', { producerId: screenA.id });
await wait(400);
check('closing one is announced',
  peerSV.seen('producerClosed').some((e) => e.data.producerId === screenA.id));
check('the other is untouched',
  !peerSV.seen('producerClosed').some((e) => e.data.producerId === screenB.id));

for (const p of [peerSA, peerSB, peerSV]) p.close();
await rest(sharerA, `/api/meetings/${sCode}/end`, { method: 'POST' }).catch(() => {});

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
const knockResult = await rest(waiting, `/api/meetings/${lobbyCode}/join`, { method: 'POST' });
/**
 * The clock starts *after* the request returns, not before.
 *
 * `refreshKnocks` runs inside the join request, so the push has already left
 * the server by the time the response lands. Timing from before the call folded
 * the whole round trip — a remote database, and an audit write that hashes a
 * chain — into a number that is supposed to be about push latency, and made
 * this a benchmark of the database rather than a test of the push.
 */
const started = Date.now();
check('the newcomer is put in the lobby', knockResult.body.status === 'waiting', JSON.stringify(knockResult.body).slice(0, 160));

// Poll the socket's own inbox. The property being tested is that this arrived
// because it was pushed, not because the ticker swept — so the bound that
// means anything is the ticker's own interval.
const ROOM_TICK_MS = 5000;
let pushed = null;
for (let i = 0; i < 40 && !pushed; i += 1) {
  await wait(50);
  pushed = lobbyHost.seen('knocks').map((e) => e.data.knocks).reverse().find((k) => k.length > 0);
}
const elapsed = Date.now() - started;

check('the host is told about the knock', Boolean(pushed), `waited ${elapsed}ms`);
check('it was pushed on the knock rather than swept up by the ticker',
  elapsed < ROOM_TICK_MS, `took ${elapsed}ms, ticker runs every ${ROOM_TICK_MS}ms`);
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

console.log('\n── asking for a room of a meeting that has none ──');
{
  /**
   * Breakout rooms are not wired up yet. Until they are, a client asking for
   * one has to land in the meeting rather than being refused or, worse, opening
   * a room nobody can see it in.
   */
  const plain = await rest(host, '/api/meetings', {
    method: 'POST', body: { title: 'No breakouts here', lobby: 'off', access: 'texor' },
  });
  const pCode = plain.body.meeting.code;
  await rest(host, `/api/meetings/${pCode}/join`, { method: 'POST' });

  const asker = new TestPeer(host, pCode, 'b1');
  await asker.connect();
  check('they land in the meeting itself', Boolean(asker.welcome));

  const second = await seedUser({ texorId: 'tx-plain', email: 'plain@texor.app', displayName: 'Pat Plain' });
  await rest(second, `/api/meetings/${pCode}/join`, { method: 'POST' });
  const other = new TestPeer(second, pCode, '');
  await other.connect();

  // The proof they are in the same room: each can see the other.
  await wait(300);
  const rosters = other.seen('roster').map((event) => event.data.peers ?? []);
  const sawHost = other.welcome.peers.some((peer) => peer.texorId === 'tx-host')
    || rosters.some((peers) => peers.some((peer) => peer.texorId === 'tx-host'));
  check('and are in it together, not in rooms of their own', sawHost);

  asker.close();
  other.close();
}

console.log('\n── a pass lasts the sitting, and no longer ──');
{
  /**
   * The bug this closes: a pass was written the first time somebody got in and
   * never taken away, so "everyone knocks" waved through anyone who had ever
   * been inside — from an earlier sitting, an earlier occurrence, or from when
   * the waiting room was off.
   */
  const sitting = await rest(host, '/api/meetings', {
    method: 'POST', body: { title: 'One sitting', lobby: 'everyone', access: 'texor' },
  });
  const sCode2 = sitting.body.meeting.code;
  await rest(host, `/api/meetings/${sCode2}/join`, { method: 'POST' });

  const hostPeer = new TestPeer(host, sCode2);
  await hostPeer.connect();

  const visitor = await seedUser({ texorId: 'tx-sitting', email: 'sit@texor.app', displayName: 'Sid Sitting' });

  const first = await rest(visitor, `/api/meetings/${sCode2}/join`, { method: 'POST' });
  check('a newcomer knocks', first.body.status === 'waiting', JSON.stringify(first.body).slice(0, 120));

  // Somebody who still has to knock cannot get in by opening a socket instead.
  const sneak = new TestPeer(visitor, sCode2);
  const refusal = await sneak.connect().then(() => null, (error) => error);
  check('and cannot skip the waiting room by opening a socket', refusal?.code === 'lobby_required',
    refusal ? `${refusal.code}: ${refusal.message}` : 'the socket let them in');

  await rest(host, `/api/meetings/${sCode2}/knocks/${first.body.knockId}`, { method: 'POST', body: { decision: 'admit' } });
  await rest(visitor, `/api/meetings/${sCode2}/knocks/${first.body.knockId}/status`);

  await rest(visitor, `/api/meetings/${sCode2}/leave`, { method: 'POST' });
  const wobble = await rest(visitor, `/api/meetings/${sCode2}/join`, { method: 'POST' });
  check('stepping out and back in while the call runs does not knock again',
    wobble.body.status === 'admitted', JSON.stringify(wobble.body).slice(0, 120));

  // Everybody leaves: the sitting is over.
  await rest(visitor, `/api/meetings/${sCode2}/leave`, { method: 'POST' });
  hostPeer.close();
  await wait(300);
  await rest(host, `/api/meetings/${sCode2}/leave`, { method: 'POST' });

  const nextTime = await rest(visitor, `/api/meetings/${sCode2}/join`, { method: 'POST' });
  check('once the room has emptied, the same person knocks again',
    nextTime.body.status === 'waiting', JSON.stringify(nextTime.body).slice(0, 120));
}

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

console.log('\n── breakout rooms: a meeting in more than one piece ──');
{
  const ana = await seedUser({ texorId: 'tx-ana', email: 'ana@texor.app', displayName: 'Ana' });
  const bo = await seedUser({ texorId: 'tx-bo', email: 'bo@texor.app', displayName: 'Bo' });

  const made = await rest(host, '/api/meetings', {
    method: 'POST', body: { title: 'Split me', lobby: 'everyone', access: 'texor' },
  });
  const bCode = made.body.meeting.code;

  await rest(host, `/api/meetings/${bCode}/join`, { method: 'POST' });
  const hostIn = new TestPeer(host, bCode);
  await hostIn.connect();

  // Admitted by the host, the ordinary way, so they hold a pass for this sitting
  // — which is what the regression further down is about.
  for (const person of [ana, bo]) {
    const knocked = await rest(person, `/api/meetings/${bCode}/join`, { method: 'POST' });
    await rest(host, `/api/meetings/${bCode}/knocks/${knocked.body.knockId}`,
      { method: 'POST', body: { decision: 'admit' } });
    // The pass is written when the waiting client picks the decision up, the
    // same way the browser does it.
    const settled = await rest(person, `/api/meetings/${bCode}/knocks/${knocked.body.knockId}/status`);
    check(`${person.displayName} is let in`, settled.body.status === 'admitted',
      JSON.stringify([knocked.body, settled.body]).slice(0, 200));
  }

  const anaMain = new TestPeer(ana, bCode);
  const boMain = new TestPeer(bo, bCode);
  await anaMain.connect();
  await boMain.connect();
  check('everybody starts in the one room',
    boMain.welcome.breakout.room === ''
      && boMain.welcome.peers.some((peer) => peer.texorId === 'tx-ana')
      && boMain.welcome.peers.some((peer) => peer.texorId === 'tx-host'),
    JSON.stringify(boMain.welcome.peers.map((peer) => peer.texorId)));

  const opened = await rest(host, `/api/meetings/${bCode}/breakouts`, {
    method: 'POST',
    body: { rooms: [{ name: 'Blue', members: ['tx-ana'] }, { name: 'Green', members: ['tx-bo'] }] },
  });
  check('the host opens two rooms', opened.status === 200, JSON.stringify(opened.body).slice(0, 200));

  await wait(300);
  const anaMove = anaMain.seen('moveTo').at(-1);
  const boMove = boMain.seen('moveTo').at(-1);
  check('each person is told where to go', anaMove?.data.room === 'b1' && boMove?.data.room === 'b2',
    JSON.stringify([anaMove?.data, boMove?.data]));
  check('and what the room is called', anaMove?.data.name === 'Blue', anaMove?.data.name);
  check('the host is not moved anywhere', hostIn.seen('moveTo').length === 0);

  // What the browser does with that: reconnect to the room it names.
  const anaBlue = new TestPeer(ana, bCode, 'b1');
  await anaBlue.connect();
  anaMain.close();
  const boGreen = new TestPeer(bo, bCode, 'b2');
  await boGreen.connect();
  boMain.close();
  await wait(300);

  check('the room they land in is the one they were sent to',
    anaBlue.welcome.breakout.room === 'b1' && anaBlue.welcome.breakout.name === 'Blue',
    JSON.stringify(anaBlue.welcome.breakout));
  check('and they are alone in it', anaBlue.welcome.peers.length === 0,
    JSON.stringify(anaBlue.welcome.peers));
  check('the main room saw them leave',
    hostIn.seen('peerLeft').some((event) => event.data.texorId === 'tx-ana'));

  /**
   * The isolation, demonstrated rather than asserted about a filter: Ana's
   * audio is on a different Router, so there is no path by which Bo could
   * receive it even if the server wanted to forward it.
   */
  await anaBlue.setupMedia();
  await boGreen.setupMedia();
  const anaAudio = await anaBlue.produce('audio', 'mic');
  await wait(200);
  check('somebody in another room is never told about the producer',
    boGreen.seen('newProducer').length === 0, JSON.stringify(boGreen.seen('newProducer')));
  const leak = await boGreen.consume(anaAudio.id).then(() => null).catch((error) => error);
  // `gone` rather than a special refusal: as far as this Router is concerned
  // that producer does not exist, which is the whole point.
  check('and asking for it by id is refused', leak !== null && leak.code === 'gone',
    `${leak?.code} ${leak?.message}`);

  console.log('\n── the meeting is still one meeting ──');
  const live = await rest(host, `/api/meetings/${bCode}`);
  check('everyone in a breakout still counts as present', live.body.meeting.presentCount === 3,
    String(live.body.meeting.presentCount));
  check('the meeting is still live', live.body.meeting.status === 'live', live.body.meeting.status);

  /**
   * The regression this whole design is arranged around.
   *
   * With presence read one room at a time, the main room looks empty the
   * moment everybody is in a breakout — and an empty room ends the sitting,
   * which silently cancels every pass. Under "everyone knocks" that means the
   * next person to reconnect is back at the door. Emptying a breakout is the
   * sharpest version of it.
   */
  boGreen.close();
  await wait(700);
  const afterEmpty = await rest(host, `/api/meetings/${bCode}`);
  check('a breakout emptying does not end the meeting', afterEmpty.body.meeting.status === 'live',
    afterEmpty.body.meeting.status);
  const stored = await db.collection('meetings').findOne({ code: bCode });
  check('and does not quietly cancel everybody’s pass',
    (stored.admittedTexorIds ?? []).includes('tx-ana'), JSON.stringify(stored.admittedTexorIds));
  // `actingHostTexorId` names a stand-in, so null is the right answer while the
  // owner is in the call: nobody has been handed a meeting that has its host.
  check('nor hand the meeting to a stand-in', stored.actingHostTexorId === null,
    String(stored.actingHostTexorId));
  check('and Ana does not have to knock again to reconnect',
    (await rest(ana, `/api/meetings/${bCode}/join`, { method: 'POST' })).body.status === 'admitted');

  console.log('\n── who may open which room ──');
  const refused = new TestPeer(ana, bCode, 'b2');
  const refusal = await refused.connect().then(() => null).catch((error) => error);
  check('a room you were not put in is refused', refusal?.code === 'forbidden', String(refusal?.code));
  const nonsense = new TestPeer(ana, bCode, 'b99');
  const unknown = await nonsense.connect().then(() => null).catch((error) => error);
  check('and a room that does not exist is not invented', unknown?.code === 'not_found', String(unknown?.code));

  const visiting = new TestPeer(host, bCode, 'b1');
  await visiting.connect();
  hostIn.close();
  check('a host walks into any room of their own meeting', visiting.welcome.breakout.room === 'b1');
  await wait(200);
  check('and the people in it see them arrive',
    anaBlue.seen('peerJoined').some((event) => event.data.peer.texorId === 'tx-host'));

  // Visiting is transient: it is not an assignment, and an unrelated edit to
  // the plan must not end it mid-sentence.
  await rest(host, `/api/meetings/${bCode}/breakouts`, {
    method: 'PATCH',
    body: { rooms: [{ key: 'b1', name: 'Blue', members: ['tx-ana'] }, { key: 'b2', name: 'Green', members: [] }] },
  });
  await wait(300);
  check('a visiting host is not yanked back by somebody else’s reassignment',
    visiting.seen('moveTo').length === 0, JSON.stringify(visiting.seen('moveTo')));

  console.log('\n── what was said in a room you were not in ──');
  await anaBlue.request('chat', { body: 'we think the answer is yes' });
  await visiting.request('chat', { body: 'good, say that to everyone' });
  await wait(400);

  const blueLog = await rest(host, `/api/meetings/${bCode}/chat?room=b1`);
  check('the host reads a breakout back afterwards',
    blueLog.body.messages?.map((message) => message.body).join(' | ')
      === 'we think the answer is yes | good, say that to everyone',
    JSON.stringify(blueLog.body).slice(0, 220));
  check('and it is labelled with the room it happened in', blueLog.body.name === 'Blue', blueLog.body.name);
  check('the main room is a separate transcript',
    (await rest(host, `/api/meetings/${bCode}/chat`)).body.messages?.length === 0);

  check('somebody reads the room they were in',
    (await rest(ana, `/api/meetings/${bCode}/chat?room=b1`)).body.messages?.length === 2);
  check('but not one they were never in',
    (await rest(ana, `/api/meetings/${bCode}/chat?room=b2`)).status === 403);
  check('and somebody outside the meeting reads nothing',
    (await rest(bob, `/api/meetings/${bCode}/chat?room=b1`)).status === 403,
    String((await rest(bob, `/api/meetings/${bCode}/chat?room=b1`)).status));

  const stamped = await db.collection('callmessages').findOne({ roomKey: 'b1' });
  check('every message is stamped with when it is deleted',
    stamped?.expiresAt instanceof Date && stamped.expiresAt > new Date(),
    String(stamped?.expiresAt));
  const ttl = await db.collection('callmessages').indexes();
  check('and the index that does the deleting exists',
    ttl.some((index) => index.expireAfterSeconds === 0), JSON.stringify(ttl.map((i) => i.name)));

  // A message costs a write now, so there is a limit on how fast they arrive.
  const flood = [];
  for (let n = 0; n < 14; n += 1) flood.push(anaBlue.request('chat', { body: `flood ${n}` }).catch((error) => error));
  const refusals = (await Promise.all(flood)).filter((result) => result?.code === 'too_fast');
  check('a flood is refused rather than written', refusals.length > 0, String(refusals.length));

  console.log('\n── talking to every room at once, and asking for help ──');
  const announced = await visiting.request('breakoutAnnounce', { body: 'five minutes left' })
    .then(() => null).catch((error) => error);
  check('a host can announce into every room', announced === null, String(announced?.message));
  await wait(400);
  check('it reaches a room the host is not in',
    anaBlue.seen('breakoutAnnounce').some((event) => event.data.body === 'five minutes left'),
    JSON.stringify(anaBlue.seen('breakoutAnnounce')));
  check('and it is kept with the room it was said in',
    (await rest(host, `/api/meetings/${bCode}/chat?room=b1`)).body.messages
      ?.some((message) => message.kind === 'announcement'));

  const notMine = await anaBlue.request('breakoutAnnounce', { body: 'nope' })
    .then(() => null).catch((error) => error);
  check('a participant cannot announce', notMine?.code === 'forbidden', String(notMine?.code));

  await anaBlue.request('breakoutHelp', {});
  await wait(300);
  const asked = visiting.seen('helpRequested').at(-1);
  check('asking for help reaches the host', asked?.data.room === 'b1' && asked?.data.texorId === 'tx-ana',
    JSON.stringify(asked?.data));

  console.log('\n── choosing your own room ──');
  {
    const blocked = new TestPeer(bo, bCode, 'b1');
    const no = await blocked.connect().then(() => null).catch((error) => error);
    check('you cannot wander in while self-selection is off', no?.code === 'forbidden', String(no?.code));

    await rest(host, `/api/meetings/${bCode}/breakouts`, { method: 'PATCH', body: { selfSelect: true } });
    const chose = new TestPeer(bo, bCode, 'b1');
    await chose.connect();
    check('and can when the host turns it on', chose.welcome.breakout.room === 'b1');

    const trail = (await db.collection('auditevents').find({ meetingCode: bCode }).toArray())
      .map((event) => event.action);
    check('choosing for yourself is recorded as your own act',
      trail.includes('breakouts.self_selected'), trail.join(', '));
    chose.close();
    await rest(host, `/api/meetings/${bCode}/breakouts`, { method: 'PATCH', body: { selfSelect: false } });
  }

  console.log('\n── coming back ──');
  const back = new TestPeer(ana, bCode);
  await back.connect();
  anaBlue.close();
  check('asking for no room at all puts you back where you belong',
    back.welcome.breakout.room === 'b1', JSON.stringify(back.welcome.breakout));

  const closed = await rest(host, `/api/meetings/${bCode}/breakouts`, { method: 'DELETE' });
  check('the host closes the rooms', closed.status === 200);
  await wait(300);
  check('and everybody is sent back to the meeting',
    back.seen('moveTo').at(-1)?.data.room === '' && visiting.seen('moveTo').at(-1)?.data.room === '',
    JSON.stringify([back.seen('moveTo').at(-1)?.data, visiting.seen('moveTo').at(-1)?.data]));

  const afterClose = new TestPeer(ana, bCode, 'b1');
  const gone = await afterClose.connect();
  check('a closed breakout cannot be walked back into', gone.breakout.room === '',
    JSON.stringify(gone.breakout));

  console.log('\n── rooms that close themselves ──');
  {
    // A minute, then wound back past the deadline: the ticker is what closes
    // them, so this is the real path rather than a function called directly.
    await rest(host, `/api/meetings/${bCode}/breakouts`, {
      method: 'POST', body: { rooms: [{ key: 'b1', name: 'Blue', members: ['tx-ana'] }], minutes: 1 },
    });
    await wait(300);
    const timed = new TestPeer(ana, bCode);
    await timed.connect();
    back.close();
    check('the room is open, with a deadline on it', timed.welcome.breakout.room === 'b1'
      && timed.welcome.breakout.closesAt !== null, JSON.stringify(timed.welcome.breakout));

    await db.collection('meetings').updateOne(
      { code: bCode }, { $set: { 'breakouts.closesAt': new Date(Date.now() - 1000) } },
    );
    await wait(6000);

    check('the deadline brings everybody back without the host doing anything',
      timed.seen('moveTo').at(-1)?.data.room === '', JSON.stringify(timed.seen('moveTo').at(-1)?.data));
    const shut = await db.collection('meetings').findOne({ code: bCode });
    check('and the plan says so', shut.breakouts.status === 'closed', shut.breakouts.status);
    const why = (await db.collection('auditevents')
      .find({ meetingCode: bCode, action: 'breakouts.closed' }).toArray()).map((row) => row.metadata?.reason);
    check('the record says it was the clock, not a person', why.includes('time'), why.join(', '));
    timed.close();
  }

  visiting.close();
  afterClose.close();
  await rest(host, `/api/meetings/${bCode}/end`, { method: 'POST' });
}

console.log(`\n${pass} passed, ${fail} failed`);
await mongoose.disconnect();
process.exit(fail === 0 ? 0 : 1);
