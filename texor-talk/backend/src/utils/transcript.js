/**
 * Turning what the recogniser heard into a conversation somebody can read.
 *
 * Its own module, with no imports, for the same reason `media/speaking.js` is:
 * every rule here is a pure function of text, and the bugs live in the rules
 * rather than in the plumbing. A hallucination filter that can only be
 * exercised by speaking into a microphone is one nobody will ever change
 * safely.
 *
 * ── Why any of this is needed ──
 *
 * Whisper does not return "nothing" for audio that contains no speech. It
 * returns its best guess, and on silence, breath, a keyboard or a fan that
 * guess is drawn from the most common phrases in its training data — subtitle
 * files. So a muted-but-not-quite room produces "Thank you.", "Thanks for
 * watching!" and "[BLANK_AUDIO]", confidently, forever. Left unfiltered a
 * stored transcript is mostly that, and the feature reads as broken even though
 * the recognition is working exactly as documented.
 */

/**
 * Non-speech annotations the model emits as bracketed text.
 *
 * These are real output, not markers we can switch off: whisper's training data
 * is subtitles, and subtitles annotate music and applause this way. Removed
 * rather than rejected outright, because `[Music] so as I was saying` is a real
 * sentence with a label stuck to the front of it.
 */
const ANNOTATION = /[[(（【]\s*(blank[_ ]?audio|silence|music|musique|applause|laughter|inaudible|noise|sound|speaking in [a-z ]+|foreign)\s*[\])）】]/gi;

/** Bars of music, which arrive as literal note characters rather than words. */
const MUSIC_NOTES = /[♪♫🎵🎶]/g;

/**
 * Phrases the model falls back on when it is given no speech at all.
 *
 * Deliberately *not* rejected on sight — every one of them is also something a
 * person says in a meeting, and a caption layer that silently refuses to
 * transcribe "thank you" is worse than one that occasionally lets a stray one
 * through. They are only dropped when the rest of the evidence already says
 * this was not speech; see `isNoise`.
 */
const FILLER = new Set([
  'thank you',
  'thanks for watching',
  'thank you for watching',
  'thanks for watching!',
  'please subscribe',
  'subscribe to my channel',
  'bye',
  'bye.',
  'you',
  'the',
  'so',
  'okay',
  'oh',
  'hmm',
  'um',
  'uh',
  '.',
  'amara.org',
  'subtitles by the amara.org community',
  'transcription by castingwords',
]);

/** Everything a language might end a sentence with, for the joining rules. */
const SENTENCE_END = /[.!?。！？…]$/;

/**
 * Strips the annotations and normalises the spacing, without touching words.
 *
 * Nothing here is language-aware on purpose. The product transcribes whatever
 * was spoken, in whatever language, and a "clean-up" that knows English
 * punctuation would quietly mangle Telugu, Japanese or Arabic.
 */
