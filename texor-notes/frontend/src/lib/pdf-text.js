/**
 * Widths for the PDF base fonts, and the line breaking they make possible.
 *
 * A PDF viewer does not wrap text — the file says where every line begins, so
 * whatever writes it has to know how wide a string is. These are the standard
 * Helvetica metrics that every conforming viewer ships, in 1/1000 em, for the
 * printable ASCII range.
 *
 * Separate from the writer so the numbers can be checked on their own: a
 * mistake in here does not fail, it produces a document whose lines are subtly
 * too long or too short, which is the kind of thing only a test notices.
 */

/* eslint-disable no-multi-spaces */
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
/* eslint-enable no-multi-spaces */

/** Anything outside the table — an em dash, an accent — is assumed average. */
const FALLBACK = 556;

export function charWidth(code, bold = false) {
  const table = bold ? BOLD : REGULAR;
  const index = code - 32;
  return index >= 0 && index < table.length ? table[index] : FALLBACK;
}

/** Width of a string at a given point size. */
export function textWidth(text, size, bold = false) {
  let total = 0;
  for (const char of String(text ?? '')) total += charWidth(char.codePointAt(0), bold);
  return (total * size) / 1000;
}

/**
 * Break a string into lines that fit.
 *
 * Breaks at spaces, and only inside a word when the word alone is wider than
 * the column — a URL in a narrow margin, which would otherwise run off the
 * page rather than wrap.
 */
export function wrap(text, size, maxWidth, bold = false) {
  const lines = [];
  let line = '';

  const push = () => { lines.push(line); line = ''; };

  for (const word of String(text ?? '').split(/(\s+)/)) {
    if (word === '') continue;

    const candidate = line + word;
    if (textWidth(candidate, size, bold) <= maxWidth || line === '') {
      // A word that cannot fit on a line of its own is cut rather than left to
      // overflow; anything else would put ink outside the margin.
      if (line === '' && textWidth(word, size, bold) > maxWidth) {
        let piece = '';
        for (const char of word) {
          if (textWidth(piece + char, size, bold) > maxWidth && piece !== '') {
            lines.push(piece);
            piece = '';
          }
          piece += char;
        }
        line = piece;
        continue;
      }
      line = candidate;
      continue;
    }

    push();
    // A line never begins with the space that caused the break.
    line = word.trim() === '' ? '' : word;
  }

  if (line !== '') push();

  return lines.length ? lines.map((entry) => entry.replace(/\s+$/, '')) : [''];
}

export default { charWidth, textWidth, wrap };
