/**
 * Indian GST reference data and checks.
 *
 * Imported by both the browser (instant form feedback) and the API (the check
 * that counts), so the two can never disagree about what a valid GSTIN is.
 */

/** GST state codes — the first two digits of every GSTIN. */
export const STATES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'],
  ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'],
  ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'],
  ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'],
  ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'],
  ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['97', 'Other Territory'],
  ['96', 'Outside India'],
].map(([code, name]) => ({ code, name }));

const STATE_NAMES = new Map(STATES.map((state) => [state.code, state.name]));

export const stateName = (code) => STATE_NAMES.get(code) ?? '';
export const isStateCode = (code) => STATE_NAMES.has(code);

/** GST rate slabs after the September 2025 rationalisation. Editable per workspace. */
export const GST_RATES = [0, 0.25, 3, 5, 18, 40];

const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The GSTN mod-36 check character over the first 14 characters. */
function checkChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = ALPHABET.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36];
}

export const normaliseGstin = (value) => String(value ?? '').trim().toUpperCase();

/** Returns an error message, or null when the GSTIN is valid. */
export function gstinError(value) {
  const gstin = normaliseGstin(value);
  if (!gstin) return null;
  if (gstin.length !== 15) return 'A GSTIN is 15 characters.';
  if (!GSTIN_SHAPE.test(gstin)) return 'That is not the shape of a GSTIN.';
  if (!isStateCode(gstin.slice(0, 2))) return 'The first two digits are not a GST state code.';
  if (checkChar(gstin.slice(0, 14)) !== gstin[14]) return 'The last character does not match — check for a typo.';
  return null;
}

export const stateFromGstin = (value) => {
  const gstin = normaliseGstin(value);
  return gstin.length >= 2 && isStateCode(gstin.slice(0, 2)) ? gstin.slice(0, 2) : '';
};

/** April-to-March by default; `startMonth` is 1–12. Returns e.g. "26-27". */
export function financialYear(date = new Date(), startMonth = 4) {
  const d = new Date(date);
  const startYear = d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
  if (startMonth === 1) return String(startYear);
  return `${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
}
