/**
 * The shape of a note, and the rules that keep one well-formed.
 *
 * ── Why a structured document and not HTML ──
 *
 * A note has bold text, highlights, and people tagged in it. The obvious way to
 * store that is HTML from a `contentEditable`, and it is the wrong way: the
 * server would then be storing markup written by a browser, and every read path
 * becomes a sanitiser you have to get right forever.
 *
 * So a block stores **plain text** plus **marks** — `{ start, end, type }`
 * ranges over that text. Nothing that arrives here is markup, nothing that
 * leaves here is markup, and the client builds its own DOM from the ranges. An
 * attacker's best case is a note containing the literal characters `<script>`,
 * which renders as those characters.
 *
 * The frontend has its own model in `lib/notes-doc.js` for editing. That is not
 * duplication to be tidied away later: the server must not trust the client's
 * idea of a valid document, so it has to be able to decide for itself.
 */

/** Inline marks. `mention` is the one that carries an identity with it. */
export const MARK_TYPES = [
  'bold', 'italic', 'underline', 'strike', 'code',
  'highlight', 'color', 'link', 'mention',
];

/**
 * Highlighter colours, named rather than free-form.
 *
 * A colour the client picks is a colour that has to survive a redesign and a
 * dark theme. Names let the stylesheet decide what "yellow" actually is, and
 * stop a note from carrying `#ff00ff` into a palette that has no place for it.
 */
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'];

/** Text colour, named for the same reason the highlighter is. */
export const TEXT_COLORS = ['red', 'orange', 'green', 'blue', 'purple', 'grey'];

export const BLOCK_TYPES = ['paragraph', 'heading', 'bullet', 'numbered', 'todo', 'quote'];

export const HEADING_LEVELS = [1, 2, 3];
export const ALIGNMENTS = ['left', 'center', 'right', 'justify'];
export const MAX_INDENT = 5;

/**
 * Schemes a link may use.
 *
 * An allowlist, not a blocklist. `javascript:` is the one everybody remembers,
 * but `data:` carries a whole document and `vbscript:` still exists — and a
 * note is written by one person and read by another, which is exactly the
 * shape of thing that turns a stored link into a stored attack. Anything not
 * named here is not a link and the mark is dropped, leaving the words behind.
 */
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function safeHref(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text || text.length > 2000) return '';

  // A bare domain is what people paste and type; assume the web's own scheme
  // rather than rejecting it, but never assume one for anything with a colon
  // already in it, or `javascript:alert(1)` becomes `https://javascript:...`.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;

  try {
    const url = new URL(candidate);
    return LINK_SCHEMES.has(url.protocol.toLowerCase()) ? url.href : '';
  } catch {
    return '';
  }
}

/** Caps. Generous for a real note, small enough that one cannot be a payload. */
export const LIMITS = {
  title: 200,
  blocks: 800,
  text: 5000,
  marksPerBlock: 300,
  name: 120,
};

const clampInt = (value, low, high) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(Math.max(Math.round(number), low), high);
};

const clean = (value, max) =>
  typeof value === 'string'
    // Control characters cannot survive a round trip through the editor and are
    // the usual way a "plain text" field stops being plain.
    ? [...value].filter((char) => char >= ' ' || char === '\t').join('').slice(0, max)
    : '';

/**
 * One mark, or `null` if it cannot be made sense of.
 *
 * Clamped to the text rather than rejected: a mark that runs past the end of
 * its text is what an editor produces when a keystroke and a save race, and
 * throwing the whole note away over it would be a poor trade.
 */
function sanitiseMark(raw, textLength) {
  if (!raw || typeof raw !== 'object') return null;
  if (!MARK_TYPES.includes(raw.type)) return null;

  const start = clampInt(raw.start, 0, textLength);
  const end = clampInt(raw.end, 0, textLength);
  if (start === null || end === null || end <= start) return null;

  const mark = { type: raw.type, start, end };

  if (raw.type === 'highlight') {
    mark.color = HIGHLIGHT_COLORS.includes(raw.color) ? raw.color : 'yellow';
  }

  if (raw.type === 'color') {
    // An unknown colour falls back rather than dropping the mark: the words
    // were meant to stand out, and the safest way to honour that is a colour
    // the stylesheet knows.
    mark.color = TEXT_COLORS.includes(raw.color) ? raw.color : 'blue';
  }

  if (raw.type === 'link') {
    const href = safeHref(raw.href);
    // No destination means no link. The text stays; only the mark goes.
    if (!href) return null;
    mark.href = href;
  }

  if (raw.type === 'mention') {
    // A mention with nobody behind it is just styled text, and storing it as a
    // mention would put a phantom into "notes that mention me".
    const texorId = clean(raw.texorId, 100).trim();
    if (!texorId) return null;
    mark.texorId = texorId;
    mark.name = clean(raw.name, LIMITS.name).trim();
  }

  return mark;
}

