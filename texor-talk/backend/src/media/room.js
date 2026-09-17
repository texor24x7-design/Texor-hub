/**
 * A live meeting's media: one mediasoup Router, and the peers on it.
 *
 * A Router is the meeting. Media can only be forwarded between transports on
 * the same Router, so "who can hear whom" is a structural property here rather
 * than a rule that has to be enforced — two meetings cannot leak into each
 * other because they are not on the same Router to begin with.
 *
 * Rooms are created when the first person arrives and closed when the last one
 * leaves, because an idle Router still holds a worker's resources.
 */
import env from '../config/env.js';
import { maxSendBitrate } from '../services/quality.service.js';
import logger from '../utils/logger.js';
import { mediaCodecs, nextWorkerInPool } from './worker.js';

const rooms = new Map();

/**
 * One participant's media state.
 *
 * Two transports, not one: WebRTC transports are directional, so sending and
 * receiving need their own. Keeping them apart also means a failure in one
 * direction does not take the other down with it.
 */
class Peer {
  constructor({ texorId, name, picture, role, socket }) {
    this.texorId = texorId;
    this.name = name;
    // Carried from the Texor profile so a tile with the camera off can show the
    // person rather than two letters. Guests have none, and fall back.
    this.picture = picture ?? '';
    this.role = role;
    this.socket = socket;

    this.sendTransport = null;
    this.recvTransport = null;
    this.producers = new Map();
    this.consumers = new Map();

    // Set once the browser has told us what it can decode. Nothing can be sent
    // to this peer before that, because we would not know what it understands.
    this.rtpCapabilities = null;
    this.joinedAt = new Date();

    // Raising a hand is state, not a passing reaction: it stays up until it is
    // lowered, and everyone arriving later needs to see it is still up.
    this.handRaised = false;
  }

  close() {
    for (const consumer of this.consumers.values()) consumer.close();
    for (const producer of this.producers.values()) producer.close();
    this.sendTransport?.close();
    this.recvTransport?.close();

    this.consumers.clear();
    this.producers.clear();
    this.sendTransport = null;
    this.recvTransport = null;
  }

  /** What other people need to know about this peer. Never internal ids. */
  summary() {
    return {
      texorId: this.texorId,
      name: this.name,
      picture: this.picture,
      role: this.role,
      joinedAt: this.joinedAt,
      handRaised: this.handRaised,
      producers: [...this.producers.values()].map((producer) => ({
        id: producer.id,
        kind: producer.kind,
        source: producer.appData.source,
        paused: producer.paused,
      })),
    };
  }
}

class Room {
  constructor(meetingCode, router, audioLevelObserver) {
    this.meetingCode = meetingCode;
    this.router = router;
    this.peers = new Map();

    /**
     * Who is talking, decided by the SFU rather than by each browser.
     *
     * Every client watching its own audio levels would give a different answer
     * at a different moment, and none of them would agree about somebody they
     * cannot hear. The router sees every stream, so it is the only place the
     * question has one answer.
     *
     * An **audio level** observer rather than an active-speaker one, because
     * only this kind reports silence. `ActiveSpeakerObserver` emits nothing at
     * all when everybody stops talking, so the highlight it sets can never be
     * taken back — it just sits on whoever spoke last for the rest of the call.
     */
    this.audioLevelObserver = audioLevelObserver;
    this.activeSpeakerTexorId = null;
  }

  /** The peer that owns a producer, or null if they have since left. */
  ownerOf(producerId) {
    return [...this.peers.values()].find((peer) => peer.producers.has(producerId)) ?? null;
  }

  get rtpCapabilities() {
    return this.router.rtpCapabilities;
  }

  /**
   * A peer can only consume what its browser can decode. Asking the Router
   * rather than assuming is what stops us sending VP9 to a browser that only
   * speaks VP8 and leaving the user with a black rectangle.
   */
  canConsume(producerId, rtpCapabilities) {
    return this.router.canConsume({ producerId, rtpCapabilities });
  }

  addPeer(peer) {
    this.peers.set(peer.texorId, peer);
    return peer;
  }

  removePeer(texorId) {
    const peer = this.peers.get(texorId);
    if (!peer) return null;

    peer.close();
    this.peers.delete(texorId);
    return peer;
  }

  /** Everyone except one — the shape almost every broadcast needs. */
  others(texorId) {
    return [...this.peers.values()].filter((peer) => peer.texorId !== texorId);
  }

