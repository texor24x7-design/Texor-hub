/**
 * The signalling channel: one WebSocket per participant, per meeting.
 *
 * This replaces what a JWT handed to somebody else's conferencing service used
 * to do, and it is strictly stronger. The socket carries the same `talk_sid`
 * session cookie as every other request, so the media layer resolves the real
 * Texor identity itself and then runs the *same* `evaluateJoin` the REST API
 * runs. There is no second notion of who someone is, and nothing to configure
 * for the access rules to be real: the lobby, roles and capacity limits are
 * enforced by the process that owns the media.
 *
 * Messages are JSON. Requests carry an `id` and get exactly one reply with the
 * same `id`; anything without an `id` is a notification and is not replied to.
 */
import { WebSocketServer } from 'ws';
import Meeting from '../models/Meeting.js';
import Knock from '../models/Knock.js';
import logger from '../utils/logger.js';
import { resolveSession, SESSION_COOKIE } from '../services/session.service.js';
import { GUEST_COOKIE, resolveGuest } from '../services/guest.service.js';
import { getPolicy, isExternalEmail } from '../services/policy.service.js';
import { ACTIONS, record } from '../services/audit.service.js';
import {
  endMeeting,
  evaluateJoin,
  isAbandoned,
  markJoined,
  markLeft,
  markPresent,
} from '../services/meeting.service.js';
import { Peer, closeRoom, createWebRtcTransport, getOrCreateRoom, getRoom } from './room.js';
import { attachSpeakingDetection } from './speaking.js';
import { effectiveTier, isTier, limitsFor, maxSendBitrate } from '../services/quality.service.js';

const ROOM_TICK_MS = 5_000;

/**
 * The reactions a client may send.
 *
 * Kept server-side as an allowlist, because whatever arrives here is broadcast
 * verbatim to everyone in the call — an arbitrary string would be a way to put
 * unvetted content on other people's screens.
 */
export const REACTIONS = ['👍', '👎', '❤️', '🎉', '👏', '😂', '😮', '😢', '🤔', '✋'];

/** Cookies arrive as one header on the upgrade request; no parser is mounted. */
function readCookie(header, name) {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

const send = (socket, message) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

const reply = (socket, id, data) => send(socket, { id, ok: true, data });
const replyError = (socket, id, message, code = 'error') =>
  send(socket, { id, ok: false, error: { code, message } });

/**
 * Closes the socket with a reason the browser can actually read.
 *
 * WebSocket close codes in the 4000s are application-defined, and the payload
 * survives where a thrown error would not — this is the only way the client
 * learns *why* it was refused rather than just that it was.
 */
const refuse = (socket, code, message) => {
  send(socket, { type: 'refused', code, message });
  socket.close(4001, code);
};

export function attachSignalling(server) {
  // `noServer`, because Express owns the HTTP server and we only want the
  // upgrade on one path — anything else should keep behaving as it did.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname !== '/ws/meeting') return socket.destroy();

    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (socket, request) => {
    handleConnection(socket, request).catch((error) => {
      logger.error('signalling connection failed', error);
      refuse(socket, 'internal_error', 'Could not join the meeting.');
    });
  });

  startRoomTicker(wss);
  logger.info('media signalling listening', { path: '/ws/meeting' });

  return wss;
}

