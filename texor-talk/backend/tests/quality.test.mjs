/**
 * The quality ceiling.
 *
 * A host choosing a tier is choosing how much the organisation spends, so the
 * rules that matter here are the ones about money: a host can never end up
 * above the ceiling, and a ceiling that drops must not break meetings that were
 * scheduled under the old one.
 *
 * Pure logic — no database, no server.
 */
const {
  TIERS, TIER_ORDER, isTier, effectiveTier, limitsFor, availableTiers, maxSendBitrate,
} = await import('../src/services/quality.service.js');

const FE = new URL('../../frontend/', import.meta.url).pathname.replace(/\/$/, '');
const { cameraEncodings, screenEncodings } = await import(`${FE}/src/lib/encodings.js`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

console.log('\n── the tiers are ordered by what they cost ──');
for (let i = 1; i < TIER_ORDER.length; i += 1) {
  const cheaper = TIERS[TIER_ORDER[i - 1]];
  const dearer = TIERS[TIER_ORDER[i]];
  check(`${dearer.id} sends more camera than ${cheaper.id}`, dearer.cameraBitrate > cheaper.cameraBitrate);
  check(`${dearer.id} sends more screen than ${cheaper.id}`, dearer.screenBitrate > cheaper.screenBitrate);
}
check('every tier is named for a person to read', TIER_ORDER.every((id) => TIERS[id].name && TIERS[id].blurb));
check('every tier states a screen frame rate', TIER_ORDER.every((id) => TIERS[id].screenFrameRate > 0));

console.log('\n── a host never gets above the ceiling ──');
for (const ceiling of TIER_ORDER) {
  for (const wanted of TIER_ORDER) {
    const got = effectiveTier(wanted, ceiling);
    check(`wanting ${wanted} under a ${ceiling} ceiling stays at or below it`,
      TIER_ORDER.indexOf(got) <= TIER_ORDER.indexOf(ceiling), `got ${got}`);
  }
}
check('a host below the ceiling keeps their own choice', effectiveTier('saver', 'high') === 'saver');
check('a host at the ceiling keeps their own choice', effectiveTier('high', 'high') === 'high');

console.log('\n── a dropped ceiling clamps rather than breaks ──');
// A meeting scheduled at "high" when the plan allowed it, seen after a downgrade.
check('an over-ceiling meeting falls back to the best still allowed',
  effectiveTier('high', 'saver') === 'saver');
check('it does not fail or return nothing', isTier(effectiveTier('high', 'saver')));

console.log('\n── nonsense input lands somewhere safe ──');
check('an unknown tier becomes standard', effectiveTier('ultra', 'high') === 'standard');
check('an unknown ceiling does not raise anything', effectiveTier('high', 'unlimited') === 'high');
check('nothing requested becomes standard', effectiveTier(undefined, 'high') === 'standard');
check('nothing at all still resolves', isTier(effectiveTier(null, null)));
check('limitsFor falls back rather than returning undefined', limitsFor('nope') === TIERS.standard);
check('isTier rejects a near miss', !isTier('High'));

console.log('\n── what a host is offered ──');
check('a saver ceiling offers one tier', availableTiers('saver').length === 1);
check('a standard ceiling offers two', availableTiers('standard').length === 2);
check('a high ceiling offers all three', availableTiers('high').length === 3);
check('the offered tiers are the cheap end of the list',
  availableTiers('standard').map((t) => t.id).join() === 'saver,standard');
check('each option carries its relative cost', availableTiers('high').every((t) => t.relativeCost > 0));
check('standard is the unit of relative cost',
  availableTiers('high').find((t) => t.id === 'standard').relativeCost === 1);
check('high costs more than standard',
  availableTiers('high').find((t) => t.id === 'high').relativeCost > 1);
check('an unknown ceiling offers everything rather than nothing', availableTiers('enterprise').length === 3);

console.log('\n── the server-side cap covers everything one person sends ──');
for (const id of TIER_ORDER) {
  const limits = TIERS[id];
  const cap = maxSendBitrate(id);
  check(`${id} leaves room for camera and screen at once`,
    cap > limits.cameraBitrate + limits.screenBitrate,
    `cap ${cap} vs ${limits.cameraBitrate + limits.screenBitrate}`);
}
check('a dearer tier gets a higher cap', maxSendBitrate('high') > maxSendBitrate('saver'));
check('an unknown tier gets the standard cap', maxSendBitrate('nope') === maxSendBitrate('standard'));

console.log('\n── a share is captured at a size its bitrate can carry ──');
{
  const { screenConstraints, cameraBudget, PRESENTING_CAMERA_BITRATE } =
    await import(`${FE}/src/lib/encodings.js`);

  for (const id of TIER_ORDER) {
    const tier = TIERS[id];
    check(`${id} states a capture ceiling`, tier.screenMaxHeight > 0, String(tier.screenMaxHeight));

    const c = screenConstraints({ frameRate: tier.screenFrameRate, maxHeight: tier.screenMaxHeight });
    check(`${id} caps the captured height`, c.height.max === tier.screenMaxHeight);
    check(`${id} caps the width to match, 16:9`, c.width.max === Math.round((tier.screenMaxHeight * 16) / 9));
    check(`${id} caps the frame rate too`, c.frameRate.max === tier.screenFrameRate);
  }

  // `max`, never `ideal` — a small screen must not be scaled *up* to meet it.
  const c = screenConstraints({ maxHeight: 1080 });
  check('the size is a ceiling, not a target', c.height.ideal === undefined, JSON.stringify(c.height));
  check('a cheaper tier captures fewer pixels than a dearer one',
    TIERS.saver.screenMaxHeight < TIERS.high.screenMaxHeight);

  console.log('\n── the camera stands down while a screen is up ──');
  check('presenting cuts the camera budget',
    cameraBudget(TIERS.high.cameraBitrate, { presenting: true }) === PRESENTING_CAMERA_BITRATE,
    String(cameraBudget(TIERS.high.cameraBitrate, { presenting: true })));
  check('and leaves it alone otherwise',
    cameraBudget(TIERS.high.cameraBitrate) === TIERS.high.cameraBitrate);
  // It must never *raise* one: Data saver presenting stays under its own tier.
  check('it never raises a budget above the tier',
    cameraBudget(200_000, { presenting: true }) === 200_000,
    String(cameraBudget(200_000, { presenting: true })));
  check('the yielded budget is well under every tier\u2019s screen bitrate',
    TIER_ORDER.every((id) => PRESENTING_CAMERA_BITRATE < TIERS[id].screenBitrate));
}

console.log('\n── the client builds its ladder from the grant ──');
for (const id of TIER_ORDER) {
  const { cameraBitrate, screenBitrate } = TIERS[id];
  const camera = cameraEncodings(cameraBitrate);
  const screen = screenEncodings(screenBitrate);

  check(`${id} camera keeps three simulcast layers`, camera.length === 3);
  check(`${id} camera tops out at exactly the grant`,
    camera[camera.length - 1].maxBitrate === cameraBitrate);
  check(`${id} camera layers never exceed the grant`,
    camera.every((e) => e.maxBitrate <= cameraBitrate));
  check(`${id} camera layers climb`,
    camera.every((e, i) => i === 0 || e.maxBitrate > camera[i - 1].maxBitrate));
  check(`${id} camera resolutions shrink for the lower layers`,
    camera.every((e, i) => i === 0 || e.scaleResolutionDownBy < camera[i - 1].scaleResolutionDownBy));
  check(`${id} screen stays a single layer`, screen.length === 1);
  check(`${id} screen is sent at exactly the grant`, screen[0].maxBitrate === screenBitrate);
  check(`${id} sets no scalabilityMode`,
    [...camera, ...screen].every((e) => e.scalabilityMode === undefined));
}
check('a saver camera really is cheaper than a high one',
  cameraEncodings(TIERS.saver.cameraBitrate)[2].maxBitrate < cameraEncodings(TIERS.high.cameraBitrate)[2].maxBitrate);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
