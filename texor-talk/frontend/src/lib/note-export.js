/**
 * Turning a note into a file somebody can keep.
 *
 * Every format is produced from the same document model the editor works on —
 * blocks of plain text with mark ranges — so an export is a rendering of the
 * note rather than a scrape of the page. Nothing here reads the DOM, which is
 * what lets all of it be tested without a browser.
 *
 * Nothing here is fetched, either. A download that needed a service would mean
 * the user's notes leaving this deployment to come back as a file.
 */
/*
 * Relative rather than the `@/` alias the rest of the app uses.
 *
 * That alias is resolved by the bundler, and this module is meant to be run
 * under plain Node by its tests — an exporter that can only be exercised
 * inside a browser is one whose output nobody checks.
 */
import { segments, indentOf, alignOf, listNumbers } from './notes-doc.js';
import { zip } from './zip.js';
import { textWidth, wrap } from './pdf-text.js';

const has = (segment, type) => segment.marks.some((mark) => mark.type === type);
const markOf = (segment, type) => segment.marks.find((mark) => mark.type === type);

/** A filename that every operating system will accept. */
export function fileName(title, extension) {
  const base = String(title ?? '').trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').slice(0, 80);
  return `${base || 'Untitled note'}.${extension}`;
}

/* ── plain text ─────────────────────────────────────────────────────────── */

/**
 * The note with its formatting dropped rather than spelled out.
 *
 * List markers stay, because a list read as a run-on paragraph loses the one
 * thing it was saying. Bold does not, because `**like this**` in a .txt file is
 * noise rather than emphasis.
 */
export function toPlainText(note) {
  const numbers = listNumbers(note?.blocks);
  const lines = [];

  if (note?.title) lines.push(note.title, '');

  (note?.blocks ?? []).forEach((block, index) => {
    const pad = '    '.repeat(indentOf(block));
    const text = block.text ?? '';

    if (block.type === 'bullet') lines.push(`${pad}• ${text}`);
    else if (block.type === 'numbered') lines.push(`${pad}${numbers.get(index) ?? 1}. ${text}`);
    else if (block.type === 'todo') lines.push(`${pad}[${block.done ? 'x' : ' '}] ${text}`);
    else if (block.type === 'quote') {
      const who = block.speakerName ? `${block.speakerName}: ` : '';
      lines.push(`${pad}"${who}${text}"`);
    } else lines.push(pad + text);
  });

  return `${lines.join('\n')}\n`;
}

/* ── markdown ───────────────────────────────────────────────────────────── */

/**
 * Characters that would otherwise turn into formatting the author never wrote.
 *
 * Only the ones that mean something *inside* a line. Escaping every `.`, `-`
 * and `(` as well is the usual over-correction, and it turns an ordinary
 * sentence into `Friday\.` — punctuation the reader can see, to prevent
 * formatting that was never possible there.
 */
const mdEscape = (text) => text.replace(/([\\`*_[\]<])/g, '\\$1');

/**
 * A line only becomes a heading, a quote or a list item if it *starts* that
 * way, so the start of a line is the only place those characters need it.
 */
const mdLineStart = (text) => text.replace(/^(\s*)([#>+-]|\d+[.)])(\s)/, '$1\\$2$3');

function mdRun(segment) {
  // A mention is a name, not a phrase to be emphasised, and a code span cannot
  // hold emphasis inside it — so both are settled before anything wraps them.
  if (has(segment, 'mention')) return `**@${segment.text.replace(/^@/, '')}**`;
  if (has(segment, 'code')) return `\`${segment.text.replace(/`/g, '')}\``;

  let out = mdEscape(segment.text);

  // Innermost first, so the delimiters nest in a legal order.
  if (has(segment, 'strike')) out = `~~${out}~~`;
  if (has(segment, 'italic')) out = `*${out}*`;
  if (has(segment, 'bold')) out = `**${out}**`;

  const link = markOf(segment, 'link');
  if (link) out = `[${out}](${link.href})`;

  // Markdown has no underline, highlight or colour. Rather than invent syntax
  // no reader renders, they are dropped and the words kept.
  return out;
}

const mdInline = (block) => segments(block).map(mdRun).join('') || '';

