/**
 * The speech recogniser: whisper.cpp, running inside this process.
 *
 * Same shape as the SFU one directory over. `smart-whisper` compiles
 * ggerganov's whisper.cpp during `npm install` and exposes the model through a
 * native addon, so a meeting's audio is transcribed by this Node process on
 * this machine. There is no speech service, no API key, and no recording of
 * anybody's voice leaving the deployment.
 *
 * ── Why the queue is strictly serial ──
 *
 * `whisper_full()` mutates the decoder state that lives on the model context.
 * Two transcriptions running against one context at the same time is a data
 * race in C++, and it does not fail loudly — it corrupts one another's output
 * or segfaults the process much later. One model, one job at a time, and
 * `n_threads` is how the work is spread over the cores. Wanting more throughput
 * means a second model in a second process, not a second concurrent call here.
 *
 * ── Why work is dropped rather than queued ──
 *
 * Recognition is slower than speech on a machine without a GPU, so a busy
 * meeting can generate utterances faster than they can be transcribed. An
 * unbounded queue turns that into captions that fall further behind for the
 * rest of the call — the words still arrive, minutes after they were said,
 * which is worse than useless because it looks like the feature works. Instead
 * the queue is small, interim results are abandoned first, and anything that
 * has been waiting too long is thrown away unheard.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import env from '../config/env.js';
import logger from '../utils/logger.js';

/** Resolved once; `null` means "not tried yet", `false` means "not available". */
let binding = null;
let engine = null;
let loading = null;
let unavailable = null;

const queue = [];
let running = false;

const stats = {
  completed: 0,
  dropped: 0,
  failed: 0,
  totalInferenceMs: 0,
  totalAudioMs: 0,
};

/**
 * Where the weights live.
 *
 * A bare name like `base` is resolved to the file `npm run models:fetch`
 * writes; anything that looks like a path is taken as one, so a deployment can
 * point at a model on a mounted volume without copying it.
 */
export function modelPath() {
  const name = env.captions.model;
  if (name.includes('/') || name.endsWith('.bin')) {
    return isAbsolute(name) ? name : join(process.cwd(), name);
  }
  return join(env.captions.modelsDir, `ggml-${name}.bin`);
}

/**
 * Loads the native addon, once, and remembers why if it cannot.
 *
 * `smart-whisper` is an optional dependency: it needs a C++ toolchain at
 * install time, and on a machine that has none `npm install` succeeds without
 * it. Everything downstream has to cope with that rather than assume, which is
 * why this reports a reason instead of throwing.
 */
async function loadBinding() {
  if (binding !== null) return binding;

  try {
    binding = await import('smart-whisper');
    return binding;
  } catch (error) {
    binding = false;
    unavailable = 'The speech recogniser is not installed on this server.';
    logger.warn('whisper binding unavailable', { message: error.message });
    return binding;
  }
}

/**
 * The model, loaded on first use rather than at boot.
 *
 * Loading costs a couple of hundred milliseconds and a few hundred megabytes of
 * resident memory, and a deployment where nobody ever turns captions on should
 * pay neither. `offload` hands that memory back after a spell with no meetings
 * using it; the next utterance reloads it.
 */
