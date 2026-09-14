/**
 * The mediasoup worker pool.
 *
 * This is the media server. It is not a service we call out to — it is C++
 * worker processes that this Node process spawns and owns, from the `mediasoup`
 * package in `node_modules`. Texor Talk depends on no meeting infrastructure
 * outside itself.
 *
 * One worker is one CPU core, and a worker cannot use more than one. So we run
 * a pool of them and hand each new meeting to the next in line — a single
 * worker would cap the whole product at one core's worth of media no matter how
 * big the machine.
 */
import * as mediasoup from 'mediasoup';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const workers = [];
let nextWorker = 0;
let starting = null;

/**
 * The codecs this SFU will route.
 *
 * An SFU forwards packets without decoding them, so this list is not about what
 * the server can encode — it is the vocabulary browsers have to agree with it
 * in. Opus for audio; VP8, VP9 and H264 for video, because no single video
 * codec is supported everywhere and leaving one out means a browser that cannot
 * send video at all.
 */
export const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      // Lets the browser tell the SFU its bandwidth estimate, which is what
      // makes layer switching react to a bad connection rather than to nothing.
      'x-google-start-bitrate': 1000,
    },
  },
  {
    kind: 'video',
    mimeType: 'video/VP9',
    clockRate: 90000,
    parameters: { 'profile-id': 2, 'x-google-start-bitrate': 1000 },
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      // Constrained Baseline 3.1 — the profile that hardware decoders on phones
      // and older laptops actually implement.
      'profile-level-id': '4d0032',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000,
    },
  },
];

/**
 * Starts the pool. Idempotent, and safe to call from more than one place at
 * once — the in-flight promise is shared rather than starting a second pool.
 */
export function startWorkers() {
  if (starting) return starting;

  starting = (async () => {
    const count = env.media.workers;

    for (let index = 0; index < count; index += 1) {
      const worker = await mediasoup.createWorker({
        logLevel: env.media.logLevel,
        rtcMinPort: env.media.rtcMinPort,
        rtcMaxPort: env.media.rtcMaxPort,
      });

      /**
       * A dead worker takes every meeting on it with it. There is no way to
       * recover those calls in place, so the honest response is to say so
       * loudly and stop — a process that limps on with a third of its media
       * capacity silently gone is worse than one that restarts.
       */
      worker.on('died', (error) => {
        logger.error('mediasoup worker died', {
          pid: worker.pid,
          message: error?.message,
        });
        process.exit(1);
      });

      workers.push(worker);
    }

    logger.info('media workers started', {
      workers: workers.length,
      pids: workers.map((worker) => worker.pid),
      rtcPorts: `${env.media.rtcMinPort}-${env.media.rtcMaxPort}`,
      announcedAddress: env.media.announcedAddress,
    });

    if (env.media.isLocalOnly && env.isProduction) {
      logger.warn(
        'MEDIA_ANNOUNCED_ADDRESS is a local address in production — browsers on ' +
          'other machines will connect and then receive no audio or video. Set it ' +
          'to this server’s public address.',
        { announcedAddress: env.media.announcedAddress },
      );
    }

    return workers;
  })();

  return starting;
}

/** Round-robin, so meetings spread across cores instead of piling onto one. */
export function nextWorkerInPool() {
  if (workers.length === 0) throw new Error('Media workers have not been started.');

  const worker = workers[nextWorker];
  nextWorker = (nextWorker + 1) % workers.length;
  return worker;
}

export async function closeWorkers() {
  for (const worker of workers) worker.close();
  workers.length = 0;
  starting = null;
}

/** Reported on the admin console, so capacity is visible before it runs out. */
export async function workerStats() {
  return Promise.all(
    workers.map(async (worker) => ({
      pid: worker.pid,
      closed: worker.closed,
      usage: await worker.getResourceUsage().catch(() => null),
    })),
  );
}

export default { startWorkers, nextWorkerInPool, closeWorkers, workerStats, mediaCodecs };
