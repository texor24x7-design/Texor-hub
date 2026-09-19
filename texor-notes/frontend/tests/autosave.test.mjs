/**
 * Autosave.
 *
 * Losing somebody's typing is the worst thing this feature could do, and the
 * second worst is telling them it saved when it did not. Both are decided here,
 * and none of it needs a browser.
 *
 * The suite exists because of a real failure: the indicator sat on "Unsaved
 * changes" forever in development while every save was in fact landing. See the
 * StrictMode section at the bottom.
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const { createSaver, saveLabel } = await import(`${FE}/src/lib/autosave.js`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** A save that records what it was given and can be made slow or broken. */
function recorder({ ms = 0, failTimes = 0 } = {}) {
  const calls = [];
  let failures = failTimes;

  const save = async (draft) => {
    calls.push(draft);
    if (ms) await wait(ms);
    if (failures > 0) { failures -= 1; throw new Error('network is down'); }
    return { ok: true };
  };

  return { save, calls };
}

/**
 * A save that finishes only when the test says so.
 *
 * Anything asserting *ordering* uses this rather than sleeps. A timing-based
 * version of these checks passes on a quiet machine and fails under load, and a
 * suite that fails at random is one everybody learns to re-run.
 */
function controlled() {
  const calls = [];
  const gates = [];

  const save = (draft) => {
    calls.push(draft);
    return new Promise((resolve, reject) => { gates.push({ resolve, reject }); });
  };

  return { save, calls, gates };
}

/** Let queued promise callbacks and zero-delay timers drain. */
const settle = async (turns = 4) => {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => { setTimeout(r, 0); });
};

console.log('\n── it saves what you typed ──');
{
  const { save, calls } = recorder();
  const saver = createSaver({ save, delay: 10 });

  saver.queue({ title: 'one' });
  check('it reports the edit immediately', saver.snapshot().state === 'dirty');

  await wait(40);
  check('the save happens', calls.length === 1, JSON.stringify(calls));
  check('with what was typed', calls[0].title === 'one');
  check('and it says so', saver.snapshot().state === 'saved', saver.snapshot().state);
  check('nothing is left pending', !saver.hasPending());
}

console.log('\n── typing fast sends one save, not twenty ──');
{
  const { save, calls } = recorder();
  const saver = createSaver({ save, delay: 20 });

  for (const title of ['a', 'ab', 'abc', 'abcd']) saver.queue({ title });
  await wait(60);

  check('keystrokes coalesce into one request', calls.length === 1, String(calls.length));
  check('and it is the newest draft that goes', calls[0].title === 'abcd', JSON.stringify(calls));
}

console.log('\n── two saves never overlap ──');
{
  // The one that silently reverts a paragraph: if both are in flight, the older
  // response can land last and win.
  const { save, calls, gates } = controlled();
  const saver = createSaver({ save, delay: 1, retryDelay: 1 });

  saver.queue({ title: 'first' });
  await settle();
  check('the first is in flight', saver.isRunning());

  saver.queue({ title: 'second' });
  await settle();
  check('the second waits rather than starting', calls.length === 1, String(calls.length));

  gates[0].resolve();
  await settle();
  check('it goes once the first finishes', calls.length === 2, String(calls.length));
  check('in order', calls[0].title === 'first' && calls[1].title === 'second',
    JSON.stringify(calls.map((c) => c.title)));

  gates[1].resolve();
  await settle();
  check('and settles on saved', saver.snapshot().state === 'saved', saver.snapshot().state);
}

console.log('\n── an edit during a save is not reported as saved ──');
{
  const { save, calls, gates } = controlled();
  const saver = createSaver({ save, delay: 1, retryDelay: 1 });

  const seen = [];
  saver.listen(({ state }) => seen.push(state));

  saver.queue({ title: 'a' });
  await settle();
  saver.queue({ title: 'b' });      // lands while the first is still in flight

  gates[0].resolve();                // the first save returns, with 'b' unsent
  await settle();
  check('the newer edit is sent on its own', calls.length === 2, String(calls.length));

  gates[1].resolve();
  await settle();

  check('saved is never announced before the last edit has landed',
    seen.indexOf('saved') === seen.length - 1, JSON.stringify(seen));
  check('and saved once that one lands too', saver.snapshot().state === 'saved', saver.snapshot().state);
}

