/**
 * The note document, and the operations an editor performs on it.
 *
 * A block is `{ type, text, marks }` where `text` is plain and `marks` are
 * `{ start, end, type }` ranges over it. Offsets are UTF-16 code units, which is
 * what `String.length`, DOM text offsets and `Range.toString().length` all
 * count in — mixing in code points would misplace every mark after an emoji.
 *
 * ── Why the model and not the DOM ──
 *
 * The tempting way to build a rich text editor is `document.execCommand`: let
 * the browser wrap things in tags and read the HTML back. It is also how you
 * end up storing `<span style="background-color:#ffff00">` and writing a parser
 * for whatever each browser felt like emitting.
 *
 * Instead every formatting action is a pure function on the model here, and the
 * DOM is rebuilt from the result. The browser is never asked to decide what a
 * document means. Everything in this file above `readBlock` is testable without
 * a browser at all, which is the other half of the point.
 */

export const HIGHLIGHTS = [
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'pink', label: 'Pink' },
  { id: 'purple', label: 'Purple' },
];

/** Text colour, as distinct from the highlighter behind it. */
export const TEXT_COLORS = [
  { id: 'red', label: 'Red' },
  { id: 'orange', label: 'Orange' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'purple', label: 'Purple' },
  { id: 'grey', label: 'Grey' },
];

/** Every inline mark. The backend's schema has to allow exactly this set. */
export const MARK_TYPES = [
  'bold', 'italic', 'underline', 'strike', 'code',
  'highlight', 'color', 'link', 'mention',
];

export const BLOCK_TYPES = ['paragraph', 'heading', 'bullet', 'numbered', 'todo', 'quote'];

/** Heading sizes, as a word processor offers them. */
export const HEADING_LEVELS = [1, 2, 3];

export const ALIGNMENTS = ['left', 'center', 'right', 'justify'];

/**
 * How far a block can be pushed in.
 *
 * Bounded because indentation is stored as a number and rendered as padding:
 * without a ceiling a held-down Tab walks the text off the side of the page,
 * and the document has no way back from a value nothing renders.
 */
export const MAX_INDENT = 5;

/**
 * Marks a character may carry only one of.
 *
 * Two highlight colours over the same word has no meaning anybody could see,
 * and two mentions over one character could not resolve to a person. The same
 * goes for two text colours, and for a character that is inside two links —
 * a click could only follow one of them. Applying one of these clears any
 * other of the same type underneath it first.
 */
const EXCLUSIVE = new Set(['highlight', 'color', 'link', 'mention']);

/**
 * The field that distinguishes two marks of the same type.
 *
 * Yellow highlight and green highlight are different marks; bold and bold are
 * not. This used to be hard-coded to `color`, which worked while the
 * highlighter was the only mark with a variant — a link would have compared
 * equal to every other link and merged two different destinations into one.
 */
const VARIANT = { highlight: 'color', color: 'color', link: 'href' };

export const variantOf = (mark) => (VARIANT[mark.type] ? mark[VARIANT[mark.type]] ?? '' : '');

export const emptyBlock = (type = 'paragraph') => ({ type, text: '', marks: [] });
export const emptyDoc = () => [emptyBlock()];

/** Identity for coalescing. Two marks with the same key are the same styling. */
const SEP = String.fromCharCode(31);
const keyOf = (mark) => [mark.type, variantOf(mark), mark.texorId ?? ''].join(SEP);

const sameKind = (mark, type, variant) =>
  mark.type === type && (!VARIANT[type] || variantOf(mark) === (variant ?? ''));

/** The marks covering one character. */
export function marksAt(block, index) {
  return (block.marks ?? []).filter((mark) => mark.start <= index && mark.end > index);
}

/**
 * Rebuild a mark list from a per-character view.
 *
 * Going through characters and back is O(text × marks) rather than clever, and
 * a note is a few thousand characters. Range arithmetic that splits and merges
 * marks in place is where editors grow their subtlest bugs, and this cannot
 * produce an overlapping or inverted range at all.
 */