export async function ensureEngine() {
  if (engine) return engine;
  if (loading) return loading;

  loading = (async () => {
    if (!env.captions.enabled) {
      unavailable = 'Captions are switched off on this server.';
      return null;
    }

    const module = await loadBinding();
    if (!module) return null;

    const file = modelPath();
    if (!existsSync(file)) {
      unavailable =
        `The speech model is missing. Run \`npm run models:fetch\` in backend/ to download "${env.captions.model}".`;
      logger.warn('whisper model missing', { file });
      return null;
    }

    try {
      engine = new module.Whisper(file, {
        /**
         * GPU off on purpose.
         *
         * `smart-whisper` picks Metal on Apple silicon and Accelerate
         * elsewhere; asking for a GPU that is not there costs a failed
         * initialisation and a fallback on the first call of every meeting.
         * The build already links the right BLAS for the platform, which is
         * where the speed on a CPU actually comes from.
         */
        gpu: false,
        // Ten minutes. Long enough that a meeting never pays a reload mid-call,
        // short enough that an idle server gives the memory back.
        offload: 600,
      });

      // Paid once, here, rather than inside the first person's first sentence.
      await engine.load();

      unavailable = null;
      logger.info('speech recogniser ready', {
        model: env.captions.model,
        threads: env.captions.threads,
        language: env.captions.language,
        interim: env.captions.interim,
      });

      return engine;
    } catch (error) {
      engine = null;
      unavailable = `The speech model could not be loaded: ${error.message}`;
      logger.error('whisper model load failed', { file, message: error.message });
      return null;
    }
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/**
 * How much of whisper's 30-second window this clip actually needs.
 *
 * The encoder always runs over a fixed 30s window, padding whatever it is
 * given with silence — so a four-second utterance costs exactly as much as a
 * thirty-second one unless it is told otherwise. `audio_ctx` shortens the
 * window to fit, and on short utterances it is the single largest speed-up
 * available: measured on a six-core laptop it took a 4.4s clip from 14.6s to
 * 9.9s with no change to the text or the confidence.
 *
 * 1500 context frames cover 30 seconds, so 50 per second, plus a little
 * headroom so the last syllable is never sitting on the boundary.
 */
export function audioContextFor(samples, sampleRate = 16_000) {
  const seconds = samples / sampleRate;
  return Math.min(1500, Math.max(128, Math.ceil(seconds * 50) + 64));
}

/**
 * Queue one clip. Resolves to `{ text, language, confidence }`, or null if the
 * job was dropped or the recogniser is unavailable.
 *
 * `priority` is `final` for a completed utterance and `interim` for the
 * in-progress redraw of one. Only finals are ever stored, so only finals are
 * worth waiting for — interims are the first thing sacrificed when the machine
 * cannot keep up.
 */
export function transcribe(pcm, { language, priority = 'final', meetingCode = '' } = {}) {
  return new Promise((resolve) => {
    if (queue.length >= env.captions.maxQueue) {
      /**
       * Make room by abandoning the most disposable thing in the queue.
       *
       * The oldest interim, because an interim is a guess at a sentence that is
       * still being spoken — by the time the backlog clears, the final for that
       * same utterance has usually been queued behind it and says the same
       * thing properly. If there is no interim to drop, the *new* job is
       * refused rather than an older final: dropping finals to make room for
       * finals would put holes in the stored transcript in arrival order,
       * which is the one thing that must stay complete.
       */
      const index = queue.findIndex((job) => job.priority === 'interim');

      if (index === -1) {
        stats.dropped += 1;
        resolve(null);
        return;
      }

      const [victim] = queue.splice(index, 1);
      stats.dropped += 1;
      victim.resolve(null);
    }

    queue.push({
      pcm,
      language: language || env.captions.language,
      priority,
      meetingCode,
      enqueuedAt: Date.now(),
      resolve,
    });

    pump();
  });
}

async function pump() {
  if (running) return;
  running = true;

  try {
    while (queue.length > 0) {
      const job = queue.shift();

      /**
       * Too old to be worth saying.
       *
       * Checked here rather than on the way in, because a job is only late once
       * everything ahead of it has run. A caption for a sentence fifteen
       * seconds gone lands in the middle of a different conversation.
       */
      if (Date.now() - job.enqueuedAt > env.captions.staleMs) {
        stats.dropped += 1;
        job.resolve(null);
        continue;
      }

      const instance = await ensureEngine();
      if (!instance) {
        job.resolve(null);
        continue;
      }

      const startedAt = Date.now();

      try {
        const task = await instance.transcribe(job.pcm, {
          format: 'detail',
          language: job.language,
          n_threads: env.captions.threads,
          audio_ctx: audioContextFor(job.pcm.length),
          /**
           * Each utterance is decoded on its own, with no memory of the last.
           *
           * Whisper's default carries the previous window's text forward as a
           * prompt, which is right for a continuous recording and wrong here:
           * our clips are separated by silence and often by a change of
           * speaker, and carrying context across that boundary is what makes
           * the decoder repeat the last sentence back when it hears nothing.
           */
          no_context: true,
          no_timestamps: true,
          suppress_blank: true,
          suppress_non_speech_tokens: true,
          print_progress: false,
          print_realtime: false,
          print_timestamps: false,
          print_special: false,
        });

        const results = await task.result;

        /**
         * `smart-whisper` keeps every task's promise in an array it never
         * empties, so a server transcribing an utterance every few seconds
         * leaks one settled promise per utterance for as long as it runs. They
         * are all settled by the time we get here — the array exists so `free`
         * can wait for in-flight work, and there is none.
         */
        if (Array.isArray(instance.tasks)) instance.tasks.length = 0;

        const text = results.map((result) => result.text).join(' ');
        // The whole clip is one utterance, so the per-segment confidences are
        // averaged rather than picking one of them.
        const confidence = results.length
          ? results.reduce((sum, result) => sum + (result.confidence ?? 0), 0) / results.length
          : 0;

        const inferenceMs = Date.now() - startedAt;
        stats.completed += 1;
        stats.totalInferenceMs += inferenceMs;
        stats.totalAudioMs += (job.pcm.length / 16_000) * 1000;

        job.resolve({
          text,
          language: results[0]?.lang ?? '',
          confidence,
          inferenceMs,
        });
      } catch (error) {
        stats.failed += 1;
        logger.warn('transcription failed', {
          meetingCode: job.meetingCode,
          message: error.message,
        });
        job.resolve(null);
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Can this server caption, without loading a model to find out?
 *
 * The client asks whether to offer the control, on every meeting page, and
 * loading a few hundred megabytes of weights to answer would be absurd. Both
 * things that can be missing are cheap to check: the native addon is an import,
 * and the model is a file on disk.
 *
 * It sets the same `unavailable` reason `ensureEngine` would, so a caller never
 * gets "not available" with nothing to act on — which is precisely what this
 * used to do on a server that had not yet been asked to transcribe anything.
 */
async function checkReady() {
  if (!env.captions.enabled) {
    unavailable = 'Captions are switched off on this server.';
    return false;
  }

  if (!(await loadBinding())) return false;

  if (!existsSync(modelPath())) {
    unavailable =
      `The speech model is missing. Run \`npm run captions:model\` in backend/ to download "${env.captions.model}".`;
    return false;
  }

  unavailable = null;
  return true;
}

/**
 * What the recogniser can do right now, for the admin console and for the
 * client — which has to know before it starts capturing anybody's microphone
 * whether there is anything on the other end to receive it.
 *
 * `probe` loads the model, and is for the moment somebody actually turns
 * captions on: then "it will work" has to be true rather than likely. Without
 * it this is a cheap readiness check.
 */
export async function status({ probe = false } = {}) {
  if (probe) await ensureEngine();

  // `available` is "this server can caption", not "the model is resident" —
  // the model loads on demand and unloads when idle, and neither is a fault.
  const ready = engine ? true : await checkReady();

  // `realtimeFactor` above 1 means recognition is slower than speech, which is
  // the number that decides whether interim captions are affordable here.
  const realtimeFactor = stats.totalAudioMs > 0
    ? Number((stats.totalInferenceMs / stats.totalAudioMs).toFixed(2))
    : null;

  return {
    available: ready,
    loaded: Boolean(engine),
    enabled: env.captions.enabled,
    reason: ready ? null : (unavailable ?? 'The speech recogniser is not available on this server.'),
    model: env.captions.model,
    language: env.captions.language,
    threads: env.captions.threads,
    interim: env.captions.interim,
    maxUtteranceMs: env.captions.maxUtteranceMs,
    queued: queue.length,
    ...stats,
    realtimeFactor,
  };
}

/** Releases the model and refuses whatever was still waiting. */
export async function closeWhisper() {
  while (queue.length > 0) queue.shift().resolve(null);

  const instance = engine;
  engine = null;

  if (instance) await instance.free().catch(() => {});
}

export default { ensureEngine, transcribe, status, closeWhisper, modelPath, audioContextFor };
