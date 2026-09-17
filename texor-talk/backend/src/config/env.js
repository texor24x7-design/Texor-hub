/**
 * Environment loading and validation for Texor Talk.
 */
import { cpus } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const csv = (value) => (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4002),

  APP_ORIGIN: z.url(),
  CORS_ORIGINS: z.string().default(''),

  MONGODB_URI: z.string().min(1),

  TEXOR_ISSUER: z.url(),
  TEXOR_CLIENT_ID: z.string().min(1),
  TEXOR_CLIENT_SECRET: z.string().min(1, 'Run `npm run seed` in texor-accounts to get a client secret.'),
  TEXOR_REDIRECT_URI: z.url(),
  TEXOR_SCOPE: z.string().default('openid profile email offline_access'),
  TEXOR_RESOURCE: z.string().optional(),

  COOKIE_SECRET: z.string().min(8),
  COOKIE_DOMAIN: z.string().default(''),

  // ── Media (the SFU that runs inside this process) ──────────────────────────
  // The address participants' browsers send their audio and video to. In
  // development that is this machine; in production it must be the server's
  // public address, because it is written into the ICE candidates the browser
  // is told to connect to — an internal address there means media never arrives.
  MEDIA_ANNOUNCED_ADDRESS: z.string().default('127.0.0.1'),
  // The UDP/TCP range the SFU binds for media. Must be open in the firewall.
  MEDIA_RTC_MIN_PORT: z.coerce.number().int().min(1024).max(65535).default(40000),
  MEDIA_RTC_MAX_PORT: z.coerce.number().int().min(1024).max(65535).default(40100),
  // One mediasoup worker is a single CPU core. Defaults to the machine's count.
  MEDIA_WORKERS: z.coerce.number().int().min(1).max(64).optional(),
  MEDIA_LOG_LEVEL: z.enum(['debug', 'warn', 'error', 'none']).default('warn'),
  /**
   * Bitrate is deliberately *not* here.
   *
   * It used to be two env vars, which meant changing what a meeting costs
   * required a deploy and applied to every meeting in the organisation at once.
   * It now lives in `services/quality.service.js` as named tiers: an admin sets
   * the ceiling, a host picks within it, per meeting, while the call is running.
   */

  // ── Captions (the speech recogniser that runs inside this process) ─────────
  /**
   * Same principle as the SFU above: whisper.cpp is compiled into
   * `node_modules` by `npm install` and run in this process. There is no speech
   * API to sign up for, no key, and no audio leaving the deployment.
   *
   * It is an *optional* dependency, so a machine without a C++ toolchain still
   * installs and runs — captions simply report themselves unavailable rather
   * than taking the product down with them.
   */
  CAPTIONS_ENABLED: z.stringbool().default(true),
  // A ggml model file. `npm run models:fetch` downloads it.
  WHISPER_MODEL: z.string().default('base'),
  WHISPER_MODELS_DIR: z.string().default('.models'),
  /**
   * `auto` detects the language per utterance, which is the only setting that
   * works for a meeting where people code-switch mid-sentence. Pin it to a
   * language code only when a deployment is genuinely monolingual — it is
   * faster and slightly more accurate when it is true, and quietly wrong when
   * it is not.
   */
  WHISPER_LANGUAGE: z.string().default('auto'),
  // Defaults to the machine's *physical* cores. Hyperthreads do not help ggml
  // and oversubscribing measurably hurts it.
  WHISPER_THREADS: z.coerce.number().int().min(1).max(64).optional(),
  /**
   * Interim captions: re-transcribing the utterance so far, every couple of
   * seconds, so words appear while somebody is still speaking rather than only
   * once they stop. It multiplies the CPU cost of every utterance, so it is the
   * first thing to turn off on a machine that cannot keep up.
   */
  CAPTIONS_INTERIM: z.stringbool().default(true),
  // How far behind the recogniser may fall before it starts dropping work.
  // Captions that arrive a minute late are worse than captions that are missing.
  CAPTIONS_MAX_QUEUE: z.coerce.number().int().min(1).max(200).default(12),
  CAPTIONS_STALE_MS: z.coerce.number().int().min(1000).default(15_000),
  // The longest single utterance the segmenter will send. Whisper's window is
  // 30s and anything approaching it is both slow and less accurate.
  CAPTIONS_MAX_UTTERANCE_MS: z.coerce.number().int().min(1000).max(30_000).default(10_000),

  // ── Meetings ───────────────────────────────────────────────────────────────
  // How early a guest may join a scheduled meeting. Hosts are never held back.
  MEETING_JOIN_EARLY_MINUTES: z.coerce.number().int().min(0).default(15),
  // How long a meeting may sit with nobody in it before it closes itself out,
  // and the grace period before a peer whose socket vanished is written off.
  MEETING_HEARTBEAT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(90),

  // ── Administration ─────────────────────────────────────────────────────────
  // Seeds the admin set. Whoever is listed here can always reach the admin
  // console, which is what stops a bad policy edit from locking everyone out.
  ADMIN_EMAILS: z.string().default(''),
  // Email domains treated as internal. Anyone else is an external guest, and
  // the external-guest policy applies to them.
  ORG_EMAIL_DOMAINS: z.string().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
}

const raw = parsed.data;

const lower = (values) => values.map((value) => value.toLowerCase());

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  appOrigin: raw.APP_ORIGIN.replace(/\/$/, ''),
  corsOrigins: csv(raw.CORS_ORIGINS),
  cookieDomain: raw.COOKIE_DOMAIN || undefined,

  adminEmails: lower(csv(raw.ADMIN_EMAILS)),
  orgEmailDomains: lower(csv(raw.ORG_EMAIL_DOMAINS)).map((domain) => domain.replace(/^@/, '')),

  captions: {
    enabled: raw.CAPTIONS_ENABLED,
    model: raw.WHISPER_MODEL,
    modelsDir: isAbsolute(raw.WHISPER_MODELS_DIR)
      ? raw.WHISPER_MODELS_DIR
      : resolve(process.cwd(), raw.WHISPER_MODELS_DIR),
    language: raw.WHISPER_LANGUAGE,
    /**
     * Physical cores, not logical ones.
     *
     * `cpus().length` counts hyperthreads, and handing ggml twice the threads
     * there are cores makes it slower rather than faster — the kernels are
     * already saturating each core's vector units, so the extra threads only
     * add contention. There is no portable way to ask for physical cores in
     * Node, and half the logical count is right on every machine that reports
     * hyperthreads and merely conservative on the ones that do not.
     */
    threads: raw.WHISPER_THREADS ?? Math.max(1, Math.floor(cpus().length / 2)),
    interim: raw.CAPTIONS_INTERIM,
    maxQueue: raw.CAPTIONS_MAX_QUEUE,
    staleMs: raw.CAPTIONS_STALE_MS,
    maxUtteranceMs: raw.CAPTIONS_MAX_UTTERANCE_MS,
  },

  media: {
    announcedAddress: raw.MEDIA_ANNOUNCED_ADDRESS,
    rtcMinPort: raw.MEDIA_RTC_MIN_PORT,
    rtcMaxPort: raw.MEDIA_RTC_MAX_PORT,
    workers: raw.MEDIA_WORKERS ?? Math.max(1, cpus().length),
    logLevel: raw.MEDIA_LOG_LEVEL,
    /**
     * Announcing a loopback or private address works on one machine and fails
     * the moment a second device joins, in a way that looks like "everyone
     * connects and nobody can hear anything". Worth saying out loud at boot.
     */
    isLocalOnly: /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$)/.test(
      raw.MEDIA_ANNOUNCED_ADDRESS,
    ),
  },
};

export default env;
