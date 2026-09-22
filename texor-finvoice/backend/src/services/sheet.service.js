/**
 * Spreadsheets, in and out. One shape both ways: an array of rows, each row an
 * array of cell values, the first row the headings.
 *
 * CSV is parsed and written here rather than by a library — it is twenty lines,
 * and no library knows that a cell starting with `=` is a formula to Excel but a
 * customer's name to us. `.xlsx` is a zip of XML, so that one is a library's job.
 *
 * The format is decided by what is *in* the file, never by its name or its
 * content type: Windows sends `application/vnd.ms-excel` for a plain CSV, and
 * phones send `application/octet-stream` for everything.
 */
import { readSheet } from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Every content type a browser might put on a spreadsheet upload. */
export const SHEET_TYPES = [
  XLSX_TYPE,
  'text/csv', 'text/plain', 'text/tab-separated-values',
  'application/csv', 'application/vnd.ms-excel', 'application/octet-stream',
];

// ── reading ───────────────────────────────────────────────────────────────────

/** `,`, `;` or a tab — whichever the heading row uses most. Tally and European Excel do not use commas. */
function delimiterOf(line) {
  const count = (d) => line.split(d).length;
  return [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
}

export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const delimiter = delimiterOf(src.split(/\r?\n/, 1)[0] ?? '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v ?? '').trim()));
}

const isZip = (buffer) => buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
const isOldExcel = (buffer) => buffer.length > 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf;

/**
 * A spreadsheet's first sheet as rows. Dates come back as `Date`, numbers as
 * numbers; both survive `JSON.stringify` into something the browser's column
 * mapping can read.
 */
export async function parse(buffer) {
  if (isOldExcel(buffer)) throw new Error('That is an old .xls file. Open it and save it as .xlsx or CSV first.');
  if (isZip(buffer)) {
    const rows = await readSheet(buffer);
    return rows.filter((r) => r.some((v) => v != null && String(v).trim()));
  }
  return parseCsv(buffer.toString('utf8'));
}

// ── writing ───────────────────────────────────────────────────────────────────

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  // Leading =, +, - or @ is a formula to a spreadsheet; prefix it so a customer
  // named "=HYPERLINK(...)" is exported as text.
  const safe = typeof value !== 'number' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = (rows) => `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** Cells are already `string | number | boolean | Date`; anything empty must be `null`. */
const cell = (v) => (v === '' || v === undefined ? null : v);

export const toXlsx = ([headings = [], ...body]) => writeXlsxFile(
  [headings.map((v) => ({ value: cell(v), fontWeight: 'bold' })), ...body.map((row) => row.map(cell))],
  { stickyRowsCount: 1 },
).toBuffer();

export const extensionOf = (format) => (format === 'xlsx' ? 'xlsx' : 'csv');
export const contentTypeOf = (format) => (format === 'xlsx' ? XLSX_TYPE : 'text/csv; charset=utf-8');
