/**
 * The speaking highlight, driven directly.
 *
 * The audio level observer needs real audio energy to fire, which no headless
 * harness can produce — so this drives the observer's own events and asserts
 * what gets broadcast. That is precisely where the bug was: the previous
 * observer had no silence event at all, so the highlight was set once and never
 * taken back, and it sat on whoever last spoke for the rest of the call.
 */
import { EventEmitter } from 'node:events';
import { attachSpeakingDetection } from '../src/media/speaking.js';

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

/** A socket that records what was sent to it. */
function stubPeer(texorId, producerId) {
  const sent = [];
  return {
    texorId,
    sent,
    socket: { readyState: 1, OPEN: 1, send: (raw) => sent.push(JSON.parse(raw)) },
    producers: new Map(producerId ? [[producerId, { id: producerId }]] : []),
  };
}

function stubRoom() {
  const anna = stubPeer('tx-anna', 'prod-anna');
  const bo = stubPeer('tx-bo', 'prod-bo');
  const peers = new Map([['tx-anna', anna], ['tx-bo', bo]]);

  return {
    room: {
      peers,
      audioLevelObserver: new EventEmitter(),
      activeSpeakerTexorId: null,
      ownerOf: (id) => [...peers.values()].find((p) => p.producers.has(id)) ?? null,
    },
    anna,
    bo,
  };
}

/** Stands in for the signalling layer's own broadcast. */
const broadcastAll = (room, message) => {
  for (const peer of room.peers.values()) {
    if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(JSON.stringify(message));
  }
};

const speakerEvents = (peer) =>
  peer.sent.filter((m) => m.type === 'activeSpeaker').map((m) => m.data.texorId);

console.log('\n── the highlight is set, moved and taken back ──');
{
  const { room, anna, bo } = stubRoom();
  attachSpeakingDetection(room, broadcastAll);

  room.audioLevelObserver.emit('volumes', [{ producer: { id: 'prod-anna' }, volume: -30 }]);
  check('speaking is announced to everyone',
    speakerEvents(anna).at(-1) === 'tx-anna' && speakerEvents(bo).at(-1) === 'tx-anna',
    JSON.stringify(speakerEvents(bo)));

  // The observer fires every interval while someone talks; that must not mean
  // a broadcast every 300ms to every participant for the whole call.
  room.audioLevelObserver.emit('volumes', [{ producer: { id: 'prod-anna' }, volume: -28 }]);
  room.audioLevelObserver.emit('volumes', [{ producer: { id: 'prod-anna' }, volume: -31 }]);
  check('the same speaker is not re-announced', speakerEvents(bo).length === 1,
    JSON.stringify(speakerEvents(bo)));

  room.audioLevelObserver.emit('volumes', [{ producer: { id: 'prod-bo' }, volume: -25 }]);
  check('a new speaker replaces the old one', speakerEvents(bo).at(-1) === 'tx-bo');

  room.audioLevelObserver.emit('silence');
  check('silence takes the highlight back', speakerEvents(bo).at(-1) === null,
    JSON.stringify(speakerEvents(bo)));
  check('and it is not re-sent while silence continues',
    (room.audioLevelObserver.emit('silence'), speakerEvents(bo).filter((v) => v === null).length === 1));
}

console.log('\n── it survives the awkward cases ──');
{
  const { room, bo } = stubRoom();
  attachSpeakingDetection(room, broadcastAll);

  // Measured just before the speaker's socket closed.
  room.audioLevelObserver.emit('volumes', [{ producer: { id: 'prod-gone' }, volume: -20 }]);
  check('a producer with no owner is ignored', speakerEvents(bo).length === 0,
    JSON.stringify(speakerEvents(bo)));

  room.audioLevelObserver.emit('volumes', []);
  check('an empty volumes report is ignored', speakerEvents(bo).length === 0);

  attachSpeakingDetection(room, broadcastAll);
  room.audioLevelObserver.emit('volumes', [{ producer: { id: 'prod-bo' }, volume: -22 }]);
  check('attaching twice does not double every broadcast', speakerEvents(bo).length === 1,
    `${speakerEvents(bo).length} events`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
