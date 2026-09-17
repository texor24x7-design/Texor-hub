/**
 * GST computation for a quotation or invoice.
 *
 * Shared by the editor (live totals as someone types) and the API (the numbers
 * that are stored and printed), so the preview can never disagree with the bill.
 *
 * Rules, all in integer minor units:
 *
 *   · Line discount comes off the line; a document discount is shared across
 *     lines in proportion to their value, before tax, because a discount given
 *     at the time of supply reduces the taxable value.
 *   · Seller state = place of supply → CGST + SGST, half the rate each.
 *     Otherwise IGST. An unknown place of supply is treated as the seller's own
 *     state (a walk-in customer).
 *   · Tax-inclusive prices: the taxable value is extracted from the inclusive
 *     amount and tax is whatever remains, so a ₹349 wash bills as exactly ₹349.
 *   · Each line's tax is rounded to the minor unit; CGST gets the odd paisa and
 *     SGST the rest, so the two always add up to the line's tax.
 *   · Round-off, when on, brings the grand total to a whole rupee.
 */
import { exponent } from './money.mjs';

const round = (value) => Math.sign(value) * Math.round(Math.abs(value));
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** Splits `total` across `weights` so the parts are integers that add up exactly. */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !total) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; remainder > 0 && k < order.length; k += 1, remainder -= 1) parts[order[k][1]] += 1;
  return parts;
}

export function isInterState(sellerState, placeOfSupply) {
  return Boolean(sellerState && placeOfSupply && sellerState !== placeOfSupply);
}

/**
 * @param {object} input
 * @param {Array} input.lines  { quantity, priceMinor, discountPct, taxRate, cessRate, priceIncludesTax, hsn }
 * @param {string} input.sellerState
 * @param {string} input.placeOfSupply
 * @param {{type: 'percent'|'amount', value: number}} [input.discount]
 * @param {boolean} [input.roundOff]
 * @param {'gst'|'none'} [input.taxMode]
 * @param {string} [input.currency]
 */
export function computeDocument({ lines = [], sellerState = '', placeOfSupply = '', discount = null, roundOff = false, taxMode = 'gst', currency = 'INR' }) {
  const inter = isInterState(sellerState, placeOfSupply || sellerState);
  const charged = taxMode !== 'none';

  // 1. Line amounts after the line discount, in the price's own basis.
  const staged = lines.map((line) => {
    const gross = round(num(line.quantity) * num(line.priceMinor));
    const lineDiscount = round((gross * Math.min(Math.max(num(line.discountPct), 0), 100)) / 100);
    return { line, gross, lineDiscount, net: gross - lineDiscount };
  });

  // 2. Document discount, shared by value.
  const netTotal = staged.reduce((a, s) => a + s.net, 0);
  const docDiscount = !discount?.value
    ? 0
    : Math.min(netTotal, discount.type === 'percent'
      ? round((netTotal * Math.min(num(discount.value), 100)) / 100)
      : round(num(discount.value)));
  const shares = allocate(docDiscount, staged.map((s) => Math.max(s.net, 0)));

  const totals = { grossMinor: 0, discountMinor: 0, taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0, cessMinor: 0 };
  const summary = new Map();

  const computed = staged.map((s, i) => {
    const rate = charged ? num(s.line.taxRate) : 0;
    const cessRate = charged ? num(s.line.cessRate) : 0;
    const amount = s.net - shares[i];

    let taxable;
    let gst;
    let cess;
    if (s.line.priceIncludesTax && (rate || cessRate)) {
      taxable = round(amount / (1 + (rate + cessRate) / 100));
      const allTax = amount - taxable;
      cess = cessRate ? round((allTax * cessRate) / (rate + cessRate)) : 0;
      gst = allTax - cess;
    } else {
      taxable = amount;
      gst = round((taxable * rate) / 100);
      cess = round((taxable * cessRate) / 100);
    }

    const igst = inter ? gst : 0;
    const cgst = inter ? 0 : Math.ceil(gst / 2);
    const sgst = inter ? 0 : gst - cgst;
    const total = taxable + gst + cess;

    totals.grossMinor += s.gross;
    totals.discountMinor += s.lineDiscount + shares[i];
    totals.taxableMinor += taxable;
    totals.cgstMinor += cgst;
    totals.sgstMinor += sgst;
    totals.igstMinor += igst;
    totals.cessMinor += cess;

    const key = `${rate}`;
    const row = summary.get(key) ?? { rate, taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0, cessMinor: 0 };
    row.taxableMinor += taxable; row.cgstMinor += cgst; row.sgstMinor += sgst; row.igstMinor += igst; row.cessMinor += cess;
    summary.set(key, row);

    return {
      grossMinor: s.gross,
      discountMinor: s.lineDiscount + shares[i],
      taxableMinor: taxable,
      cgstMinor: cgst,
      sgstMinor: sgst,
      igstMinor: igst,
      cessMinor: cess,
      totalMinor: total,
    };
  });

  totals.taxMinor = totals.cgstMinor + totals.sgstMinor + totals.igstMinor + totals.cessMinor;
  const beforeRound = totals.taxableMinor + totals.taxMinor;
  const unit = 10 ** exponent(currency);
  totals.roundOffMinor = roundOff ? round(beforeRound / unit) * unit - beforeRound : 0;
  totals.totalMinor = beforeRound + totals.roundOffMinor;

  return {
    lines: computed,
    totals,
    interState: inter,
    taxSummary: [...summary.values()].filter((r) => r.rate || r.cessMinor).sort((a, b) => a.rate - b.rate),
  };
}

/** HSN-wise summary for printing and GSTR-1. */
export function hsnSummary(lines, computed) {
  const rows = new Map();
  lines.forEach((line, i) => {
    const key = `${line.hsn || '—'}|${line.taxRate ?? 0}`;
    const c = computed[i];
    const row = rows.get(key) ?? { hsn: line.hsn || '', rate: num(line.taxRate), quantity: 0, taxableMinor: 0, taxMinor: 0 };
    row.quantity += num(line.quantity);
    row.taxableMinor += c.taxableMinor;
    row.taxMinor += c.cgstMinor + c.sgstMinor + c.igstMinor + c.cessMinor;
    rows.set(key, row);
  });
  return [...rows.values()];
}
