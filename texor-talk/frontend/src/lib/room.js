'use client';

/**
 * The browser half of the call.
 *
 * Wraps `mediasoup-client` and the signalling socket behind a plain object with
 * callbacks, so the React components stay about layout and controls rather than
 * about transport negotiation. Nothing here talks to anything but our own
 * backend — the SFU is a process inside it.
 *
 * The shape of a WebRTC session, in order:
 *
 *   1. open the socket, receive the router's capabilities
 *   2. load a Device with them — this is the browser saying what it can do
 *   3. build a send transport and a receive transport
 *   4. produce our own tracks; consume everybody else's
 *
 * Steps 3 and 4 are where the `connect` and `produce` transport events fire,
 * and those are round trips to the server, which is why they look inverted:
 * mediasoup-client asks *us* to tell the server, then waits for our callback.
 */
import { Device } from 'mediasoup-client';
import { API_ORIGIN } from '@/lib/api';

const WS_ORIGIN = API_ORIGIN.replace(/^http/, 'ws');

/** Sensible constraints. Nothing exotic — exotic constraints fail on phones. */
const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

/**
 * Three spatial layers, smallest first.
 *
 * Simulcast is what makes a grid of twelve people work: everyone uploads three
 * resolutions once, and the SFU forwards whichever each viewer's connection can
 * carry. Without it the sender would have to choose one quality for all, and a
 * single participant on hotel wifi would drag the whole call down to it.
 */
const SIMULCAST_ENCODINGS = [
  { scaleResolutionDownBy: 4, maxBitrate: 150_000, scalabilityMode: 'S1T3' },
  { scaleResolutionDownBy: 2, maxBitrate: 500_000, scalabilityMode: 'S1T3' },
  { scaleResolutionDownBy: 1, maxBitrate: 1_500_000, scalabilityMode: 'S1T3' },
];

export class MeetingRoom {
  constructor(code, handlers = {}) {
    this.code = code;
    this.on = handlers;

    this.socket = null;
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;

    this.producers = new Map(); // source -> Producer
    this.consumers = new Map(); // consumerId -> { consumer, peerTexorId, source }

    this.pending = new Map(); // request id -> { resolve, reject }
    this.nextRequestId = 1;
    this.closed = false;
  }

  // ── Signalling ─────────────────────────────────────────────────────────────

  /** One request, one reply, correlated by id. */
  request(action, data = {}) {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to the meeting.'));
        return;
      }

