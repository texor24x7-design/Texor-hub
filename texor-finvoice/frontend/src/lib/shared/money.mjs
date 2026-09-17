/**
 * Money as integers in the currency's minor unit (paise, cents).
 *
 * Every stored amount is an integer. Floats appear only at the edges — parsing
 * what someone typed, and formatting for display — so a long invoice cannot
 * drift by a paisa between the screen, the PDF and the database.
 */
const EXPONENTS = { JPY: 0, KRW: 0, VND: 0, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3 };

export const exponent = (currency = 'INR') => EXPONENTS[currency] ?? 2;
const factor = (currency) => 10 ** exponent(currency);

/** "1,234.50" or 1234.5 → 123450. Returns null for anything unparseable. */
export function toMinor(value, currency = 'INR') {
  if (value === '' || value == null) return null;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/[,\s]/g, ''));
  if (!Number.isFinite(number)) return null;
  return Math.round(number * factor(currency));
}

export const fromMinor = (minor, currency = 'INR') => (minor ?? 0) / factor(currency);

/**
 * Round half away from zero. `Math.round(-2.5)` is -2, which would make a
 * credit round differently from the matching charge.
 */
export const roundHalfUp = (value) => Math.sign(value) * Math.round(Math.abs(value));

export function formatMoney(minor, currency = 'INR', locale = 'en-IN') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent(currency),
    maximumFractionDigits: exponent(currency),
  }).format(fromMinor(minor, currency));
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function belowThousand(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** Indian grouping: crore, lakh, thousand. 1234567 → "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven". */
export function integerInWords(value) {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${integerInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

const UNIT_NAMES = { INR: ['Rupees', 'Paise'], USD: ['Dollars', 'Cents'], EUR: ['Euros', 'Cents'], GBP: ['Pounds', 'Pence'], AED: ['Dirhams', 'Fils'] };

export function amountInWords(minor, currency = 'INR') {
  const [major, sub] = UNIT_NAMES[currency] ?? [currency, ''];
  const whole = Math.floor(Math.abs(minor) / factor(currency));
  const fraction = Math.abs(minor) % factor(currency);
  const words = `${integerInWords(whole)} ${major}`;
  return `${fraction && sub ? `${words} and ${integerInWords(fraction)} ${sub}` : words} Only`;
}
