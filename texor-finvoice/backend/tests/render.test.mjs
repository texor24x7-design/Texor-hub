/**
 * The renderer, without a browser: every built-in design renders every kind of
 * document, conditions hide what they should, and nothing a person typed can
 * become markup.
 */
import { BUILTIN_DESIGNS } from '../../frontend/src/lib/shared/designs.mjs';
import { renderDocument, upiLink } from '../../frontend/src/lib/shared/render.mjs';
import { computeDocument } from '../../frontend/src/lib/shared/tax.mjs';

let failed = 0;
const ok = (label, value) => { if (!value) failed += 1; console.log(`  ${value ? 'ok  ' : 'FAIL'} ${label}`); };

const lines = [
  { description: '43" 4K Smart LED TV', hsn: '8528', quantity: 1, unit: 'Pcs', priceMinor: 3299000, taxRate: 18, priceIncludesTax: true, serials: ['SN-1'], variant: '', custom: { stylist: 'x' } },
  { description: 'Installation', hsn: '', quantity: 1, priceMinor: 59900, taxRate: 18 },
];
const business = { name: 'Volt Electronics', legalName: 'Volt Retail LLP', gstin: '27AAPFU0939F1ZV', stateCode: '27', address: { line1: '12 MG Road', city: 'Pune', stateCode: '27', pincode: '411001' }, phone: '+91 20 1234 5678', email: 'bills@volt.test', branding: { accent: '#2563eb', logo: 'logoKEY1234567890abcd' }, bank: { upiId: 'volt@okhdfc', accountNumber: '50100012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' }, currency: 'INR', locale: 'en-IN' };
const module = { labelSingular: 'Invoice', fields: [{ key: 'vehicleNo', label: 'Vehicle no.', type: 'text', custom: true, printable: true }] };
const lineLabels = { fields: [{ key: 'description', label: 'Product' }, { key: 'stylist', label: 'Stylist', type: 'text', custom: true, printable: true }] };

function doc(overrides = {}) {
  const placeOfSupply = overrides.placeOfSupply ?? '27';
  const computed = computeDocument({ lines, sellerState: '27', placeOfSupply });
  return {
    number: 'INV/26-27/0001', status: 'issued', date: '2026-09-17', dueDate: '2026-10-02', placeOfSupply, taxMode: 'gst', currency: 'INR', amountPaidMinor: 0,
    billTo: { name: 'Priya <script>alert(1)</script>', gstin: '', address: { line1: '4 Lake View', city: 'Pune', stateCode: '27' } },
    lines: lines.map((l, i) => ({ ...l, ...computed.lines[i] })), totals: computed.totals, taxSummary: computed.taxSummary, interState: computed.interState,
    notes: '', terms: 'Goods once sold\nwill not be taken back.', custom: { vehicleNo: 'MH12 AB 1234' },
    ...overrides,
  };
}

console.log('\n── rendering ──');
for (const [key, design] of Object.entries(BUILTIN_DESIGNS)) {
  for (const kind of ['invoices', 'quotations']) {
    const html = renderDocument({ design, kind, document: doc(), business, module: { ...module, labelSingular: kind === 'invoices' ? 'Invoice' : 'Quotation' }, lines: lineLabels, assets: { fileUrl: (k) => `https://api.test/files/${k}`, upiQr: 'data:image/png;base64,AAAA' } });
    ok(`${key} renders ${kind === "invoices" ? "an invoice" : "a quotation"}`, html.startsWith('<!doctype html>') && html.includes('Volt Retail LLP'));
  }
}

const html = renderDocument({ design: BUILTIN_DESIGNS.classic, kind: 'invoices', document: doc(), business, module, lines: lineLabels, assets: { fileUrl: (k) => `https://api.test/files/${k}`, upiQr: 'data:image/png;base64,AAAA' } });
ok('a GST-registered invoice is titled Tax Invoice', html.includes('Tax Invoice'));
ok('a customer name cannot inject markup', !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'));
ok('printable custom fields appear on the document', html.includes('Vehicle no.') && html.includes('MH12 AB 1234'));
ok('renamed line columns are used', html.includes('>Product<'));
ok('printable line fields print under the item', html.includes('Stylist: x'));
ok('serial numbers print under the item', html.includes('S/N: SN-1'));
ok('same state shows CGST and SGST', html.includes('CGST') && html.includes('SGST') && !html.includes('>IGST'));
ok('the amount is written in words', html.includes('Rupees'));
ok('the UPI QR shows while money is owed', html.includes('Scan to pay'));
ok('terms keep their line breaks', html.includes('Goods once sold<br>will not be taken back.'));
ok('the logo comes from the file URL', html.includes('https://api.test/files/logoKEY1234567890abcd'));

const inter = renderDocument({ design: BUILTIN_DESIGNS.classic, kind: 'invoices', document: doc({ placeOfSupply: '29' }), business, module, lines: lineLabels, assets: {} });
ok('another state shows IGST instead', inter.includes('IGST') && !inter.includes('CGST @'));

const paidDoc = doc();
paidDoc.amountPaidMinor = paidDoc.totals.totalMinor;
paidDoc.status = 'paid';
const paid = renderDocument({ design: BUILTIN_DESIGNS.classic, kind: 'invoices', document: paidDoc, business, module, lines: lineLabels, assets: { upiQr: 'data:image/png;base64,AAAA' } });
ok('a paid invoice hides the pay-now QR', !paid.includes('Scan to pay'));
ok('and carries a paid stamp', paid.includes('stamp-paid'));

const draft = renderDocument({ design: BUILTIN_DESIGNS.classic, kind: 'invoices', document: doc({ number: null, status: 'draft' }), business, module, lines: lineLabels, assets: {} });
ok('a draft is stamped and unnumbered', draft.includes('stamp-draft') && draft.includes('Draft'));

const unregistered = renderDocument({ design: BUILTIN_DESIGNS.classic, kind: 'invoices', document: doc({ taxMode: 'none', totals: { ...doc().totals, taxMinor: 0 } }), business: { ...business, gstin: '' }, module, lines: lineLabels, assets: {} });
ok('an unregistered business is not titled Tax Invoice', !unregistered.includes('Tax Invoice'));

const hostile = JSON.parse(JSON.stringify(BUILTIN_DESIGNS.classic));
hostile.blocks.unshift({ id: 'x"><script>', type: 'text', props: { text: '<img src=x onerror=alert(1)> {{customer.name}}' }, style: { color: 'red;background:url(javascript:alert(1))', fontSize: '9;x' } });
const escaped = renderDocument({ design: hostile, kind: 'invoices', document: doc(), business, module, lines: lineLabels, assets: {} });
ok('text blocks and block ids are escaped', !escaped.includes('<img src=x') && !escaped.includes('"><script>'));
ok('style values outside the allowed shapes are dropped', !escaped.includes('javascript:'));
ok('unknown block types are ignored', renderDocument({ design: { ...hostile, blocks: [{ type: 'iframe', props: {} }] }, kind: 'invoices', document: doc(), business, module, lines: lineLabels, assets: {} }).includes('<main class="page"></main>'));

ok('UPI link carries the amount and reference', upiLink({ upiId: 'volt@okhdfc', payee: 'Volt', amountMinor: 123450, reference: 'INV/26-27/0001' }) === 'upi://pay?pa=volt%40okhdfc&pn=Volt&cu=INR&am=1234.50&tn=INV%2F26-27%2F0001');

process.exit(failed ? 1 : 0);
