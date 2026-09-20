/**
 * Which room of a meeting somebody may open.
 *
 * Pure, and the only place the question is answered. The panel hiding a button
 * is a hint; this is the rule, and it runs on the socket where it cannot be
 * skipped.
 */
const { resolveRoom, assignedRoom, MAIN_ROOM } = await import('../src/services/breakout.service.js');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const meeting = (over = {}) => ({
  code: 'abc-defg-hij',
  breakouts: {
    status: 'open',
    selfSelect: false,
    rooms: [
      { key: 'b1', name: 'Room 1', members: ['tx-ana'] },
      { key: 'b2', name: 'Room 2', members: ['tx-bo', 'tx-guest'] },
    ],
    ...over,
  },
});

const ask = (m, texorId, role, requested) => {
  try {
    return { room: resolveRoom({ meeting: m, texorId, role, requested }) };
  } catch (error) {
    return { refused: error.code };
  }
};

console.log('\n── before anybody opens a breakout ──');
{
  // The state every meeting is in today, and most meetings will stay in.
  check('there are no rooms to be in', resolveRoom({ meeting: { code: 'x' }, texorId: 'tx-ana', role: 'guest', requested: null }) === MAIN_ROOM);
  check('and asking for one anyway lands you in the meeting',
    resolveRoom({ meeting: { code: 'x' }, texorId: 'tx-ana', role: 'guest', requested: 'b1' }) === MAIN_ROOM);
  check('a closed breakout is the same as no breakout',
    resolveRoom({ meeting: meeting({ status: 'closed' }), texorId: 'tx-ana', role: 'guest', requested: 'b1' }) === MAIN_ROOM);
}

console.log('\n── asking for nothing means "where I belong" ──');
{
  // This is what makes a refresh, and a server restart, put everybody back.
  const m = meeting();
  check('somebody assigned to a room goes to it', ask(m, 'tx-ana', 'guest', null).room === 'b1');
  check('somebody assigned to another goes there', ask(m, 'tx-bo', 'guest', null).room === 'b2');
  check('a guest is assigned like anybody else', ask(m, 'tx-guest', 'guest', null).room === 'b2');
  check('somebody unassigned stays in the meeting', ask(m, 'tx-new', 'guest', null).room === MAIN_ROOM);
  check('and the assignment can be read on its own', assignedRoom(m, 'tx-bo') === 'b2');
}

console.log('\n── going somewhere on purpose ──');
{
  const m = meeting();
  check('back to the main room is always allowed', ask(m, 'tx-ana', 'guest', MAIN_ROOM).room === MAIN_ROOM);
  check('your own room is allowed', ask(m, 'tx-ana', 'guest', 'b1').room === 'b1');
  check("somebody else's room is refused", ask(m, 'tx-ana', 'guest', 'b2').refused === 'forbidden');
  check('a room that does not exist is refused', ask(m, 'tx-ana', 'guest', 'b9').refused === 'not_found');
  // The key is built by the server from this id, so anything unrecognised has
  // to be refused rather than concatenated into a key.
  check('and so is anything that looks like an attempt at another meeting',
    ask(m, 'tx-ana', 'guest', '../zzz-zzzz-zzz').refused === 'not_found');
}

console.log('\n── hosts visit ──');
{
  const m = meeting();
  check('a host may walk into any room', ask(m, 'tx-host', 'host', 'b2').room === 'b2');
  check('so may a co-host', ask(m, 'tx-co', 'cohost', 'b1').room === 'b1');
  // Custody counts as hosting — `roleOf` reports a stand-in as 'host'.
  check('a host with no assignment still lands in the meeting by default',
    ask(m, 'tx-host', 'host', null).room === MAIN_ROOM);
  check('but a host cannot visit a room that does not exist',
    ask(m, 'tx-host', 'host', 'b9').refused === 'not_found');
}

console.log('\n── when the host lets people choose ──');
{
  const m = meeting({ selfSelect: true });
  check('anybody may pick a room', ask(m, 'tx-new', 'guest', 'b1').room === 'b1');
  check('including one they were not put in', ask(m, 'tx-ana', 'guest', 'b2').room === 'b2');
  check('and a room that does not exist is still refused',
    ask(m, 'tx-new', 'guest', 'b9').refused === 'not_found');
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
