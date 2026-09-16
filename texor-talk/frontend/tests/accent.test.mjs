/**
 * The colour a meeting gets.
 *
 * Two properties matter and both are easy to get wrong by reaching for
 * `Math.random`: the same meeting must be the same colour everywhere, and a
 * scheduled meeting must never come out green — green means live in this
 * interface, and a card that borrows it is saying something untrue.
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const { accentFor, ACCENTS, chatColorFor, CHAT_COLORS } = await import(`${FE}/src/lib/accent.js`);

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

console.log('\n── who said it, as a colour ──');
{
  /**
   * Chat has its own palette, on a different ground.
   *
   * The four above are chosen to sit on the app's white; the call is nearly
   * black and they go muddy there. Eight rather than four because chat is the
   * one place two people sharing a colour is actively confusing — the colour
   * is what the reader is using to tell one block of text from the next.
   */
  check('the same person is always the same colour',
    chatColorFor('tx-krishna') === chatColorFor('tx-krishna'));
  check('and a hundred times over',
    Array.from({ length: 100 }, () => chatColorFor('tx-asha'))
      .every((tone) => tone === chatColorFor('tx-asha')));

  check('every colour it picks is one of the set',
    Array.from({ length: 300 }, (_, i) => chatColorFor(`tx-${i}`))
      .every((tone) => CHAT_COLORS.includes(tone)));

  // Derived, never stored — so it has to agree across browsers with nothing
  // passed between them. That is only true if it depends on the id alone.
  check('it depends on nothing but the id',
    chatColorFor('tx-krishna') === chatColorFor(String('tx-krishna')));

  const counts = new Map();
  for (let i = 0; i < 400; i += 1) {
    const tone = chatColorFor(`person-${i}`);
    counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }
  check('it spreads across the palette', counts.size === CHAT_COLORS.length,
    [...counts.keys()].join(', '));
  check('and none of them dominates',
    [...counts.values()].every((n) => n > 400 / CHAT_COLORS.length / 3),
    [...counts].map(([t, n]) => `${t}:${n}`).join(' '));

  /**
   * The two lists share the name `violet`, which is fine — they are different
   * values under different selectors on different grounds, and neither is
   * looked up by the other. What matters is the count: the reason chat has its
   * own palette is that four buckets put two people in the same colour far too
   * often for a column whose whole job is telling them apart.
   */
  check('there are more of these than there are page accents',
    CHAT_COLORS.length > ACCENTS.length, `${CHAT_COLORS.length} vs ${ACCENTS.length}`);
  check('and no colour is listed twice',
    new Set(CHAT_COLORS).size === CHAT_COLORS.length, CHAT_COLORS.join(', '));

  check('nothing to go on still gives a colour', CHAT_COLORS.includes(chatColorFor(undefined)));
  check('an empty id too', CHAT_COLORS.includes(chatColorFor('')));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