async function handleConnection(socket, request) {
  const url = new URL(request.url, 'http://localhost');
  const code = (url.searchParams.get('code') ?? '').toLowerCase().trim();

  // ── Who is this ──
  // A Texor session first; a guest pass only if there is no real session, so
  // somebody signed in is never downgraded by a stale cookie.
  const resolved = await resolveSession(readCookie(request.headers.cookie, SESSION_COOKIE));
  const user = resolved?.user
    ?? await resolveGuest(readCookie(request.headers.cookie, GUEST_COOKIE));

  if (!user) return refuse(socket, 'unauthorized', 'Sign in with Texor to join.');

  // ── May they be here ──
  const meeting = await Meeting.findOne({ code }).exec();
  if (!meeting) return refuse(socket, 'not_found', 'No meeting with that code.');

  /**
   * A guest pass opens exactly one meeting.
   *
   * Without this check a pass issued for an open meeting would be a credential
   * for every other meeting in the product, which is precisely the hole that
   * makes guest access dangerous to add carelessly.
   */
  if (user.isGuest && user.meetingId !== meeting._id.toString()) {
    return refuse(socket, 'forbidden', 'Your guest pass is for a different meeting.');
  }

  const policy = await getPolicy();

  let decision;
  try {
    decision = await evaluateJoin({ meeting, user, policy });
  } catch (error) {
    return refuse(socket, error.code ?? 'forbidden', error.message);
  }

  // The lobby is answered over REST before the socket is opened. Arriving here
  // still needing to knock means the client skipped that step.
  if (decision.outcome !== 'admit') {
    return refuse(socket, 'lobby_required', 'A host has to let you in first.');
  }

  const { role } = decision;

  // ── Media ──
  const room = await getOrCreateRoom(meeting.code);

  // One socket per person. A second tab is a reconnect, not a second seat, and
  // leaving the old peer open would strand its transports on the worker.
  room.removePeer(user.texorId);

  const peer = room.addPeer(
    new Peer({
      texorId: user.texorId,
      name: user.displayName || user.email,
      picture: user.picture,
      role,
      socket,
    }),
  );

  await markJoined({ meeting, user, role });

  // Read by the room ticker, which sweeps by meeting rather than by socket.
  socket.meetingCode = meeting.code;
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });

  /**
   * Listeners before `welcome`, not after.
   *
   * A well-behaved client answers `welcome` immediately — mediasoup-client
   * sends its capabilities the moment it has loaded the router's. Anything sent
   * before this handler exists is dropped on the floor by the socket, so
   * attaching it even one `await` later loses that first message and the client
   * waits forever for a reply to a request the server never saw.
   */
  socket.on('message', (raw) => {
    handleMessage({ socket, raw, room, peer, user, code }).catch((error) => {
      logger.warn('signalling message failed', { message: error.message });
    });
  });

  socket.on('close', () => {
    onDisconnect({ room, peer, user, code }).catch((error) =>
      logger.warn('signalling disconnect failed', { message: error.message }),
    );
  });

  send(socket, {
    type: 'welcome',
    data: {
      rtpCapabilities: room.rtpCapabilities,
      you: { texorId: user.texorId, name: peer.name, role },
      peers: room.others(user.texorId).map((other) => other.summary()),
      meeting: {
        code: meeting.code,
        title: meeting.title,
        settings: meeting.settings,
        startedAt: meeting.startedAt,
        maxDurationMinutes: meeting.maxDurationMinutes,
      },
    },
  });

  broadcast(room, user.texorId, { type: 'peerJoined', data: { peer: peer.summary() } });
  broadcastRoster(room);

  attachSpeakingDetection(room, broadcastAll);

  if (role === 'host' || role === 'cohost') await pushKnocks(room, meeting, socket);
}

async function onDisconnect({ room, peer, user, code }) {
  // Only tear down if this socket is still the peer of record — a reconnect
  // that already replaced it must not have its new transports closed.
  if (room.peers.get(user.texorId) !== peer) return;

  room.removePeer(user.texorId);
  broadcast(room, user.texorId, { type: 'peerLeft', data: { texorId: user.texorId } });
  broadcastRoster(room);

  const meeting = await Meeting.findOne({ code }).exec();
  if (meeting) {
    const left = await markLeft({ meeting, texorId: user.texorId });
    if (left) await record({ action: ACTIONS.MEETING_LEFT, actor: user, meeting });
  }

  // An empty Router still holds resources on a worker.
  if (room.peers.size === 0) closeRoom(code);
}

// ── Messages ─────────────────────────────────────────────────────────────────

