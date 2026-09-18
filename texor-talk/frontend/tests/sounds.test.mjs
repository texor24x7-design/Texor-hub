/**
 * Call chimes.
 *
 * The tones are data and the rules about when to play are pure, so both are
 * checked here without a browser. What is *not* checked is the oscillator
 * itself — that needs an `AudioContext`, and asserting a sine wave is a sine
 * wave proves nothing anybody cares about.
 *
 * What people care about is that these do not become irritating, and that is
 * entirely decided by the gate below.
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const { TONES, toneLength, createSoundGate, createChimes } = await import(`${FE}/src/lib/sounds.js`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

console.log('\n── the tones ──');
{
  check('there is one for each thing that happens',
    Object.keys(TONES).sort().join() === 'ended,join,leave', Object.keys(TONES).join());

  for (const [name, tone] of Object.entries(TONES)) {
    check(`${name} has notes`, tone.notes.length > 0);
    check(`${name} has a real frequency for every note`,
      tone.notes.every((n) => n.freq > 20 && n.freq < 20_000));
    check(`${name} has a duration for every note`, tone.notes.every((n) => n.ms > 0));
    check(`${name} plays its notes in order`,
      tone.notes.every((n, i) => i === 0 || n.at >= tone.notes[i - 1].at));
    // This plays over the top of somebody talking.
    check(`${name} is quiet`, tone.gain > 0 && tone.gain <= 0.15, String(tone.gain));
  }

  // The shape is what makes them tellable apart without looking at the screen.
  const rises = (t) => t.notes[t.notes.length - 1].freq > t.notes[0].freq;
  check('arriving rises', rises(TONES.join));
  check('leaving falls', !rises(TONES.leave));
  check('the end falls all the way down',
    TONES.ended.notes.every((n, i) => i === 0 || n.freq < TONES.ended.notes[i - 1].freq));

  check('a chime is short', toneLength('join') < 400, String(toneLength('join')));
  check('and the end is the longest of them',
    toneLength('ended') > toneLength('join') && toneLength('ended') > toneLength('leave'),
    `${toneLength('ended')} vs ${toneLength('join')}/${toneLength('leave')}`);
  check('an unknown sound has no length rather than throwing', toneLength('nope') === 0);
}

console.log('\n── nothing plays before you are in the call ──');
{
  const gate = createSoundGate();
  check('not armed to begin with', gate.armed === false);
  // Otherwise opening a busy meeting announces everyone already in it.
  check('a join is ignored', gate.allow('join', 1000) === false);
  check('so is the meeting ending', gate.allow('ended', 1000) === false);
}

console.log('\n── nor for a moment after you join ──');
{
  // The roster arrives as a burst of joins; it must not play as a burst of
  // chimes. This is the rule that stops that.
  const gate = createSoundGate({ settleMs: 2500 });
  gate.arm(0);

  check('not immediately', gate.allow('join', 0) === false);
  check('not a second later', gate.allow('join', 1000) === false);
  check('not just before the window closes', gate.allow('join', 2499) === false);
  check('but once it has settled, yes', gate.allow('join', 2600) === true);
}

console.log('\n── two people arriving together make one sound ──');
{
  const gate = createSoundGate({ settleMs: 0, minGapMs: 350 });
  gate.arm(0);

  check('the first plays', gate.allow('join', 1000) === true);
  check('one arriving straight after does not', gate.allow('join', 1100) === false);
  check('nor does a third', gate.allow('join', 1200) === false);
  check('once the gap has passed, it plays again', gate.allow('join', 1400) === true);
}

console.log('\n── a crowd filing in is not a slot machine ──');
{
  const gate = createSoundGate({ settleMs: 0, minGapMs: 0, maxPerWindow: 4, windowMs: 5000 });
  gate.arm(0);

  const played = [];
  for (let i = 0; i < 30; i += 1) played.push(gate.allow('join', 1000 + i * 100));

  check('only the cap gets through', played.filter(Boolean).length === 4,
    String(played.filter(Boolean).length));
  check('and they are the first ones, not a random few',
    played.slice(0, 4).every(Boolean) && !played.slice(4).some(Boolean));

  // The window slides; it is a rate, not a quota for the whole call.
  check('after the window, it plays again', gate.allow('join', 7000) === true);
}

console.log('\n── the end is never suppressed ──');
{
  // It happens once, and it is the one everybody needs to hear.
  const settling = createSoundGate({ settleMs: 5000 });
  settling.arm(0);
  check('not by the settling window', settling.allow('ended', 100) === true);

  const busy = createSoundGate({ settleMs: 0, minGapMs: 0, maxPerWindow: 1 });
  busy.arm(0);
  busy.allow('join', 1000);
  check('not by the rate limit', busy.allow('ended', 1001) === true);
  check('though an ordinary sound still is', busy.allow('leave', 1002) === false);

  const closed = createSoundGate();
  check('but it still does not play before you are in the call',
    closed.allow('ended', 1000) === false);
}

console.log('\n── leaving the call ──');
{
  const gate = createSoundGate({ settleMs: 0 });
  gate.arm(0);
  check('armed', gate.armed === true);

  gate.disarm();
  check('disarming stops everything', gate.armed === false);
  check('including the end', gate.allow('ended', 5000) === false);

  // Rejoining starts the settling window again, or coming back to a busy room
  // would announce all of it.
  const rejoined = createSoundGate({ settleMs: 2500 });
  rejoined.arm(0);
  rejoined.disarm();
  rejoined.arm(10_000);
  check('re-arming starts the settling window again',
    rejoined.allow('join', 10_100) === false);
  check('and it opens on schedule from the new arming',
    rejoined.allow('join', 12_600) === true);

  const fresh = createSoundGate({ settleMs: 0, minGapMs: 0, maxPerWindow: 2 });
  fresh.arm(0);
  fresh.allow('join', 1);
  fresh.allow('join', 2);
  check('and the rate limit starts fresh too', fresh.allow('join', 3) === false);
  fresh.arm(4);
  check('until it is re-armed', fresh.allow('join', 5) === true);
}

console.log('\n── the player survives having no audio at all ──');
{
  /**
   * There is no `window` here, which is also true during server rendering —
   * and the player is constructed during a render, so it has to be safe there.
   * It is equally the case in a browser with Web Audio disabled.
   */
  const chimes = createChimes();
  check('it constructs without a browser', typeof chimes.play === 'function');
  check('playing reports that it did not, rather than throwing',
    chimes.play('join') === false);
  check('and the same for the end', chimes.play('ended') === false);

  chimes.arm(0);
  check('arming without audio does not throw', chimes.enabled === true);
  check('an unknown sound is simply not played', chimes.play('trumpet') === false);

  chimes.setEnabled(false);
  check('it can be turned off', chimes.enabled === false);
  check('and then plays nothing', chimes.play('ended') === false);

  chimes.setEnabled(true);
  check('and back on', chimes.enabled === true);

  chimes.close();
  check('closing with nothing open does not throw', true);
}

