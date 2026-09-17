/**
 * Downloads the ggml speech model the recogniser runs on.
 *
 *   npm run captions:model            # the model named in .env
 *   npm run captions:model -- small   # or a specific one
 *
 * The weights are a few hundred megabytes and are not in the repository, which
 * is the one part of captions that `npm install` cannot do for you. Everything
 * else — whisper.cpp itself — is compiled from `node_modules`.
 *
 * ── Which model ──
 *
 *   tiny    75 MB   fastest, visibly weaker on accents and on anything but English
 *   base   148 MB   the default: multilingual, and real time on a modern CPU
 *   small  488 MB   better on accented and code-switched speech, ~3x the work
 *   medium 1.5 GB   better again, and needs a GPU to keep up with a meeting
 *
 * Use the plain names, not the `.en` ones, unless the deployment is certain to
 * be English-only — `.en` models cannot transcribe anything else at all, and
 * they fail by confidently producing English-looking nonsense rather than by
 * saying they cannot.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

const HOST = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

const KNOWN = [
  'tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en',
  'medium', 'medium.en', 'large-v1', 'large-v2', 'large-v3', 'large-v3-turbo',
];

const model = process.argv[2] ?? process.env.WHISPER_MODEL ?? 'base';
const dir = process.env.WHISPER_MODELS_DIR
  ? join(process.cwd(), process.env.WHISPER_MODELS_DIR)
  : join(process.cwd(), '.models');

if (!KNOWN.includes(model)) {
  console.error(`\n  "${model}" is not a whisper model.\n  Known: ${KNOWN.join(', ')}\n`);
  process.exit(1);
}

const target = join(dir, `ggml-${model}.bin`);
// Downloaded to one side and renamed on success, so an interrupted download
// never leaves a truncated file that loads as a corrupt model.
const partial = `${target}.part`;

const existing = await stat(target).catch(() => null);
if (existing) {
  console.log(`\n  ${model} is already here: ${target} (${(existing.size / 1e6).toFixed(0)} MB)\n`);
  process.exit(0);
}

await mkdir(dir, { recursive: true });

console.log(`\n  downloading ${model} from huggingface.co`);
console.log(`  to ${target}\n`);

const response = await fetch(`${HOST}/ggml-${model}.bin`);

if (!response.ok || !response.body) {
  console.error(`  download failed: ${response.status} ${response.statusText}\n`);
  process.exit(1);
}

const total = Number(response.headers.get('content-length') ?? 0);
let received = 0;
let lastShown = 0;

const source = Readable.fromWeb(response.body);

source.on('data', (chunk) => {
  received += chunk.length;
  // Only when the number has visibly moved — a progress line per chunk is tens
  // of thousands of lines of scrollback for one download.
  if (received - lastShown < 4_000_000) return;
  lastShown = received;

  const done = (received / 1e6).toFixed(0);
  const size = total ? `/${(total / 1e6).toFixed(0)} MB` : ' MB';
  process.stdout.write(`\r  ${done}${size}`);
});

try {
  await pipeline(source, createWriteStream(partial));
  await rename(partial, target);
} catch (error) {
  await unlink(partial).catch(() => {});
  console.error(`\n  download failed: ${error.message}\n`);
  process.exit(1);
}

console.log(`\r  ${model} ready — ${target}\n`);
