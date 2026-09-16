/**
 * Downloading a note.
 *
 * Five formats, and the thing they have in common is that a defect in any of
 * them is invisible here and obvious to whoever opens the file. A `.docx` with
 * one malformed part is a file Word refuses; a PDF whose cross-reference table
 * is a byte out is a blank page. Neither fails at build time, and neither
 * shows up in a screenshot of the app.
 *
 * So these check the bytes: the archive's structure, the XML parts it holds,
 * the invariant the PDF's offsets depend on, and — for the text formats — that
 * escaping neither swallows punctuation nor lets markup through.
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const x = await import(`${FE}/src/lib/note-export.js`);
const { zip, crc32 } = await import(`${FE}/src/lib/zip.js`);
const { textWidth, wrap, charWidth } = await import(`${FE}/src/lib/pdf-text.js`);

let pass = 0, fail = 0;
const check = (l, ok, extra = '') => {
  ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${extra}`));
};

const NOTE = {
  title: 'Q3 planning',
  blocks: [
    { type: 'heading', level: 1, text: 'Decisions', marks: [] },
    { type: 'paragraph', text: 'We ship Friday. Cost: $3 (approx).', marks: [{ type: 'bold', start: 0, end: 2 }] },
    { type: 'bullet', text: 'one', marks: [] },
    { type: 'bullet', text: 'nested', marks: [], indent: 1 },
    { type: 'numbered', text: 'first', marks: [] },
    { type: 'numbered', text: 'inner', marks: [], indent: 1 },
    { type: 'numbered', text: 'second', marks: [] },
    { type: 'todo', done: true, text: 'Book room', marks: [] },
    { type: 'quote', speakerName: 'Surya', text: 'Ship it.', marks: [] },
    {
      type: 'paragraph',
      text: 'see the doc now',
      align: 'center',
      marks: [
        { type: 'link', start: 4, end: 11, href: 'https://texor.app/' },
        { type: 'highlight', color: 'yellow', start: 12, end: 15 },
      ],
    },
    { type: 'paragraph', text: 'evil <script>alert(1)</script> & "quotes"', marks: [] },
  ],
};

console.log('\n── markdown ──');
{
  const md = x.toMarkdown(NOTE);

  check('the title is the only top-level heading', md.startsWith('# Q3 planning'));
  check('a level-1 heading sits under it', md.includes('## Decisions'), md.slice(0, 120));
  check('bold survives', md.includes('**We**'));
  check('a link keeps its destination', md.includes('[the doc](https://texor.app/)'));
  check('a ticked todo is a ticked box', md.includes('- [x] Book room'));
  check('a quote is a quote', md.includes('> **Surya:** Ship it.'));

  // The numbering is derived, so this is really a check that the derivation
  // survives being rendered.
  check('an ordered list counts', md.includes('1. first') && md.includes('2. second'));
  check('and a nested one starts again', /\n\s+1\. inner/.test(md), md);

  /**
   * Escaping is the part that goes wrong quietly. Too little and a stray
   * asterisk italicises half a note; too much and ordinary punctuation comes
   * out as `Friday\.`, which is worse because it is in every sentence.
   */
  check('ordinary punctuation is left alone', md.includes('Friday. Cost: $3 (approx).'), md);
  check('but formatting characters are escaped',
    x.toMarkdown({ blocks: [{ type: 'paragraph', text: 'a*b_c[d]', marks: [] }] }).includes('a\\*b\\_c\\[d\\]'));
  check('and a line that would become a heading is escaped at the start',
    x.toMarkdown({ blocks: [{ type: 'paragraph', text: '# no', marks: [] }] }).includes('\\# no'));
}

