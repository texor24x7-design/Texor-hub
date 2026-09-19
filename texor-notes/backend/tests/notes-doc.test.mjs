/**
 * The note document model.
 *
 * Marks are ranges over text, so every one of these is really the same
 * question: after an edit, does each mark still cover the characters it was
 * describing? That is the bug class an editor dies of — a highlight that
 * creeps, a mention that loses its person, a bold that swallows the next word —
 * and none of it needs a browser to catch.
 *
 * The server's own rules are in `services/notes.service.js` and are checked in
 * the second half, because the server must not trust this file's opinion.
 */
const FE = new URL('../../frontend/', import.meta.url).pathname.replace(/\/$/, '');
const doc = await import(`${FE}/src/lib/notes-doc.js`);
const server = await import('../src/services/notes.service.js');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const block = (text, marks = []) => ({ type: 'paragraph', text, marks });
const types = (b) => b.marks.map((m) => `${m.type}${m.color ? `:${m.color}` : ''}@${m.start}-${m.end}`).join(' ');

console.log('\n── applying a mark ──');
{
  let b = doc.toggleMark(block('hello brave world'), 6, 11, { type: 'bold' });
  check('it covers exactly what was selected', types(b) === 'bold@6-11', types(b));
  check('the text is untouched', b.text === 'hello brave world');

  b = doc.toggleMark(b, 6, 11, { type: 'bold' });
  check('applying it again takes it off', b.marks.length === 0, types(b));
}

console.log('\n── a partly-marked selection ──');
{
  // Half of this is already bold. Dragging across the whole phrase should bold
  // all of it, not clear the half that was.
  let b = block('one two three', [{ type: 'bold', start: 0, end: 3 }]);
  check('a partial range does not count as marked', !doc.rangeHasMark(b, 0, 13, 'bold'));
  b = doc.toggleMark(b, 0, 13, { type: 'bold' });
  check('so toggling extends it over everything', types(b) === 'bold@0-13', types(b));
  check('and adjacent runs merge into one mark', b.marks.length === 1, types(b));
}

console.log('\n── highlighters ──');
{
  let b = doc.toggleMark(block('important'), 0, 9, { type: 'highlight', color: 'yellow' });
  check('a highlight carries its colour', types(b) === 'highlight:yellow@0-9', types(b));

  b = doc.toggleMark(b, 0, 9, { type: 'highlight', color: 'green' });
  check('a different colour replaces rather than stacks',
    b.marks.filter((m) => m.type === 'highlight').length === 1 && b.marks[0].color === 'green', types(b));

  b = doc.toggleMark(b, 0, 9, { type: 'highlight', color: 'green' });
  check('the same colour again clears it', b.marks.length === 0, types(b));

  // Highlighting the middle of a highlight is how you get two of them.
  let c = doc.toggleMark(block('abcdefghij'), 0, 10, { type: 'highlight', color: 'blue' });
  c = doc.removeMark(c, 4, 6, 'highlight', 'blue');
  check('clearing the middle leaves the two ends', types(c) === 'highlight:blue@0-4 highlight:blue@6-10', types(c));
}

console.log('\n── marks survive editing the text around them ──');
{
  const b = block('hello world', [{ type: 'bold', start: 6, end: 11 }]);

  const before = doc.spliceText(b, 0, 0, 'oh ');
  check('typing before a mark pushes it along', types(before) === 'bold@9-14', types(before));
  check('and the word under it is the same one', before.text.slice(9, 14) === 'world');

  const after = doc.spliceText(b, 11, 11, '!');
  check('typing after a mark leaves it alone', types(after) === 'bold@6-11', types(after));

  const inside = doc.spliceText(b, 8, 8, 'XX');
  check('typing inside a mark grows it', types(inside) === 'bold@6-13', types(inside));
  check('and it still covers the whole word', inside.text.slice(6, 13) === 'woXXrld');

  const cut = doc.spliceText(b, 6, 11, '');
  check('deleting the marked text drops the mark', cut.marks.length === 0, types(cut));
  check('deleting leaves the rest intact', cut.text === 'hello ');

  const straddle = doc.spliceText(b, 4, 8, '');
  check('a cut across a boundary shortens the mark', types(straddle) === 'bold@4-7', types(straddle));
}

console.log('\n── tagging someone ──');
{
  const typed = block('ask @kri');
  const query = doc.mentionQuery(typed.text, 8);
  check('the half-typed name is found', query?.query === 'kri', JSON.stringify(query));
  check('and so is where it starts', query?.from === 4 && query?.to === 8, JSON.stringify(query));

  const tagged = doc.insertMention(typed, query.from, query.to, { texorId: 'tx-k', name: 'Krishna Rao' });
  check('the text reads as the person’s name', tagged.text === 'ask @Krishna Rao ', JSON.stringify(tagged.text));
  check('the mark covers the name but not the trailing space',
    types(tagged) === 'mention@4-16', types(tagged));
  check('the mention knows who it is', tagged.marks[0].texorId === 'tx-k');
  check('the marked text is exactly the tag', tagged.text.slice(4, 16) === '@Krishna Rao');
}

