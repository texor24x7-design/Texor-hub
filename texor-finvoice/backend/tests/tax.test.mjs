/**
 * The tax engine against invoices worked out by hand.
 *
 * Every expected number below was calculated on paper first, not copied from
 * the engine's output — a test that snapshots its own answer proves nothing.
 */
import { allocate, computeDocument, hsnSummary } from '../../frontend/src/lib/shared/tax.mjs';

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

console.log('\n── GST ──');

{
  // Maharashtra seller, Maharashtra customer. 2 × ₹1,000 at 18% = 2,000 + 180 CGST + 180 SGST = 2,360.
  const r = computeDocument({ sellerState: '27', placeOfSupply: '27', lines: [{ quantity: 2, priceMinor: 100000, taxRate: 18 }] });
  eq('intra-state splits into CGST and SGST', [r.totals.cgstMinor, r.totals.sgstMinor, r.totals.igstMinor], [18000, 18000, 0]);
  eq('intra-state total', r.totals.totalMinor, 236000);
  eq('not inter-state', r.interState, false);
}

{
  // Maharashtra seller, Karnataka customer: IGST 360.
  const r = computeDocument({ sellerState: '27', placeOfSupply: '29', lines: [{ quantity: 2, priceMinor: 100000, taxRate: 18 }] });
  eq('inter-state is IGST', [r.totals.cgstMinor, r.totals.sgstMinor, r.totals.igstMinor], [0, 0, 36000]);
}

{
  // Unknown place of supply (walk-in) → treated as intra-state.
  const r = computeDocument({ sellerState: '27', placeOfSupply: '', lines: [{ quantity: 1, priceMinor: 10000, taxRate: 5 }] });
  eq('a walk-in customer is intra-state', [r.totals.cgstMinor, r.totals.sgstMinor], [250, 250]);
}

{
  // ₹349 inclusive of 18%: taxable = 349 / 1.18 = 295.7627 → ₹295.76; tax = 53.24 → CGST 26.62, SGST 26.62.
  const r = computeDocument({ sellerState: '27', placeOfSupply: '27', lines: [{ quantity: 1, priceMinor: 34900, taxRate: 18, priceIncludesTax: true }] });
  eq('an inclusive price bills to exactly that price', r.totals.totalMinor, 34900);
  eq('inclusive taxable value', r.lines[0].taxableMinor, 29576);
  eq('inclusive tax splits evenly', [r.lines[0].cgstMinor, r.lines[0].sgstMinor], [2662, 2662]);
}

{
  // ₹1.01 at 5% = 5.05 paise → 5 paise of tax. CGST takes the odd paisa: 3 + 2.
  const r = computeDocument({ sellerState: '27', placeOfSupply: '27', lines: [{ quantity: 1, priceMinor: 101, taxRate: 5 }] });
  eq('an odd paisa of tax goes to CGST and the halves still add up', [r.lines[0].cgstMinor, r.lines[0].sgstMinor], [3, 2]);
}

{
  // 10% line discount on ₹500, then 18%: taxable 450, tax 81 → 531.
  const r = computeDocument({ sellerState: '27', placeOfSupply: '27', lines: [{ quantity: 1, priceMinor: 50000, discountPct: 10, taxRate: 18 }] });
  eq('line discount reduces the taxable value', [r.lines[0].taxableMinor, r.totals.taxMinor, r.totals.totalMinor], [45000, 8100, 53100]);
}

{
  // Document discount ₹100 across ₹300 (18%) and ₹100 (5%) lines: shares 75 and 25.
  // Taxable 225 → tax 40.50; taxable 75 → tax 3.75. Total 225 + 75 + 40.50 + 3.75 = 344.25.
  const r = computeDocument({
    sellerState: '27', placeOfSupply: '27', discount: { type: 'amount', value: 10000 },
    lines: [{ quantity: 1, priceMinor: 30000, taxRate: 18 }, { quantity: 1, priceMinor: 10000, taxRate: 5 }],
  });
  eq('a document discount is shared by value before tax', r.lines.map((l) => l.taxableMinor), [22500, 7500]);
  eq('and the total reflects it', r.totals.totalMinor, 34425);
  eq('with a summary per rate', r.taxSummary.map((s) => [s.rate, s.taxableMinor]), [[5, 7500], [18, 22500]]);
}

{
  // Round-off: 344.25 → 344.00, round-off −0.25.
  const r = computeDocument({
    sellerState: '27', placeOfSupply: '27', roundOff: true, discount: { type: 'percent', value: 25 },
    lines: [{ quantity: 1, priceMinor: 30000, taxRate: 18 }, { quantity: 1, priceMinor: 10000, taxRate: 5 }],
  });
  eq('round-off brings the total to a whole rupee', [r.totals.roundOffMinor, r.totals.totalMinor], [-25, 34400]);
}

{
  // ₹1,000 at 18% IGST plus 12% cess: 180 + 120 → 1,300.
  const r = computeDocument({ sellerState: '27', placeOfSupply: '29', lines: [{ quantity: 1, priceMinor: 100000, taxRate: 18, cessRate: 12 }] });
  eq('cess is charged on the taxable value alongside IGST', [r.totals.igstMinor, r.totals.cessMinor, r.totals.totalMinor], [18000, 12000, 130000]);
}

{
  const r = computeDocument({ sellerState: '27', placeOfSupply: '27', taxMode: 'none', lines: [{ quantity: 3, priceMinor: 20000, taxRate: 18 }] });
  eq('an unregistered business charges no tax', [r.totals.taxMinor, r.totals.totalMinor], [0, 60000]);
}

{
  // 1.5 kg at ₹333.33 = 499.995 → ₹500.00 (rounded once, on the line).
  const r = computeDocument({ sellerState: '27', placeOfSupply: '27', lines: [{ quantity: 1.5, priceMinor: 33333, taxRate: 0 }] });
  eq('fractional quantities round once, at the line', r.totals.totalMinor, 50000);
}

{
  const lines = [{ hsn: '8528', taxRate: 18, quantity: 2, priceMinor: 1000 }, { hsn: '8528', taxRate: 18, quantity: 1, priceMinor: 1000 }, { hsn: '8415', taxRate: 18, quantity: 1, priceMinor: 500 }];
  const r = computeDocument({ sellerState: '27', placeOfSupply: '27', lines });
  eq('HSN summary groups by code and rate', hsnSummary(lines, r.lines).map((h) => [h.hsn, h.quantity, h.taxableMinor]), [['8528', 3, 3000], ['8415', 1, 500]]);
}

eq('allocation always adds up', allocate(100, [1, 1, 1]).reduce((a, b) => a + b), 100);
eq('allocation favours the largest remainders', allocate(100, [1, 1, 1]), [34, 33, 33]);

process.exit(failed ? 1 : 0);
