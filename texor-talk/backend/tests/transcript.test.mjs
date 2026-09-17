/**
 * The transcript rules, and the wire format underneath them.
 *
 * ── Why this suite exists ──
 *
 * Whisper does not answer "nothing" for audio with no speech in it. It answers
 * with its best guess, and on silence that guess comes from the subtitle files
 * it was trained on — so an unfiltered transcript of a quiet meeting is page
 * after page of "Thank you." and "[BLANK_AUDIO]". Every rule that stops that is
 * a threshold, and a threshold nobody can exercise is one nobody will dare
 * change.
 *
 * The second half checks the audio frame format against the *browser's* own
 * encoder rather than against a copy of it. A format agreed in two files and
 * verified in neither is how captions end up silently never appearing.
 */
import { decodeAudioFrame } from '../src/media/audio-frame.js';
import {
  clock,
  collapseRepeats,
  countWords,
  isNoise,
  languagesIn,
  mergeSegments,
  normaliseText,
  renderTranscript,
  renderTranscriptFile,
  toSegment,
} from '../src/utils/transcript.js';

const FE = new URL('../../frontend/', import.meta.url).pathname.replace(/\/$/, '');
const { encodeAudioFrame } = await import(`${FE}/src/lib/captions.js`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

console.log('\n── cleaning up what the recogniser returns ──');
{
  check('the leading space whisper pads with goes', normaliseText(' hello there') === 'hello there');
  check('bracketed non-speech is removed', normaliseText('[BLANK_AUDIO]') === '');
  check(
    'and removed from around real speech',
    normaliseText('[Music] so as I was saying') === 'so as I was saying',
    normaliseText('[Music] so as I was saying'),
  );
  check('music notes go too', normaliseText('♪♪♪') === '');
  check('non-Latin text is untouched', normaliseText(' endhuko telidu ') === 'endhuko telidu');
}

console.log('\n── the decoder getting stuck in a loop ──');
{
  check('a plausible repeat survives', collapseRepeats('no no no yes') === 'no no no yes');
  check(
    'an implausible one is cut back',
    collapseRepeats('no no no no no no no yes') === 'no no no yes',
    collapseRepeats('no no no no no no no yes'),
  );
  check('spacing is not left broken', !/ {2}/.test(collapseRepeats('a a a a a b')));
}

console.log('\n── hallucinations on silence ──');
{
  check('blank audio is noise', isNoise('[BLANK_AUDIO]', { confidence: 1, durationMs: 2000 }));
  check('empty is noise', isNoise('   ', { confidence: 1, durationMs: 2000 }));
  check('punctuation alone is noise', isNoise('...', { confidence: 0.9, durationMs: 2000 }));

  /**
   * The filler list only applies when something else already says the audio was
   * thin. "Thank you" is a thing people say in meetings, and a caption layer
   * that refuses to transcribe it is worse than one that lets a stray through.
   */
  check('a short, unsure "thank you" is noise', isNoise('Thank you.', { confidence: 0.3, durationMs: 400 }));
  check(
    'a confident, spoken "thank you" is not',
    !isNoise('Thank you.', { confidence: 0.95, durationMs: 1500 }),
  );

  /**
   * The one a real check caught: two seconds of digital silence came back as
   * " you", confidently. Not unsure, not short, and an ordinary English word —
   * every other rule here passes it. What gives it away is that one short word
   * stretched over two seconds is not speech, it is a void being filled.
   */
  check('a lone filler word stretched over a long clip is noise', isNoise(' you', { confidence: 0.95, durationMs: 2000 }));
  check(
    'but a filler said at a normal pace is not',
    !isNoise('Thank you.', { confidence: 0.9, durationMs: 1400 }),
  );
  check('and a real word alone is still kept', !isNoise('Margin.', { confidence: 0.9, durationMs: 2000 }));

  // The strongest signal: text that could not fit in the audio it came from.
  check(
    'more words than the clip could hold is noise',
    isNoise('thanks for watching and I will see you in the next one', { confidence: 0.9, durationMs: 800 }),
  );
  check(
    'a normal sentence at a normal pace is not',
    !isNoise('The quarterly numbers look strong.', { confidence: 0.9, durationMs: 3000 }),
  );
}

console.log('\n── one utterance becoming a stored segment ──');
{
  const started = new Date('2026-09-17T10:00:05.000Z');
  const segment = toSegment({
    speakerTexorId: 'tx-surya',
    speakerName: 'surya',
    text: ' endhuko telidu. ',
    language: 'te',
    confidence: 0.82,
    startedAt: started,
    durationMs: 1800,
    offsetMs: 5000,
  });

  check('it is kept', Boolean(segment));
  check('the text is cleaned', segment.text === 'endhuko telidu.', segment.text);
  check('the detected language is carried', segment.language === 'te');
  check('the end is derived from the duration', +segment.endedAt === +started + 1800);
  check('noise returns null instead of an empty segment', toSegment({ text: '[BLANK_AUDIO]', confidence: 1, durationMs: 900, startedAt: started }) === null);
}

console.log('\n── the conversation ──');
{
  const base = new Date('2026-09-17T10:00:00.000Z');
  const at = (seconds, ms = 1200) => ({
    startedAt: new Date(+base + seconds * 1000),
    endedAt: new Date(+base + seconds * 1000 + ms),
    durationMs: ms,
    offsetMs: seconds * 1000,
  });

  const segments = [
    { speakerTexorId: 'tx-s', speakerName: 'surya', text: 'endhuko telidu.', language: 'te', ...at(3) },
    { speakerTexorId: 'tx-s', speakerName: 'surya', text: 'Really no idea.', language: 'en', ...at(5) },
    { speakerTexorId: 'tx-j', speakerName: 'john', text: "I don't know either.", language: 'en', ...at(9) },
    { speakerTexorId: 'tx-s', speakerName: 'surya', text: 'Fine.', language: 'en', ...at(40) },
  ];

  const lines = mergeSegments(segments);
  check('consecutive utterances from one person become one turn', lines.length === 3, String(lines.length));
  check('and their text is joined', lines[0].text === 'endhuko telidu. Really no idea.', lines[0].text);
  check('both languages are recorded on the turn', lines[0].languages.join(',') === 'te,en');
  check('a long gap starts a new turn even for the same person', lines[2].speakerName === 'surya');

  const rendered = renderTranscript(segments);
  const expected = [
    'surya: endhuko telidu. Really no idea.',
    "john: I don't know either.",
    'surya: Fine.',
  ].join('\n');
  check('it renders as the conversation', rendered === expected, JSON.stringify(rendered));

  const stamped = renderTranscript(segments, { timestamps: true });
  check('timestamps are offsets into the meeting', stamped.startsWith('[0:03] surya:'), stamped.split('\n')[0]);

  check('languages come back most-spoken first', languagesIn(segments).join(',') === 'en,te');
  check('words are counted across every utterance', countWords(segments) === 10, String(countWords(segments)));

  const file = renderTranscriptFile({
    meetingTitle: 'Q3 numbers',
    meetingStartedAt: base,
    segments,
  });
  check('the file names the meeting', file.includes('Q3 numbers'));
  check('the file says how many languages were heard', file.includes('languages: en, te'));
  check('and it contains the conversation', file.includes('surya: endhuko telidu.'));
}

console.log('\n── the clock ──');
{
  check('under an hour it is m:ss', clock(63_000) === '1:03', clock(63_000));
  check('over an hour it grows a field', clock(3_723_000) === '1:02:03', clock(3_723_000));
  check('negative is clamped rather than rendered', clock(-5) === '0:00', clock(-5));
}

console.log('\n── the audio frame, browser encoder to server decoder ──');
{
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const frame = decodeAudioFrame(Buffer.from(encodeAudioFrame({ utteranceId: '7', final: true }, samples)));

  check('it decodes at all', Boolean(frame));
  check('the header survives', frame.header.utteranceId === '7' && frame.header.final === true);
  check('the sample count is right', frame.samples === 5, String(frame.samples));

  // Int16 quantisation, so exact equality is the wrong test — within one step is.
  const close = samples.every((value, index) => Math.abs(value - frame.pcm[index]) < 1 / 32_000);
  check('the audio round-trips within a quantisation step', close, JSON.stringify([...frame.pcm]));

  check(
    'full scale is not wrapped around by the conversion',
    frame.pcm[3] > 0.99 && frame.pcm[4] < -0.99,
    `${frame.pcm[3]} ${frame.pcm[4]}`,
  );

  /**
   * The duration is the server's, computed from the sample count. A client
   * asserting its own would be asserting a field that lands in a permanent
   * record of who said what and when.
   */
  const second = decodeAudioFrame(
    Buffer.from(encodeAudioFrame({ utteranceId: '1', final: true, durationMs: 999_999 }, new Float32Array(16_000))),
  );
  check('a second of audio is a second, whatever the header claims', second.durationMs === 1000, String(second.durationMs));
}

console.log('\n── frames that are not ours ──');
{
  check('empty is refused', decodeAudioFrame(Buffer.alloc(0)) === null);
  check('a truncated frame is refused', decodeAudioFrame(Buffer.from([0, 0, 0, 40, 1, 2])) === null);

  const lying = Buffer.alloc(8);
  lying.writeUInt32BE(0xffffffff, 0);
  check('an absurd header length is refused, not read past', decodeAudioFrame(lying) === null);

  const notJson = Buffer.concat([Buffer.from([0, 0, 0, 3]), Buffer.from('abc'), Buffer.alloc(4)]);
  check('a header that is not JSON is refused', decodeAudioFrame(notJson) === null);

  const odd = Buffer.concat([Buffer.from([0, 0, 0, 2]), Buffer.from('{}'), Buffer.alloc(3)]);
  check('an odd number of audio bytes is refused', decodeAudioFrame(odd) === null);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