console.log('\n── a failed save keeps the draft ──');
{
  const { save, calls, gates } = controlled();
  const saver = createSaver({ save, delay: 1, retryDelay: 1 });

  saver.queue({ title: 'precious' });
  await settle();

  gates[0].reject(new Error('network is down'));
  await settle(1);

  check('the failure is reported', saver.snapshot().error === 'network is down',
    JSON.stringify(saver.snapshot()));
  check('and the draft is still held, not dropped', saver.hasPending());

  await settle();
  check('it tries again on its own', calls.length === 2, String(calls.length));
  check('with the draft still intact', calls[1].title === 'precious', JSON.stringify(calls));

  gates[1].resolve();
  await settle();
  check('and recovers', saver.snapshot().state === 'saved', saver.snapshot().state);
  check('clearing the error', saver.snapshot().error === null);
}

console.log('\n── flushing now ──');
{
  const { save, calls } = recorder();
  const saver = createSaver({ save, delay: 10_000 });

  saver.queue({ title: 'leaving' });
  await saver.flushNow();

  check('it does not wait for the debounce', calls.length === 1, String(calls.length));
  check('which is what makes closing the panel safe', calls[0].title === 'leaving');

  await saver.flushNow();
  check('flushing with nothing pending does nothing', calls.length === 1, String(calls.length));
}

console.log('\n── StrictMode: the bug this file was written for ──');
{
  /**
   * React StrictMode mounts twice in development: effect, cleanup, effect. The
   * previous implementation cleared an `alive` ref in the cleanup and never set
   * it back, so every state update after that was dropped — the save worked,
   * the indicator was frozen on "Unsaved changes" forever.
   *
   * A listener re-attaches on the second mount, because attaching is what the
   * effect body does. This is that exact sequence.
   */
  const { save, calls } = recorder();
  const saver = createSaver({ save, delay: 10 });

  const seen = [];
  const listener = ({ state }) => seen.push(state);

  const off1 = saver.listen(listener);   // first mount
  off1();                                // StrictMode cleanup
  const off2 = saver.listen(listener);   // second mount

  seen.length = 0;
  saver.queue({ title: 'typed after the double mount' });
  await wait(40);

  check('the save still happens', calls.length === 1, String(calls.length));
  check('and the state updates still arrive', seen.length > 0, JSON.stringify(seen));
  check('ending on saved, not stuck on dirty',
    seen[seen.length - 1] === 'saved', JSON.stringify(seen));
  check('having passed through saving', seen.includes('saving'), JSON.stringify(seen));

  off2();
}

console.log('\n── a fresh listener is told where things stand ──');
{
  const { save } = controlled();
  const saver = createSaver({ save, delay: 1 });

  saver.queue({ title: 'x' });
  await settle();

  // A remount midway through a save must not show "idle" for a note that is
  // busy saving.
  let first = null;
  const off = saver.listen((status) => { first ??= status.state; });
  check('it is handed the current state on attach', first === 'saving', String(first));
  off();
}

console.log('\n── an unsubscribed listener stops hearing ──');
{
  const { save } = recorder();
  const saver = createSaver({ save, delay: 5 });

  const seen = [];
  const off = saver.listen(({ state }) => seen.push(state));
  off();
  seen.length = 0;

  saver.queue({ title: 'y' });
  await wait(30);
  check('nothing arrives after unsubscribing', seen.length === 0, JSON.stringify(seen));
}

console.log('\n── what a person is shown ──');
{
  check('idle says nothing at all', saveLabel('idle') === '');
  check('dirty is honest about it', saveLabel('dirty') === 'Unsaved changes');
  check('saving says so', saveLabel('saving') === 'Saving…');
  check('saved says so', saveLabel('saved') === 'Saved');
  check('an error says so', saveLabel('error') === 'Could not save');
  check('an unknown state says nothing rather than "undefined"', saveLabel('wat') === '');
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
