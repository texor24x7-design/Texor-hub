/**
 * The lateness rule, at its edges.
 *
 * This lives in a unit suite on purpose. Judging it end to end meant checking in
 * "now" against a fixed shift start, which is only true at certain times of day
 * — a shift starting at 00:00 cannot be late at 00:05, so the suite failed for
 * ten minutes out of every twenty-four hours and took a deploy with it.
 */
import { isLate } from '../src/services/attendance.service.js';

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`  ok   ${label}`);
  else { failed += 1; console.log(`  FAIL ${label} — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`); }
};

console.log('\n── lateness ──');

const TZ = 'Asia/Kolkata';
/** An instant that reads as this wall-clock time in Kolkata (UTC+5:30). */
const at = (hh, mm) => new Date(Date.UTC(2026, 5, 15, hh, mm) - (5 * 60 + 30) * 60000);
const shift = (shiftStart) => ({ shiftStart });

eq('on the dot is not late', isLate(shift('10:00'), TZ, at(10, 0)), false);
eq('inside the ten minutes of grace is not late', isLate(shift('10:00'), TZ, at(10, 10)), false);
eq('a minute past the grace is late', isLate(shift('10:00'), TZ, at(10, 11)), true);
eq('early is never late', isLate(shift('10:00'), TZ, at(9, 30)), false);

eq('a midnight shift is not late at five past', isLate(shift('00:00'), TZ, at(0, 5)), false);
eq('but is at a quarter past', isLate(shift('00:00'), TZ, at(0, 15)), true);
eq('a shift ending the day can never be late', isLate(shift('23:59'), TZ, at(23, 59)), false);

eq('no shift means no judgement', isLate(shift(''), TZ, at(23, 0)), false);
eq('nor does no check-in', isLate(shift('10:00'), TZ, null), false);

// The rule reads the clock in the workspace's zone, not the server's.
eq('the same instant is late in Kolkata', isLate(shift('10:00'), TZ, at(11, 0)), true);
eq('and not yet in London, where it is still early', isLate(shift('10:00'), 'Europe/London', at(11, 0)), false);

console.log(`\n  ${failed ? `${failed} failed` : 'all ok'}\n`);
process.exit(failed ? 1 : 0);