console.log('\n── html ──');
{
  const html = x.toHtml(NOTE);

  check('it is a complete document', html.startsWith('<!doctype html>') && html.includes('</html>'));
  check('nothing is fetched from anywhere', !/https?:\/\/[^"]*\.(css|js)/.test(html));

  /** The one that matters: a note is written by one person and read by another. */
  check('markup in the text cannot become markup in the file',
    html.includes('&lt;script&gt;') && !html.includes('<script>'), 'script tag survived');
  check('quotes and ampersands too', html.includes('&amp;') && html.includes('&quot;'));

  check('lists are grouped rather than one list each',
    (html.match(/<ul>/g) ?? []).length === 1 && (html.match(/<ol>/g) ?? []).length === 1, html);
  check('a link cannot reach back through the opener',
    html.includes('rel="noopener noreferrer"'));
  check('alignment is carried', html.includes('text-align:center'));
  check('a highlight is a mark', html.includes('<mark'));
}

console.log('\n── plain text ──');
{
  const text = x.toPlainText(NOTE);

  check('list markers stay, because they carry the meaning', text.includes('• one'));
  check('numbers stay too', text.includes('1. first') && text.includes('2. second'));
  check('a ticked box is legible', text.includes('[x] Book room'));
  check('emphasis does not become punctuation', !text.includes('**'));
  check('indentation is real whitespace', /\n {4}• nested/.test(text), JSON.stringify(text));
}

console.log('\n── the zip a .docx is made of ──');
{
  // A known vector, so a broken table shows up here rather than as a corrupt
  // archive that some tools open and others do not.
  const probe = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
  check('crc32 matches the reference vector', crc32(probe) === 0x414fa339, crc32(probe).toString(16));

  const bytes = zip([{ name: 'a.txt', data: 'hello' }]);
  check('an archive starts with the local file signature',
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);
  check('and ends with the end-of-central-directory record',
    [...bytes.slice(-22, -18)].join(',') === [0x50, 0x4b, 0x05, 0x06].join(','));
}

console.log('\n── word (.docx) ──');
{
  const bytes = x.toDocx(NOTE);
  const text = new TextDecoder().decode(bytes);

  check('it is an archive', bytes[0] === 0x50 && bytes[1] === 0x4b);

  // Stored, not deflated, so the parts are readable in the bytes — which is
  // what lets this suite check them without unzipping.
  for (const part of [
    '[Content_Types].xml', '_rels/.rels', 'word/document.xml',
    'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml',
  ]) check(`it contains ${part}`, text.includes(part));

  check('headings use a style rather than a font size',
    text.includes('<w:pStyle w:val="Heading1"/>'));
  check('bullets and numbers are real Word lists',
    text.includes('<w:numId w:val="1"/>') && text.includes('<w:numId w:val="2"/>'));
  check('nesting is carried as a list level', text.includes('<w:ilvl w:val="1"/>'));
  check('alignment is carried', text.includes('<w:jc w:val="center"/>'));
  check('a highlight is Word\'s own highlight', text.includes('<w:highlight w:val="yellow"/>'));

  /**
   * A hyperlink is the one inline thing OOXML splits in two: the run points at
   * a relationship id, and the destination lives in another part. A mismatch
   * is a link that goes nowhere, or a file Word rejects outright.
   */
  const ids = [...text.matchAll(/<w:hyperlink r:id="(rId\d+)"/g)].map((match) => match[1]);
  check('each link run has a relationship id', ids.length === 1, ids.join(','));
  check('and that id is defined in the relationships part',
    ids.every((id) => text.includes(`Id="${id}"`)), ids.join(','));
  check('pointing at the destination, marked external',
    text.includes('Target="https://texor.app/" TargetMode="External"'));

  check('spaces on the edge of a run are preserved',
    text.includes('xml:space="preserve"'), 'Word will eat them');
  check('text is escaped for XML', text.includes('&lt;script&gt;'), 'raw markup in document.xml');
}

console.log('\n── pdf ──');
{
  const bytes = x.toPdf(NOTE);
  const text = new TextDecoder().decode(bytes);

  check('it announces itself as a PDF', text.startsWith('%PDF-1.4'));
  check('and ends properly', text.trimEnd().endsWith('%%EOF'));
  check('it has a cross-reference table', text.includes('\nxref\n') && text.includes('startxref'));

  /**
   * The invariant everything else rests on.
   *
   * Offsets and `/Length` are measured with `String.length` and the document
   * is then encoded as UTF-8. One non-ASCII character would make those two
   * disagree, every offset after it would be wrong, and a viewer trusts the
   * table over the file — so the page comes up blank rather than wrong.
   */
  check('every byte is ASCII', /^[\x00-\x7f]*$/.test(text));
  check('so the offsets it declares are the real ones', bytes.length === text.length,
    `${bytes.length} bytes vs ${text.length} chars`);

  const accented = x.toPdf({ title: 'Résumé — “curly” • bullets…', blocks: [{ type: 'paragraph', text: 'café naïve', marks: [] }] });
  const accentedText = new TextDecoder().decode(accented);
  check('and that holds for text that is not ASCII at all',
    /^[\x00-\x7f]*$/.test(accentedText) && accented.length === accentedText.length);
  check('those characters are written as escapes, not dropped',
    /\\\d{3}/.test(accentedText), 'accented text was discarded');

  check('the first object is the catalogue', text.includes('/Type /Catalog'));
  check('it declares its pages', /\/Type \/Pages \/Count [1-9]/.test(text));
  check('base fonts only, so nothing needs embedding',
    text.includes('/BaseFont /Helvetica') && !text.includes('/FontFile'));

  // Long enough to need more than one page: the cursor has to roll over.
  const long = { title: 'Long', blocks: Array.from({ length: 200 }, (_, i) => ({ type: 'paragraph', text: `Paragraph number ${i} with enough words in it to take up a line.`, marks: [] })) };
  const pages = Number(new TextDecoder().decode(x.toPdf(long)).match(/\/Count (\d+)/)?.[1] ?? 0);
  check('a long note runs onto more pages', pages > 1, `${pages} pages`);
}

console.log('\n── measuring text, which is what lets a PDF wrap ──');
{
  // Against the published Helvetica metrics. A wrong number here does not
  // fail; it produces lines that are slightly too long, forever.
  for (const [char, width] of [[' ', 278], ['A', 667], ['W', 944], ['i', 222], ['m', 833], ['0', 556]]) {
    check(`${JSON.stringify(char)} is ${width}/1000 em`, charWidth(char.codePointAt(0)) === width,
      String(charWidth(char.codePointAt(0))));
  }
  check('bold is wider where it should be', charWidth(65, true) === 722);

  const lines = wrap('The quick brown fox jumps over the lazy dog near the river', 12, 160);
  check('wrapping produces more than one line', lines.length > 1);
  check('and no line is wider than the column',
    lines.every((line) => textWidth(line, 12) <= 160), lines.join(' | '));
  check('no line begins with the space it broke on', lines.every((line) => !line.startsWith(' ')));

  // A URL in a narrow column: nothing to break on, so it has to be cut.
  const url = wrap('https://example.com/a/very/long/path/that/keeps/going', 12, 90);
  check('a word too wide to fit is cut rather than left to overflow',
    url.every((line) => textWidth(line, 12) <= 90), url.join(' | '));

  check('empty text still yields a line, so a blank paragraph has height',
    wrap('', 12, 100).length === 1);
}

console.log('\n── file names ──');
{
  check('a title becomes the file name', x.fileName('Q3 planning', 'docx') === 'Q3 planning.docx');
  check('characters no filesystem accepts are removed',
    x.fileName('a/b\\c:d*e?f"g<h>i|j', 'pdf') === 'abcdefghij.pdf', x.fileName('a/b\\c:d*e?f"g<h>i|j', 'pdf'));
  check('an untitled note still gets a name', x.fileName('', 'md') === 'Untitled note.md');
  check('and a missing one does too', x.fileName(undefined, 'txt') === 'Untitled note.txt');
  check('a very long title is cut', x.fileName('x'.repeat(300), 'txt').length < 100);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
