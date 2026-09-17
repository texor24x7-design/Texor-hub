/**
 * The caption lines on screen.
 *
 * ── Why this is not just an array you push onto ──
 *
 * An utterance arrives more than once. While somebody is still speaking it is
 * re-transcribed every couple of seconds and sent as an interim; when they stop
 * it comes once more as a final. Appending each one gives four copies of the
 * same sentence, each a few words longer than the last. That is what a naive
 * caption layer looks like, and it is unreadable — so every rule about
 * replacing rather than appending is worth a test.
 */
import { applyCaption, groupCaptions, visibleCaptions, MAX_LINES } from '../src/lib/captions.js';

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const caption = (over = {}) => ({
  texorId: 'tx-s',
  name: 'surya',
  utteranceId: '1',
  text: 'endhuko',
  language: 'te',
  confidence: 0.8,
  final: false,
  at: new Date('2026-09-17T10:00:00Z'),
  ...over,
});

console.log('\n── a sentence assembling itself ──');
{
  let lines = [];
  lines = applyCaption(lines, caption({ text: 'endhuko' }));
  lines = applyCaption(lines, caption({ text: 'endhuko telidu' }));
  lines = applyCaption(lines, caption({ text: 'endhuko telidu.', final: true }));

  check('three versions of one utterance are one line', lines.length === 1, String(lines.length));
  check('and it is the last one', lines[0].text === 'endhuko telidu.', lines[0].text);
  check('marked final', lines[0].final === true);
}

console.log('\n── an interim arriving after its own final ──');
{
  /**
   * Interims and finals are separate jobs in the recogniser's queue and can
   * come back out of order when it is busy. Without this guard a late interim
   * replaces a finished sentence with the half of it spoken two seconds
   * earlier, and leaves it that way for good.
   */
  let lines = applyCaption([], caption({ text: 'endhuko telidu.', final: true }));
  lines = applyCaption(lines, caption({ text: 'endhuko', final: false }));

  check('the finished sentence is not clobbered', lines[0].text === 'endhuko telidu.', lines[0].text);
  check('and it stays final', lines[0].final === true);
}

console.log('\n── two people at once ──');
{
  let lines = applyCaption([], caption({ texorId: 'tx-s', utteranceId: '1', text: 'one' }));
  lines = applyCaption(lines, caption({ texorId: 'tx-j', name: 'john', utteranceId: '1', text: 'two' }));

  // The id is only unique per speaker, so the key has to carry both. Keyed on
  // the utterance alone, two people talking would overwrite each other.
  check('the same utterance id from two people is two lines', lines.length === 2, String(lines.length));
  check('and each keeps its own speaker', lines[0].name === 'surya' && lines[1].name === 'john');
}

console.log('\n── the list does not grow forever ──');
{
  let lines = [];
  for (let index = 0; index < MAX_LINES + 50; index += 1) {
    lines = applyCaption(lines, caption({ utteranceId: String(index), final: true }));
  }
  check('it is capped', lines.length === MAX_LINES, String(lines.length));
  check('and it is the oldest that go', lines[0].key.endsWith(':50'), lines[0].key);
}

console.log('\n── the overlay ──');
{
  const now = new Date('2026-09-17T10:00:30Z').getTime();
  const lines = [
    caption({ utteranceId: '1', at: new Date('2026-09-17T10:00:05Z'), final: true }),
    caption({ utteranceId: '2', at: new Date('2026-09-17T10:00:26Z'), final: true }),
    caption({ utteranceId: '3', at: new Date('2026-09-17T10:00:28Z'), final: true }),
    caption({ utteranceId: '4', at: new Date('2026-09-17T10:00:29Z'), final: true }),
    caption({ utteranceId: '5', at: new Date('2026-09-17T10:00:30Z'), final: true }),
  ].reduce((acc, entry) => applyCaption(acc, entry), []);

  const shown = visibleCaptions(lines, { now });
  check('only the last few are drawn', shown.length === 3, String(shown.length));
  check('the oldest is dropped, not the newest', shown.at(-1).key.endsWith(':5'), shown.at(-1).key);

  const stale = visibleCaptions(lines, { now: now + 60_000 });
  check('and a silent minute clears it entirely', stale.length === 0, String(stale.length));
}

console.log('\n── grouping into turns ──');
{
  const lines = [
    caption({ utteranceId: '1', text: 'endhuko telidu.', at: new Date('2026-09-17T10:00:00Z'), final: true }),
    caption({ utteranceId: '2', text: 'Really no idea.', at: new Date('2026-09-17T10:00:02Z'), final: true }),
    caption({ texorId: 'tx-j', name: 'john', utteranceId: '1', text: "I don't know.", at: new Date('2026-09-17T10:00:05Z'), final: true }),
    caption({ utteranceId: '3', text: 'Fine.', at: new Date('2026-09-17T10:01:00Z'), final: true }),
  ].reduce((acc, entry) => applyCaption(acc, entry), []);

  const turns = groupCaptions(lines);
  check('one person talking twice is one turn', turns.length === 3, String(turns.length));
  check('joined in order', turns[0].text === 'endhuko telidu. Really no idea.', turns[0].text);
  check('a different speaker breaks it', turns[1].name === 'john');
  check('and so does a long gap', turns[2].text === 'Fine.');

  const rendered = turns.map((turn) => `${turn.name}: ${turn.text}`).join('\n');
  check(
    'which is the form the transcript is copied in',
    rendered === "surya: endhuko telidu. Really no idea.\njohn: I don't know.\nsurya: Fine.",
    JSON.stringify(rendered),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