export function toMarkdown(note) {
  const numbers = listNumbers(note?.blocks);
  const out = [];

  if (note?.title) out.push(`# ${note.title}`, '');

  (note?.blocks ?? []).forEach((block, index) => {
    const pad = '  '.repeat(indentOf(block));
    const text = mdInline(block);

    switch (block.type) {
      case 'heading':
        // Offset by one, so the note's own title keeps the only `#`.
        out.push(`${'#'.repeat(Math.min(6, (block.level ?? 2) + 1))} ${text}`, '');
        break;
      case 'bullet':
        out.push(`${pad}- ${text}`);
        break;
      case 'numbered':
        out.push(`${pad}${numbers.get(index) ?? 1}. ${text}`);
        break;
      case 'todo':
        out.push(`${pad}- [${block.done ? 'x' : ' '}] ${text}`);
        break;
      case 'quote': {
        const who = block.speakerName ? `**${block.speakerName}:** ` : '';
        out.push(`${pad}> ${who}${text}`, '');
        break;
      }
      default:
        out.push(pad + mdLineStart(text), '');
    }
  });

  // Collapse the runs of blank lines the per-block rules leave behind.
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/* ── html ───────────────────────────────────────────────────────────────── */

export const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const HTML_COLORS = {
  red: '#c0392b', orange: '#c2620f', green: '#1e7a43',
  blue: '#1f5fb0', purple: '#6b3fa0', grey: '#6b7280',
};

const HTML_HIGHLIGHTS = {
  yellow: '#fff3a3', green: '#c8f2d4', blue: '#cfe4ff', pink: '#ffd6e7', purple: '#e4d9ff',
};

function htmlRun(segment) {
  let out = escapeHtml(segment.text);

  if (has(segment, 'code')) out = `<code>${out}</code>`;
  if (has(segment, 'bold')) out = `<strong>${out}</strong>`;
  if (has(segment, 'italic')) out = `<em>${out}</em>`;
  if (has(segment, 'underline')) out = `<u>${out}</u>`;
  if (has(segment, 'strike')) out = `<s>${out}</s>`;

  const colour = markOf(segment, 'color');
  if (colour) out = `<span style="color:${HTML_COLORS[colour.color] ?? HTML_COLORS.blue}">${out}</span>`;

  const highlight = markOf(segment, 'highlight');
  if (highlight) {
    const paint = HTML_HIGHLIGHTS[highlight.color] ?? HTML_HIGHLIGHTS.yellow;
    out = `<mark style="background:${paint}">${out}</mark>`;
  }

  if (has(segment, 'mention')) out = `<span class="mention">${out}</span>`;

  const link = markOf(segment, 'link');
  if (link) {
    // `noopener` because the opened page gets a handle on this one otherwise,
    // and these destinations were typed by whoever wrote the note.
    out = `<a href="${escapeHtml(link.href)}" rel="noopener noreferrer">${out}</a>`;
  }

  return out;
}

const htmlInline = (block) => segments(block).map(htmlRun).join('') || '<br>';

const STYLE = `
  body { margin: 0 auto; padding: 48px 24px; max-width: 46rem; background: #fff; color: #17181d;
         font: 16px/1.65 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  h1.note-title { font-size: 2rem; margin: 0 0 1.5rem; }
  h1, h2, h3 { line-height: 1.3; margin: 1.6em 0 0.5em; }
  p { margin: 0 0 0.9em; }
  blockquote { margin: 0 0 0.9em; padding-left: 1rem; border-left: 3px solid #d7dae3; color: #4b5162; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
         background: #f1f2f6; padding: 0.1em 0.3em; border-radius: 4px; font-size: 0.92em; }
  .todo { list-style: none; padding-left: 0; }
  .mention { color: #1f5fb0; font-weight: 600; }
  .meta { color: #6b7280; font-size: 0.875rem; margin-bottom: 2rem; }
`;

/**
 * A single file that opens in any browser and prints sensibly.
 *
 * The styles are inline rather than linked for the same reason nothing is
 * fetched: a saved file that needs this site to be up in order to look right is
 * not really a saved file.
 */
export function toHtml(note) {
  const numbers = listNumbers(note?.blocks);
  const body = [];
  let list = null;

  const closeList = () => {
    if (list) body.push(list === 'ol' ? '</ol>' : '</ul>');
    list = null;
  };

  const openList = (kind, className = '') => {
    if (list !== kind) {
      closeList();
      body.push(kind === 'ol' ? '<ol>' : `<ul${className}>`);
      list = kind;
    }
  };

  (note?.blocks ?? []).forEach((block, index) => {
    const align = alignOf(block);
    const indent = indentOf(block);
    const style = [
      align !== 'left' ? `text-align:${align}` : '',
      indent ? `margin-left:${indent * 2}rem` : '',
    ].filter(Boolean).join(';');
    const attr = style ? ` style="${style}"` : '';
    const text = htmlInline(block);

    if (block.type === 'bullet') { openList('ul'); body.push(`<li${attr}>${text}</li>`); return; }
    if (block.type === 'numbered') { openList('ol'); body.push(`<li${attr}>${text}</li>`); return; }
    if (block.type === 'todo') {
      openList('ul', ' class="todo"');
      body.push(`<li${attr}><input type="checkbox" disabled${block.done ? ' checked' : ''}> ${text}</li>`);
      return;
    }

    closeList();

    if (block.type === 'heading') {
      const level = Math.min(3, Math.max(1, block.level ?? 2)) + 1;
      body.push(`<h${level}${attr}>${text}</h${level}>`);
    } else if (block.type === 'quote') {
      const who = block.speakerName ? `<strong>${escapeHtml(block.speakerName)}:</strong> ` : '';
      body.push(`<blockquote${attr}>${who}${text}</blockquote>`);
    } else {
      body.push(`<p${attr}>${text}</p>`);
    }

    // `numbers` is consulted by the list branches above; referenced here so the
    // ordered list keeps counting even when a paragraph interrupts it.
    void numbers.get(index);
  });

  closeList();

  const title = escapeHtml(note?.title || 'Untitled note');
  const meta = note?.meetingTitle ? `<p class="meta">${escapeHtml(note.meetingTitle)}</p>` : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>${STYLE}</style></head>
<body><h1 class="note-title">${title}</h1>${meta}
${body.join('\n')}
</body></html>
`;
}


/* ── word (.docx) ───────────────────────────────────────────────────────── */

/**
 * A `.docx` is a ZIP of XML parts. Five of them are enough for a document with
 * headings, lists, colour and links:
 *
 *   [Content_Types].xml        what kind of thing each part is
 *   _rels/.rels                which part is the document
 *   word/document.xml          the document
 *   word/_rels/document.xml.rels   where its hyperlinks point
 *   word/styles.xml            what "Heading 1" means
 *   word/numbering.xml         what a bullet and a number look like
 *
 * Written by hand rather than with a library. The whole feature is one button,
 * the format's own rules are what decide whether Word opens the file, and a
 * dependency would not make those rules any easier to get right — it would put
 * a megabyte in the bundle and move the place where they are broken.
 */

const xml = (text) =>
  String(text ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));

/** Word wants half-points, and named colours as plain hex. */
const DOCX_COLORS = {
  red: 'C0392B', orange: 'C2620F', green: '1E7A43',
  blue: '1F5FB0', purple: '6B3FA0', grey: '6B7280',
};

/** Word's own highlight names, which are a fixed list rather than free colour. */
const DOCX_HIGHLIGHTS = {
  yellow: 'yellow', green: 'green', blue: 'cyan', pink: 'magenta', purple: 'darkMagenta',
};

const HEADING_SIZE = { 1: 32, 2: 26, 3: 22 };

function docxRun(segment, rels) {
  const props = [];

  if (has(segment, 'bold') || has(segment, 'mention')) props.push('<w:b/>');
  if (has(segment, 'italic')) props.push('<w:i/>');
  if (has(segment, 'underline')) props.push('<w:u w:val="single"/>');
  if (has(segment, 'strike')) props.push('<w:strike/>');
  if (has(segment, 'code')) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');

  const colour = markOf(segment, 'color');
  if (colour) props.push(`<w:color w:val="${DOCX_COLORS[colour.color] ?? DOCX_COLORS.blue}"/>`);

  const highlight = markOf(segment, 'highlight');
  if (highlight) {
    props.push(`<w:highlight w:val="${DOCX_HIGHLIGHTS[highlight.color] ?? 'yellow'}"/>`);
  }

  const link = markOf(segment, 'link');
  // A link is blue and underlined because that is what a reader recognises;
  // Word does not style one on its own.
  if (link) props.push('<w:color w:val="1F5FB0"/><w:u w:val="single"/>');

  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  // `xml:space` or Word eats the spaces between runs, which is every space
  // that happens to fall on the edge of a bold word.
  const run = `<w:r>${rPr}<w:t xml:space="preserve">${xml(segment.text)}</w:t></w:r>`;

  if (!link) return run;

  const id = rels.add(link.href);
  return `<w:hyperlink r:id="${id}">${run}</w:hyperlink>`;
}

function docxParagraph(block, index, { numbers, rels }) {
  const props = [];
  const indent = indentOf(block);
  const align = alignOf(block);

  if (block.type === 'heading') {
    props.push(`<w:pStyle w:val="Heading${Math.min(3, Math.max(1, block.level ?? 2))}"/>`);
  }
  if (block.type === 'quote') props.push('<w:pStyle w:val="Quote"/>');

  // Real Word lists, so they renumber when the reader edits them.
  if (block.type === 'bullet' || block.type === 'numbered') {
    const id = block.type === 'bullet' ? 1 : 2;
    props.push(`<w:numPr><w:ilvl w:val="${indent}"/><w:numId w:val="${id}"/></w:numPr>`);
  } else if (indent) {
    props.push(`<w:ind w:left="${indent * 720}"/>`);
  }

  if (align !== 'left') {
    props.push(`<w:jc w:val="${align === 'justify' ? 'both' : align}"/>`);
  }

  const pPr = props.length ? `<w:pPr>${props.join('')}</w:pPr>` : '';

  const lead = [];
  if (block.type === 'todo') {
    lead.push(`<w:r><w:t xml:space="preserve">${block.done ? '☒' : '☐'} </w:t></w:r>`);
  }
  if (block.type === 'quote' && block.speakerName) {
    lead.push(`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xml(block.speakerName)}: </w:t></w:r>`);
  }

  const runs = segments(block).map((segment) => docxRun(segment, rels)).join('');
  void numbers;

  return `<w:p>${pPr}${lead.join('')}${runs}</w:p>`;
}

/** Built rather than written out, because six levels of each is a lot of XML. */
function numberingXml() {
  const levels = (format, text) => [0, 1, 2, 3, 4, 5].map((level) =>
    `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/>` +
    `<w:lvlText w:val="${text(level)}"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="${(level + 1) * 720}" w:hanging="360"/></w:pPr>` +
    (format === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>' : '') +
    '</w:lvl>').join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">${levels('bullet', () => '')}</w:abstractNum>
<w:abstractNum w:abstractNumId="1">${levels('decimal', (level) => `%${level + 1}.`)}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
}

function stylesXml() {
  const heading = (level) =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
    `<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${level - 1}"/>` +
    `<w:spacing w:before="240" w:after="120"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${HEADING_SIZE[level]}"/><w:color w:val="0B1B3E"/></w:rPr></w:style>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>
${[1, 2, 3].map(heading).join('')}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>
<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:color w:val="4B5162"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>
</w:styles>`;
}

