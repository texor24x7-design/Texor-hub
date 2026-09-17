import { amountInWords, formatMoney, integerInWords, roundHalfUp, toMinor } from '../../frontend/src/lib/shared/money.mjs';

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

console.log('\n── money ──');
eq('parses grouped input', toMinor('1,23,456.78'), 12345678);
eq('parses a number', toMinor(0.1 + 0.2), 30);
eq('rejects junk', toMinor('abc'), null);
eq('empty is null', toMinor(''), null);
eq('yen has no minor unit', toMinor('1500', 'JPY'), 1500);
eq('rounds half away from zero', [roundHalfUp(2.5), roundHalfUp(-2.5)], [3, -3]);
eq('Indian grouping', formatMoney(12345678), '₹1,23,456.78');
eq('zero in words', integerInWords(0), 'Zero');
eq('lakh and crore', integerInWords(123456789), 'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine');
eq('teens', integerInWords(1115), 'One Thousand One Hundred Fifteen');
eq('rupees and paise', amountInWords(10050), 'One Hundred Rupees and Fifty Paise Only');
eq('whole rupees', amountInWords(250000), 'Two Thousand Five Hundred Rupees Only');

process.exit(failed ? 1 : 0);