async function handleMessage({ socket, raw, room, peer, user, code }) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  const { id, action, data = {} } = message;

  try {
    const result = await dispatch({ action, data, room, peer, user, code, socket });
    if (id) reply(socket, id, result ?? {});
  } catch (error) {
    if (id) replyError(socket, id, error.message, error.code ?? 'error');
  }
}

async function dispatch({ action, data, room, peer, user, code, socket }) {
  switch (action) {
    // ── Transports ──
    case 'createTransport': {
      /**
       * Only the sending direction is capped. Limiting what somebody may
       * *receive* would punish them for the number of people in the room, which
       * is not their doing — the cost is controlled at the source instead.
       */
      let maxIncomingBitrate;
      if (data.direction === 'send') {
        const meeting = await Meeting.findOne({ code }).select('quality').exec();
        const policy = await getPolicy();
        maxIncomingBitrate = maxSendBitrate(effectiveTier(meeting?.quality, policy.maxQuality));
      }

      const { transport, parameters } = await createWebRtcTransport(room, { maxIncomingBitrate });

      if (data.direction === 'send') {
        peer.sendTransport?.close();
        peer.sendTransport = transport;
      } else {
        peer.recvTransport?.close();
        peer.recvTransport = transport;
      }

      return parameters;
    }

    case 'connectTransport': {
      const transport = transportFor(peer, data.transportId);
      await transport.connect({ dtlsParameters: data.dtlsParameters });
      return {};
    }

    // ── Sending media ──
    case 'produce': {
      if (!peer.sendTransport) throw fail('no_transport', 'No sending transport.');

      /**
       * Screen sharing is a meeting setting, and this is the only place it can
       * actually be enforced — hiding the button is a hint, refusing the
       * producer is the rule.
       *
       * `screenAudio` is covered by the same rule. It is a second producer from
       * the same capture, so letting it through separately would let someone
       * barred from sharing their screen still share what it is playing.
       */
      if (data.source === 'screen' || data.source === 'screenAudio') {
        const meeting = await Meeting.findOne({ code }).select('settings').exec();
        const hostsOnly = meeting?.settings?.screenShare === 'hosts';
        if (hostsOnly && peer.role !== 'host' && peer.role !== 'cohost') {
          throw fail('forbidden', 'Only hosts can share their screen in this meeting.');
        }
      }

      const producer = await peer.sendTransport.produce({
        kind: data.kind,
        rtpParameters: data.rtpParameters,
        appData: { source: data.source ?? (data.kind === 'audio' ? 'mic' : 'camera') },
      });

      peer.producers.set(producer.id, producer);

      // Only microphones are candidates for "who is talking" — a shared screen
      // playing a video would otherwise win the highlight permanently.
      if (producer.kind === 'audio' && producer.appData.source === 'mic') {
        room.audioLevelObserver.addProducer({ producerId: producer.id }).catch(() => {});
      }

      producer.on('transportclose', () => peer.producers.delete(producer.id));

      broadcast(room, user.texorId, {
        type: 'newProducer',
        data: {
          peerTexorId: user.texorId,
          producerId: producer.id,
          kind: producer.kind,
          source: producer.appData.source,
        },
      });

      /**
       * The roster carries each peer's producers, so starting a track changes
       * it. Without this the authoritative copy lags a delta by up to a full
       * tick — and a `newProducer` that went missing left somebody's screen
       * share invisible for those seconds rather than being repaired at once.
       */
      broadcastRoster(room);

      return { id: producer.id };
    }

    case 'closeProducer': {
      const producer = peer.producers.get(data.producerId);
      if (!producer) return {};

      producer.close();
      peer.producers.delete(data.producerId);
      broadcast(room, user.texorId, {
        type: 'producerClosed',
        data: { peerTexorId: user.texorId, producerId: data.producerId },
      });
      broadcastRoster(room);
      return {};
    }

    case 'pauseProducer':
    case 'resumeProducer': {
      const producer = peer.producers.get(data.producerId);
      if (!producer) return {};

      const pausing = action === 'pauseProducer';
      await (pausing ? producer.pause() : producer.resume());

      broadcast(room, user.texorId, {
        type: pausing ? 'producerPaused' : 'producerResumed',
        data: { peerTexorId: user.texorId, producerId: data.producerId, kind: producer.kind },
      });
      return {};
    }

    // ── Receiving media ──
    case 'setCapabilities': {
      peer.rtpCapabilities = data.rtpCapabilities;
      return {};
    }

    case 'consume': {
      if (!peer.recvTransport) throw fail('no_transport', 'No receiving transport.');
      if (!peer.rtpCapabilities) throw fail('no_capabilities', 'Capabilities not sent yet.');

      /**
       * Who owns this producer — resolved first, and for two reasons.
       *
       * A producer can be advertised and then its owner leave before the
       * consume request lands. Answering with a null owner pushed that hole
       * onto the client, which had nothing to attach the track to and invented
       * a nameless phantom participant for it.
       *
       * This check also has to come *before* `canConsume`, because a departed
       * peer's producer is closed and `canConsume` reports false for it — which
       * would blame the viewer's browser for a stream that simply no longer
       * exists. Order the checks and the error tells the truth.
       */
      const owner = [...room.peers.values()].find((other) => other.producers.has(data.producerId));
      if (!owner) throw fail('gone', 'That participant has left the meeting.');

      if (!room.canConsume(data.producerId, peer.rtpCapabilities)) {
        throw fail('cannot_consume', 'Your browser cannot decode that stream.');
      }

      const consumer = await peer.recvTransport.consume({
        producerId: data.producerId,
        rtpCapabilities: peer.rtpCapabilities,
        /**
         * Started paused, always. Resuming only once the client has the track
         * attached to an element avoids the first seconds of video arriving
         * before there is anywhere to draw it — which shows up as a stream that
         * starts frozen and takes a keyframe to recover.
         */
        paused: true,
      });

      peer.consumers.set(consumer.id, consumer);

      consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
      consumer.on('producerclose', () => {
        peer.consumers.delete(consumer.id);
        send(peer.socket, { type: 'consumerClosed', data: { consumerId: consumer.id } });
      });

      return {
        id: consumer.id,
        producerId: data.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        // `consume()` does not inherit the producer's appData, so the source
        // label has to come from the producer we just resolved.
        source: owner.producers.get(data.producerId)?.appData?.source,
        peerTexorId: owner.texorId,
      };
    }

    case 'resumeConsumer': {
      await peer.consumers.get(data.consumerId)?.resume();
      return {};
    }

    // ── Hosting ──
    /**
     * The waiting list, on request.
     *
     * Knocks are pushed as they happen, but a push is a single delivery: if the
     * socket was mid-reconnect, or the client dropped it, nothing ever comes
     * again and a host is left looking at an empty panel while somebody waits.
     * Asking is the backstop, and the panel asks whenever it is opened.
     */
    case 'getKnocks': {
      requireHost(peer);
      const meeting = await Meeting.findOne({ code }).select('_id').exec();
      if (meeting) await pushKnocks(room, meeting, socket);
      return {};
    }

    case 'admitKnock': {
      requireHost(peer);
      const meeting = await Meeting.findOne({ code }).exec();
      const admit = data.decision === 'admit';

      const knock = await Knock.findOneAndUpdate(
        { _id: data.knockId, meeting: meeting._id, status: 'waiting' },
        {
          $set: {
            status: admit ? 'admitted' : 'denied',
            decidedByTexorId: user.texorId,
            decidedByName: user.displayName,
            decidedAt: new Date(),
            expiresAt: new Date(Date.now() + 5 * 60_000),
          },
        },
        { returnDocument: 'after' },
      );

      if (!knock) throw fail('gone', 'That request is no longer waiting.');

      await record({
        action: admit ? ACTIONS.LOBBY_ADMITTED : ACTIONS.LOBBY_DENIED,
        actor: user,
        meeting,
        target: { texorId: knock.texorId, name: knock.name },
      });

      // Every host is looking at the same list; all of them should see it go.
      broadcastAll(room, { type: 'knockResolved', data: { knockId: data.knockId } });
      return {};
    }

    /**
     * A host muting somebody else.
     *
     * Enforced, not requested: the producer is paused **on the server**, so the
     * audio stops being forwarded whatever the muted person's browser does or
     * does not do about it. They are told as well, so their own button matches
     * reality rather than claiming they are still live.
     *
     * There is deliberately no matching "unmute them". A host who could switch
     * on somebody else's microphone could listen to a room they are not in, and
     * no amount of UI makes that acceptable — every serious product draws the
     * line in the same place. A host can mute, and ask.
     */
    case 'muteParticipant': {
      requireHost(peer);

      const target = room.peers.get(data.texorId);
      if (!target) throw fail('gone', 'They are no longer in the meeting.');

      const mic = [...target.producers.values()].find(
        (producer) => producer.appData.source === 'mic',
      );
      if (!mic || mic.paused) return { alreadyMuted: true };

      await mic.pause();

      send(target.socket, {
        type: 'forceMuted',
        data: { by: peer.name, producerId: mic.id },
      });
      broadcastAll(room, {
        type: 'producerPaused',
        data: { peerTexorId: target.texorId, producerId: mic.id, kind: 'audio' },
      });

      return {};
    }

    /** The same rule, applied to the room. Hosts are left alone. */
    case 'muteEveryone': {
      requireHost(peer);
      let muted = 0;

      for (const target of room.peers.values()) {
        if (target.role === 'host' || target.role === 'cohost') continue;

        const mic = [...target.producers.values()].find(
          (producer) => producer.appData.source === 'mic',
        );
        if (!mic || mic.paused) continue;

        await mic.pause();
        muted += 1;

        send(target.socket, { type: 'forceMuted', data: { by: peer.name, producerId: mic.id } });
        broadcastAll(room, {
          type: 'producerPaused',
          data: { peerTexorId: target.texorId, producerId: mic.id, kind: 'audio' },
        });
      }

      return { muted };
    }

    /**
     * The host changes how much bandwidth this meeting is allowed to use.
     *
     * Done live rather than "from the next meeting", because the moment a host
     * wants this is the moment somebody says the screen share is stuttering.
     * Nothing is renegotiated: the senders already exist and their bitrate is a
     * parameter on them, so each client rewrites it in place and the picture
     * changes without a black frame.
     *
     * Three things move together and all three are needed — the stored tier so
     * it survives a rejoin, the transport caps so the SFU stops refusing what
     * clients now send, and the broadcast so clients know what to send.
     */
    case 'setQuality': {
      requireHost(peer);

      if (!isTier(data.tier)) throw fail('badRequest', 'That is not a quality setting.');

      const policy = await getPolicy();
      const tier = effectiveTier(data.tier, policy.maxQuality);

      if (tier !== data.tier) {
        throw fail(
          'forbidden',
          `Your organisation's plan allows up to "${policy.maxQuality}" quality.`,
        );
      }

      await Meeting.updateOne({ code }, { $set: { quality: tier } }).exec();
      await applyRoomQuality(room, tier, peer.name);

      return { tier };
    }

    case 'removePeer': {
      requireHost(peer);
      const meeting = await Meeting.findOne({ code }).exec();

      if (data.texorId === meeting.hostTexorId) {
        throw fail('forbidden', 'The host cannot be removed.');
      }

      if (!meeting.removedTexorIds.includes(data.texorId)) {
        meeting.removedTexorIds.push(data.texorId);
      }
      meeting.cohostTexorIds = meeting.cohostTexorIds.filter((id) => id !== data.texorId);
      const entry = meeting.attendance.find((item) => item.texorId === data.texorId);
      if (entry && !entry.leftAt) entry.leftAt = new Date();
      await meeting.save();

      await record({
        action: ACTIONS.PARTICIPANT_REMOVED,
        actor: user,
        meeting,
        target: { texorId: data.texorId, name: entry?.name ?? '' },
      });

      // Told directly, then disconnected — their media stops at our end whether
      // or not their client cooperates.
      const target = room.peers.get(data.texorId);
      if (target) {
        send(target.socket, { type: 'removed', data: { reason: 'A host removed you.' } });
        target.socket.close(4003, 'removed');
        room.removePeer(data.texorId);
        broadcastAll(room, { type: 'peerLeft', data: { texorId: data.texorId } });
        broadcastRoster(room);
      }

      return {};
    }

    case 'endMeeting': {
      requireHost(peer);
      const meeting = await Meeting.findOne({ code }).exec();

      await endMeeting({ meeting, reason: `ended by ${user.displayName}` });
      await record({
        action: ACTIONS.MEETING_ENDED,
        actor: user,
        meeting,
        metadata: { reason: 'ended by host' },
      });

      closeEveryone(room, code, 'The host ended the meeting.');
      return {};
    }

    /**
     * A reaction is ephemeral by design: broadcast and forgotten.
     *
     * Nothing is stored and nothing is replayed to someone who joins later —
     * a reaction is a moment in the call, and a list of everything everyone
     * ever clapped at would be a different feature with different privacy
     * questions attached.
     */
    case 'reaction': {
      const emoji = String(data.emoji ?? '');
      // Allowlisted rather than sanitised. The value is broadcast to every
      // participant, so it may only ever be one of ours.
      if (!REACTIONS.includes(emoji)) throw fail('bad_reaction', 'Unknown reaction.');

      broadcastAll(room, {
        type: 'reaction',
        data: { texorId: user.texorId, name: peer.name, emoji, at: Date.now() },
      });
      return {};
    }

    case 'raiseHand': {
      const raised = Boolean(data.raised);
      peer.handRaised = raised;

      broadcastAll(room, {
        type: 'handChanged',
        data: { texorId: user.texorId, name: peer.name, raised },
      });
      return {};
    }

    /** A host clearing someone's hand once it has been dealt with. */
    case 'lowerHand': {
      requireHost(peer);
      const target = room.peers.get(data.texorId);
      if (!target) return {};

      target.handRaised = false;
      broadcastAll(room, {
        type: 'handChanged',
        data: { texorId: target.texorId, name: target.name, raised: false },
      });
      return {};
    }

    case 'chat': {
      const meeting = await Meeting.findOne({ code }).select('settings').exec();
      if (!meeting?.settings?.allowChat) throw fail('forbidden', 'Chat is off in this meeting.');

      const body = String(data.body ?? '').trim().slice(0, 2000);
      if (!body) return {};

      broadcastAll(room, {
        type: 'chat',
        data: { from: peer.name, texorId: user.texorId, body, at: new Date() },
      });
      return {};
    }

    default:
      throw fail('unknown_action', `Unknown action: ${action}`);
  }
}