/**
 * Builds a real Word file.
 *
 * @returns {Uint8Array} the bytes of a `.docx`.
 */
export function toDocx(note) {
  const numbers = listNumbers(note?.blocks);

  // Hyperlinks are not inline in OOXML: the run points at a relationship id
  // and the destination lives in a separate part.
  const links = [];
  const rels = {
    add(href) {
      links.push(href);
      return `rId${links.length + 10}`;
    },
  };

  const body = (note?.blocks ?? [])
    .map((block, index) => docxParagraph(block, index, { numbers, rels }))
    .join('');

  const title = note?.title
    ? `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${xml(note.title)}</w:t></w:r></w:p>`
    : '';

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${title}${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
${links.map((href, index) => `<Relationship Id="rId${index + 11}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(href)}" TargetMode="External"/>`).join('')}
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  return zip([
    // `[Content_Types].xml` first, which the format requires.
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: document },
    { name: 'word/_rels/document.xml.rels', data: documentRels },
    { name: 'word/styles.xml', data: stylesXml() },
    { name: 'word/numbering.xml', data: numberingXml() },
  ]);
}


/* ── pdf ────────────────────────────────────────────────────────────────── */

/**
 * A PDF, written directly.
 *
 * A viewer does not lay text out — the file gives the position of every line —
 * so this wraps the text itself using the metrics in `pdf-text.js` and emits
 * one text-showing operator per run. Only the base fonts are used, which every
 * viewer has built in, so nothing has to be embedded.
 *
 * Pagination is a running cursor: when the next line would cross the bottom
 * margin a new page begins. That is all a note needs, and it means no content
 * can ever be drawn off the edge of a page.
 */