console.log('\n── when the picker should and should not open ──');
{
  check('at the start of a line', doc.mentionQuery('@kr', 3)?.query === 'kr');
  check('after a space', doc.mentionQuery('hi @kr', 6)?.query === 'kr');
  check('after an opening bracket', doc.mentionQuery('(@kr', 4)?.query === 'kr');
  check('immediately after typing @', doc.mentionQuery('hi @', 4)?.query === '');
  // The one that matters: an email address must not open a people picker.
  check('not inside an email address', doc.mentionQuery('mail ann@texor.app', 18) === null);
  check('not once a space has been typed', doc.mentionQuery('hi @kr ', 7) === null);
  check('not on a second @', doc.mentionQuery('hi @kr@', 7) === null);
  check('only what is before the caret counts', doc.mentionQuery('@krishna', 3)?.query === 'kr');
}

console.log('\n── ranking the people offered ──');
{
  const people = [
    { texorId: '1', name: 'Mark Rowe' },
    { texorId: '2', name: 'Krishna Rao' },
    { texorId: '3', name: 'Ana Krish' },
  ];
  const got = doc.matchPeople(people, 'kr').map((p) => p.name);
  check('a name starting with what you typed comes first', got[0] === 'Krishna Rao', got.join(', '));
  check('a later word starting with it comes next', got[1] === 'Ana Krish', got.join(', '));
  check('somebody who does not match is not offered', !got.includes('Mark Rowe'), got.join(', '));
  check('an empty query offers everyone', doc.matchPeople(people, '').length === 3);
  check('matching ignores case', doc.matchPeople(people, 'KRISHNA').length === 1);
}

console.log('\n── a mention is never cut in half ──');
{
  const b = block('ask @Krishna Rao about it', [
    { type: 'mention', start: 4, end: 16, texorId: 'tx-k', name: 'Krishna Rao' },
  ]);
  const snapped = doc.snapToMentions(b, 6, 10);
  check('a selection inside a mention grows to cover it',
    snapped.from === 4 && snapped.to === 16, JSON.stringify(snapped));

  const hl = doc.toggleMark(b, 6, 10, { type: 'highlight', color: 'pink' });
  const mark = hl.marks.find((m) => m.type === 'highlight');
  check('so highlighting part of a name highlights the name',
    mark.start === 4 && mark.end === 16, types(hl));

  const outside = doc.snapToMentions(b, 17, 22);
  check('a selection clear of it is left alone', outside.from === 17 && outside.to === 22);
}

console.log('\n── splitting into runs for rendering ──');
{
  const b = block('the quick brown fox', [
    { type: 'highlight', start: 0, end: 15, color: 'yellow' },
    { type: 'bold', start: 4, end: 9 },
  ]);
  const runs = doc.segments(b);
  check('every character appears exactly once',
    runs.map((r) => r.text).join('') === b.text, runs.map((r) => r.text).join('|'));
  check('the overlap becomes its own run', runs.length === 4, String(runs.length));
  check('the overlapping run carries both marks',
    runs[1].marks.length === 2 && runs[1].text === 'quick', JSON.stringify(runs[1]));
  // The highlight ends at 15, which is the space — so the unmarked tail is
  // " fox", space included. A run boundary is a character index, not a word.
  check('the run outside everything carries none',
    runs[3].marks.length === 0 && runs[3].text === ' fox', JSON.stringify(runs[3]));
  check('runs are in reading order', runs.every((r, i) => i === 0 || r.from >= runs[i - 1].to));

  check('an empty block produces no runs', doc.segments(block('')).length === 0);
  check('a block with no marks is one run', doc.segments(block('plain')).length === 1);
}

console.log('\n── nothing produces an invalid document ──');
{
  const cases = [
    ['a zero-width selection', () => doc.toggleMark(block('abc'), 2, 2, { type: 'bold' })],
    ['an inverted selection', () => doc.toggleMark(block('abc'), 3, 1, { type: 'bold' })],
    ['a mark on empty text', () => doc.toggleMark(block(''), 0, 0, { type: 'bold' })],
    ['deleting everything', () => doc.spliceText(
      block('abc', [{ type: 'bold', start: 0, end: 3 }]), 0, 3, '')],
  ];

  for (const [label, run] of cases) {
    const result = run();
    const sane = result.marks.every(
      (m) => m.end > m.start && m.start >= 0 && m.end <= result.text.length,
    );
    check(label, sane, JSON.stringify(result.marks));
  }
}

console.log('\n── counting what is in a note ──');
{
  const blocks = [
    { type: 'heading', text: 'Review', marks: [] },
    { type: 'todo', text: 'send the deck', marks: [], done: true },
    { type: 'todo', text: 'book the room', marks: [] },
    { type: 'paragraph', text: 'two words', marks: [{ type: 'highlight', start: 0, end: 3, color: 'blue' }] },
  ];
  const stats = doc.noteStats(blocks);
  check('words are counted across blocks', stats.words === 9, JSON.stringify(stats));
  check('action items are counted', stats.todo === 2 && stats.done === 1, JSON.stringify(stats));
  check('highlights are counted', stats.highlights === 1, JSON.stringify(stats));
  check('plain text joins blocks with newlines', doc.plainText(blocks).split('\n').length === 4);
}