/**
 * Broadcasts whoever is currently talking.
 *
 * Attached once per room, on first use. The observer outlives individual peers,
 * so re-attaching per connection would stack duplicate listeners and send the
 * same event several times over.
 */
// ── Helpers ──────────────────────────────────────────────────────────────────

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireHost(peer) {
  if (peer.role !== 'host' && peer.role !== 'cohost') {
    throw fail('forbidden', 'Only a host can do that.');
  }
}

function transportFor(peer, transportId) {
  if (peer.sendTransport?.id === transportId) return peer.sendTransport;
  if (peer.recvTransport?.id === transportId) return peer.recvTransport;
  throw fail('no_transport', 'Unknown transport.');
}

function broadcast(room, exceptTexorId, message) {
  for (const other of room.others(exceptTexorId)) send(other.socket, message);
}

function broadcastAll(room, message) {
  for (const other of room.peers.values()) send(other.socket, message);
}

/**
 * Sends everybody the authoritative list of who else is here.
 *
 * `peerJoined` and `peerLeft` are deltas, and a delta is a single delivery:
 * `send` drops the message if that socket is not open at that instant — mid
 * reconnect, say — and nothing ever corrects it. One participant then has a
 * permanently wrong roster for the rest of the call, which is exactly what
 * happened: two people saw three participants and the third saw two.
 *
 * So the deltas stay, because they are immediate, and this runs alongside them
 * to make the state converge. The payload differs per recipient, since everyone
 * wants the list of *others*.
 */
