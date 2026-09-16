/**
 * The colour a meeting gets.
 *
 * Two properties matter and both are easy to get wrong by reaching for
 * `Math.random`: the same meeting must be the same colour everywhere, and a
 * scheduled meeting must never come out green — green means live in this
 * interface, and a card that borrows it is saying something untrue.
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const { accentFor, ACCENTS } = await import(`${FE}/src/lib/accent.js`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

console.log('\n── the same meeting is always the same colour ──');
{
  const code = 'cbv-qzzr-pwr';
  const once = accentFor(code);
  check('asking twice gives the same answer', accentFor(code) === once, once);
  check('and a hundred times', Array.from({ length: 100 }, () => accentFor(code)).every((a) => a === once));
  // Stored nowhere, so it has to be derivable — that is what makes it the same
  // on somebody else's screen as on yours.
  check('a different meeting can differ', accentFor('aaa-bbbb-ccc') !== undefined);
}

console.log('\n── green is reserved ──');
{
  const codes = Array.from({ length: 400 }, (_, i) => `code-${i}-${i * 7}`);
  const used = new Set(codes.map((code) => accentFor(code)));

  check('no scheduled meeting is ever green', !used.has('live'), [...used].join(', '));
  check('every colour it picks is one of the set',
    [...used].every((a) => ACCENTS.includes(a)), [...used].join(', '));
  check('and green is not in that set', !ACCENTS.includes('live') && !ACCENTS.includes('green'));
}

console.log('\n── live wins ──');
{
  check('a live meeting is green whatever its code', accentFor('anything', { live: true }) === 'live');
  check('even one whose code would hash elsewhere',
    accentFor('cbv-qzzr-pwr', { live: true }) === 'live');
}

console.log('\n── it spreads across the palette ──');
{
  // A hash that answers "blue" for everything would be stable and useless.
  const codes = Array.from({ length: 200 }, (_, i) => `m-${i}`);
  const counts = new Map();
  for (const code of codes) {
    const accent = accentFor(code);
    counts.set(accent, (counts.get(accent) ?? 0) + 1);
  }

  check('every colour gets used', counts.size === ACCENTS.length,
    [...counts].map(([a, n]) => `${a}:${n}`).join(' '));
  check('and none of them dominates',
    [...counts.values()].every((n) => n > 200 / ACCENTS.length / 3),
    [...counts].map(([a, n]) => `${a}:${n}`).join(' '));
}

console.log('\n── nothing sensible to work with ──');
{
  check('no code still gives a colour', ACCENTS.includes(accentFor(undefined)));
  check('an empty code too', ACCENTS.includes(accentFor('')));
  check('no arguments at all', ACCENTS.includes(accentFor()));
  check('a number is fine', ACCENTS.includes(accentFor(12345)));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