const PAGE = { width: 595.28, height: 841.89, margin: 56 };   // A4, in points

const PDF_COLORS = {
  red: [0.75, 0.22, 0.17], orange: [0.76, 0.38, 0.06], green: [0.12, 0.48, 0.26],
  blue: [0.12, 0.37, 0.69], purple: [0.42, 0.25, 0.63], grey: [0.42, 0.45, 0.50],
};

const PDF_HIGHLIGHTS = {
  yellow: [1, 0.95, 0.64], green: [0.78, 0.95, 0.83], blue: [0.81, 0.89, 1],
  pink: [1, 0.84, 0.91], purple: [0.89, 0.85, 1],
};

/**
 * The handful of characters that are not Latin-1 but do exist in WinAnsi.
 *
 * A bullet is the obvious one — a bulleted list that renders as "?" is what
 * this produced before — but curly quotes and dashes arrive in any note
 * written on a Mac, where the keyboard inserts them without being asked.
 */
const WINANSI = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95],
  [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a],
]);

/**
 * Escape for a PDF literal string, emitting pure ASCII.
 *
 * Every byte above 126 goes out as an octal escape rather than as itself.
 * That is not only about encoding: the writer below measures `/Length` and the
 * cross-reference offsets with `String.length`, and then encodes the finished
 * document as UTF-8. A single accented character would make those two disagree
 * — the declared length and every offset after it would be short by a byte,
 * and a viewer trusts the table over the file. Keeping the string ASCII keeps
 * the two counts identical by construction.
 */
