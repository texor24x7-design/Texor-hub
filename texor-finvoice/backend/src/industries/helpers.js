/** Small builders so the packs read as data. */
export const options = (...labels) => labels.map((label) => ({
  value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
  label,
}));

/** Rupees → paise for sample prices. */
export const rs = (rupees) => Math.round(rupees * 100);

export const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Cheque'];
