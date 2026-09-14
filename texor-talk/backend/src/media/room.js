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
  constructor({ texorId, name, role, socket }) {
    this.texorId = texorId;
    this.name = name;
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
      role: this.role,
      joinedAt: this.joinedAt,
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
  constructor(meetingCode, router) {
    this.meetingCode = meetingCode;
    this.router = router;
    this.peers = new Map();
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
    this.router.close();
  }
}

export async function getOrCreateRoom(meetingCode) {
  const existing = rooms.get(meetingCode);
  if (existing) return existing;

  const worker = nextWorkerInPool();
  const router = await worker.createRouter({ mediaCodecs });
  const room = new Room(meetingCode, router);

  rooms.set(meetingCode, room);
  logger.info('media room opened', { meetingCode, workerPid: worker.pid });

  return room;
}

export const getRoom = (meetingCode) => rooms.get(meetingCode) ?? null;

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
export async function createWebRtcTransport(room) {
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
    initialAvailableOutgoingBitrate: env.media.maxBitrate,
  });

  // A transport that closes because DTLS failed is dead; holding the object
  // open only means the peer's state disagrees with reality.
  transport.on('dtlsstatechange', (state) => {
    if (state === 'failed' || state === 'closed') {
      logger.warn('media transport dtls failed', { transportId: transport.id, state });
      transport.close();
    }
  });

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
export default { getOrCreateRoom, getRoom, closeRoom, createWebRtcTransport, Peer };