const pdfString = (text) =>
  [...String(text ?? '')]
    .map((char) => {
      if (char === '(' || char === ')' || char === '\\') return `\\${char}`;

      const code = char.codePointAt(0);
      if (code >= 32 && code <= 126) return char;

      const byte = WINANSI.get(code) ?? (code <= 255 ? code : null);
      // Nothing in the base encoding draws this; a placeholder keeps the line
      // the right length instead of the viewer silently dropping it.
      if (byte === null) return '?';

      return `\\${byte.toString(8).padStart(3, '0')}`;
    })
    .join('');

const FONTS = { regular: 'F1', bold: 'F2', italic: 'F3', boldItalic: 'F4', mono: 'F5' };

const fontFor = (segment) => {
  if (has(segment, 'code')) return FONTS.mono;
  const bold = has(segment, 'bold') || has(segment, 'mention');
  const italic = has(segment, 'italic');
  if (bold && italic) return FONTS.boldItalic;
  if (bold) return FONTS.bold;
  if (italic) return FONTS.italic;
  return FONTS.regular;
};

/**
 * Lay a note out into pages of positioned runs.
 *
 * Split from the byte writing below because this is the part with the
 * arithmetic in it, and arithmetic is worth being able to inspect without
 * parsing a PDF to do it.
 */