/* ────────────────────────────────────────────────────────────────────────────
 * The server's rules. Same document, but it has to decide for itself.
 * ──────────────────────────────────────────────────────────────────────────── */

console.log('\n── the server clamps rather than refuses ──');
{
  const out = server.sanitiseBlocks([
    { type: 'paragraph', text: 'short', marks: [{ type: 'bold', start: 0, end: 900 }] },
  ]);
  check('a mark running past the end is pulled back', out[0].marks[0].end === 5, JSON.stringify(out[0].marks));
  check('and the text is kept', out[0].text === 'short');

  const inverted = server.sanitiseBlocks([
    { type: 'paragraph', text: 'abcdef', marks: [{ type: 'bold', start: 4, end: 2 }] },
  ]);
  check('an inverted mark is dropped, not stored', inverted[0].marks.length === 0);
}

console.log('\n── and refuses what is not a document ──');
{
  check('a string instead of blocks', server.sanitiseBlocks('hello').length === 0);
  check('null', server.sanitiseBlocks(null).length === 0);
  check('rubbish in the array', server.sanitiseBlocks([null, 5, 'x']).length === 0);

  const unknown = server.sanitiseBlocks([{ type: 'iframe', text: 'hi' }]);
  check('an unknown block type becomes a paragraph', unknown[0].type === 'paragraph');

  const badMark = server.sanitiseBlocks([{ type: 'paragraph', text: 'hi', marks: [{ type: 'script', start: 0, end: 2 }] }]);
  check('an unknown mark type is dropped', badMark[0].marks.length === 0);

  const badColor = server.sanitiseBlocks([
    { type: 'paragraph', text: 'hi', marks: [{ type: 'highlight', start: 0, end: 2, color: 'url(javascript:1)' }] },
  ]);
  check('a colour that is not one of ours becomes yellow', badColor[0].marks[0].color === 'yellow');
}

console.log('\n── markup is text, not markup ──');
{
  const out = server.sanitiseBlocks([{ type: 'paragraph', text: '<script>alert(1)</script>' }]);
  check('a script tag is stored as the characters somebody typed',
    out[0].text === '<script>alert(1)</script>', out[0].text);
  // Which is the point of the whole design: there is no HTML anywhere to escape.
  check('and nothing about the block says it is markup', Object.keys(out[0]).join() === 'type,text,marks');
}

console.log('\n── who a note names ──');
{
  const blocks = [
    { type: 'paragraph', text: '@Ann and @Bo', marks: [
      { type: 'mention', start: 0, end: 4, texorId: 'tx-a', name: 'Ann' },
      { type: 'mention', start: 9, end: 12, texorId: 'tx-b', name: 'Bo' },
    ] },
    { type: 'paragraph', text: '@Ann again', marks: [
      { type: 'mention', start: 0, end: 4, texorId: 'tx-a', name: 'Ann' },
    ] },
  ];
  const mentions = server.mentionsOf(blocks);
  check('everyone tagged is listed', mentions.length === 2, JSON.stringify(mentions));
  check('somebody tagged twice is listed once',
    mentions.filter((m) => m.texorId === 'tx-a').length === 1);

  const nameless = server.sanitiseBlocks([
    { type: 'paragraph', text: '@Ghost', marks: [{ type: 'mention', start: 0, end: 6 }] },
  ]);
  check('a mention with nobody behind it is not a mention', nameless[0].marks.length === 0);
  check('so it cannot put a phantom into the mentions index',
    server.mentionsOf(nameless).length === 0);
}

console.log('\n── trailing blank lines are where the cursor was, not content ──');
{
  const out = server.sanitiseBlocks([
    { type: 'paragraph', text: 'real' },
    { type: 'paragraph', text: '' },
    { type: 'paragraph', text: '  ' },
  ]);
  check('they are trimmed off the end', out.length === 1, String(out.length));

  const middle = server.sanitiseBlocks([
    { type: 'paragraph', text: 'one' },
    { type: 'paragraph', text: '' },
    { type: 'paragraph', text: 'two' },
  ]);
  check('but a blank line between paragraphs is kept', middle.length === 3, String(middle.length));
}

console.log('\n── the preview line ──');
{
  const blocks = [{ type: 'heading', text: '' }, { type: 'paragraph', text: 'the   first  thing said' }];
  check('it skips an empty opening block',
    server.preview(blocks) === 'the first thing said', server.preview(blocks));
  const long = [{ type: 'paragraph', text: 'x'.repeat(400) }];
  check('it is cut to length', server.preview(long).length <= 160, String(server.preview(long).length));
  check('and says it was cut', server.preview(long).endsWith('…'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
