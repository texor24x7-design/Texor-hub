/**
 * The floating window: what it shows, and what a share is a share *of*.
 *
 * ── Why these two together ──
 *
 * Both answer "what is worth looking at", and both were wrong in the same
 * direction. A presenter was shown a card instead of their own screen for
 * every kind of share — but only a whole display can mirror itself, so
 * somebody sharing a single tab was denied the one view that would have told
 * them they had picked the wrong one. The floating window inherits that
 * question, because keeping half an eye on what you are presenting while you
 * work in another app is most of the reason to open it.
 *
 * The browser halves are not tested here — opening a real picture-in-picture
 * window needs a real browser and a user gesture. What is tested is every
 * decision made before one is asked for.
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const { choosePipFeed } = await import(`${FE}/src/lib/pip.js`);
const { captureSurface, mirrorsItself } = await import(`${FE}/src/lib/stage.js`);

let pass = 0, fail = 0;
const check = (l, ok, extra = '') => {
  ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${extra}`));
};

const track = (id) => ({ id });
const peer = (texorId, name, camera = true) => ({
  texorId, name, tracks: camera ? { camera: track(`cam-${texorId}`) } : {},
});

console.log('\n── what a capture is of ──');
{
  const captured = (displaySurface) => ({ getSettings: () => ({ displaySurface }) });

  check('a tab is a tab', captureSurface(captured('browser')) === 'browser');
  check('a window is a window', captureSurface(captured('window')) === 'window');
  check('a display is a display', captureSurface(captured('monitor')) === 'monitor');

  /**
   * Safari has historically reported nothing here. Unknown has to mean
   * "monitor": being wrong that way costs a preview, and being wrong the other
   * way puts the meeting inside itself, forever.
   */
  check('an unreported surface is assumed to be a display',
    captureSurface(captured(undefined)) === 'monitor');
  check('and so is a value nobody recognises', captureSurface(captured('hologram')) === 'monitor');
  check('and so is no track at all', captureSurface(null) === 'monitor');
  check('even a track that cannot be asked', captureSurface({}) === 'monitor');
}

console.log('\n── only a whole display mirrors itself ──');
{
  const captured = (displaySurface) => ({ getSettings: () => ({ displaySurface }) });

  check('a whole display does', mirrorsItself(captured('monitor')) === true);
  check('a tab does not', mirrorsItself(captured('browser')) === false);
  check('nor does a single window', mirrorsItself(captured('window')) === false);
  check('an unknown surface is treated as one that does', mirrorsItself(captured(undefined)) === true);
}

console.log('\n── what the floating window looks at ──');
{
  const self = { texorId: 'me', name: 'Me', track: track('self-cam') };

  const screen = choosePipFeed({
    shares: [{ texorId: 'asha', name: 'Asha', track: track('screen') }],
    peers: [peer('asha', 'Asha'), peer('bo', 'Bo')],
    speakingTexorId: 'bo',
    self,
  });
  check('a shared screen beats everything', screen.kind === 'screen', screen.kind);
  check('even the person talking', screen.texorId === 'asha');

  const speaker = choosePipFeed({
    peers: [peer('asha', 'Asha'), peer('bo', 'Bo')],
    speakingTexorId: 'bo',
    self,
  });
  check('otherwise whoever is talking', speaker.texorId === 'bo', speaker.texorId);
  check('and it is their camera', speaker.track.id === 'cam-bo');

  const quiet = choosePipFeed({ peers: [peer('asha', 'Asha')], self });
  check('with nobody talking, somebody who is here', quiet.texorId === 'asha');

  /**
   * A peer with no camera is still worth showing: the window carries their
   * name and the fact that the meeting has somebody in it, which is most of
   * what it is for.
   */
  const dark = choosePipFeed({ peers: [peer('asha', 'Asha', false)], self });
  check('a peer with no camera still beats yourself',
    dark.kind === 'peer' && dark.texorId === 'asha', JSON.stringify(dark));
  check('with no picture to show', dark.track === null);

  const alone = choosePipFeed({ peers: [], self });
  check('alone, it shows you', alone.kind === 'self' && alone.track.id === 'self-cam');

  const nothing = choosePipFeed({});
  check('and with nothing at all it is empty rather than broken',
    nothing.kind === 'empty' && nothing.track === null);
  check('no arguments does not throw', choosePipFeed().kind === 'empty');
}

console.log('\n── a share with no picture is not a share ──');
{
  /**
   * The caller blanks its own whole-screen share before handing the list over,
   * so an entry can arrive with a null track. Picking it would leave the
   * window black while somebody was talking.
   */
  const self = { texorId: 'me', name: 'Me', track: track('self-cam') };

  const blanked = choosePipFeed({
    shares: [{ texorId: 'me', name: 'Me', track: null, isYou: true }],
    peers: [peer('asha', 'Asha')],
    self,
  });
  check('it is skipped for something that can be seen',
    blanked.kind === 'peer' && blanked.texorId === 'asha', JSON.stringify(blanked));

  const mine = choosePipFeed({
    shares: [{ texorId: 'me', name: 'Me', track: track('tab'), isYou: true }],
    peers: [peer('asha', 'Asha')],
    self,
  });
  check('but a tab share of our own is shown, which is the point of it',
    mine.kind === 'screen' && mine.track.id === 'tab', JSON.stringify(mine));
}

console.log('\n── the newest share wins ──');
{
  // The caller sorts newest-first; this takes the first that can be drawn.
  const feed = choosePipFeed({
    shares: [
      { texorId: 'bo', name: 'Bo', track: track('new') },
      { texorId: 'asha', name: 'Asha', track: track('old') },
    ],
    peers: [],
  });
  check('the first one offered', feed.track.id === 'new', feed.track.id);
}

console.log('\n── the media session it has to hold ──');
{
  /**
   * Registering the picture-in-picture action is necessary and not sufficient:
   * a browser grants the automatic version to a page with a *live* media
   * session, and declines for one that merely asked. That was the reason the
   * window would not open on its own.
   *
   * The half worth pinning here is the undo. A session left behind after a
   * call leaves a phantom in the operating system's own media controls — a
   * play button on the lock screen for a meeting that ended an hour ago.
   */
  const { holdMediaSession } = await import(`${FE}/src/lib/pip.js`);

  const session = { metadata: null, playbackState: 'none' };
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { mediaSession: session }, configurable: true });

  try {
    const release = holdMediaSession({ title: 'Q3 planning' });

    check('the session is marked as playing', session.playbackState === 'playing', session.playbackState);

    release();
    check('and is handed back afterwards', session.playbackState === 'none', session.playbackState);
    check('along with whatever metadata was there', session.metadata === null);

    // A browser with no media session at all must not throw on the way past.
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    const noop = holdMediaSession();
    check('a browser without one is not an error', typeof noop === 'function');
    noop();
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
