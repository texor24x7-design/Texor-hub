/**
 * Requests waiting for a reply.
 *
 * ── The bug this exists for ──
 *
 * Production sometimes showed "consume timed out." A consume takes
 * milliseconds, so twenty seconds was never plausible — and the meeting was
 * working by the time the error appeared.
 *
 * The cause was that a closed socket settled nothing. Every request in flight
 * when the connection dropped stayed registered with no reply coming and no
 * one to tell, until its own timer fired long afterwards and blamed whatever
 * action happened to be in flight. The client had already reconnected; the
 * error was describing the past.
 *
 * So: every request must leave exactly once, and leave at the moment its fate
 * is decided. These check all three exits and that none of them overlap.
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const { createPending } = await import(`${FE}/src/lib/pending.js`);

let pass = 0, fail = 0;
const check = (l, ok, extra = '') => {
  ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${extra}`));
};

/** A clock the test drives, so nothing here waits twenty seconds to find out. */
function clock() {
  let now = 0;
  const timers = new Map();
  let next = 1;

  return {
    setTimer(fn, delay) { timers.set(next, { fn, at: now + delay }); return next++; },
    clearTimer(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.fn(); }
      }
    },
    get live() { return timers.size; },
  };
}

/**
 * Wait for a promise, but never forever.
 *
 * Without the race, a request that is never settled makes this suite hang
 * rather than fail — which is precisely the defect it is here to catch, and a
 * hang says far less than a named failure does. `setImmediate` rather than a
 * timer, so it resolves after the microtask queue has drained but without
 * asking the clock, which the tests control.
 */
const settled = async (promise) => {
  const escape = Symbol('unsettled');
  const race = await Promise.race([
    promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error })),
    new Promise((resolve) => { setImmediate(() => resolve(escape)); }),
  ]);

  if (race === escape) return { ok: false, error: new Error('never settled'), stuck: true };
  return race;
};

console.log('\n── a reply ──');
{
  const time = clock();
  const pending = createPending({ timeout: 20_000, setTimer: time.setTimer, clearTimer: time.clearTimer });

  const promise = pending.add(1, 'consume');
  check('the request is being waited on', pending.size === 1);

  check('a reply is claimed', pending.settle(1, { ok: true, data: { id: 'c1' } }) === true);
  check('and it resolves with the payload', (await settled(promise)).value.id === 'c1');
  check('nothing is left waiting', pending.size === 0);

  /**
   * The timer has to go with it. Left running it would fire later and try to
   * reject a promise that already resolved — harmless in itself, but it is the
   * same loose end that produced the original bug.
   */
  check('and its timer is cancelled', time.live === 0, `${time.live} timers still live`);
}

console.log('\n── an error reply ──');
{
  const time = clock();
  const pending = createPending({ setTimer: time.setTimer, clearTimer: time.clearTimer });

  const promise = pending.add(7, 'consume');
  pending.settle(7, { ok: false, error: { code: 'gone', message: 'That participant has left the meeting.' } });

  const out = await settled(promise);
  check('it rejects', out.ok === false);
  check('carrying the code the server sent', out.error.code === 'gone', out.error.code);
  check('and the message', out.error.message.includes('has left'), out.error.message);
  check('a server error is not treated as retryable', out.error.retryable !== true);
}

console.log('\n── the socket goes away ──');
{
  const time = clock();
  const pending = createPending({ timeout: 20_000, setTimer: time.setTimer, clearTimer: time.clearTimer });

  const consume = pending.add(1, 'consume');
  const produce = pending.add(2, 'produce');
  const resume = pending.add(3, 'resumeConsumer');

  check('three are in flight', pending.size === 3);
  check('aborting reports how many it settled', pending.abort('The meeting connection closed.') === 3);

  const outs = await Promise.all([settled(consume), settled(produce), settled(resume)]);

  check('every one of them rejects', outs.every((out) => out.ok === false));
  check('immediately, not twenty seconds later',
    outs.every((out) => out.error.code === 'disconnected'), outs.map((o) => o.error.code).join(','));

  /**
   * The distinction the caller acts on: a dropped socket is a reconnect, not
   * an ended meeting. Getting this wrong throws people out of a call that is
   * still running.
   */
  check('and says so as something to retry', outs.every((out) => out.error.retryable === true));
  check('nothing is left registered', pending.size === 0);
  check('and no timer survives to fire later', time.live === 0, `${time.live} still live`);

  // The heart of it: the abandoned timer is what reported the stale error.
  time.advance(60_000);
  check('advancing past the timeout changes nothing', pending.size === 0);
}

console.log('\n── the timeout, when it is the real answer ──');
{
  const time = clock();
  const pending = createPending({ timeout: 20_000, setTimer: time.setTimer, clearTimer: time.clearTimer });

  const promise = pending.add(1, 'consume');

  time.advance(19_999);
  check('it waits the full time before giving up', pending.size === 1);

  time.advance(2);
  const out = await settled(promise);
  check('then rejects', out.ok === false);
  check('naming the action, so the message says what stalled',
    out.error.message === 'consume timed out.', out.error.message);
  check('as retryable, because a quiet server is not a refusal', out.error.retryable === true);
  check('and it stops being tracked', pending.size === 0);
}

console.log('\n── nothing settles twice ──');
{
  const time = clock();
  const pending = createPending({ timeout: 20_000, setTimer: time.setTimer, clearTimer: time.clearTimer });

  const promise = pending.add(1, 'consume');
  pending.settle(1, { ok: true, data: 'first' });

  check('a second reply for the same id is ignored',
    pending.settle(1, { ok: true, data: 'second' }) === false);
  check('and the first answer stands', (await settled(promise)).value === 'first');

  check('a reply for an id nobody awaits is ignored, not thrown',
    pending.settle(999, { ok: true, data: 'x' }) === false);

  // A reply that loses a race with the timeout: the promise is already
  // rejected, and the late reply must not be able to resolve it.
  const raced = createPending({ timeout: 10, setTimer: time.setTimer, clearTimer: time.clearTimer });
  const late = raced.add(5, 'consume');
  time.advance(20);
  check('a reply arriving after a timeout is ignored', raced.settle(5, { ok: true, data: 'late' }) === false);
  check('and the timeout is what the caller sees', (await settled(late)).error.code === 'timeout');
}

console.log('\n── an abort with nothing in flight ──');
{
  const pending = createPending();
  check('is not an error', pending.abort('closed') === 0);
  check('and leaves it empty', pending.size === 0);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
