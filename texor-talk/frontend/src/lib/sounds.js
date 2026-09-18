'use client';

/**
 * The short chimes a call makes: somebody arrived, somebody left, it is over.
 *
 * ── Synthesised, not shipped ──
 *
 * These are oscillators and gain envelopes rather than audio files. No asset to
 * bundle, no request that can 404 in production, nothing to put on a CDN, and
 * the whole product stays self-contained. Three notes of a sine wave is also
 * simply what these sounds are.
 *
 * ── Two halves ──
 *
 * The tones and the rules about *when* to play are plain data and plain
 * functions, and are tested. Only the last few lines touch an `AudioContext`.
 */

/**
 * Frequencies in Hz, offsets and durations in milliseconds.
 *
 * Rising for an arrival, falling for a departure, and a longer descent for the
 * end — the shape carries the meaning, so the sounds stay distinguishable to
 * somebody who is not looking at the screen, which is the whole point of them.
 *
 * Gains are deliberately low. This plays over the top of somebody talking.
 */
export const TONES = {
  join: {
    gain: 0.08,
    notes: [
      { freq: 587.33, at: 0, ms: 110 },   // D5
      { freq: 880.00, at: 85, ms: 170 },  // A5
    ],
  },
  leave: {
    gain: 0.08,
    notes: [
      { freq: 783.99, at: 0, ms: 110 },   // G5
      { freq: 523.25, at: 85, ms: 190 },  // C5
    ],
  },
  ended: {
    gain: 0.10,
    notes: [
      { freq: 783.99, at: 0, ms: 150 },   // G5
      { freq: 659.25, at: 130, ms: 150 }, // E5
      { freq: 523.25, at: 260, ms: 320 }, // C5
    ],
  },
};

/** How long a tone takes, end to end. */
export const toneLength = (name) => {
  const tone = TONES[name];
  if (!tone) return 0;
  return Math.max(...tone.notes.map((note) => note.at + note.ms));
};

/**
 * Whether a sound should actually be made.
 *
 * Almost all the work of these being pleasant rather than irritating is here
 * rather than in the tones:
 *
 *   · **nothing before you are in the call.** Otherwise opening a busy meeting
 *     announces every person already in it.
 *   · **nothing for a moment after you join**, for the same reason — the roster
 *     arrives as a burst of joins and would play as a burst of chimes.
 *   · **a minimum gap**, so two people arriving together is one sound and not a
 *     muddle of two overlapping.
 *   · **a cap per window**, so a class of thirty filing in does not turn the
 *     call into a slot machine.
 *
 * `ended` is exempt from the rate limits. It happens once and it is the one
 * everybody needs to hear.
 */
export function createSoundGate({
  settleMs = 2500,
  minGapMs = 350,
  maxPerWindow = 4,
  windowMs = 5000,
} = {}) {
  let armedAt = null;
  let played = [];

  return {
    /** Called once the local participant is actually in the call. */
    arm(now = Date.now()) {
      armedAt = now;
      played = [];
    },

    disarm() {
      armedAt = null;
      played = [];
    },

    get armed() {
      return armedAt !== null;
    },

    allow(event, now = Date.now()) {
      if (armedAt === null) return false;

      // The end of a meeting is never suppressed for being busy.
      if (event === 'ended') return true;

      if (now - armedAt < settleMs) return false;

      played = played.filter((at) => now - at < windowMs);
      if (played.length >= maxPerWindow) return false;

      const last = played[played.length - 1];
      if (last !== undefined && now - last < minGapMs) return false;

      played.push(now);
      return true;
    },
  };
}

/**
 * The player.
 *
 * One `AudioContext` for the call, created when the gate is armed — which
 * happens on joining, and joining is a click, so the browser's autoplay policy
 * is satisfied. Created any earlier and it would start suspended and stay that
 * way.
 */
export function createChimes({ enabled = true, gate = createSoundGate() } = {}) {
  let context = null;
  let on = enabled;

  function audio() {
    if (typeof window === 'undefined') return null;

    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return null;

    try {
      context ??= new Ctor();
      // Tab switches and some phone browsers suspend it underneath us.
      if (context.state === 'suspended') context.resume().catch(() => {});
      return context;
    } catch {
      return null;
    }
  }

  function strike(ctx, { freq, at, ms }, gain) {
    const start = ctx.currentTime + at / 1000;
    const end = start + ms / 1000;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);

    /**
     * An envelope, not a switch.
     *
     * Starting and stopping an oscillator at full amplitude produces a click at
     * each end — a discontinuity in the waveform — which is louder and more
     * annoying than the note itself.
     */
    const level = ctx.createGain();
    level.gain.setValueAtTime(0, start);
    level.gain.linearRampToValueAtTime(gain, start + 0.012);
    level.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(level).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  return {
    setEnabled(next) { on = Boolean(next); },
    get enabled() { return on; },

    arm(now) {
      gate.arm(now);
      // Build it on the gesture that got us here, not on the first sound.
      audio();
    },

    /**
     * `force` skips the gate. It is for sounds that answer a click of your own
     * — leaving the call — where a rate limit meant for other people's comings
     * and goings would swallow the one piece of feedback you asked for.
     */
    play(name, now, { force = false } = {}) {
      if (!on) return false;
      if (!force && !gate.allow(name, now)) return false;

      const tone = TONES[name];
      if (!tone) return false;

      const ctx = audio();
      if (!ctx) return false;

      try {
        for (const note of tone.notes) strike(ctx, note, tone.gain);
        return true;
      } catch {
        // A context closed underneath us, or an engine that refuses. A missing
        // chime is not worth an error anybody sees.
        return false;
      }
    },

    /** Let whatever is sounding finish, then let go of the hardware. */
    close(after = 600) {
      gate.disarm();
      const ctx = context;
      context = null;
      if (!ctx) return;
      setTimeout(() => { ctx.close?.().catch?.(() => {}); }, after);
    },
  };
}

export default { TONES, toneLength, createSoundGate, createChimes };