function broadcastRoster(room) {
  for (const peer of room.peers.values()) {
    send(peer.socket, {
      type: 'roster',
      data: { peers: room.others(peer.texorId).map((other) => other.summary()) },
    });
  }
}

async function pushKnocks(room, meeting, socket) {
  const knocks = await Knock.find({ meeting: meeting._id, status: 'waiting' })
    .sort({ createdAt: 1 })
    .lean();

  send(socket, {
    type: 'knocks',
    data: {
      knocks: knocks.map((knock) => ({
        id: knock._id.toString(),
        name: knock.name,
        email: knock.email,
        picture: knock.picture,
        isExternal: Boolean(knock.isGuest) || isExternalEmail(knock.email),
        isGuest: Boolean(knock.isGuest),
        knockedAt: knock.createdAt,
      })),
    },
  });
}

function closeEveryone(room, code, reason) {
  for (const other of room.peers.values()) {
    send(other.socket, { type: 'ended', data: { reason } });
    other.socket.close(4004, 'ended');
  }
  closeRoom(code);
}

/**
 * The per-room tick.
 *
 * Does what a heartbeat endpoint used to: notices a meeting that has run past
 * its policy limit, pushes new lobby requests to hosts, and drops sockets that
 * have stopped answering pings. Running it here rather than having every client
 * poll means one timer for the whole server instead of one request per
 * participant every fifteen seconds.
 */