export function normaliseText(raw) {
  return String(raw ?? '')
    .replace(ANNOTATION, ' ')
    .replace(MUSIC_NOTES, ' ')
    // Whisper pads almost every segment with a leading space.
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Collapses a word repeated past the point of plausibility.
 *
 * The other half of the hallucination problem: given a long stretch of
 * near-silence the decoder can fall into a loop and return the same token
 * forty times. Three in a row is something a person can say — "no, no, no" —
 * and beyond that it is the model stuck, so the run is cut back to three
 * rather than thrown away.
 */
export function collapseRepeats(text, limit = 3) {
  const words = String(text ?? '').split(/(\s+)/);
  const out = [];
  let previous = null;
  let run = 0;

  for (const part of words) {
    if (/^\s*$/.test(part)) {
      // Whitespace rides along with whatever word preceded it, so dropping a
      // repeat does not leave a double space behind.
      if (run <= limit) out.push(part);
      continue;
    }

    const key = part.toLowerCase().replace(/[.,!?;:]+$/, '');
    run = key === previous ? run + 1 : 1;
    previous = key;

    if (run <= limit) out.push(part);
  }

  return out.join('').replace(/\s+/g, ' ').trim();
}

/**
 * Whether this hypothesis should be thrown away rather than shown to anybody.
 *
 * Three independent signals, and the filler list is only consulted once one of
 * the others already says the audio was thin:
 *
 *   · nothing survived normalisation, or what did is only punctuation
 *   · the model itself is unsure — `confidence` is the mean token probability,
 *     and genuine speech sits well above 0.5 even on a `base` model
 *   · the utterance was too short to contain what was returned
 *
 * That last one is the strongest and the least obvious. A 400ms clip cannot
 * contain "Thanks for watching, and I'll see you in the next one" — when the
 * text is long and the audio is not, the text was invented.
 */
export function isNoise(text, { confidence = 1, durationMs = 0 } = {}) {
  const clean = normaliseText(text);
  if (!clean) return true;

  // Only punctuation, or a single stray character.
  if (!/[\p{L}\p{N}]/u.test(clean)) return true;

  const lower = clean.toLowerCase().replace(/\s+/g, ' ').trim();
  const words = lower.split(' ').filter(Boolean);

  const unsure = confidence < 0.55;
  const wordsPerSecond = durationMs > 0 ? words.length / (durationMs / 1000) : 0;

  // Roughly two words a second is fast conversational speech; three is not
  // physically plausible, so anything above it was not in the audio.
  if (durationMs > 0 && wordsPerSecond > 3) return true;

  /**
   * Far too few words for the length of the clip.
   *
   * This is the signal that catches the hallucination the others miss, and it
   * cost a real check to find: two seconds of pure digital silence came back as
   * " you", with high confidence. The model was not unsure, the clip was not
   * short, and "you" is an ordinary English word — every other test here passes
   * it.
   *
   * What gives it away is density. The segmenter cuts clips tight around
   * speech, so two seconds of it holds three or four words. One short filler
   * word stretched over the whole clip is not somebody speaking slowly; it is
   * the decoder filling a void with the most likely token it knows.
   */
  const tooSparse = durationMs >= 1200 && wordsPerSecond < 0.8;

  const filler = FILLER.has(lower) || FILLER.has(lower.replace(/[.!?]+$/, ''));
  if (filler && (unsure || durationMs < 1200 || tooSparse)) return true;

  // A very short clip that the model was also unsure about is a cough.
  if (unsure && durationMs < 700) return true;

  return false;
}

/**
 * One recognised utterance, cleaned and ready to store — or null if it was
 * noise.
 *
 * Returning null rather than an empty segment is deliberate: the caller has to
 * decide *not* to broadcast it, and an empty string is too easy to pass along
 * by accident into a caption that flashes blank on everyone's screen.
 */
export function toSegment({
  speakerTexorId,
  speakerName,
  text,
  language = '',
  confidence = 0,
  startedAt,
  durationMs = 0,
  offsetMs = 0,
}) {
  if (isNoise(text, { confidence, durationMs })) return null;

  const clean = collapseRepeats(normaliseText(text));
  if (!clean) return null;

  const started = startedAt instanceof Date ? startedAt : new Date(startedAt ?? Date.now());

  return {
    speakerTexorId,
    speakerName,
    text: clean,
    language,
    confidence,
    startedAt: started,
    endedAt: new Date(started.getTime() + durationMs),
    durationMs,
    offsetMs: Math.max(0, Math.round(offsetMs)),
  };
}

/**
 * Joins consecutive utterances by the same person into one line.
 *
 * This is what makes the stored transcript read as a conversation rather than
 * as a log. Somebody speaking for thirty seconds produces six or seven
 * utterances, because the segmenter cuts on the pauses between sentences —
 * printing each on its own line with their name repeated seven times is
 * technically accurate and unreadable.
 *
 * `gapMs` is the silence that ends a turn. Long enough that a breath does not
 * split a sentence in two, short enough that somebody answering a question is
 * not folded into the person who asked it.
 */
export function mergeSegments(segments, { gapMs = 4000 } = {}) {
  const lines = [];

  for (const segment of segments ?? []) {
    const previous = lines.at(-1);
    const startedAt = new Date(segment.startedAt);
    const endedAt = new Date(segment.endedAt ?? segment.startedAt);

    const continues = previous
      && previous.speakerTexorId === segment.speakerTexorId
      && startedAt.getTime() - previous.endedAt.getTime() <= gapMs;

    if (continues) {
      // A sentence that already ended gets a space; one cut mid-flow is joined
      // as it was spoken, so "I think — we should" does not become two.
      previous.text += SENTENCE_END.test(previous.text) ? ` ${segment.text}` : ` ${segment.text}`;
      previous.endedAt = endedAt;
      previous.durationMs = previous.endedAt.getTime() - previous.startedAt.getTime();
      if (segment.language && !previous.languages.includes(segment.language)) {
        previous.languages.push(segment.language);
      }
      previous.parts += 1;
      continue;
    }

    lines.push({
      speakerTexorId: segment.speakerTexorId,
      speakerName: segment.speakerName,
      text: segment.text,
      languages: segment.language ? [segment.language] : [],
      startedAt,
      endedAt,
      durationMs: segment.durationMs ?? 0,
      offsetMs: segment.offsetMs ?? 0,
      parts: 1,
    });
  }

  return lines;
}

/** `01:23`, or `1:02:03` once a meeting has run past the hour. */
export function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * The conversation, as plain text.
 *
 *   surya: endhuko telidu.
 *   john: I don't know either.
 *
 * One line per turn, the speaker's name in front of it. This is the form the
 * transcript is stored to be read in and the form it downloads as, and it is
 * deliberately the simplest thing that survives being pasted anywhere.
 */
export function renderTranscript(segments, { timestamps = false, gapMs = 4000 } = {}) {
  return mergeSegments(segments, { gapMs })
    .map((line) => {
      const stamp = timestamps ? `[${clock(line.offsetMs)}] ` : '';
      return `${stamp}${line.speakerName}: ${line.text}`;
    })
    .join('\n');
}

/**
 * The same conversation with a header, for the file somebody downloads.
 *
 * The header matters more than it looks: a transcript with no meeting name and
 * no date is a wall of dialogue that nobody can place three weeks later.
 */
export function renderTranscriptFile(transcript, { timestamps = true } = {}) {
  const head = [
    transcript.meetingTitle || 'Meeting',
    transcript.meetingStartedAt
      ? new Date(transcript.meetingStartedAt).toISOString().replace('T', ' ').slice(0, 16)
      : '',
    `${transcript.segments?.length ?? 0} utterances`,
    languagesIn(transcript.segments).length > 1
      ? `languages: ${languagesIn(transcript.segments).join(', ')}`
      : '',
  ].filter(Boolean);

  return `${head.join('\n')}\n${'─'.repeat(40)}\n\n${renderTranscript(transcript.segments, { timestamps })}\n`;
}

/** Every language the recogniser detected, most-spoken first. */
export function languagesIn(segments) {
  const counts = new Map();

  for (const segment of segments ?? []) {
    if (!segment.language) continue;
    counts.set(segment.language, (counts.get(segment.language) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([language]) => language);
}

/** Roughly how much was said. Whitespace-split, which is wrong for Chinese and
 * Japanese and close enough everywhere else — it is shown as "about", never
 * used for a decision. */
export function countWords(segments) {
  return (segments ?? []).reduce(
    (total, segment) => total + String(segment.text ?? '').split(/\s+/).filter(Boolean).length,
    0,
  );
}

export default {
  normaliseText,
  collapseRepeats,
  isNoise,
  toSegment,
  mergeSegments,
  renderTranscript,
  renderTranscriptFile,
  languagesIn,
  countWords,
  clock,
};
