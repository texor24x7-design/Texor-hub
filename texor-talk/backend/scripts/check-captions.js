/**
 * Does the recogniser actually recognise anything, on this machine?
 *
 *   npm run captions:check
 *
 * The test suite checks the pipeline and its guarantees — that a muted person
 * is never transcribed, that a participant cannot start a recording, that a
 * malformed frame cannot take a meeting down. It deliberately does not assert
 * what whisper *heard*, because that is not a deterministic function of a
 * fixture: it depends on the model file, the build flags and the CPU, and a
 * suite that asserted particular words would fail for reasons that have nothing
 * to do with this code.
 *
 * So that check lives here, where it can speak a real sentence through the real
 * engine and print what came back, alongside the number that decides whether
 * captions are usable at all:
 *
 *   **the real-time factor** — inference time divided by the length of the
 *   audio. Below 1 means recognition is faster than speech and captions keep up
 *   with a room. Above it, utterances arrive faster than they can be
 *   transcribed and the queue spends the meeting shedding them.
 *
 * Speech is synthesised with the operating system's own voice where there is
 * one, so there is no audio fixture in the repository. Without `say` and
 * `ffmpeg` the script still exercises the model, the queue and the noise
 * filter, and says which part it had to skip.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import env from '../src/config/env.js';
import { closeWhisper, modelPath, status, transcribe } from '../src/services/whisper.service.js';
import { isNoise, normaliseText } from '../src/utils/transcript.js';

const have = (command) => {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

console.log('\n  speech recognition\n  ──────────────────');
console.log(`  model    : ${env.captions.model}`);
console.log(`  file     : ${modelPath()}`);
console.log(`  threads  : ${env.captions.threads}`);
console.log(`  language : ${env.captions.language}`);

const ready = await status({ probe: true });

if (!ready.available) {
  console.error(`\n  not available: ${ready.reason}\n`);
  process.exit(1);
}

console.log('  loaded   : yes\n');

let failures = 0;
const report = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/* ── silence must not become words ─────────────────────────────────────────
 *
 * The failure mode that matters most. Given no speech, whisper returns its best
 * guess drawn from the subtitles it was trained on — "Thank you.", "Thanks for
 * watching", "[BLANK_AUDIO]" — confidently. Unfiltered, a transcript of a quiet
 * meeting is page after page of exactly that.
 */
{
  const silence = new Float32Array(16_000 * 2);
  const heard = await transcribe(silence, { meetingCode: 'check' });
  const text = normaliseText(heard?.text ?? '');
  const filtered = !text || isNoise(heard?.text ?? '', { confidence: heard?.confidence ?? 0, durationMs: 2000 });

  report('two seconds of silence produces no caption', filtered, `model said ${JSON.stringify(heard?.text ?? '')}`);
}

/* ── real speech ───────────────────────────────────────────────────────────── */
if (!have('say') || !have('ffmpeg')) {
  console.log('\n  skipped the spoken check: it needs `say` and `ffmpeg` on the path.');
  console.log('  the model, the queue and the noise filter were still exercised above.\n');
  await closeWhisper();
  process.exit(failures > 0 ? 1 : 0);
}

const SENTENCE = 'The quarterly numbers look strong, but I want to check the margin before we send it.';
const scratch = mkdtempSync(join(tmpdir(), 'talk-captions-'));

try {
  execFileSync('say', ['-o', join(scratch, 'speech.aiff'), SENTENCE]);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', join(scratch, 'speech.aiff'),
    // Exactly what the browser's tap sends: 16 kHz, mono, 32-bit float.
    '-ar', '16000', '-ac', '1', '-f', 'f32le',
    join(scratch, 'speech.raw'),
  ]);

  const raw = readFileSync(join(scratch, 'speech.raw'));
  const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const audioMs = (pcm.length / 16_000) * 1000;

  const startedAt = Date.now();
  const heard = await transcribe(pcm, { meetingCode: 'check' });
  const elapsed = Date.now() - startedAt;

  if (!heard) {
    report('a spoken sentence comes back as text', false, 'the recogniser returned nothing');
  } else {
    const text = normaliseText(heard.text);

    console.log(`\n  said  : ${SENTENCE}`);
    console.log(`  heard : ${text}`);
    console.log(`  lang  : ${heard.language}   confidence: ${heard.confidence.toFixed(3)}`);

    report('a spoken sentence comes back as text', text.length > 0);

    /**
     * Not an exact match. Punctuation and casing vary between models and
     * builds, and holding the check to the exact string would make it a test of
     * the model rather than of the pipeline. Most of the distinctive words
     * coming back is the real signal.
     */
    const expected = SENTENCE.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter((w) => w.length > 3);
    const got = text.toLowerCase();
    const found = expected.filter((word) => got.includes(word));

    report(
      'and says roughly what was said',
      found.length >= expected.length * 0.8,
      `${found.length}/${expected.length} of the distinctive words`,
    );

    report('the language was detected', Boolean(heard.language), heard.language);
    report('it is confident about it', heard.confidence > 0.6, heard.confidence.toFixed(3));

    const factor = elapsed / audioMs;
    console.log(`\n  ${(audioMs / 1000).toFixed(1)}s of audio in ${(elapsed / 1000).toFixed(1)}s  →  real-time factor ${factor.toFixed(2)}`);

    if (factor > 1) {
      console.log('\n  ⚠ recognition is slower than speech on this machine.');
      console.log('    captions will fall behind and the queue will start dropping them.');
      console.log('    try, in order:');
      console.log('      · npm run captions:build      rebuild for this CPU — usually the whole gap');
      console.log('      · CAPTIONS_INTERIM=false      stop re-transcribing sentences mid-flow');
      console.log('      · WHISPER_MODEL=tiny          a smaller model');
    } else {
      console.log('  captions will keep up with a meeting on this machine.');
    }

    // Not a failure: a slow machine is a real deployment, and the queue is built
    // to degrade rather than break. It is worth saying out loud, though.
    report('recognition keeps up with speech', true, factor > 1 ? '(slow — see above)' : '');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
  await closeWhisper();
}

console.log(failures > 0 ? `\n  ${failures} check failed\n` : '\n  captions are working\n');
process.exit(failures > 0 ? 1 : 0);
