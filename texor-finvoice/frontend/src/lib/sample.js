/**
 * A realistic document for previewing designs before there are real ones —
 * built from the workspace's own catalogue when it has one, and computed with
 * the real tax engine so the preview's numbers add up.
 */
import { computeDocument } from './shared/tax.mjs';

const FALLBACK = [
  { description: 'Premium service package', hsn: '998714', quantity: 1, unit: 'Service', priceMinor: 249900, taxRate: 18 },
  { description: 'Add-on treatment', hsn: '', quantity: 2, unit: 'Pcs', priceMinor: 49900, taxRate: 18, discountPct: 10 },
  { description: 'Consumables', hsn: '3405', quantity: 3, unit: 'Pcs', priceMinor: 14900, taxRate: 5 },
];

export function sampleDocument({ workspace, items = [], kind = 'invoices', status = 'issued', lineFields = [] }) {
  const lines = (items.length ? items.slice(0, 3).map((item, i) => ({
    item: item._id, description: item.name, hsn: item.hsn ?? '', quantity: i === 1 ? 2 : 1, unit: item.unit ?? '',
    priceMinor: item.variants?.[0]?.priceMinor ?? item.priceMinor ?? 0, variant: item.variants?.[0]?.name ?? '',
    taxRate: item.taxRate ?? 18, priceIncludesTax: item.priceIncludesTax ?? false, serials: item.trackSerials ? ['SN-2044-01'] : [],
  })) : FALLBACK).map((l) => ({ discountPct: 0, cessRate: 0, serials: [], custom: Object.fromEntries(lineFields.filter((f) => f.printable && f.type === 'text').map((f) => [f.key, 'Sample'])), ...l }));

  const placeOfSupply = workspace.stateCode || '27';
  const computed = computeDocument({ lines, sellerState: workspace.stateCode, placeOfSupply, taxMode: workspace.gstin ? 'gst' : 'none', currency: workspace.currency });
  const date = new Date();
  const due = new Date(date.getTime() + 15 * 864e5);

  return {
    number: kind === 'invoices' ? `${workspace.preferences?.numbering?.invoices ?? 'INV'}/26-27/0042` : `${workspace.preferences?.numbering?.quotations ?? 'QT'}/26-27/0017`,
    status, date, dueDate: due, validUntil: due, placeOfSupply, taxMode: workspace.gstin ? 'gst' : 'none', currency: workspace.currency ?? 'INR', amountPaidMinor: 0,
    billTo: { name: 'Priya Sharma', phone: '+91 98200 11223', email: 'priya@example.com', gstin: '', stateCode: placeOfSupply, address: { line1: 'Flat 804, Palm Residency', line2: 'Baner Road', city: 'Pune', stateCode: placeOfSupply, pincode: '411045' } },
    lines: lines.map((l, i) => ({ ...l, ...computed.lines[i] })),
    totals: computed.totals, taxSummary: computed.taxSummary, interState: computed.interState,
    notes: 'Thank you for choosing us!', terms: workspace.preferences?.terms || 'Payment due within 15 days.',
    custom: {},
  };
}
