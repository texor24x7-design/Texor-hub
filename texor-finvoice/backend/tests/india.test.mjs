import { financialYear, gstinError, stateFromGstin } from '../../frontend/src/lib/shared/india.mjs';

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

console.log('\n── GSTIN and financial year ──');
eq('a real GSTIN passes', gstinError('27AAPFU0939F1ZV'), null);
eq('lower case is normalised', gstinError('27aapfu0939f1zv'), null);
eq('a one-character typo fails the checksum', Boolean(gstinError('27AAPFU0939F1ZW')), true);
eq('wrong length', gstinError('27AAPFU0939F1Z'), 'A GSTIN is 15 characters.');
eq('unknown state code', gstinError('99AAPFU0939F1ZV'), 'The first two digits are not a GST state code.');
eq('empty is allowed', gstinError(''), null);
eq('state from GSTIN', stateFromGstin('29AAGCB7383J1Z4'), '29');
eq('31 March is the old year', financialYear(new Date('2027-03-31T12:00:00')), '26-27');
eq('1 April starts the new year', financialYear(new Date('2027-04-01T12:00:00')), '27-28');
eq('calendar-year businesses', financialYear(new Date('2027-06-01'), 1), '2027');

process.exit(failed ? 1 : 0);
