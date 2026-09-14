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
import { CAMERA_ENCODINGS, SCREEN_ENCODINGS } from '@/lib/encodings';

const WS_ORIGIN = API_ORIGIN.replace(/^http/, 'ws');

/** Sensible constraints. Nothing exotic — exotic constraints fail on phones. */
const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

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
            /**
             * The roster is handed over *before* any track is consumed.
             *
             * `setup` consumes everything the people already here are sending,
             * and each of those fires `track`. If the caller seeded its roster
             * afterwards instead, that seed would overwrite the tracks that had
             * just arrived and a new joiner would see nothing until somebody
             * toggled their camera and produced again.
             */
            this.on.roster?.(message.data.peers);
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

      case 'reaction':
        this.on.reaction?.(data);
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

  /**
   * Sends a video track, degrading rather than failing.
   *
   * Which codec gets negotiated is decided by the browser, and encoding
   * parameters that one codec accepts another rejects — a mismatch throws from
   * `addTransceiver` and takes the whole track with it. Retrying once with no
   * encodings costs the layering and keeps the video, which is the right way
   * round: a single-layer camera is worth far more than an error message.
   */
  async produceVideo(track, encodings, source) {
    try {
      return await this.sendTransport.produce({ track, encodings, appData: { source } });
    } catch (error) {
      this.on.warning?.(
        `Your browser refused the preferred video settings for your ${source}, so it is being sent at a single quality.`,
      );
      return this.sendTransport.produce({ track, appData: { source } });
    }
  }

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

    const producer = await this.produceVideo(track, CAMERA_ENCODINGS, 'camera');

    this.producers.set('camera', producer);
    return track;
  }

  /**
   * Starts a screen share.
   *
   * Two failure modes, and they need different treatment. The picker being
   * dismissed is not an error — it is somebody changing their mind, and is
   * flagged with `cancelled` so the caller can stay quiet. Anything after that
   * is a real failure, and the capture has to be stopped on the way out or the
   * browser keeps showing its "sharing your screen" indicator for a share that
   * never started.
   */
  async startScreen() {
    // A stale entry here used to make every later attempt a silent no-op.
    if (this.producers.has('screen')) await this.stop('screen');
    if (this.producers.has('screenAudio')) await this.stop('screenAudio');

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15 } },
        /**
         * Every processing step off, deliberately.
         *
         * These exist to make a human voice picked up by a microphone
         * intelligible. This is program audio taken straight from the source —
         * music, a video, a demo — and running it through echo cancellation and
         * automatic gain makes it pump, duck and sound underwater. Off is the
         * only setting that reproduces what is actually playing.
         *
         * Whether anything arrives at all is the browser's call: Chrome offers
         * tab audio when a tab is picked and system audio only on Windows,
         * Firefox and Safari offer neither. `audio: true` asks; it never
         * guarantees, so the track may simply not be there.
         */
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (error) {
      // NotAllowedError is both "denied by policy" and "user hit Cancel"; the
      // browser does not distinguish, and treating it as a cancel is kinder
      // than accusing someone of a permissions problem they do not have.
      if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
        throw Object.assign(new Error('Screen sharing was cancelled.'), { cancelled: true });
      }
      throw Object.assign(new Error(`Could not capture your screen: ${error.message}`), {
        cause: error,
      });
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((each) => each.stop());
      throw new Error('Your browser did not return a screen to share.');
    }

    let producer;
    try {
      producer = await this.produceVideo(track, SCREEN_ENCODINGS, 'screen');
    } catch (error) {
      // Leaving the capture running would keep the browser claiming the screen
      // is being shared when nothing is being sent anywhere.
      stream.getTracks().forEach((each) => each.stop());
      throw error;
    }

    /**
     * Tab or system audio, when the browser gave us any.
     *
     * A separate producer rather than a second track on the same one, so it can
     * be routed and stopped independently — and so the people receiving it can
     * tell program audio from a microphone, which is what stops it being mixed
     * into voice handling on the far side.
     */
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      try {
        const audioProducer = await this.sendTransport.produce({
          track: audioTrack,
          appData: { source: 'screenAudio' },
          codecOptions: {
            // Stereo, and no discontinuous transmission: DTX saves bandwidth by
            // going quiet during pauses, which is right for speech and wrong for
            // music, where it clips the tails off everything.
            opusStereo: true,
            opusDtx: false,
            opusFec: true,
            opusMaxPlaybackRate: 48000,
            opusMaxAverageBitrate: 128_000,
          },
        });
        this.producers.set('screenAudio', audioProducer);
      } catch {
        // Sharing the picture without the sound is a far better outcome than
        // failing the whole share, so this one is allowed to quietly not happen.
        audioTrack.stop();
        this.on.warning?.('Your screen is being shared, but its audio could not be sent.');
      }
    }

    /**
     * The browser's own "Stop sharing" bar bypasses our controls entirely.
     *
     * Tearing the producer down is not enough: without telling the caller, the
     * UI keeps its button in the "presenting" state and keeps the dead track on
     * the stage, so the call appears stuck on a frozen screen share that no
     * longer exists.
     */
    track.addEventListener('ended', () => {
      this.stop('screen').catch(() => {});
      this.stop('screenAudio').catch(() => {});
      this.on.localTrackEnded?.('screen');
    });

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

  /** Pulls the waiting list, for when a pushed one was never received. */
  refreshKnocks() {
    return this.request('getKnocks');
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

  sendReaction(emoji) {
    return this.request('reaction', { emoji });
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