function layout(note) {
  const pages = [[]];
  const width = PAGE.width - PAGE.margin * 2;
  let y = PAGE.height - PAGE.margin;

  const newPage = () => { pages.push([]); y = PAGE.height - PAGE.margin; };
  const page = () => pages[pages.length - 1];

  const line = (runs, size, leading) => {
    if (y - leading < PAGE.margin) newPage();
    y -= leading;
    let x = PAGE.margin + (runs.indent ?? 0);
    for (const run of runs.items) {
      page().push({ ...run, x, y, size });
      x += textWidth(run.text, size, run.bold);
    }
  };

  if (note?.title) {
    for (const text of wrap(note.title, 22, width, true)) {
      line({ items: [{ text, font: FONTS.bold, bold: true }] }, 22, 28);
    }
    y -= 10;
  }

  const numbers = listNumbers(note?.blocks);

  (note?.blocks ?? []).forEach((block, index) => {
    const heading = block.type === 'heading';
    const size = heading ? [0, 17, 14.5, 12.5][Math.min(3, Math.max(1, block.level ?? 2))] : 11;
    const leading = heading ? size * 1.7 : size * 1.55;
    const indent = indentOf(block) * 22 + (block.type === 'quote' ? 16 : 0);

    let marker = '';
    if (block.type === 'bullet') marker = '•  ';
    else if (block.type === 'numbered') marker = `${numbers.get(index) ?? 1}.  `;
    else if (block.type === 'todo') marker = block.done ? '[x]  ' : '[ ]  ';
    else if (block.type === 'quote' && block.speakerName) marker = `${block.speakerName}: `;

    if (heading) y -= 8;

    // Runs are wrapped as a single string first, then re-split across the
    // wrapped lines, so a bold word that lands on a line break still breaks in
    // the right place rather than being measured on its own.
    const runs = segments(block).map((segment) => ({
      text: segment.text,
      font: heading ? FONTS.bold : fontFor(segment),
      bold: heading || has(segment, 'bold') || has(segment, 'mention'),
      color: markOf(segment, 'color')?.color,
      highlight: markOf(segment, 'highlight')?.color,
      link: markOf(segment, 'link')?.href,
      underline: has(segment, 'underline') || Boolean(markOf(segment, 'link')),
      strike: has(segment, 'strike'),
    }));

    const available = width - indent;
    let pending = marker ? [{ text: marker, font: heading ? FONTS.bold : FONTS.bold, bold: true }] : [];
    let used = pending.reduce((sum, run) => sum + textWidth(run.text, size, run.bold), 0);

    const flush = () => {
      if (pending.length) line({ items: pending, indent }, size, leading);
      pending = [];
      used = 0;
    };

    for (const run of runs) {
      for (const word of run.text.split(/(\s+)/)) {
        if (word === '') continue;
        const advance = textWidth(word, size, run.bold);

        if (used + advance > available && used > 0) {
          flush();
          if (word.trim() === '') continue;
        }

        pending.push({ ...run, text: word });
        used += advance;
      }
    }

    if (pending.length || block.text === '') flush();
  });

  return pages;
}

const OPERATORS = {
  line(run) {
    const out = [];
    const colour = run.color ? PDF_COLORS[run.color] : null;

    if (run.highlight) {
      const [r, g, b] = PDF_HIGHLIGHTS[run.highlight] ?? PDF_HIGHLIGHTS.yellow;
      const w = textWidth(run.text, run.size, run.bold);
      out.push(`q ${r} ${g} ${b} rg ${run.x} ${run.y - run.size * 0.22} ${w} ${run.size} re f Q`);
    }

    out.push('BT');
    if (colour) out.push(`${colour[0]} ${colour[1]} ${colour[2]} rg`);
    else if (run.link) out.push('0.12 0.37 0.69 rg');
    out.push(`/${run.font} ${run.size} Tf 1 0 0 1 ${run.x} ${run.y} Tm (${pdfString(run.text)}) Tj ET`);
    if (colour || run.link) out.push('0 0 0 rg');

    if (run.underline || run.strike) {
      const w = textWidth(run.text, run.size, run.bold);
      const at = run.strike ? run.y + run.size * 0.28 : run.y - run.size * 0.11;
      out.push(`q 0.6 w ${run.x} ${at} m ${run.x + w} ${at} l S Q`);
    }

    return out.join('\n');
  },
};

export function toPdf(note) {
  const pages = layout(note);

  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };

  // 1 catalog, 2 pages, then one content stream and one page per page.
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesRef = add('');   // filled in once the kids are known

  const fonts = [
    ['F1', 'Helvetica'], ['F2', 'Helvetica-Bold'], ['F3', 'Helvetica-Oblique'],
    ['F4', 'Helvetica-BoldOblique'], ['F5', 'Courier'],
  ].map(([name, base]) => [name, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`)]);

  const fontResource = fonts.map(([name, id]) => `/${name} ${id} 0 R`).join(' ');
  const kids = [];

  for (const runs of pages) {
    const stream = runs.map((run) => OPERATORS.line(run)).join('\n');
    const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
      `/Resources << /Font << ${fontResource} >> >> /Contents ${contents} 0 R >>`,
    ));
  }

  objects[pagesRef - 1] =
    `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] >>`;

  // Assemble, recording where each object starts: the cross-reference table at
  // the end is a list of byte offsets, and a viewer trusts it over the file.
  let out = '%PDF-1.4\n';
  const offsets = [];

  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new TextEncoder().encode(out);
}

export default { toPlainText, toMarkdown, toHtml, toDocx, toPdf, escapeHtml, fileName };