      const id = this.nextRequestId++;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, action, data }));

      // A request that never comes back would otherwise leave the UI waiting
      // forever on a promise nothing will settle.
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${action} timed out.`));
      }, 20_000);
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${WS_ORIGIN}/ws/meeting?code=${encodeURIComponent(this.code)}`);
      this.socket = socket;

      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      socket.onerror = () => fail(new Error('Could not reach the meeting server.'));

      socket.onclose = (event) => {
        fail(new Error(event.reason || 'The meeting connection closed.'));
        if (!this.closed) this.on.closed?.(event.reason);
      };

      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        // A reply to something we asked.
        if (message.id !== undefined) {
          const waiting = this.pending.get(message.id);
          if (!waiting) return;
          this.pending.delete(message.id);

          if (message.ok) waiting.resolve(message.data);
          else waiting.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
          return;
        }

        if (message.type === 'refused') {
          settled = true;
          reject(Object.assign(new Error(message.message), { code: message.code }));
          return;
        }

        if (message.type === 'welcome') {
          try {
            await this.setup(message.data);
            settled = true;
            resolve(message.data);
          } catch (error) {
            fail(error);
          }
          return;
        }

        this.handleNotification(message).catch((error) =>
          this.on.error?.(error.message),
        );
      };
    });
  }

  /** Steps 2 and 3: load the device, then build both transports. */
  async setup({ rtpCapabilities, peers }) {
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });

    // The server cannot decide what to send us until it knows what we decode.
    await this.request('setCapabilities', { rtpCapabilities: this.device.rtpCapabilities });

    await this.createSendTransport();
    await this.createRecvTransport();

    // Everyone already in the room, and whatever they are already sending.
    for (const peer of peers) {
      for (const producer of peer.producers) {
        await this.consume(producer.id).catch(() => {});
      }
    }
  }

  async createSendTransport() {
    const parameters = await this.request('createTransport', { direction: 'send' });
    const transport = this.device.createSendTransport(parameters);

    // Fired once, when the transport first needs to be connected. `callback`
    // unblocks mediasoup-client; `errback` makes it give up cleanly.
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.request('connectTransport', { transportId: transport.id, dtlsParameters })
        .then(callback)
        .catch(errback);
    });

    // Fired for each track we start sending. The server's producer id has to
    // come back through `callback` or the client never finishes the handshake.
    transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      this.request('produce', { transportId: transport.id, kind, rtpParameters, source: appData.source })
        .then(({ id }) => callback({ id }))
        .catch(errback);
    });

    transport.on('connectionstatechange', (state) => {
      if (state === 'failed') this.on.error?.('Lost the connection for your microphone and camera.');
    });

    this.sendTransport = transport;
  }

  async createRecvTransport() {
    const parameters = await this.request('createTransport', { direction: 'recv' });
    const transport = this.device.createRecvTransport(parameters);

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.request('connectTransport', { transportId: transport.id, dtlsParameters })
        .then(callback)
        .catch(errback);
    });

    transport.on('connectionstatechange', (state) => {
      if (state === 'failed') this.on.error?.('Lost the connection to the other participants.');
    });

    this.recvTransport = transport;
  }

  // ── Notifications ──────────────────────────────────────────────────────────

  async handleNotification({ type, data }) {
    switch (type) {
      case 'peerJoined':
        this.on.peerJoined?.(data.peer);
        for (const producer of data.peer.producers ?? []) {
          await this.consume(producer.id).catch(() => {});
        }
        break;

      case 'peerLeft':
        for (const [id, entry] of this.consumers) {
          if (entry.peerTexorId === data.texorId) {
            entry.consumer.close();
            this.consumers.delete(id);
          }
        }
        this.on.peerLeft?.(data.texorId);
        break;

      case 'newProducer':
        await this.consume(data.producerId);
        break;

      case 'producerClosed':
      case 'consumerClosed': {
        for (const [id, entry] of this.consumers) {
          if (entry.consumer.producerId === data.producerId || id === data.consumerId) {
            entry.consumer.close();
            this.consumers.delete(id);
            this.on.trackEnded?.(entry.peerTexorId, entry.source);
          }
        }
        break;
      }

      case 'producerPaused':
      case 'producerResumed':
        this.on.peerMediaToggled?.(data.peerTexorId, data.kind, type === 'producerPaused');
        break;

      case 'knocks':
        this.on.knocks?.(data.knocks);
        break;

      case 'knockResolved':
        this.on.knockResolved?.(data.knockId);
        break;

      case 'chat':
        this.on.chat?.(data);
        break;

      // Our own role changed — a promotion to co-host takes effect now rather
      // than on a rejoin, because the role is a field on our peer at the SFU.
      case 'roleChanged':
        this.on.roleChanged?.(data);
        break;

      case 'peerRoleChanged':
        this.on.peerRoleChanged?.(data);
        break;

      case 'removed':
        this.closed = true;
        this.on.removed?.(data.reason);
        break;

      case 'ended':
        this.closed = true;
        this.on.ended?.(data.reason);
        break;

      default:
        break;
    }
  }

  // ── Receiving ──────────────────────────────────────────────────────────────

  async consume(producerId) {
    const info = await this.request('consume', { producerId });

    const consumer = await this.recvTransport.consume({
      id: info.id,
      producerId: info.producerId,
      kind: info.kind,
      rtpParameters: info.rtpParameters,
    });

    this.consumers.set(consumer.id, {
      consumer,
      peerTexorId: info.peerTexorId,
      source: info.source,
    });

    // Hand the track over before resuming, so the first frames have somewhere
    // to land. The server started this consumer paused for exactly this reason.
    this.on.track?.({
      peerTexorId: info.peerTexorId,
      source: info.source,
      kind: info.kind,
      track: consumer.track,
    });

    await this.request('resumeConsumer', { consumerId: consumer.id });
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  async startMic() {
    if (this.producers.has('mic')) return null;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const track = stream.getAudioTracks()[0];

    const producer = await this.sendTransport.produce({
      track,
      appData: { source: 'mic' },
      // Opus in-band forward error correction: lets the decoder rebuild a lost
      // packet from the next one, which is most of why a call survives jitter.
      codecOptions: { opusStereo: false, opusDtx: true, opusFec: true },
    });

    this.producers.set('mic', producer);
    return track;
  }

  async startCamera(deviceId) {
    if (this.producers.has('camera')) return null;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { ...VIDEO_CONSTRAINTS, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
    });
    const track = stream.getVideoTracks()[0];

    const producer = await this.sendTransport.produce({
      track,
      encodings: SIMULCAST_ENCODINGS,
      appData: { source: 'camera' },
    });

    this.producers.set('camera', producer);
    return track;
  }

  async startScreen() {
    if (this.producers.has('screen')) return null;

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15 } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];

    const producer = await this.sendTransport.produce({
      track,
      // No simulcast for a screen: legibility of text matters more than
      // adapting resolution, so one high-quality layer is the right trade.
      encodings: [{ maxBitrate: 2_500_000, scalabilityMode: 'S1T3' }],
      appData: { source: 'screen' },
    });

    // Chrome's own "Stop sharing" bar bypasses our UI entirely.
    track.addEventListener('ended', () => this.stop('screen').catch(() => {}));

    this.producers.set('screen', producer);
    return track;
  }

  /** Closes a track for good — the peer's tile loses it. */
  async stop(source) {
    const producer = this.producers.get(source);
    if (!producer) return;

    producer.track?.stop();
    producer.close();
    this.producers.delete(source);

    await this.request('closeProducer', { producerId: producer.id }).catch(() => {});
  }

  /**
   * Mute and camera-off, which is not the same as stopping.
   *
   * Pausing keeps the transport and the producer alive, so coming back is
   * instant and does not renegotiate. It also means the microphone light stays
   * on, which is honest: the track exists, it is simply not being forwarded.
   */
  async setPaused(source, paused) {
    const producer = this.producers.get(source);
    if (!producer) return;

    if (paused) producer.pause();
    else producer.resume();

    await this.request(paused ? 'pauseProducer' : 'resumeProducer', { producerId: producer.id });
  }

  isPaused(source) {
    return this.producers.get(source)?.paused ?? true;
  }

  has(source) {
    return this.producers.has(source);
  }

  // ── Hosting ────────────────────────────────────────────────────────────────

  admit(knockId, decision) {
    return this.request('admitKnock', { knockId, decision });
  }

  removePeer(texorId) {
    return this.request('removePeer', { texorId });
  }

  endMeeting() {
    return this.request('endMeeting');
  }

  sendChat(body) {
    return this.request('chat', { body });
  }

  // ── Teardown ───────────────────────────────────────────────────────────────

  close() {
    this.closed = true;

    for (const producer of this.producers.values()) {
      producer.track?.stop();
      producer.close();
    }
    this.producers.clear();

    for (const { consumer } of this.consumers.values()) consumer.close();
    this.consumers.clear();

    this.sendTransport?.close();
    this.recvTransport?.close();
    this.socket?.close(1000, 'left');
  }
}

export default MeetingRoom;
