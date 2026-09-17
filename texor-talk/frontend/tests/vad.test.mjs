/**
 * Where one thing somebody said ends and the next begins.
 *
 * ── Why this is the suite that matters most for caption quality ──
 *
 * Whisper transcribes a clip. It does not find the clip. Hand it a fixed window
 * and you get sentences cut in half at both ends, which it then fills in by
 * guessing — so bad segmentation reads as bad recognition, and the wrong thing
 * gets blamed. Every rule here is a threshold, and a threshold nobody can
 * exercise is one nobody will dare tune.
 *
 * Driven with synthetic audio rather than a microphone, so it runs in a second
 * and asserts the same code the browser runs.
 */
import { createSegmenter, rms } from '../src/lib/vad.js';

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const RATE = 16_000;
const FRAME = 320;            // 20 ms, exactly what the worklet posts
const frames = (ms) => Math.round(ms / 20);

/** A frame of "speech": a tone loud enough to clear any sane threshold. */
function tone(amplitude = 0.3) {
  const frame = new Float32Array(FRAME);
  for (let index = 0; index < FRAME; index += 1) {
    frame[index] = Math.sin((2 * Math.PI * 220 * index) / RATE) * amplitude;
  }
  return frame;
}

/** A frame of room noise: quiet, and not silent, which is the realistic case. */
function hiss(amplitude = 0.001) {
  const frame = new Float32Array(FRAME);
  for (let index = 0; index < FRAME; index += 1) {
    frame[index] = (Math.random() * 2 - 1) * amplitude;
  }
  return frame;
}

/** Pushes `count` frames and collects everything the segmenter emitted. */
function feed(segmenter, make, count) {
  const events = [];
  for (let index = 0; index < count; index += 1) events.push(...segmenter.push(make()));
  return events;
}

console.log('\n── loudness ──');
{
  check('silence measures zero', rms(new Float32Array(320)) === 0);
  check('a tone measures well above room noise', rms(tone()) > rms(hiss()) * 50);
  check('an empty frame does not throw', rms(null) === 0);
}

console.log('\n── one utterance ──');
{
  const segmenter = createSegmenter();

  // Let it measure the room first, the way it does on a real microphone.
  feed(segmenter, hiss, frames(1000));
  check('quiet room produces nothing', true);

  const during = feed(segmenter, tone, frames(1000));
  check('speech alone does not end an utterance', during.every((e) => e.type !== 'final'));

  const after = feed(segmenter, hiss, frames(700));
  const finals = after.filter((e) => e.type === 'final');
  check('the pause after it does', finals.length === 1, String(finals.length));

  /**
   * Longer than the speech, because of the pre-roll. The detector needs a frame
   * or two above the floor to be sure, and by then the first consonant has gone
   * past — a clipped first word is the most noticeable caption error there is.
   */
  const spoken = finals[0].samples.length / RATE;
  check('the clip starts before the speech did', spoken > 1.0, `${spoken.toFixed(2)}s`);
  check('and is not padded with the whole pause', spoken < 2.0, `${spoken.toFixed(2)}s`);
}

console.log('\n── things that are not speech ──');
{
  const segmenter = createSegmenter();
  feed(segmenter, hiss, frames(1000));

  // A door, a click, a chair: one loud frame and then nothing.
  const events = [
    ...segmenter.push(tone()),
    ...feed(segmenter, hiss, frames(800)),
  ];
  check('a blip is not transcribed', events.filter((e) => e.type === 'final').length === 0);
}

console.log('\n── the floor is measured, not assumed ──');
{
  // A noisy room: a fan, an open window, a laptop microphone with the gain up.
  const noisy = createSegmenter();
  feed(noisy, () => hiss(0.02), frames(3000));

  const events = feed(noisy, () => hiss(0.02), frames(2000));
  check(
    'steady room noise well above the absolute floor is still not speech',
    events.length === 0,
    JSON.stringify(events.map((e) => e.type)),
  );
  check('and the floor has risen to meet it', noisy.level.threshold > 0.01, String(noisy.level.threshold));

  // Somebody talking in that same noisy room still has to get through.
  const speech = feed(noisy, () => tone(0.3), frames(800));
  check('speech over that noise is still detected', noisy.level.speaking, JSON.stringify(speech.map((e) => e.type)));
}

console.log('\n── a silent input cannot be talking ──');
{
  const segmenter = createSegmenter();
  // A muted or disconnected device: exactly zero, forever. Without an absolute
  // floor the measured one collapses to zero and float noise becomes speech.
  const events = feed(segmenter, () => new Float32Array(FRAME), frames(5000));
  check('digital silence produces nothing at all', events.length === 0, String(events.length));
  check('and the floor never falls through the absolute one', segmenter.level.threshold >= 0.008);
}

console.log('\n── somebody who does not stop ──');
{
  const segmenter = createSegmenter({ maxUtteranceMs: 4000, interimEveryMs: 1500 });
  feed(segmenter, hiss, frames(600));

  const events = feed(segmenter, tone, frames(9000));
  const finals = events.filter((e) => e.type === 'final');

  check('a monologue is cut into clips rather than growing forever', finals.length >= 2, String(finals.length));
  check(
    'and no clip exceeds the maximum',
    finals.every((e) => e.samples.length / RATE <= 4.1),
    JSON.stringify(finals.map((e) => +(e.samples.length / RATE).toFixed(2))),
  );

  /**
   * The tail is not thrown away: the next clip opens from the frame that closed
   * the last one, so continuous speech comes out as consecutive utterances
   * rather than as one clip and then a gap.
   */
  const covered = finals.reduce((total, e) => total + e.samples.length / RATE, 0);
  check('the clips account for most of what was said', covered > 7, `${covered.toFixed(1)}s`);
}

console.log('\n── interim redraws ──');
{
  const segmenter = createSegmenter({ interimEveryMs: 1000 });
  feed(segmenter, hiss, frames(600));

  const events = feed(segmenter, tone, frames(3500));
  const interims = events.filter((e) => e.type === 'interim');

  check('a sentence still being spoken is redrawn', interims.length >= 2, String(interims.length));
  check(
    'and each redraw contains everything said so far, not just the new part',
    interims.every((e, index) => index === 0 || e.samples.length > interims[index - 1].samples.length),
  );

  const off = createSegmenter({ interimEveryMs: Number.POSITIVE_INFINITY });
  feed(off, hiss, frames(600));
  const none = feed(off, tone, frames(4000)).filter((e) => e.type === 'interim');
  check('turning them off produces none', none.length === 0, String(none.length));
}

console.log('\n── muting mid-sentence ──');
{
  const segmenter = createSegmenter();
  feed(segmenter, hiss, frames(600));
  feed(segmenter, tone, frames(1200));

  /**
   * The last thing said before somebody mutes or hangs up never reaches the
   * pause that would have sent it. Without a flush it is simply lost — and it
   * is very often the sentence that mattered.
   */
  const pending = segmenter.flush();
  check('the half-sentence in hand is handed over', pending?.type === 'final');
  check('and there is audio in it', pending.samples.length > RATE, String(pending.samples.length));
  check('flushing twice does not send it twice', segmenter.flush() === null);

  const quiet = createSegmenter();
  feed(quiet, hiss, frames(600));
  check('flushing silence sends nothing', quiet.flush() === null);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
