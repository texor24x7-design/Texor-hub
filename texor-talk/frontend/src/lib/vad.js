/**
 * Deciding where one thing somebody said ends and the next begins.
 *
 * This is the part of captions that decides whether they are any good.
 * Whisper transcribes a clip; it does not find the clip. Hand it a fixed
 * five-second window and you get sentences cut in half at both ends, which it
 * then guesses the missing halves of — so the recognition looks bad when the
 * segmentation was what was wrong.
 *
 * Pure, and with no imports, so it can be driven by a test with synthetic audio
 * rather than by somebody talking into a laptop. That matters more here than
 * anywhere else in the client: the rules are all thresholds, and a threshold
 * nobody can exercise is a threshold nobody will ever dare change.
 *
 * ── Why the threshold is not a constant ──
 *
 * A fixed level works on the microphone it was tuned on. A headset in a quiet
 * room sits thirty decibels below a laptop microphone next to a fan, and one
 * number cannot be right for both: too low and the fan is transcribed all
 * afternoon, too high and a softly spoken person is never captioned at all.
 * So the floor is *measured* — tracked from the quiet stretches — and speech is
 * whatever rises well clear of it.
 */

/** Root mean square of a frame: its loudness, as a number from 0 to 1. */
export function rms(frame) {
  if (!frame?.length) return 0;

  let sum = 0;
  for (let index = 0; index < frame.length; index += 1) sum += frame[index] * frame[index];

  return Math.sqrt(sum / frame.length);
}

export const DEFAULTS = {
  sampleRate: 16_000,
  /**
   * How far above the measured noise floor a frame has to be to count as
   * speech. Speech runs an order of magnitude above room noise, so three is
   * conservative — it is chosen to avoid transcribing a fan, not to catch
   * every whisper.
   */
  speechFactor: 3,
  /**
   * The floor below which nothing is speech however quiet the room is.
   *
   * Without this, a *perfectly* silent input — a muted microphone that still
   * produces frames, a virtual device with nothing attached — drives the
   * measured floor to zero, and then any float rounding error is three times
   * it and counts as talking.
   */
  absoluteFloor: 0.008,
  /** Silence that ends a turn. Shorter clips sentences; longer runs two
   * separate remarks together and makes captions lag behind the speaker. */
  hangoverMs: 600,
  /** Anything briefer than this is a cough, a click or a door. */
  minSpeechMs: 250,
  /**
   * The longest clip sent in one piece.
   *
   * Whisper's window is thirty seconds and its accuracy falls off well before
   * that. Ten keeps somebody delivering a monologue in captions that arrive
   * while they are still talking rather than at the end.
   */
  maxUtteranceMs: 10_000,
  /** How often a sentence still being spoken is re-transcribed for the live
   * line on screen. Nothing interim is ever stored. */
  interimEveryMs: 1_800,
  /**
   * Audio kept from *before* speech was detected.
   *
   * The detector needs a frame or two above the floor to be sure, and by then
   * the first consonant has already gone past. Starting the clip a fifth of a
   * second earlier is the difference between "we should ship it" and "e should
   * ship it" — and a clipped first word is the single most noticeable caption
   * error there is.
   */
  prerollMs: 200,
};

/**
 * A streaming segmenter.
 *
 * Feed it frames; it hands back utterances. `push` returns an array because one
 * frame can legitimately produce two events — the frame that takes a monologue
 * past the maximum length both closes one utterance and opens the next.
 */