/** One block, or `null` if there is nothing left of it worth storing. */
function sanitiseBlock(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const type = BLOCK_TYPES.includes(raw.type) ? raw.type : 'paragraph';
  const text = clean(raw.text, LIMITS.text);

  const marks = (Array.isArray(raw.marks) ? raw.marks : [])
    .map((mark) => sanitiseMark(mark, text.length))
    .filter(Boolean)
    .slice(0, LIMITS.marksPerBlock)
    // Ordered by where they start, so two documents with the same meaning
    // serialise the same way and a diff between saves is readable.
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const block = { type, text, marks };

  // Paragraph properties. Each is stored only where it means something, and
  // only when it differs from the default, so an untouched note carries none.
  if (type === 'heading') {
    block.level = HEADING_LEVELS.includes(Number(raw.level)) ? Number(raw.level) : 2;
  }

  if (ALIGNMENTS.includes(raw.align) && raw.align !== 'left') block.align = raw.align;

  const indent = clampInt(raw.indent, 0, MAX_INDENT);
  if (indent) block.indent = indent;

  if (type === 'todo') block.done = Boolean(raw.done);

  if (type === 'quote') {
    const texorId = clean(raw.speakerTexorId, 100).trim();
    if (texorId) {
      block.speakerTexorId = texorId;
      block.speakerName = clean(raw.speakerName, LIMITS.name).trim();
    }
    // When in the meeting it was said. Only meaningful on a quote, which is the
    // one block type that is a record of a moment rather than a thought.
    const at = raw.at ? new Date(raw.at) : null;
    if (at && !Number.isNaN(at.getTime())) block.at = at;
  }

  return block;
}

/**
 * A whole document, made safe to store.
 *
 * Empty blocks are kept — they are paragraph breaks somebody typed on purpose —
 * but a run of them at the end is not, because that is just where the cursor
 * was resting when the note was last saved.
 */
export function sanitiseBlocks(raw) {
  const blocks = (Array.isArray(raw) ? raw : [])
    .map(sanitiseBlock)
    .filter(Boolean)
    .slice(0, LIMITS.blocks);

  while (blocks.length > 0) {
    const last = blocks[blocks.length - 1];
    if (last.text.trim() === '' && last.type === 'paragraph') blocks.pop();
    else break;
  }

  return blocks;
}

/**
 * Everyone tagged anywhere in the note, each listed once.
 *
 * Derived on write rather than asked for, so it cannot disagree with the text —
 * and indexed, which is what makes "notes that mention me" one query instead of
 * a scan through everybody's documents.
 */
export function mentionsOf(blocks) {
  const seen = new Map();

  for (const block of blocks ?? []) {
    for (const mark of block.marks ?? []) {
      if (mark.type !== 'mention' || !mark.texorId) continue;
      // Last name written wins, so a note keeps up with somebody renaming
      // themselves without needing a migration.
      seen.set(mark.texorId, mark.name ?? '');
    }
  }

  return [...seen].map(([texorId, name]) => ({ texorId, name }));
}

/** The note as plain prose. Used for search and for the preview line. */
export function plainText(blocks) {
  return (blocks ?? []).map((block) => block.text ?? '').join('\n');
}

/**
 * The line shown under a note's title in a list.
 *
 * Built from the text rather than the first block, so a note that opens with a
 * heading or an empty line still says something about itself.
 */
export function preview(blocks, length = 160) {
  const text = plainText(blocks).replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

/** How much is actually in here, for a list that wants to say so. */
export function noteStats(blocks) {
  const text = plainText(blocks);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  let highlights = 0;
  let todo = 0;
  let done = 0;

  for (const block of blocks ?? []) {
    for (const mark of block.marks ?? []) if (mark.type === 'highlight') highlights += 1;
    if (block.type === 'todo') {
      todo += 1;
      if (block.done) done += 1;
    }
  }

  return { words, highlights, todo, done };
}

/**
 * Everyone named in a note's shares who actually has an account yet.
 *
 * Kept beside the sanitiser because it is the same kind of thing: a derived
 * field recomputed on every save, so no caller can set it to something
 * convenient.
 */
export function sharedIdsOf(shares) {
  return [...new Set((shares ?? []).map((share) => share.texorId).filter(Boolean))];
}

export default {
  MARK_TYPES,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  BLOCK_TYPES,
  HEADING_LEVELS,
  ALIGNMENTS,
  MAX_INDENT,
  LIMITS,
  sanitiseBlocks,
  safeHref,
  mentionsOf,
  plainText,
  preview,
  noteStats,
  sharedIdsOf,
};