console.log('\n── your own departure is not rate-limited ──');
{
  // Leaving is a click of your own; the gate exists for other people's comings
  // and goings and must not swallow the feedback you asked for.
  const gate = createSoundGate({ settleMs: 0, minGapMs: 0, maxPerWindow: 0 });
  gate.arm(0);
  check('the gate would refuse it', gate.allow('leave', 1000) === false);

  const chimes = createChimes({ gate });
  // No AudioContext here, so the play itself still reports false — what is
  // being checked is that the gate is no longer what stops it.
  const seen = [];
  const original = gate.allow;
  gate.allow = (...args) => { seen.push(args[0]); return original.call(gate, ...args); };

  chimes.play('leave', 1000, { force: true });
  check('forcing does not consult it at all', seen.length === 0, seen.join());

  chimes.play('leave', 1000);
  check('without forcing it still does', seen.join() === 'leave', seen.join());

  chimes.setEnabled(false);
  chimes.play('leave', 1000, { force: true });
  check('and off still means off', seen.length === 1 && chimes.enabled === false);
}

console.log('\n── turning it off is checked before anything else ──');
{
  // Off means off, including for the end of the meeting.
  const gate = createSoundGate({ settleMs: 0 });
  const chimes = createChimes({ enabled: false, gate });
  chimes.arm(0);
  check('a disabled player refuses the end too', chimes.play('ended', 1000) === false);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