function coalesce(text, perChar) {
  const marks = [];
  const open = new Map();

  for (let index = 0; index <= text.length; index += 1) {
    const here = new Map((perChar[index] ?? []).map((mark) => [keyOf(mark), mark]));

    for (const [key, entry] of [...open]) {
      if (here.has(key)) continue;
      marks.push({ ...entry.mark, start: entry.start, end: index });
      open.delete(key);
    }

    for (const [key, mark] of here) {
      if (!open.has(key)) open.set(key, { mark, start: index });
    }
  }

  return marks.sort((left, right) => left.start - right.start || left.end - right.end);
}

const spread = (block) => {
  const perChar = [];
  for (let index = 0; index < block.text.length; index += 1) perChar.push(marksAt(block, index));
  return perChar;
};

/** Does every character in the range already carry this mark? */
export function rangeHasMark(block, from, to, type, color) {
  if (to <= from) return false;
  for (let index = from; index < to; index += 1) {
    if (!marksAt(block, index).some((mark) => sameKind(mark, type, color))) return false;
  }
  return true;
}

export function addMark(block, from, to, mark) {
  if (to <= from) return block;

  const perChar = spread(block);
  for (let index = from; index < to; index += 1) {
    const existing = EXCLUSIVE.has(mark.type)
      ? perChar[index].filter((current) => current.type !== mark.type)
      : perChar[index].filter((current) => keyOf(current) !== keyOf(mark));
    perChar[index] = [...existing, mark];
  }

  return { ...block, marks: coalesce(block.text, perChar) };
}

export function removeMark(block, from, to, type, color) {
  if (to <= from) return block;

  const perChar = spread(block);
  for (let index = from; index < to; index += 1) {
    perChar[index] = perChar[index].filter((mark) => !sameKind(mark, type, color));
  }

  return { ...block, marks: coalesce(block.text, perChar) };
}

/**
 * The one an editor actually calls: on if it was off, off if it was on.
 *
 * "On" means *every* character in the selection carries it, which is what makes
 * dragging across a half-bold phrase bold the whole thing rather than clearing
 * the part that was already bold.
 */
export function toggleMark(block, from, to, mark) {
  const range = snapToMentions(block, from, to);
  if (range.to <= range.from) return block;

  const variant = variantOf(mark);

  return rangeHasMark(block, range.from, range.to, mark.type, variant)
    ? removeMark(block, range.from, range.to, mark.type, variant)
    : addMark(block, range.from, range.to, mark);
}

/**
 * Grow a range so it never cuts a mention in half.
 *
 * Half a mention is not a thing: the name is one object to the reader, and a
 * highlight over "@Kris" of "@Krishna" would render as a torn chip. Growing
 * rather than shrinking, so the user's selection still gets what they asked
 * for plus the rest of the word they clearly meant.
 */
export function snapToMentions(block, from, to) {
  let start = from;
  let end = to;

  for (const mark of block.marks ?? []) {
    if (mark.type !== 'mention') continue;
    if (mark.start < start && mark.end > start) start = mark.start;
    if (mark.start < end && mark.end > end) end = mark.end;
  }

  return { from: start, to: end };
}

/**
 * Replace a range of text, carrying the marks around it with it.
 *
 * Every mark boundary is mapped through the edit: before the cut it stays, after
 * it shifts, inside it collapses onto the cut point. A mark that covered only
 * the replaced text collapses to nothing and is dropped, which is right — the
 * text it described is gone.
 */
export function spliceText(block, from, to, insert = '') {
  const delta = insert.length - (to - from);
  const map = (position) => {
    if (position <= from) return position;
    if (position >= to) return position + delta;
    return from;
  };

  const text = block.text.slice(0, from) + insert + block.text.slice(to);
  const marks = (block.marks ?? [])
    .map((mark) => ({ ...mark, start: map(mark.start), end: map(mark.end) }))
    .filter((mark) => mark.end > mark.start);

  return { ...block, text, marks };
}

