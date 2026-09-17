/**
 * Built-in document designs, and the rules for what a design may contain.
 *
 * A design is data: page settings plus an ordered list of blocks, each with its
 * own props, style and an optional condition. Workspaces save edited copies in
 * `preferences.designs`; these stay as the starting points and the fallback.
 */

export const BLOCK_TYPES = [
  'header', 'title', 'meta', 'parties', 'items', 'totals', 'taxSummary', 'words',
  'bank', 'notes', 'terms', 'signature', 'text', 'image', 'divider', 'spacer', 'columns', 'footer',
];

export const CONDITIONS = [
  { value: '', label: 'Always' },
  { value: 'interState', label: 'Only for IGST (other state)' },
  { value: 'intraState', label: 'Only for CGST + SGST (same state)' },
  { value: 'taxed', label: 'Only when tax is charged' },
  { value: 'hasDue', label: 'Only when money is owed' },
  { value: 'hasNotes', label: 'Only when there are notes' },
  { value: 'invoice', label: 'Only on invoices' },
  { value: 'quotation', label: 'Only on quotations' },
];

export const PAGE_SIZES = [
  { value: 'A4', label: 'A4', width: 210, height: 297 },
  { value: 'A5', label: 'A5', width: 148, height: 210 },
  { value: 'Letter', label: 'US Letter', width: 215.9, height: 279.4 },
  { value: '80mm', label: 'Thermal 80 mm', width: 80, height: null },
  { value: '58mm', label: 'Thermal 58 mm', width: 58, height: null },
];

export const FONTS = [
  { value: 'inter', label: 'Inter', css: "'Inter', system-ui, sans-serif" },
  { value: 'serif', label: 'Source Serif', css: "'Source Serif 4', Georgia, serif" },
  { value: 'mono', label: 'JetBrains Mono', css: "'JetBrains Mono', ui-monospace, monospace" },
];

/** Columns an items table can show. `custom.<key>` columns come from printable line fields. */
export const ITEM_COLUMNS = [
  { key: 'index', label: '#', width: 5, align: 'center' },
  { key: 'description', label: 'Item', width: 31, align: 'left' },
  { key: 'hsn', label: 'HSN/SAC', width: 10, align: 'left' },
  { key: 'quantity', label: 'Qty', width: 11, align: 'right' },
  { key: 'priceMinor', label: 'Rate', width: 11, align: 'right' },
  { key: 'discountPct', label: 'Disc.', width: 7, align: 'right' },
  { key: 'taxableMinor', label: 'Taxable', width: 12, align: 'right' },
  { key: 'taxRate', label: 'GST', width: 7, align: 'right' },
  { key: 'taxMinor', label: 'Tax', width: 10, align: 'right' },
  { key: 'totalMinor', label: 'Amount', width: 13, align: 'right' },
];

const col = (key, extra = {}) => ({ key, show: true, ...extra });
let seq = 0;
const block = (type, props = {}, extra = {}) => ({ id: `${type}-${(seq += 1)}`, type, props, style: {}, when: '', ...extra });

const standardColumns = () => [
  col('index'), col('description'), col('hsn'), col('quantity'), col('priceMinor'),
  col('discountPct', { show: false }), col('taxableMinor'), col('taxRate'), col('taxMinor', { show: false }), col('totalMinor'),
];