function startRoomTicker(wss) {
  const timer = setInterval(async () => {
    // Liveness: a socket that misses a ping round-trip is gone, whether or not
    // a close frame ever arrived.
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }

    const codes = [...new Set([...wss.clients].map((socket) => socket.meetingCode))].filter(Boolean);

    for (const code of codes) {
      const room = getRoom(code);
      if (!room) continue;

      try {
        const meeting = await Meeting.findOne({ code }).exec();
        if (!meeting) continue;

        if (meeting.status === 'cancelled' || meeting.status === 'ended') {
          closeEveryone(room, code, meeting.endedReason || 'This meeting has ended.');
          continue;
        }

        /**
         * Presence first, before anything reads it.
         *
         * An open socket is the definition of being in the meeting, so this is
         * where that fact reaches the database. Doing it before the abandonment
         * check below is what stops a room full of connected people being
         * declared empty.
         */
        if (markPresent(meeting, [...room.peers.keys()])) await meeting.save();

        if (meeting.maxDurationMinutes > 0 && meeting.startedAt) {
          const elapsed = (Date.now() - meeting.startedAt.getTime()) / 60_000;
          if (elapsed > meeting.maxDurationMinutes) {
            await endMeeting({
              meeting,
              reason: `reached the ${meeting.maxDurationMinutes} minute limit`,
            });
            await record({
              action: ACTIONS.MEETING_ENDED,
              meeting,
              metadata: { reason: 'duration limit' },
            });
            closeEveryone(room, code, meeting.endedReason);
            continue;
          }
        }

        /**
         * The reconciliation pass.
         *
         * Cheap — a handful of small JSON messages — and it is what turns a
         * roster built from deltas into one that is eventually correct however
         * many of those deltas went missing.
         */
        broadcastRoster(room);

        // New lobby requests reach hosts without them polling for them.
        for (const other of room.peers.values()) {
          if (other.role === 'host' || other.role === 'cohost') {
            await pushKnocks(room, meeting, other.socket);
          }
        }

        if (isAbandoned(meeting)) await endMeeting({ meeting, reason: 'everyone left' });
      } catch (error) {
        logger.warn('room tick failed', { code, message: error.message });
      }
    }
  }, ROOM_TICK_MS);

  timer.unref();
  return timer;
}

