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
import { readConnection } from '@/lib/stats';
import { createPending } from '@/lib/pending';
import {
  CAMERA_ENCODINGS, SCREEN_MODES, cameraBudget, cameraEncodings, screenConstraints, screenEncodings,
} from '@/lib/encodings';

const WS_ORIGIN = API_ORIGIN.replace(/^http/, 'ws');

/** Close codes the server uses on purpose: refused, removed, meeting ended. */
const DELIBERATE_CLOSE = [4001, 4003, 4004];

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

    // Every request leaves this exactly once: reply, timeout, or abort.
    this.pending = createPending({ timeout: 20_000 });
    this.nextRequestId = 1;
    this.closed = false;
    this.reconnecting = false;

    /**
     * Which room of the meeting this socket opens, `''` for the main one.
     *
     * Sent as a request, not as an instruction: the server looks the id up in
     * the meeting's own plan and decides. Left empty it means "wherever I
     * belong", which is what puts somebody back in their breakout after a
     * refresh — and after a server restart, where the rooms in memory are gone
     * and every client rebuilds them by arriving.
     */
    this.roomKey = handlers.roomKey ?? '';
    /** A move is a reconnect we asked for, so the reconnect path must not also run. */
    this.moving = false;

    /**
     * What this meeting is allowed to send, as granted by the server.
     *
     * Set before any track is produced. The server caps the transport too, so
     * ignoring this would not buy anything — it would just mean encoding above
     * a ceiling that then drops the excess, which is worse than encoding to it.
     */
    this.limits = handlers.limits ?? null;
  }

  // ── Signalling ─────────────────────────────────────────────────────────────

  /** One request, one reply, correlated by id. */
  request(action, data = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(Object.assign(
        new Error('Not connected to the meeting.'),
        { retryable: true, code: 'disconnected' },
      ));
    }

    const id = this.nextRequestId++;
    const settled = this.pending.add(id, action);

    try {
      this.socket.send(JSON.stringify({ id, action, data }));
    } catch (error) {
      // Nothing left the machine, so nothing is going to reply to it. Settled
      // here rather than left to the timeout, which would otherwise hold a
      // request for twenty seconds that failed before it was sent.
      this.pending.settle(id, { ok: false, error: { code: 'send_failed', message: error.message } });
    }

    return settled;
  }

  /**
   * Reject everything still waiting for a reply, and forget it.
   *
   * Called when the socket goes away. `retryable` because a dropped socket is
   * a reconnect, not an ended meeting — the same distinction `onclose` makes
   * about the connection itself.
   */
  abortPending(reason) {
    this.pending.abort(reason);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `${WS_ORIGIN}/ws/meeting?code=${encodeURIComponent(this.code)}`
        + (this.roomKey ? `&room=${encodeURIComponent(this.roomKey)}` : '');
      const socket = new WebSocket(url);
      this.socket = socket;

      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      /**
       * A transport failure is "not right now", not "no".
       *
       * The server being unreachable — restarting, a dropped network, a proxy
       * recycling — is temporary, and is flagged `retryable` so the caller
       * shows "reconnecting" instead of ending a meeting that is still running.
       * A refusal carries a reason and is not retryable; those are handled
       * where the `refused` message is read.
       */
      socket.onerror = () =>
        fail(Object.assign(new Error('Could not reach the meeting server.'), { retryable: true }));

      socket.onclose = (event) => {
        fail(Object.assign(
          new Error(event.reason || 'The meeting connection closed.'),
          { retryable: !DELIBERATE_CLOSE.includes(event.code) },
        ));

        /**
         * Nothing in flight is coming back.
         *
         * Every request waiting on this socket used to be left in `pending`
         * with nothing able to settle it: the reply had nowhere to arrive, and
         * the only thing left was its own twenty-second timer. The reconnect
         * below would succeed, the meeting would carry on, and then long after
         * everything was working again the abandoned timers fired and reported
         * "consume timed out" for a socket that had closed twenty seconds
         * earlier. The error was real; it was describing the past.
         *
         * Settling them here makes the failure land at the moment it happened,
         * and marks it retryable so a caller treats it as the blip it is.
         */
        this.abortPending(event.reason || 'The meeting connection closed.');

        if (this.closed) return;

        /**
         * A closed socket is not the end of a meeting.
         *
         * Wifi drops, laptops sleep, load balancers recycle connections and
         * development servers restart on every file change. Treating any of
         * those as "the meeting is over" — which is what this used to do —
         * throws everybody out of a call that is still running. Only the codes
         * the server uses deliberately mean stop.
         */
        if (DELIBERATE_CLOSE.includes(event.code)) {
          this.on.closed?.(event.reason);
          return;
        }

        // A move closes this socket on purpose and is already rebuilding. One
        // reconnect loop, not two racing to claim the same peer.
        if (!this.moving) this.reconnect();
      };

      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        // A reply to something we asked.
        if (message.id !== undefined) {
          this.pending.settle(message.id, message);
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

  /**
   * Rebuilds the session after an unexpected disconnect.
   *
   * Everything is re-negotiated from scratch — device, transports, producers,
   * consumers — because the server's side of all of it went away with the
   * socket. What survives is the local media: the camera and microphone tracks
   * are still captured, so the browser does not re-prompt and the light on the
   * webcam never blinks.
   */
  async reconnect({ firstDelay } = {}) {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;

    /**
     * Keep the captured tracks, drop everything the server knew about.
     *
     * The transports, producers and consumers all died with the socket, but the
     * camera and microphone are still open locally. Holding the tracks and
     * re-sending the same ones means the browser is never asked for permission
     * again and the capture indicator does not blink — closing a producer does
     * not stop its track unless we ask it to, which is why this works.
     */
    const carried = [];
    for (const [source, producer] of this.producers) {
      if (source === 'screen' || source === 'screenAudio') {
        // A screen capture cannot be restarted without a fresh user gesture.
        producer.track?.stop();
      } else if (producer.track?.readyState === 'live') {
        carried.push({
          source,
          track: producer.track,
          paused: producer.paused,
          // Which device this was, so a track the system reclaims during a long
          // reconnect can be re-opened as the same one rather than the default.
          deviceId: producer.track.getSettings?.().deviceId,
        });
      }
      producer.close();
    }
    const hadScreen = this.producers.has('screen');
    this.producers.clear();

    for (const { consumer } of this.consumers.values()) consumer.close();
    this.consumers.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();

    for (let attempt = 0; attempt < 12 && !this.closed; attempt += 1) {
      // Backs off to 8s and stays there, so a long outage does not become a
      // tight retry loop against a server that is already struggling.
      // A move is not a failure, so it does not start by waiting a second: the
      // first attempt goes out immediately and only a genuine failure backs off.
      const delay = attempt === 0 && firstDelay !== undefined
        ? firstDelay
        : Math.min(1000 * 2 ** attempt, 8000);
      this.on.reconnecting?.({ attempt: attempt + 1, delay, moving: this.moving });
      await new Promise((resolve) => { setTimeout(resolve, delay); });
      if (this.closed) return;

      try {
        await this.connect();
        await this.resend(carried);
        if (hadScreen) this.on.warning?.('Your screen share stopped when the connection dropped.');
        this.reconnecting = false;
        this.on.reconnected?.();
        return;
      } catch {
        // Try again until the attempts run out.
      }
    }

    this.reconnecting = false;
    if (!this.closed) this.on.closed?.('Lost the connection to the meeting.');
  }

  /**
   * Moves this person to another room of the same meeting.
   *
   * A room is a separate mediasoup Router, and media only forwards between
   * transports on one Router — so moving is reconnecting, and isolation is a
   * property of where the streams are rather than a filter every future feature
   * has to remember to apply. The reconnect carries the live camera and
   * microphone tracks across, so the browser never re-prompts and the capture
   * light does not blink; what it costs is about a second of silence.
   *
   * Asking for a room is not being given it. The server resolves the request
   * against the meeting's plan when the new socket connects, and a refusal
   * closes it with a reason like any other.
   */
  async switchTo(roomKey, { name = '', reason = 'assigned' } = {}) {
    if (this.closed || this.reconnecting || this.roomKey === roomKey) return;

    this.roomKey = roomKey;
    this.moving = true;
    this.on.moving?.({ room: roomKey, name, reason });

    try {
      // 1000 is not in DELIBERATE_CLOSE, but `moving` is what stops the close
      // handler reconnecting — the flag, not the code, because the server may
      // close this socket first when it replaces the peer.
      this.socket?.close(1000, 'moving rooms');
      await this.reconnect({ firstDelay: 0 });
    } finally {
      this.moving = false;
      this.on.moved?.({ room: this.roomKey, name });
    }
  }

  /**
   * Re-sends the tracks we were already sending, on the new transports.
   *
   * ── Why a dead track is re-opened rather than skipped ──
   *
   * A reconnect carries the live camera and microphone across so the browser
   * never re-prompts and the capture light does not blink. That works for a
   * blip. It does not work for the case this is really for — a bad connection,
   * where the retry loop can run for a minute or more — because by then the
   * operating system may have taken the device back: a laptop that slept, a
   * headset that was unplugged, another app that grabbed the microphone while
   * this one was not using it.
   *
   * The old code checked `readyState` and silently moved on. You came back to
   * the meeting with the microphone button lit, no microphone attached, and no
   * indication of either — talking to a room that could not hear you, which is
   * exactly the "voice bug after reconnecting" this is here to end.
   */
  async resend(carried) {
    for (const { source, track, paused, deviceId } of carried) {
      try {
        // A track the system has reclaimed cannot be re-sent, so ask for the
        // same device again. This is the slow path and the important one.
        const live = track.readyState === 'live'
          ? track
          : (await navigator.mediaDevices.getUserMedia(MeetingRoom.constraintsFor(source, deviceId)))
            .getTracks()[0];

        if (!live) throw new Error(`No ${source} to send.`);

        const producer = source === 'mic'
          ? await this.sendTransport.produce({
              track: live,
              appData: { source },
              codecOptions: { opusStereo: false, opusDtx: true, opusFec: true },
            })
          : await this.produceVideo(live, cameraEncodings(this.limits?.cameraBitrate), source);

        this.producers.set(source, producer);
        if (paused) await this.setPaused(source, true);

        // The caller holds the old track to draw your own tile with; a
        // re-opened device is a different one and has to reach it.
        if (live !== track) this.on.localTrack?.(source, live);
      } catch {
        /**
         * Reported as a source that is *off*, not as a warning in passing.
         *
         * The caller turns the button off in response, so the state on screen
         * matches the state on the wire — a lit microphone that is sending
         * nothing is worse than an obviously muted one.
         */
        this.on.sourceLost?.(source);
        this.on.warning?.(`Your ${source === 'mic' ? 'microphone' : source} did not come back after reconnecting.`);
      }
    }
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
        // Announced before consuming, so the indicator flips as soon as the
        // track exists rather than when its first packet has been negotiated.
        this.on.peerProducerAdded?.(data);

        /**
         * The one consume that was not guarded, and the one most likely to
         * fail: it runs the instant somebody turns a camera on, rather than
         * during a setup the caller is already waiting on.
         *
         * A rejection here used to have nowhere to go and surfaced as an
         * unhandled rejection — "consume timed out", twenty seconds after a
         * connection blip that had already been recovered from.
         *
         * Losing the socket is not worth reporting, because reconnecting
         * consumes every producer in the room again and this track comes back
         * with the rest. Nor is `gone`, which only means the person stopped
         * sending before we got to them. Anything else is a track that will
         * not arrive on its own, and is worth saying out loud.
         */
        await this.consume(data.producerId).catch((error) => {
          if (error?.retryable || error?.code === 'gone') return;
          this.on.warning?.('A participant\u2019s video could not be played.');
        });
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

      /**
       * The authoritative list of who else is here.
       *
       * Arrives periodically alongside the join/leave deltas. Handing it to the
       * caller repairs a roster that lost a delta, and `reconcile` picks up any
       * track we never started consuming because the notification that would
       * have told us about it went missing.
       */
      case 'roster':
        this.on.roster?.(data.peers);
        await this.reconcile(data.peers);
        break;

      case 'activeSpeaker':
        this.on.activeSpeaker?.(data.texorId);
        break;

      /**
       * The host changed how much this meeting is allowed to send.
       *
       * Everyone gets this, not just the host, because everyone's camera is
       * part of what the meeting costs.
       */
      case 'quality':
        this.limits = data;
        await this.applyLimits();
        this.on.quality?.(data);
        break;

      case 'handChanged':
        this.on.handChanged?.(data);
        break;

      /**
       * A host muted us. The server has already stopped forwarding the audio;
       * pausing locally keeps our own producer and our own button honest about
       * it, rather than showing a live microphone that is going nowhere.
       */
      case 'forceMuted': {
        const producer = this.producers.get('mic');
        if (producer && !producer.paused) producer.pause();
        this.on.forceMuted?.(data);
        break;
      }

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

      /**
       * The host has decided which room this person is in.
       *
       * Acted on rather than argued with — but the move is still a request:
       * the new socket is authorised against the meeting's plan when it
       * connects, so a stale instruction is refused there rather than trusted
       * here.
       */
      case 'moveTo':
        this.on.breakout?.({ room: data.room, name: data.name, closesAt: data.closesAt });
        await this.switchTo(data.room, { name: data.name, reason: data.reason });
        break;

      default:
        break;
    }
  }

  // ── Receiving ──────────────────────────────────────────────────────────────

  /**
   * Starts consuming anything in the roster we are not already receiving.
   *
   * Consumers are the other half of the same problem: a missed `newProducer`
   * means a participant who is present but permanently silent and blank, with
   * nothing to prompt a retry. Comparing against the authoritative list closes
   * that gap without re-consuming what we already have.
   */
  async reconcile(peers) {
    const already = new Set(
      [...this.consumers.values()].map((entry) => entry.consumer.producerId),
    );

    for (const peer of peers ?? []) {
      for (const producer of peer.producers ?? []) {
        if (already.has(producer.id)) continue;
        // One failure must not stop the rest of the room from arriving.
        await this.consume(producer.id).catch(() => {});
      }
    }
  }

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
  /**
   * What the connection is actually doing, right now.
   *
   * Both directions, because they answer different questions: the send side
   * says whether *we* are sending a full picture, and the receive side says
   * whether the SFU is forwarding one. A complaint about quality is almost
   * always one or the other, and without this there is no way to tell which.
   */
  async connectionStats() {
    const [send, recv] = await Promise.all([
      this.sendTransport?.getStats().catch(() => null) ?? null,
      this.recvTransport?.getStats().catch(() => null) ?? null,
    ]);

    const snapshot = readConnection({ send, recv, previous: this.lastStats ?? {} });
    this.lastStats = { send, recv };
    return snapshot;
  }

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

  async startMic(deviceId) {
    if (this.producers.has('mic')) return null;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Left on, unlike the screen-audio track: this is a voice in a room,
        // and it is what stops a presenter's own speakers echoing back.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
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

    const producer = await this.produceVideo(
      track,
      cameraEncodings(this.limits?.cameraBitrate),
      'camera',
    );

    /**
     * Which way the camera gives when bandwidth runs short.
     *
     * This was missing, and the browser's own default for a camera track is to
     * hold the frame rate and shrink the picture. That is invisible on a
     * developer's machine, where nothing is ever constrained, and on a real
     * connection it is the difference between "High" looking high and looking
     * smooth but soft.
     */
    await this.applyDegradation(producer, this.limits?.cameraDegradation ?? 'balanced');

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
  /**
   * Biases an already-created sender toward frames or toward sharpness.
   *
   * Applied after `produce`, because mediasoup-client owns the sender until it
   * returns. Wrapped because `degradationPreference` is not universally
   * supported — and where it is missing, the `contentHint` set on the track is
   * still doing half the job.
   */
  async applyDegradation(producer, preference) {
    const sender = producer?.rtpSender;
    if (!sender?.getParameters) return;

    try {
      const parameters = sender.getParameters();
      parameters.degradationPreference = preference;
      await sender.setParameters(parameters);
    } catch {
      // Older browsers reject the field outright; the hint still applies.
    }
  }

  /**
   * Re-aim the live senders at the meeting's current budget.
   *
   * Bitrate is a parameter on a sender, not part of the negotiated session, so
   * this changes with no offer/answer and no black frame — the encoder simply
   * starts targeting a different number on its next frame. Re-producing would
   * have worked too and would have shown every viewer a gap.
   *
   * The layer *shape* is preserved: whatever ladder was negotiated keeps its
   * number of layers and its proportions, and only the ceiling moves. Handing
   * `setParameters` a different number of encodings than the sender was created
   * with is rejected outright.
   */
  async applyLimits() {
    if (!this.limits) return;

    const ceilings = {
      camera: this.limits.cameraBitrate,
      screen: this.limits.screenBitrate,
    };

    for (const [source, producer] of this.producers) {
      const ceiling = ceilings[source];
      const sender = producer?.rtpSender;
      if (!ceiling || !sender?.getParameters) continue;

      try {
        const parameters = sender.getParameters();
        const encodings = parameters.encodings ?? [];
        if (encodings.length === 0) continue;

        // Rebuild the same ladder against the new top, so the small layers stay
        // proportionally small instead of all collapsing onto the ceiling.
        const ladder = source === 'camera'
          ? cameraEncodings(cameraBudget(ceiling, { presenting: this.presenting }))
          : screenEncodings(ceiling);

        encodings.forEach((encoding, index) => {
          // Fall back to the top of the ladder if this sender has more layers
          // than we build, which is the browser's prerogative.
          encoding.maxBitrate = (ladder[index] ?? ladder[ladder.length - 1]).maxBitrate;
        });

        await sender.setParameters(parameters);
      } catch {
        // A sender that refuses keeps the bitrate it already had, which is a
        // worse picture or a dearer one — never a broken call.
      }
    }

    // The trade-off moves with the tier, not just the number.
    const camera = this.producers.get('camera');
    if (camera && this.limits.cameraDegradation) {
      await this.applyDegradation(camera, this.limits.cameraDegradation);
    }

    // Frame rate is a constraint on the track rather than on the sender, and
    // only a screen share has one worth moving.
    const screen = this.producers.get('screen');
    const max = this.limits.screenFrameRate;
    if (screen?.track && max) {
      try {
        await screen.track.applyConstraints({ frameRate: { ideal: max, max } });
      } catch {
        // Some capture sources refuse to be re-constrained mid-share.
      }
    }
  }

  /** The host raises or lowers the budget for everyone. */
  async setQuality(tier) {
    return this.request('setQuality', { tier });
  }

  /**
   * How this stream is ranked when the browser divides up the uplink.
   *
   * Separate from bitrate: a ceiling says what a sender *may* use, priority
   * decides who gets it first when the estimate cannot cover everyone. Applied
   * through `setParameters` and wrapped, for the same reason as degradation —
   * an unsupported field must not take the whole transceiver down with it.
   */
  async applyPriority(producer, priority) {
    const sender = producer?.rtpSender;
    if (!sender?.getParameters) return;

    try {
      const parameters = sender.getParameters();
      for (const encoding of parameters.encodings ?? []) {
        encoding.networkPriority = priority;
        encoding.priority = priority;
      }
      await sender.setParameters(parameters);
    } catch {
      // Not every engine accepts it; the bitrate ceilings still apply.
    }
  }

  /** Whether a screen of ours is currently being sent. */
  get presenting() {
    return this.producers.has('screen');
  }

  async startScreen(mode = 'motion') {
    // A stale entry here used to make every later attempt a silent no-op.
    if (this.producers.has('screen')) await this.stop('screen');
    if (this.producers.has('screenAudio')) await this.stop('screenAudio');

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        /**
         * Frame rate *and* size.
         *
         * Only frame rate used to be asked for, so the browser returned the
         * display's native resolution — 4K, or a retina panel — and the encoder
         * had to force that into a few Mbps. That is the soft, blocky share
         * that looks nothing like what the sharer sees, and it never appears on
         * localhost because nothing there is ever short of bandwidth.
         */
        video: screenConstraints({
          // The tier caps the frame rate as well as the bitrate: Data saver has
          // no use for 30fps it cannot afford to encode.
          frameRate: Math.min(
            SCREEN_MODES[mode]?.frameRate?.ideal ?? 30,
            this.limits?.screenFrameRate ?? 30,
          ),
          maxHeight: this.limits?.screenMaxHeight ?? 1080,
        }),
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

    /**
     * Tell the encoder what kind of picture this is *before* producing.
     *
     * Without a hint, browsers treat captured screens as detail content and
     * hold resolution by dropping frames — which is exactly the complaint this
     * is fixing, and it happens silently.
     */
    try {
      track.contentHint = SCREEN_MODES[mode]?.contentHint ?? 'motion';
    } catch {
      // Read-only in some engines; the sender preference below still applies.
    }

    let producer;
    try {
      producer = await this.produceVideo(track, screenEncodings(this.limits?.screenBitrate), 'screen');
      await this.applyDegradation(
        producer,
        SCREEN_MODES[mode]?.degradationPreference ?? 'maintain-framerate',
      );
      // When there is not enough for both, the shared screen wins. It is what
      // everyone in the meeting is actually looking at.
      await this.applyPriority(producer, 'high');
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

    // Set last, so `presenting` is already true: this is what actually stands
    // the camera down and hands its share of the uplink to the screen.
    await this.applyLimits();

    return track;
  }

  /** Closes a track for good — the peer's tile loses it. */
/**
   * The constraints one source is captured with.
   *
   * Shared by the initial capture and by a mid-call device change, so the
   * microphone a meeting switches to is opened exactly the way the one it
   * started with was — echo cancellation and the rest. Two copies of this
   * drifting apart is how a swapped microphone ends up echoing.
   */
  static constraintsFor(source, deviceId) {
    const device = deviceId ? { deviceId: { exact: deviceId } } : {};

    if (source === 'mic') {
      return {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...device,
        },
      };
    }

    return { video: { ...VIDEO_CONSTRAINTS, ...device } };
  }

  /**
   * Change which microphone or camera is being sent, mid-call.
   *
   * `replaceTrack` swaps what the existing sender is reading from. There is no
   * renegotiation, no new producer id, and nobody else sees anything except the
   * picture or the voice changing — which is the difference between switching
   * headsets and dropping out of the meeting for a second.
   *
   * This did not exist. The settings dialog wrote the new device to storage and
   * nothing acted on it, so changing your microphone during a call did nothing
   * at all until you left and came back — and there was no sign that it had not
   * worked.
   *
   * Returns the new track, or null when that source is not being sent right
   * now — a choice made while muted is still saved, and takes effect the next
   * time the source starts.
   */
  async useDevice(source, deviceId) {
    const producer = this.producers.get(source);
    if (!producer) return null;

    // Held so it can be released once the new one is carrying the call.
    const previous = producer.track;

    const stream = await navigator.mediaDevices.getUserMedia(
      MeetingRoom.constraintsFor(source, deviceId),
    );
    const track = stream.getTracks()[0];

    if (!track) return null;

    try {
      await producer.replaceTrack({ track });
    } catch (error) {
      // The new device could not be attached; keep the one that works rather
      // than leaving the call silent.
      track.stop();
      throw error;
    }

    /**
     * Only once the swap has succeeded.
     *
     * Stopping the old track first would leave the call with nothing on air for
     * as long as the new device takes to open — which on a USB headset is long
     * enough to cut a word in half. Releasing it afterwards is what turns the
     * old device's indicator light off.
     */
    previous?.stop();
    return track;
  }

  async stop(source) {
    const producer = this.producers.get(source);
    if (!producer) return;

    producer.track?.stop();
    producer.close();
    this.producers.delete(source);

    await this.request('closeProducer', { producerId: producer.id }).catch(() => {});

    // The screen is gone, so the camera can have its full budget back.
    if (source === 'screen') await this.applyLimits();
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

  muteParticipant(texorId) {
    return this.request('muteParticipant', { texorId });
  }

  muteEveryone() {
    return this.request('muteEveryone');
  }

  setRoleOf(texorId, role) {
    return this.request('setPeerRole', { texorId, role });
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

  raiseHand(raised) {
    return this.request('raiseHand', { raised });
  }

  lowerHandOf(texorId) {
    return this.request('lowerHand', { texorId });
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