/**
 * Turn a half-typed `@kris` into a real mention of a real person.
 *
 * The stored text is `@Their Name`, so a note still reads correctly everywhere
 * the marks are not rendered — an export, a search index, a preview line.
 */
export function insertMention(block, from, to, person, { trailingSpace = true } = {}) {
  const label = `@${person.name}`;
  const inserted = trailingSpace ? `${label} ` : label;

  const spliced = spliceText(block, from, to, inserted);

  return addMark(spliced, from, from + label.length, {
    type: 'mention',
    texorId: person.texorId,
    name: person.name,
  });
}

/**
 * The `@…` being typed just before the caret, if there is one.
 *
 * Anchored to the start of a word so an email address in the middle of a
 * sentence does not open a people picker. No spaces in the query: allowing them
 * means the picker can never tell "@ann smith" from "@ann" followed by a word,
 * and the failure mode is a popover that will not go away.
 */
const MENTION_OPENER = /(?:^|[\s([{"'-])@([^\s@]{0,40})$/u;

export function mentionQuery(text, caret) {
  const before = text.slice(0, caret);
  const match = MENTION_OPENER.exec(before);
  if (!match) return null;

  const query = match[1];
  return { query, from: caret - query.length - 1, to: caret };
}

/** Rank people for the picker: what you typed, against what they are called. */
export function matchPeople(people, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return people;

  return people
    .map((person) => {
      const name = (person.name ?? '').toLowerCase();
      const words = name.split(/\s+/);

      // Start of the name beats start of a later word beats anywhere at all, so
      // typing "kr" puts Krishna above Mark Rowe.
      if (name.startsWith(needle)) return { person, rank: 0 };
      if (words.some((word) => word.startsWith(needle))) return { person, rank: 1 };
      if (name.includes(needle)) return { person, rank: 2 };
      return null;
    })
    .filter(Boolean)
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => entry.person);
}

/**
 * Split a block into runs of identically-styled text.
 *
 * Every boundary of every mark becomes a cut point, so each run carries one
 * unchanging set of marks and can be rendered as one element. This is what both
 * the editor and the read-only view build their DOM from, which is why a note
 * looks the same in both.
 */
export function segments(block) {
  const text = block?.text ?? '';
  const marks = block?.marks ?? [];

  const points = new Set([0, text.length]);
  for (const mark of marks) {
    if (mark.start > 0 && mark.start < text.length) points.add(mark.start);
    if (mark.end > 0 && mark.end < text.length) points.add(mark.end);
  }

  const cuts = [...points].sort((left, right) => left - right);
  const out = [];

  for (let index = 0; index < cuts.length - 1; index += 1) {
    const from = cuts[index];
    const to = cuts[index + 1];
    if (to <= from) continue;

    out.push({
      from,
      to,
      text: text.slice(from, to),
      marks: marks.filter((mark) => mark.start <= from && mark.end >= to),
    });
  }

  return out;
}

export const hasType = (segment, type) => segment.marks.some((mark) => mark.type === type);
export const markOfType = (segment, type) => segment.marks.find((mark) => mark.type === type);

/** The note as plain prose — previews, exports, and anything that counts words. */
/**
 * Block shape: type, and the three properties a word processor puts on a
 * paragraph rather than on the characters inside it.
 *
 * They live on the block because that is what they describe. Alignment over
 * half a paragraph is not a thing anybody can see, and neither is half an
 * indent — storing them as ranges would allow documents that cannot be drawn.
 */
const clampLevel = (level) => (HEADING_LEVELS.includes(Number(level)) ? Number(level) : 2);

/**
 * `level` only means anything on a heading, so it is dropped elsewhere rather
 * than carried invisibly: a paragraph that remembers it used to be an H1 turns
 * back into one the next time somebody presses the heading button.
 */
export function setBlockType(block, type, { level } = {}) {
  if (!BLOCK_TYPES.includes(type)) return block;

  const next = { ...block, type };

  if (type === 'heading') next.level = clampLevel(level ?? block.level);
  else delete next.level;

  // Only a todo has a tick; only a quote has a speaker.
  if (type !== 'todo') delete next.done;
  if (type !== 'quote') { delete next.speakerTexorId; delete next.speakerName; delete next.at; }

  return next;
}

export function setAlign(block, align) {
  if (!ALIGNMENTS.includes(align)) return block;

  const next = { ...block, align };
  // Left is the default, so it is stored as absence rather than as a value —
  // otherwise every paragraph ever typed carries a property that means nothing.
  if (align === 'left') delete next.align;

  return next;
}

export const alignOf = (block) => (ALIGNMENTS.includes(block?.align) ? block.align : 'left');

export const indentOf = (block) => {
  const level = Number(block?.indent);
  if (!Number.isFinite(level)) return 0;
  return Math.min(MAX_INDENT, Math.max(0, Math.floor(level)));
};

/** Push in or pull out by one step, never past either end. */
export function indentBy(block, delta) {
  const level = Math.min(MAX_INDENT, Math.max(0, indentOf(block) + delta));

  const next = { ...block, indent: level };
  if (level === 0) delete next.indent;

  return next;
}

/**
 * The number each item in an ordered list shows.
 *
 * Counting is derived, never stored. A stored number is wrong the moment
 * somebody inserts an item above it, and then the document disagrees with
 * itself — this way the list cannot be out of order, only rendered.
 *
 * A run restarts when the list is broken by another kind of block, and each
 * indent level counts on its own, so a nested list starts at 1 and the outer
 * list carries on where it left off underneath.
 */
export function listNumbers(blocks) {
  const numbers = new Map();
  const counters = [];

  (blocks ?? []).forEach((block, index) => {
    if (block?.type !== 'numbered') {
      counters.length = 0;
      return;
    }

    const depth = indentOf(block);
    // Coming back out of a nested level abandons its count, so going in again
    // starts from 1 rather than resuming a list the reader has stopped seeing.
    counters.length = depth + 1;
    counters[depth] = (counters[depth] ?? 0) + 1;

    numbers.set(index, counters[depth]);
  });

  return numbers;
}

export const plainText = (blocks) => (blocks ?? []).map((block) => block.text ?? '').join('\n');

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

/* ── DOM, from here down ──────────────────────────────────────────────────── */

/**
 * Read a block element back into the model.
 *
 * Walks children rather than trusting `innerHTML`: a `<span>` we wrote
 * contributes its mark, anything a browser or a paste invented contributes only
 * its text. That is what keeps foreign markup from ever reaching the server —
 * it is dropped here, at the only door in.
 *
 * Nesting works because each element records its own range as the walk passes
 * through it, so bold inside a highlight yields both marks over the right spans.
 */
export function readBlock(el, type = 'paragraph') {
  const marks = [];
  let text = '';

  const markOf = (node) => {
    const mention = node.dataset?.texorId;
    if (mention) return { type: 'mention', texorId: mention, name: node.dataset.name ?? node.textContent };

    const kind = node.dataset?.mark;
    if (!kind) return null;
    return kind === 'highlight'
      ? { type: 'highlight', color: node.dataset.color ?? 'yellow' }
      : { type: kind };
  };

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        text += child.nodeValue;
        continue;
      }
      if (child.nodeType !== 1) continue;
      // A trailing <br> is how browsers keep an empty line from collapsing. It
      // is furniture, not content, and each block here is a single line anyway.
      if (child.tagName === 'BR') continue;

      const mark = markOf(child);
      const start = text.length;
      walk(child);
      if (mark && text.length > start) marks.push({ ...mark, start, end: text.length });
    }
  };

  walk(el);

  return { type, text, marks: marks.sort((l, r) => l.start - r.start || l.end - r.end) };
}

const span = (attrs, text) => {
  const el = document.createElement('span');
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
};

/**
 * Build a block's DOM from the model.
 *
 * Only ever called when the model changed underneath the editor — on load, and
 * after a formatting command. While somebody is simply typing, the browser owns
 * the DOM and we read from it; rewriting on every keystroke would fight the
 * caret and break input methods that compose over several of them.
 */
export function writeBlock(el, block) {
  el.textContent = '';

  const runs = segments(block);
  if (runs.length === 0) {
    el.appendChild(document.createElement('br'));
    return;
  }

  let openMention = null;
  let openMentionEl = null;

  for (const run of runs) {
    const mention = markOfType(run, 'mention');

    if (mention) {
      // A mention is one object to the reader and one keystroke to delete, so
      // consecutive runs of the same mention become a single atomic element.
      if (openMention === mention && openMentionEl) {
        openMentionEl.textContent += run.text;
        continue;
      }
      const chip = span(
        {
          'data-texor-id': mention.texorId,
          'data-name': mention.name ?? '',
          class: 'note-mention',
          contenteditable: 'false',
        },
        run.text,
      );
      el.appendChild(chip);
      openMention = mention;
      openMentionEl = chip;
      continue;
    }

    openMention = null;
    openMentionEl = null;

    // Highlight outermost so its background sits behind the rest.
    let node = document.createTextNode(run.text);
    for (const type of ['code', 'italic', 'bold']) {
      if (!hasType(run, type)) continue;
      const wrapper = span({ 'data-mark': type, class: `note-${type}` });
      wrapper.appendChild(node);
      node = wrapper;
    }
    const highlight = markOfType(run, 'highlight');
    if (highlight) {
      const wrapper = span({
        'data-mark': 'highlight',
        'data-color': highlight.color ?? 'yellow',
        class: `note-highlight note-highlight--${highlight.color ?? 'yellow'}`,
      });
      wrapper.appendChild(node);
      node = wrapper;
    }

    el.appendChild(node);
  }
}

/** Where the caret is, as an offset into the block's plain text. */
export function caretOffset(el) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!el.contains(range.endContainer)) return null;

  const measure = range.cloneRange();
  measure.selectNodeContents(el);
  measure.setEnd(range.endContainer, range.endOffset);
  return measure.toString().length;
}

