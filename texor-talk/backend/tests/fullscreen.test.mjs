/**
 * The fullscreen fallback chain.
 *
 * Three browsers, three spellings, and the one that matters most is iOS —
 * where no element can go fullscreen and only a <video> can, through a method
 * that exists nowhere else. Stubbed rather than run in a browser, because what
 * is worth pinning down is which call is reached in which case.
 */
const FE = new URL('../../frontend/', import.meta.url).pathname.replace(/\/$/, '');
const { enterFullscreen, exitFullscreen, fullscreenSupported, fullscreenAction } =
  await import(`${FE}/src/lib/fullscreen.js`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

globalThis.document = { addEventListener() {}, removeEventListener() {} };

console.log('\n── which call is reached ──');
{
  const calls = [];
  const el = { requestFullscreen: () => { calls.push('standard'); return Promise.resolve(); } };
  await enterFullscreen(el, null);
  check('a standards-compliant browser uses requestFullscreen', calls[0] === 'standard');
}
{
  const calls = [];
  const el = { webkitRequestFullscreen: () => { calls.push('webkit'); return Promise.resolve(); } };
  await enterFullscreen(el, null);
  check('desktop Safari falls back to the webkit spelling', calls[0] === 'webkit');
}
{
  const calls = [];
  // iOS: the element itself offers nothing at all.
  const el = {};
  const video = { webkitEnterFullscreen: () => { calls.push('ios-video'); } };
  await enterFullscreen(el, video);
  check('iOS falls back to native video fullscreen', calls[0] === 'ios-video');
}
{
  const err = await enterFullscreen({}, {}).catch((e) => e);
  check('a browser that supports none of them reports it',
    err instanceof Error && /not available/i.test(err.message), err?.message);
}

console.log('\n── the standard spelling wins when several exist ──');
{
  const calls = [];
  const el = {
    requestFullscreen: () => { calls.push('standard'); return Promise.resolve(); },
    webkitRequestFullscreen: () => { calls.push('webkit'); return Promise.resolve(); },
  };
  const video = { webkitEnterFullscreen: () => calls.push('ios-video') };
  await enterFullscreen(el, video);
  check('only one call is made', calls.length === 1, JSON.stringify(calls));
  check('and it is the standard one', calls[0] === 'standard');
}

console.log('\n── support detection ──');
check('an element with requestFullscreen is supported', fullscreenSupported({ requestFullscreen() {} }, null));
check('a webkit element is supported', fullscreenSupported({ webkitRequestFullscreen() {} }, null));
check('a bare element with an iOS video is supported', fullscreenSupported({}, { webkitEnterFullscreen() {} }));
check('a bare element with a plain video is not', !fullscreenSupported({}, {}));
check('nothing at all is not', !fullscreenSupported(null, null));

console.log('\n── exiting ──');
{
  let exited = null;
  globalThis.document = { exitFullscreen: () => { exited = 'standard'; return Promise.resolve(); } };
  await exitFullscreen();
  check('uses exitFullscreen when present', exited === 'standard');

  globalThis.document = { webkitExitFullscreen: () => { exited = 'webkit'; return Promise.resolve(); } };
  await exitFullscreen();
  check('falls back to the webkit spelling', exited === 'webkit');

  globalThis.document = {};
  check('and does not throw when neither exists',
    await exitFullscreen().then(() => true).catch(() => false));
}

console.log('\n── what a toggle should do ──');
{
  /**
   * The bug this is here for.
   *
   * `toggle` used to exit first and *then* ask whether the thing it had just
   * exited was the one being toggled. By that point nothing was fullscreen,
   * the comparison was against null, and it fell through and re-entered — so
   * the button to leave fullscreen left and came straight back. From the
   * outside that is indistinguishable from the button not working, and it was
   * invisible here because the decision lived inside a React hook that cannot
   * run without a browser.
   *
   * It is a pure function now, and this is the case that was wrong.
   */
  const tile = { id: 'tile' };
  const other = { id: 'other' };

  check('leaving the thing that is fullscreen is an exit, not a re-entry',
    fullscreenAction(tile, tile) === 'exit', fullscreenAction(tile, tile));

  check('nothing fullscreen means enter', fullscreenAction(null, tile) === 'enter');
  check('and undefined counts as nothing', fullscreenAction(undefined, tile) === 'enter');

  // One tile to another: the browser rejects a second request while one is
  // already fullscreen, so it has to be left first.
  check('another element fullscreen means swap', fullscreenAction(other, tile) === 'swap');

  check('no target at all does nothing', fullscreenAction(tile, null) === 'none');
  check('even with nothing fullscreen either', fullscreenAction(null, null) === 'none');
  check('and no arguments does not throw', fullscreenAction() === 'none');

  /**
   * The property underneath it: asking for the same thing twice returns to
   * where it started. A toggle that does not is not a toggle.
   */
  const settle = (current, target) => {
    const action = fullscreenAction(current, target);
    if (action === 'exit') return null;
    if (action === 'enter' || action === 'swap') return target;
    return current;
  };

  check('toggling twice comes back to nothing fullscreen',
    settle(settle(null, tile), tile) === null);
  check('and toggling a second tile lands on that one',
    settle(settle(null, tile), other) === other);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