/**
 * Live control from outside the socket.
 *
 * The REST endpoints and the in-call panel do the same things, and they must
 * have the same effect — a participant removed through the API has to leave the
 * call, not merely lose the right to rejoin. Because the SFU is in this process,
 * these reach straight into the room rather than waiting for the target's
 * client to poll and cooperate.
 */
/**
 * Pushes the waiting list to every host in a room, now.
 *
 * Knocks are created by the REST join endpoint, which has no socket of its own.
 * Without this the only things that told a host somebody was at the door were
 * their own connect and the room ticker — so an admit prompt could sit unseen
 * for up to fifteen seconds while the person waited. Called the moment a knock
 * is created or withdrawn.
 */
export async function refreshKnocks(code) {
  const room = getRoom(code);
  if (!room) return false;

  const hosts = [...room.peers.values()].filter(
    (peer) => peer.role === 'host' || peer.role === 'cohost',
  );
  if (hosts.length === 0) return false;

  const meeting = await Meeting.findOne({ code }).select('_id').exec();
  if (!meeting) return false;

  for (const host of hosts) await pushKnocks(room, meeting, host.socket);
  return true;
}

export function updatePeerRole(code, texorId, role) {
  const peer = getRoom(code)?.peers.get(texorId);
  if (!peer) return false;

  peer.role = role;
  send(peer.socket, { type: 'roleChanged', data: { role } });
  broadcastAll(getRoom(code), { type: 'peerRoleChanged', data: { texorId, role } });
  return true;
}