/** The selection within a block, as plain-text offsets. */
export function selectionRange(el) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;

  const start = range.cloneRange();
  start.selectNodeContents(el);
  start.setEnd(range.startContainer, range.startOffset);

  const end = range.cloneRange();
  end.selectNodeContents(el);
  end.setEnd(range.endContainer, range.endOffset);

  const from = start.toString().length;
  const to = end.toString().length;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

/** Find the text node and offset that a plain-text offset lands on. */
function locate(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let last = null;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    last = node;
    if (seen + node.nodeValue.length >= offset) return { node, offset: offset - seen };
    seen += node.nodeValue.length;
  }

  return last ? { node: last, offset: last.nodeValue.length } : null;
}

export function setSelection(el, from, to = from) {
  const start = locate(el, from);
  const end = locate(el, to);
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  if (start) range.setStart(start.node, start.offset);
  else range.setStart(el, 0);
  if (end) range.setEnd(end.node, end.offset);
  else range.setEnd(el, el.childNodes.length);

  selection.removeAllRanges();
  selection.addRange(range);
}

export default {
  HIGHLIGHTS,
  BLOCK_TYPES,
  emptyBlock,
  emptyDoc,
  marksAt,
  rangeHasMark,
  addMark,
  removeMark,
  toggleMark,
  snapToMentions,
  spliceText,
  insertMention,
  mentionQuery,
  matchPeople,
  segments,
  plainText,
  noteStats,
  readBlock,
  writeBlock,
  caretOffset,
  selectionRange,
  setSelection,
};
