/**
 * The microphone tap that feeds captions.
 *
 * Runs on the audio rendering thread, which is why it is a separate file
 * fetched by URL rather than part of the bundle — an AudioWorklet module is
 * loaded into its own realm and cannot import anything from the page.
 *
 * It does one job: hand the main thread mono 16 kHz frames. Everything that
 * decides *what to do* with them — where an utterance starts and ends, what is
 * sent, what is dropped — lives in `lib/vad.js`, where it can be tested. Audio
 * callbacks run every 2.7 milliseconds and must never be the place a judgement
 * call lives.
 *
 * ── Why it resamples at all ──
 *
 * Whisper's models are trained at 16 kHz and the recogniser expects exactly
 * that. The page asks for an AudioContext at 16 kHz so the browser's own
 * high-quality resampler does the work, but that is a request rather than a
 * guarantee — Safari has historically ignored it, and a device can force its
 * hardware rate. So this handles whatever rate it is actually given.
 */

/**
 * Twenty milliseconds at 16 kHz.
 *
 * Small enough that the segmenter's silence timing is fine-grained, large
 * enough that the message rate stays at fifty a second rather than the ~375
 * that posting every render quantum would produce.
 */
const FRAME_SAMPLES = 320;

class CaptionTap extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const target = options?.processorOptions?.targetRate ?? 16_000;

    /**
     * How many input samples make one output sample.
     *
     * `sampleRate` is a global inside a worklet: the context's real rate,
     * whatever was asked for. A ratio of 1 means the browser already gave us
     * what we wanted and the loop below becomes a copy.
     */
    this.ratio = sampleRate / target;

    this.out = new Float32Array(FRAME_SAMPLES);
    this.filled = 0;

    /**
     * Resampler state, carried across render quanta.
     *
     * Each output sample is the mean of the input samples that fall inside it,
     * which is a box filter — crude as filters go, and the important part is
     * that it *is* a filter. Picking every third sample instead would fold
     * everything above 8 kHz back down into the speech band as aliasing, and
     * the recogniser would be reading a signal with noise printed across the
     * consonants.
     */
    this.sum = 0;
    this.count = 0;
    this.position = 0;

    this.running = true;
    this.port.onmessage = (event) => {
      if (event.data === 'stop') this.running = false;
    };
  }

  process(inputs) {
    // Returning false would let the node be collected; while the tap is alive
    // it stays alive through silence and through a track being replaced.
    if (!this.running) return false;

    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let index = 0; index < channel.length; index += 1) {
      this.sum += channel[index];
      this.count += 1;
      this.position += 1;

      if (this.position < this.ratio) continue;
      this.position -= this.ratio;

      this.out[this.filled] = this.sum / this.count;
      this.filled += 1;
      this.sum = 0;
      this.count = 0;

      if (this.filled < FRAME_SAMPLES) continue;

      /**
       * Transferred, not copied.
       *
       * Handing the buffer over costs nothing and leaves this one detached, so
       * a fresh one is allocated for the next frame. Posting the same array
       * repeatedly would have the main thread reading a buffer this thread is
       * already overwriting.
       */
      this.port.postMessage(this.out, [this.out.buffer]);
      this.out = new Float32Array(FRAME_SAMPLES);
      this.filled = 0;
    }

    return true;
  }
}

registerProcessor('caption-tap', CaptionTap);
