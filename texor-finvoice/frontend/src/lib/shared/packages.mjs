/**
 * Expanding a package into invoice lines.
 *
 * A package is never billed as itself. Picking one drops its components in as
 * ordinary lines, each carrying its **own** price, GST rate, cess and HSN, and
 * the saving is recorded as a discount on those lines.
 *
 * That is a tax requirement, not a preference. A bundle sold at a single price
 * is a mixed supply under section 8 of the CGST Act unless it is naturally
 * bundled, and a mixed supply is taxable in full at the highest rate of any
 * component. Billing the parts separately is the treatment section 8 leaves
 * alone, and section 15(3)(a) lets the discount come off the taxable value
 * precisely because it is written on the invoice.
 *
 * Shared by the editor and the API so both arrive at the same figures.
 */
import { allocate } from './tax.mjs';

const round = (value) => Math.sign(value) * Math.round(Math.abs(value));
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** A component's unit price: its chosen variant, else its own price. */
export function componentPrice(component) {
  const item = component?.item ?? null;
  if (!item) return num(component?.priceMinor);
  const variant = component.variant ? (item.variants ?? []).find((v) => v.name === component.variant) : null;
  return num(variant?.priceMinor ?? item.priceMinor);
}

/** What the parts add up to before the package saving. */
export const partsTotal = (pkg) => (pkg?.components ?? [])
  .reduce((sum, c) => sum + round(num(c.quantity || 1) * componentPrice(c)), 0);

/**
 * The lines a package becomes.
 *
 * `quantity` multiplies every component — two thalis is two of everything in one.
 * Components whose item could not be resolved are dropped rather than billed at
 * zero; `beforeSave` refuses to store such a package in the first place.
 */
export function linesFromPackage(pkg, { quantity = 1, prefs = {} } = {}) {
  const components = (pkg?.components ?? []).filter((c) => c.item);
  if (!components.length) return [];

  const staged = components.map((component) => {
    const item = component.item;
    const qty = num(component.quantity || 1) * num(quantity || 1);
    const priceMinor = componentPrice(component);
    return {
      item,
      gross: round(qty * priceMinor),
      line: {
        item: item._id,
        variant: component.variant ?? '',
        description: component.description || item.name,
        hsn: item.hsn ?? '',
        quantity: qty,
        unit: item.unit ?? '',
        priceMinor,
        discountPct: 0,
        discountAmountMinor: null,
        taxRate: num(item.taxRate ?? prefs.taxRate ?? 0),
        cessRate: num(item.cessRate ?? 0),
        priceIncludesTax: Boolean(item.priceIncludesTax ?? prefs.priceIncludesTax ?? false),
        serials: [],
        custom: {},
      },
    };
  });

  if (pkg.packagePricing === 'percent') {
    // Every line off by the same percentage: exact on its own, and it keeps
    // showing the right saving if a component is repriced later.
    const pct = Math.min(Math.max(num(pkg.packageDiscountPct), 0), 100);
    return staged.map((s) => ({ ...s.line, discountPct: pct }));
  }

  // A fixed package price has to be met to the paisa, which a percentage cannot
  // do across several lines. Share the saving out in whole paise instead.
  //
  // The target scales with the quantity: two thalis cost twice one thali, not
  // one thali's price spread over twice the food.
  const gross = staged.reduce((sum, s) => sum + s.gross, 0);
  const target = Math.min(Math.max(num(pkg.priceMinor) * num(quantity || 1), 0), gross);
  const shares = allocate(gross - target, staged.map((s) => s.gross));
  return staged.map((s, i) => ({ ...s.line, discountAmountMinor: shares[i] }));
}