export function createSegmenter(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const msPerSample = 1000 / config.sampleRate;

  const prerollSamples = Math.round((config.prerollMs / 1000) * config.sampleRate);

  /** Frames held from before speech started, trimmed to the pre-roll length. */
  let preroll = [];
  let prerollLength = 0;

  let speaking = false;
  let frames = [];
  let collected = 0;
  let silenceMs = 0;
  let speechMs = 0;
  let sinceInterimMs = 0;

  // Started at the absolute floor rather than at zero, so the first breath in
  // a quiet room does not set the floor at silence and count as speech.
  let noiseFloor = config.absoluteFloor;

  const threshold = () => Math.max(config.absoluteFloor, noiseFloor * config.speechFactor);

  /** Flattens the collected frames into the single buffer the wire wants. */
  function drain() {
    const merged = new Float32Array(collected);
    let offset = 0;
    for (const frame of frames) {
      merged.set(frame, offset);
      offset += frame.length;
    }
    return merged;
  }

  function reset() {
    speaking = false;
    frames = [];
    collected = 0;
    silenceMs = 0;
    speechMs = 0;
    sinceInterimMs = 0;
  }

  return {
    /** Exposed for tests and for a level meter; never for a decision. */
    get level() {
      return { noiseFloor, threshold: threshold(), speaking };
    },

    push(frame) {
      if (!frame?.length) return [];

      const events = [];
      const frameMs = frame.length * msPerSample;
      const energy = rms(frame);
      const loud = energy > threshold();

      if (!speaking) {
        /**
         * Track the floor only while nobody is talking.
         *
         * Updating it during speech would drag it up towards the speech itself,
         * and a few seconds in, the speaker would fall below their own floor
         * and be cut off mid-sentence.
         *
         * Asymmetric on purpose: it rises slowly, so one loud moment does not
         * deafen the detector, and falls quickly, so walking into a quiet room
         * does not leave it insensitive for the next minute.
         */
        noiseFloor = energy > noiseFloor
          ? noiseFloor * 0.995 + energy * 0.005
          : noiseFloor * 0.9 + energy * 0.1;

        if (!loud) {
          // Hold the tail of the silence so the start of the next word is not
          // clipped off the front of the clip.
          preroll.push(frame);
          prerollLength += frame.length;

          while (prerollLength - preroll[0].length >= prerollSamples) {
            prerollLength -= preroll.shift().length;
          }

          return events;
        }

        // Speech starts, with the pre-roll in front of it.
        speaking = true;
        frames = [...preroll, frame];
        collected = prerollLength + frame.length;
        speechMs = frameMs;
        silenceMs = 0;
        sinceInterimMs = 0;
        preroll = [];
        prerollLength = 0;

        return events;
      }

      frames.push(frame);
      collected += frame.length;
      sinceInterimMs += frameMs;

      if (loud) {
        speechMs += frameMs;
        silenceMs = 0;
      } else {
        silenceMs += frameMs;
      }

      const totalMs = collected * msPerSample;

      /**
       * Long enough that it has to be cut, whether or not they have paused.
       *
       * The tail is not thrown away: the clip is closed and a new one opens
       * immediately from this frame, so a continuous monologue comes out as
       * consecutive utterances rather than as one clip and then a gap.
       */
      if (totalMs >= config.maxUtteranceMs) {
        events.push({ type: 'final', samples: drain(), durationMs: Math.round(totalMs) });

        reset();
        speaking = true;
        frames = [frame];
        collected = frame.length;
        speechMs = loud ? frameMs : 0;

        return events;
      }

      // The turn has ended.
      if (silenceMs >= config.hangoverMs) {
        // Only if there was actually speech in it. A door closing produces a
        // frame above the floor and then nothing, and is not worth sending.
        if (speechMs >= config.minSpeechMs) {
          events.push({ type: 'final', samples: drain(), durationMs: Math.round(totalMs) });
        }

        reset();
        return events;
      }

      /**
       * A redraw of the sentence being spoken, for the live line on screen.
       *
       * Only while there is still speech coming: re-transcribing during the
       * hangover would spend the recogniser on a clip whose final is already a
       * few hundred milliseconds away and would say the same thing.
       */
      if (sinceInterimMs >= config.interimEveryMs && silenceMs === 0 && speechMs >= config.minSpeechMs) {
        sinceInterimMs = 0;
        events.push({ type: 'interim', samples: drain(), durationMs: Math.round(totalMs) });
      }

      return events;
    },

    /**
     * Whatever is in hand, because the microphone is being turned off.
     *
     * Without this the last sentence before somebody mutes or hangs up is
     * simply lost — it never reaches the hangover that would have sent it.
     */
    flush() {
      if (!speaking || speechMs < config.minSpeechMs) {
        reset();
        return null;
      }

      const event = {
        type: 'final',
        samples: drain(),
        durationMs: Math.round(collected * msPerSample),
      };

      reset();
      return event;
    },
  };
}

export default { createSegmenter, rms, DEFAULTS };
