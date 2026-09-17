'use client';

/**
 * Listening to your own microphone, for captions.
 *
 * A second, silent read of the same track the call is already sending. It is
 * deliberately *not* taken from the audio arriving from the SFU:
 *
 *   · this side of the wire the audio has not been through Opus, packet loss
 *     or discontinuous transmission, and the recogniser is markedly more
 *     accurate on it
 *   · the words are attributable with no guessing at all — this is one
 *     person's microphone, and the socket it goes out on is that person's
 *   · muting stops the capture at the source rather than stopping it somewhere
 *     downstream of a microphone that is still being read
 *
 * The cost is that each browser does its own segmentation. That is the right
 * trade: it is work that scales with the number of people rather than piling
 * onto the server, and it is the only version where "muted" means the audio was
 * never taken in the first place.
 */
import { createSegmenter } from '@/lib/vad';

const WORKLET_URL = '/worklets/caption-tap.js';
const TARGET_RATE = 16_000;

export class CaptionCapture {
  constructor({ track, onUtterance, onError, maxUtteranceMs, interim = true } = {}) {
    this.track = track;
    this.onUtterance = onUtterance;
    this.onError = onError;
    this.interim = interim;
    this.maxUtteranceMs = maxUtteranceMs;

    this.context = null;
    this.source = null;
    this.node = null;
    this.sink = null;
    this.segmenter = null;
    this.running = false;

    // Increments per utterance, so interims can be matched to the final that
    // replaces them. Only ever meaningful next to this peer's id.
    this.utterance = 0;
  }

  async start() {
    if (this.running || !this.track) return false;

    /**
     * Ask for the rate the model wants, and cope with being refused.
     *
     * Every current browser honours this and resamples the microphone with a
     * far better filter than anything worth writing by hand. Where it is
     * ignored, the context comes back at the hardware rate and the worklet
     * decimates instead — so the tap works either way, just a little less well.
     */
    try {
      this.context = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      this.context = new AudioContext();
    }

    // Created before capture starts, in case it comes back at a rate we did not
    // ask for — every threshold in the segmenter is expressed in milliseconds
    // and is derived from this.
    this.segmenter = createSegmenter({
      sampleRate: TARGET_RATE,
      ...(this.maxUtteranceMs ? { maxUtteranceMs: this.maxUtteranceMs } : {}),
      // Cheap, and it saves the recogniser the work of every redraw.
      ...(this.interim ? {} : { interimEveryMs: Number.POSITIVE_INFINITY }),
    });

    try {
      await this.context.audioWorklet.addModule(WORKLET_URL);
    } catch (error) {
      await this.stop();
      this.onError?.(new Error(`The caption processor could not be loaded: ${error.message}`));
      return false;
    }

    /**
     * A context created while the page is in the background starts suspended,
     * and a suspended context never calls the worklet — so the tap would sit
     * there producing nothing, with no error to point at.
     */
    if (this.context.state === 'suspended') await this.context.resume().catch(() => {});

    this.source = this.context.createMediaStreamSource(new MediaStream([this.track]));
    this.node = new AudioWorkletNode(this.context, 'caption-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      processorOptions: { targetRate: TARGET_RATE },
    });

    this.node.port.onmessage = (event) => this.consume(event.data);

    /**
     * Wired through to the destination at zero gain.
     *
     * A worklet whose output goes nowhere is not guaranteed to be pulled: the
     * graph renders what leads to the destination, and a node connected to
     * nothing can legitimately never run. Routing it to a muted gain node gives
     * it a reason to exist without putting the speaker's own voice into their
     * own ears a quarter of a second late.
     */
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;

    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(this.context.destination);

    this.running = true;
    return true;
  }

  /** One 20 ms frame from the worklet. */
  consume(frame) {
    if (!this.running) return;

    for (const event of this.segmenter.push(frame)) this.emit(event);
  }

  emit({ type, samples, durationMs }) {
    // A new id per utterance, claimed when the utterance *ends* rather than
    // when it starts, so every interim leading up to it shares the id of the
    // final that will replace them.
    const utteranceId = `${this.utterance}`;
    if (type === 'final') this.utterance += 1;

    this.onUtterance?.({ utteranceId, final: type === 'final', samples, durationMs });
  }

  /**
   * Follow a microphone change without dropping the tap.
   *
   * `useDevice` in the room swaps the track under the producer with
   * `replaceTrack`, which the call does not notice. This tap holds its own
   * reference and would otherwise keep reading the device the user just
   * switched away from — captioning a microphone that is no longer on air.
   */
  async setTrack(track) {
    if (!track || track === this.track) return;

    this.track = track;
    if (!this.running) return;

    this.source?.disconnect();
    this.source = this.context.createMediaStreamSource(new MediaStream([track]));
    this.source.connect(this.node);
  }

  async stop() {
    /**
     * Send the half-sentence in hand before tearing anything down.
     *
     * Stopping happens when somebody mutes or leaves, and that is very often
     * the moment *after* they finished a thought. Without this the last thing
     * said in a meeting is the one thing the transcript never contains.
     */
    if (this.running) {
      const pending = this.segmenter?.flush();
      if (pending) this.emit(pending);
    }

    this.running = false;

    try {
      this.node?.port.postMessage('stop');
      this.node?.disconnect();
      this.source?.disconnect();
      this.sink?.disconnect();
      // The track belongs to the call's producer, so it is never stopped here —
      // only the graph reading it is taken down.
      await this.context?.close();
    } catch {
      // A context that is already closed is the state we were after.
    }

    this.context = null;
    this.source = null;
    this.node = null;
    this.sink = null;
    this.segmenter = null;
  }
}

export default CaptionCapture;
