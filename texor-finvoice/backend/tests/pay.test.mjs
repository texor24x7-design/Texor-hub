/**
 * What a month of attendance is worth.
 *
 * Pure arithmetic, so it is pinned here rather than end to end: the payable-days
 * rule and the per-day divisor are the two things that quietly underpay people
 * when they are wrong.
 */
import { payFor } from '../src/services/attendance.service.js';

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`  ok   ${label}`);
  else { failed += 1; console.log(`  FAIL ${label} — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`); }
};

console.log('\n── pay ──');

/** 20 present, 2 half days, 1 leave, 3 absent → 22 payable, 3 lost. */
const totals = { present: 20, half_day: 2, absent: 3, leave: 1, holiday: 0, week_off: 0 };
totals.payable = totals.present + totals.half_day / 2 + totals.holiday + totals.week_off + totals.leave;

eq('half days count as half, leave counts in full', totals.payable, 22);

eq('nobody is paid without an amount', payFor({ salaryKind: 'monthly', salaryMinor: 0 }, totals, 30), null);
eq('nor without a basis of pay', payFor({ salaryKind: '', salaryMinor: 100000 }, totals, 30), null);

{
  const p = payFor({ salaryKind: 'daily', salaryMinor: 50000 }, totals, 30);
  eq('a daily wage pays for the days that count', p.amountMinor, 50000 * 22);
  eq('and loses nothing on top', p.lopMinor, 0);
}

{
  // ₹30,000 a month, 3 days lost.
  const thirty = payFor({ salaryKind: 'monthly', salaryMinor: 3000000, salaryBasis: 'days30' }, totals, 30);
  const twentySix = payFor({ salaryKind: 'monthly', salaryMinor: 3000000, salaryBasis: 'days26' }, totals, 30);
  eq('÷30 costs a day at ₹1,000', thirty.perDayMinor, 100000);
  eq('so three lost days cost ₹3,000', thirty.lopMinor, 300000);
  eq('leaving ₹27,000', thirty.amountMinor, 2700000);
  eq('÷26 costs more per day', twentySix.perDayMinor, Math.round(3000000 / 26));
  eq('so the same absence costs more', twentySix.lopMinor > thirty.lopMinor, true);
  eq('and the basis is reported, not assumed', [thirty.basis, twentySix.basis], [30, 26]);
}

{
  const feb = payFor({ salaryKind: 'monthly', salaryMinor: 2800000, salaryBasis: 'worked' }, totals, 28);
  eq('"days in the month" follows a short February', feb.basis, 28);
  eq('costing a day at ₹1,000', feb.perDayMinor, 100000);
}

{
  // Somebody absent all month cannot be paid a negative salary.
  const gone = { present: 0, half_day: 0, absent: 40, leave: 0, holiday: 0, week_off: 0, payable: 0 };
  const p = payFor({ salaryKind: 'monthly', salaryMinor: 3000000, salaryBasis: 'days30' }, gone, 30);
  eq('loss of pay is capped at the salary', p.amountMinor, 0);
}

console.log(`\n  ${failed ? `${failed} failed` : 'all ok'}\n`);
process.exit(failed ? 1 : 0);
