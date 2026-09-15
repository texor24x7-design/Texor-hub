/**
 * The meeting timer.
 *
 * All of it takes `now` as an argument rather than reading the clock, which is
 * what makes "two minutes before the limit" a test rather than a two-hour wait.
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const {
  formatDuration, formatRemaining, meetingTime, startedAgo, durationBetween, SOON_MS, URGENT_MS,
} = await import(`${FE}/src/lib/duration.js`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

console.log('\n── the elapsed clock ──');
{
  check('zero reads as zero', formatDuration(0) === '0:00', formatDuration(0));
  check('seconds are padded', formatDuration(5 * SEC) === '0:05', formatDuration(5 * SEC));
  check('a minute', formatDuration(MIN) === '1:00', formatDuration(MIN));
  check('minutes and seconds', formatDuration(12 * MIN + 4 * SEC) === '12:04',
    formatDuration(12 * MIN + 4 * SEC));
  check('under an hour never shows an hours field', formatDuration(59 * MIN + 59 * SEC) === '59:59',
    formatDuration(59 * MIN + 59 * SEC));
  // The one that reads wrong if hours are left out: "1:05" would be ambiguous.
  check('an hour grows a field', formatDuration(HOUR + 5 * MIN + 3 * SEC) === '1:05:03',
    formatDuration(HOUR + 5 * MIN + 3 * SEC));
  check('minutes are padded once hours appear', formatDuration(HOUR + 4 * SEC) === '1:00:04',
    formatDuration(HOUR + 4 * SEC));
  check('long meetings keep counting', formatDuration(25 * HOUR) === '25:00:00', formatDuration(25 * HOUR));
  check('a negative duration reads as zero, not as a minus sign',
    formatDuration(-5000) === '0:00', formatDuration(-5000));
  check('it does not round up mid-second', formatDuration(1999) === '0:01', formatDuration(1999));
}

console.log('\n── time left, in words ──');
{
  check('plenty', formatRemaining(9 * MIN) === '9 min left', formatRemaining(9 * MIN));
  check('rounded to the nearest minute', formatRemaining(8 * MIN + 40 * SEC) === '9 min left',
    formatRemaining(8 * MIN + 40 * SEC));
  check('the last minute is called out rather than shown as 1',
    formatRemaining(30 * SEC) === 'Under a minute left', formatRemaining(30 * SEC));
  check('zero is over', formatRemaining(0) === 'Time is up');
  check('past zero is still over', formatRemaining(-60_000) === 'Time is up');
}

console.log('\n── a meeting that has not started ──');
{
  const idle = meetingTime({ startedAt: null });
  check('there is no clock to show', idle.running === false && idle.elapsed === '');
  check('and nothing to warn about', idle.remaining === null && idle.level === 'normal');

  check('a nonsense date is treated as not started',
    meetingTime({ startedAt: 'not a date' }).running === false);
  check('so is no argument at all', meetingTime().running === false);
}

console.log('\n── a meeting with no limit ──');
{
  const start = Date.parse('2026-09-15T10:00:00Z');
  const t = meetingTime({
    startedAt: new Date(start).toISOString(),
    maxDurationMinutes: 0,
    now: start + 12 * MIN + 4 * SEC,
  });

  check('it is running', t.running === true);
  check('the elapsed clock is right', t.elapsed === '12:04', t.elapsed);
  check('there is no countdown', t.remainingMs === null);
  // An ever-present countdown would invent an anxiety the meeting did not have.
  check('and nothing is said about time left', t.remaining === null);
  check('the level stays normal however long it runs',
    meetingTime({ startedAt: new Date(start).toISOString(), now: start + 9 * HOUR }).level === 'normal');
}

console.log('\n── a meeting with a limit ──');
{
  const start = Date.parse('2026-09-15T10:00:00Z');
  const at = (ms) => meetingTime({
    startedAt: new Date(start).toISOString(),
    maxDurationMinutes: 60,
    now: start + ms,
  });

  check('early on, nothing is said', at(5 * MIN).remaining === null, JSON.stringify(at(5 * MIN)));
  check('and the level is normal', at(5 * MIN).level === 'normal');

  const soon = at(60 * MIN - SOON_MS + SEC);
  check('a warning appears as the end approaches', soon.remaining !== null, JSON.stringify(soon));
  check('at the "soon" level', soon.level === 'soon', soon.level);

  const urgent = at(60 * MIN - URGENT_MS + SEC);
  check('it gets insistent near the end', urgent.level === 'urgent', urgent.level);
  check('and says how long is left', urgent.remaining.includes('left'), urgent.remaining);

  const over = at(61 * MIN);
  check('past the limit it says time is up', over.level === 'over' && over.remaining === 'Time is up',
    JSON.stringify(over));
  check('remaining never goes negative', over.remainingMs === 0, String(over.remainingMs));
  check('but the elapsed clock keeps running, because the call still is',
    over.elapsed === '1:01:00', over.elapsed);
}

console.log('\n── the boundaries, exactly ──');
{
  const start = 1_000_000;
  const at = (ms, limit = 60) =>
    meetingTime({ startedAt: new Date(start).toISOString(), maxDurationMinutes: limit, now: start + ms });

  // Exactly on a threshold counts as having reached it — a warning that starts
  // a second late is fine; one that never starts is not.
  check('exactly ten minutes left is "soon"', at(50 * MIN).level === 'soon', at(50 * MIN).level);
  check('a second before that is still normal',
    at(50 * MIN - SEC).level === 'normal', at(50 * MIN - SEC).level);
  check('exactly two minutes left is "urgent"', at(58 * MIN).level === 'urgent', at(58 * MIN).level);
  check('exactly at the limit is over', at(60 * MIN).level === 'over', at(60 * MIN).level);
  check('a second before the limit is not yet over',
    at(60 * MIN - SEC).level === 'urgent', at(60 * MIN - SEC).level);
}

console.log('\n── a clock running ahead of the server ──');
{
  // Browsers are not synchronised with the API. A start time a few seconds in
  // the "future" must read 0:00, not count up towards zero.
  const start = 2_000_000;
  const skewed = meetingTime({ startedAt: new Date(start).toISOString(), now: start - 4 * SEC });
  check('it reads zero rather than going negative', skewed.elapsed === '0:00', skewed.elapsed);
  check('and is still considered running', skewed.running === true);
}

console.log('\n── "started x ago", for a list ──');
{
  const start = 3_000_000;
  const ago = (ms) => startedAgo(new Date(start).toISOString(), start + ms);

  check('the first minute is not a number', ago(20 * SEC) === 'just started', ago(20 * SEC));
  check('minutes', ago(12 * MIN + 50 * SEC) === '12 min in', ago(12 * MIN + 50 * SEC));
  // Floor, not round: a list refreshed rarely should never claim more time has
  // passed than actually has.
  check('it rounds down rather than up', ago(59 * SEC) === 'just started', ago(59 * SEC));
  check('an exact hour', ago(HOUR) === '1h in', ago(HOUR));
  check('hours and minutes', ago(2 * HOUR + 15 * MIN) === '2h 15m in', ago(2 * HOUR + 15 * MIN));
  check('nothing to say without a start time', startedAgo(null) === '');
  check('nor for a nonsense one', startedAgo('whenever') === '');
}

console.log('\n── how long something lasted ──');
{
  const from = Date.parse('2026-09-15T10:00:00Z');
  const to = from + 45 * MIN + 12 * SEC;

  check('a closed span', durationBetween(new Date(from).toISOString(), new Date(to).toISOString()) === '45:12',
    durationBetween(new Date(from).toISOString(), new Date(to).toISOString()));

  // The same function serves "ran for" and "has been here", which is the point.
  check('an open span runs to now',
    durationBetween(new Date(from).toISOString(), null, from + 3 * MIN) === '3:00',
    durationBetween(new Date(from).toISOString(), null, from + 3 * MIN));

  check('an end before the start reads as zero rather than negative',
    durationBetween(new Date(to).toISOString(), new Date(from).toISOString()) === '0:00',
    durationBetween(new Date(to).toISOString(), new Date(from).toISOString()));

  check('no start means nothing to show', durationBetween(null, new Date(to).toISOString()) === '');
  check('a nonsense start means nothing to show', durationBetween('whenever', null) === '');
  check('a nonsense end means nothing to show',
    durationBetween(new Date(from).toISOString(), 'whenever') === '');
  check('a long one grows an hours field',
    durationBetween(new Date(from).toISOString(), new Date(from + 2 * HOUR).toISOString()) === '2:00:00');
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