export const BUILTIN_DESIGNS = {
  classic: {
    key: 'classic',
    name: 'Classic',
    description: 'A traditional GST invoice: bordered table, tax summary and bank details.',
    page: { size: 'A4', margin: 12, font: 'inter', fontSize: 9, accent: 'brand', text: '#1f2328', muted: '#5c6370', border: '#d0d4db' },
    blocks: [
      block('header', { layout: 'split', showLogo: true, showAddress: true, showContact: true, showGstin: true }),
      block('title', { text: '{{document.title}}', subtitle: '{{document.copy}}' }, { style: { align: 'center', uppercase: true, fontSize: 13, borderTop: true, borderBottom: true, paddingY: 4 } }),
      block('columns', { ratio: '1:1' }, {
        children: [
          [block('parties', { show: 'billTo', billToLabel: 'Bill to' })],
          [block('meta', { includePrintable: true })],
        ],
      }),
      block('items', { layout: 'table', columns: standardColumns(), striped: false, bordered: true, showSerials: true, showVariant: true }),
      block('columns', { ratio: '3:2' }, {
        children: [
          [block('words'), block('taxSummary', {}, { when: 'taxed' })],
          [block('totals', { showBalance: true })],
        ],
      }),
      block('columns', { ratio: '1:1' }, {
        children: [
          [block('bank', { showQr: true, showBank: true }, { when: 'invoice' })],
          [block('signature', { label: 'Authorised signatory', prefix: 'For' })],
        ],
      }),
      block('notes', {}, { when: 'hasNotes' }),
      block('terms', { label: 'Terms & conditions' }),
      block('footer', { text: 'This is a computer-generated document.' }),
    ],
  },

  modern: {
    key: 'modern',
    name: 'Modern',
    description: 'A bold colour band, generous spacing and a clean, borderless table.',
    page: { size: 'A4', margin: 0, font: 'inter', fontSize: 9.5, accent: 'brand', text: '#16181d', muted: '#6b7280', border: '#e5e7eb' },
    blocks: [
      block('header', { layout: 'band', showLogo: true, showAddress: true, showContact: true, showGstin: true, showTitle: true, title: '{{document.title}}' }),
      block('columns', { ratio: '1:1' }, {
        style: { paddingX: 14, marginTop: 8 },
        children: [
          [block('parties', { show: 'both', billToLabel: 'Billed to', shipToLabel: 'Ship to' })],
          [block('meta', { includePrintable: true, style: 'cards' })],
        ],
      }),
      block('items', { layout: 'table', columns: standardColumns(), striped: true, bordered: false, showSerials: true, showVariant: true }, { style: { paddingX: 14, marginTop: 6 } }),
      block('columns', { ratio: '3:2' }, {
        style: { paddingX: 14 },
        children: [
          [block('bank', { showQr: true, showBank: true }, { when: 'invoice' }), block('notes', {}, { when: 'hasNotes' })],
          [block('totals', { showBalance: true, highlight: true })],
        ],
      }),
      block('taxSummary', {}, { when: 'taxed', style: { paddingX: 14 } }),
      block('words', {}, { style: { paddingX: 14 } }),
      block('columns', { ratio: '3:2' }, {
        style: { paddingX: 14, marginTop: 8 },
        children: [
          [block('terms', { label: 'Terms' })],
          [block('signature', { label: 'Authorised signatory', prefix: 'For' })],
        ],
      }),
      block('footer', { text: 'Thank you for your business!' }, { style: { align: 'center', paddingX: 14, marginTop: 10 } }),
    ],
  },

  compact: {
    key: 'compact',
    name: 'Compact',
    description: 'Dense and economical — fits long bills on fewer pages. Good on A5.',
    page: { size: 'A5', margin: 8, font: 'inter', fontSize: 8, accent: 'brand', text: '#111827', muted: '#6b7280', border: '#d1d5db' },
    blocks: [
      block('header', { layout: 'inline', showLogo: true, showAddress: true, showContact: true, showGstin: true, showTitle: true, title: '{{document.title}}' }),
      block('columns', { ratio: '1:1' }, { children: [[block('parties', { show: 'billTo', billToLabel: 'To' })], [block('meta', { includePrintable: true })]] }),
      block('items', {
        layout: 'table', striped: true, bordered: false, showSerials: true, showVariant: true,
        columns: [col('index'), col('description'), col('hsn', { show: false }), col('quantity'), col('priceMinor'), col('discountPct', { show: false }), col('taxableMinor', { show: false }), col('taxRate'), col('taxMinor', { show: false }), col('totalMinor')],
      }),
      block('columns', { ratio: '1:1' }, { children: [[block('bank', { showQr: true, showBank: false }, { when: 'hasDue' })], [block('totals', { showBalance: true })]] }),
      block('words'),
      block('terms', { label: 'Terms' }),
    ],
  },

  thermal: {
    key: 'thermal',
    name: 'Thermal receipt',
    description: 'An 80 mm till receipt for restaurants and counters.',
    page: { size: '80mm', margin: 3, font: 'mono', fontSize: 8, accent: '#000000', text: '#000000', muted: '#333333', border: '#000000' },
    blocks: [
      block('header', { layout: 'centered', showLogo: true, showAddress: true, showContact: true, showGstin: true }),
      block('title', { text: '{{document.title}}' }, { style: { align: 'center', uppercase: true, fontSize: 10, borderTop: true, borderBottom: true, paddingY: 2, dashed: true } }),
      block('meta', { includePrintable: true, style: 'receipt' }),
      block('parties', { show: 'billTo', billToLabel: 'Customer', compact: true }, { when: 'taxed' }),
      block('items', { layout: 'receipt', showSerials: false, showVariant: true }),
      block('totals', { showBalance: false }),
      block('taxSummary', { compact: true }, { when: 'taxed' }),
      block('bank', { showQr: true, showBank: false, compact: true }, { when: 'hasDue' }),
      block('text', { text: 'Thank you! Visit again.' }, { style: { align: 'center', marginTop: 4 } }),
    ],
  },
};

export const builtinDesign = (key) => BUILTIN_DESIGNS[key] ?? null;

/** A fresh copy, so edits never mutate the built-in. */
export const cloneDesign = (design) => JSON.parse(JSON.stringify(design));

export function newBlock(type) {
  const defaults = {
    items: { layout: 'table', columns: standardColumns(), striped: true, bordered: false, showSerials: true, showVariant: true },
    text: { text: 'Type something — {{customer.name}} and other tags work here.' },
    spacer: { height: 6 },
    columns: { ratio: '1:1' },
    title: { text: '{{document.title}}' },
    signature: { label: 'Authorised signatory', prefix: 'For' },
    bank: { showQr: true, showBank: true },
    header: { layout: 'split', showLogo: true, showAddress: true, showContact: true, showGstin: true },
    parties: { show: 'billTo', billToLabel: 'Bill to', shipToLabel: 'Ship to' },
    meta: { includePrintable: true },
    totals: { showBalance: true },
    terms: { label: 'Terms & conditions' },
    footer: { text: 'This is a computer-generated document.' },
  };
  const created = block(type, structuredClone(defaults[type] ?? {}));
  created.id = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  if (type === 'columns') created.children = [[], []];
  return created;
}