  close() {
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    // Closing the router takes its observers with it.
    this.router.close();
  }
}

export async function getOrCreateRoom(meetingCode) {
  const existing = rooms.get(meetingCode);
  if (existing) return existing;

  const worker = nextWorkerInPool();
  const router = await worker.createRouter({ mediaCodecs });

  const audioLevelObserver = await router.createAudioLevelObserver({
    // Only the loudest matters — this drives one highlight, not a leaderboard.
    maxEntries: 1,
    /**
     * dBov, where 0 is the loudest a stream can be and -127 is silence.
     * Speech from a laptop microphone sits around -35; a quiet room with noise
     * suppression on sits below -60. -50 is the gap between them, and picking
     * it too low means a fan or a keyboard holds the highlight.
     */
    threshold: -50,
    // Short enough to track a conversation, long enough not to strobe between
    // two people talking over each other.
    interval: 300,
  });

  const room = new Room(meetingCode, router, audioLevelObserver);

  rooms.set(meetingCode, room);
  logger.info('media room opened', { meetingCode, workerPid: worker.pid });

  return room;
}

export const getRoom = (meetingCode) => rooms.get(meetingCode) ?? null;

/**
 * Who has an open socket for this meeting, right now.
 *
 * The live answer, straight from memory, with no database round trip. An open
 * socket *is* being in the meeting, so this is the ground truth that anything
 * reasoning about presence should consult first — including code paths that
 * have nothing to do with media.
 */
export const connectedTexorIds = (meetingCode) => [...(rooms.get(meetingCode)?.peers.keys() ?? [])];

export function closeRoom(meetingCode) {
  const room = rooms.get(meetingCode);
  if (!room) return;

  room.close();
  rooms.delete(meetingCode);
  logger.info('media room closed', { meetingCode });
}

/**
 * Builds the WebRTC transport one peer will use in one direction.
 *
 * `announcedAddress` is the single setting that decides whether media arrives.
 * It is written into the ICE candidates handed to the browser, so it has to be
 * an address that browser can actually reach — a container's internal address
 * or 127.0.0.1 produces a call that connects and then stays silent.
 */
export async function createWebRtcTransport(room, { maxIncomingBitrate } = {}) {
  const transport = await room.router.createWebRtcTransport({
    listenInfos: [
      {
        protocol: 'udp',
        ip: '0.0.0.0',
        announcedAddress: env.media.announcedAddress,
        portRange: { min: env.media.rtcMinPort, max: env.media.rtcMaxPort },
      },
      {
        // TCP as a fallback for networks that block UDP outright. Slower and
        // worse for real-time media, but it is the difference between a bad
        // call and no call on a corporate network.
        protocol: 'tcp',
        ip: '0.0.0.0',
        announcedAddress: env.media.announcedAddress,
        portRange: { min: env.media.rtcMinPort, max: env.media.rtcMaxPort },
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    /**
     * The starting bandwidth estimate, and it has to have room for the most
     * expensive thing this transport will ever carry — a shared screen. Start
     * it at a camera's ceiling and the estimator spends the first seconds of
     * every share climbing, which the sender experiences as it stuttering and
     * then settling.
     */
    // What the transport assumes it can push before congestion control has
    // measured anything. The top tier, because guessing low here makes the
    // first seconds of every call worse than they need to be while BWE climbs.
    initialAvailableOutgoingBitrate: maxSendBitrate('high'),
  });

  // A transport that closes because DTLS failed is dead; holding the object
  // open only means the peer's state disagrees with reality.
  transport.on('dtlsstatechange', (state) => {
    if (state === 'failed' || state === 'closed') {
      logger.warn('media transport dtls failed', { transportId: transport.id, state });
      transport.close();
    }
  });

  /**
   * The ceiling that actually holds.
   *
   * Everything else about quality is the client cooperating: it is told a
   * bitrate and asked to encode within it. This is the part that does not
   * depend on cooperation — the SFU refuses to accept more than this from the
   * sender, so a modified client cannot spend the organisation's bandwidth by
   * simply choosing a bigger number.
   */
  if (maxIncomingBitrate) {
    await transport.setMaxIncomingBitrate(maxIncomingBitrate).catch(() => {});
  }

  return {
    transport,
    // Exactly what mediasoup-client needs on the other side, and nothing more.
    parameters: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    },
  };
}

export { Peer, Room };
export default { getOrCreateRoom, getRoom, closeRoom, createWebRtcTransport, connectedTexorIds, Peer };