export function ejectPeer(code, texorId, reason) {
  const room = getRoom(code);
  const peer = room?.peers.get(texorId);
  if (!peer) return false;

  send(peer.socket, { type: 'removed', data: { reason } });
  peer.socket.close(4003, 'removed');
  room.removePeer(texorId);
  broadcastAll(room, { type: 'peerLeft', data: { texorId } });
  broadcastRoster(room);
  return true;
}

/**
 * Push a tier onto a room that is already running.
 *
 * Order matters. The transports' incoming caps go up *before* anyone is told
 * they may send more — otherwise the first client to react has its extra
 * bitrate thrown away by an SFU still enforcing the old ceiling, which looks
 * exactly like the change not working.
 */
async function applyRoomQuality(room, tier, changedBy) {
  if (!room) return false;

  const cap = maxSendBitrate(tier);
  await Promise.all([...room.peers.values()].map(async (target) => {
    try {
      await target.sendTransport?.setMaxIncomingBitrate(cap);
    } catch {
      // A transport closing underneath us is not a reason to abandon the rest
      // of the room; that peer gets the new cap when it rejoins.
    }
  }));

  const limits = limitsFor(tier);
  broadcastAll(room, {
    type: 'quality',
    data: {
      tier,
      name: limits.name,
      cameraBitrate: limits.cameraBitrate,
      cameraDegradation: limits.cameraDegradation,
      screenBitrate: limits.screenBitrate,
      screenFrameRate: limits.screenFrameRate,
      screenMaxHeight: limits.screenMaxHeight,
      changedBy,
    },
  });

  return true;
}

/**
 * The same change, arriving from the settings page rather than from the bar.
 *
 * A host editing the meeting while it is live should not have to rejoin for it
 * to take effect — the two routes into this have to end up in the same place.
 */
export function updateRoomQuality(code, tier, changedBy) {
  return applyRoomQuality(getRoom(code), tier, changedBy);
}

export function endRoom(code, reason) {
  const room = getRoom(code);
  if (!room) return false;

  closeEveryone(room, code, reason);
  return true;
}

export default {
  attachSignalling, updatePeerRole, ejectPeer, endRoom, refreshKnocks, updateRoomQuality,
};
