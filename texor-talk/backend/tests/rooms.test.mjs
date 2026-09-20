/**
 * A meeting is every room it is using.
 *
 * Breakout rooms are separate mediasoup Routers keyed `code#b1`, which is what
 * makes "who can hear whom" structural rather than something each feature has
 * to remember to filter. The property this suite pins is the other half of that
 * design: **presence is the union across a meeting's rooms.**
 *
 * It matters more than it sounds. Every caller of `connectedTexorIds` means the
 * meeting — the participant count, capacity, the occupied-time clock, host
 * custody, whether the meeting has been abandoned. If it answered for one room,
 * opening breakouts would leave the main room empty, and an empty room clears
 * custody, wipes everybody's lobby pass and ends the meeting under people who
 * are still in it.
 *
 * One real worker is started here, because rooms are real Routers.
 */
process.env.MEDIA_WORKERS = '1';

const { startWorkers, closeWorkers } = await import('../src/media/worker.js');
const {
  closeRoom,
  connectedInRoom,
  connectedTexorIds,
  getOrCreateRoom,
  removePeerEverywhere,
  roomKeyFor,
  roomsOf,
} = await import('../src/media/room.js');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

await startWorkers();

/** Enough of a peer for the room to hold and let go of. */
const someone = (texorId) => ({ texorId, closed: false, close() { this.closed = true; } });

const CODE = 'abc-defg-hij';
const OTHER = 'zzz-zzzz-zzz';

console.log('\n── keys ──');
{
  check('the main room is keyed by the meeting code', roomKeyFor(CODE) === CODE);
  check('and a breakout hangs off it', roomKeyFor(CODE, 'b1') === 'abc-defg-hij#b1');
}

console.log('\n── one meeting, two rooms ──');
const main = await getOrCreateRoom(CODE);
const breakout = await getOrCreateRoom(CODE, 'b1');
{
  check('they are different rooms', main !== breakout);
  check('on different routers — which is what keeps them apart', main.router !== breakout.router);
  check('and both belong to the meeting', main.meetingCode === CODE && breakout.meetingCode === CODE);
  check('asking again returns the same room', (await getOrCreateRoom(CODE, 'b1')) === breakout);
  check('the meeting lists both', roomsOf(CODE).length === 2, String(roomsOf(CODE).length));
}

console.log('\n── presence is the union ──');
{
  main.addPeer(someone('tx-ana'));
  breakout.addPeer(someone('tx-bo'));

  check('somebody in a breakout is still in the meeting',
    connectedTexorIds(CODE).sort().join() === 'tx-ana,tx-bo', JSON.stringify(connectedTexorIds(CODE)));
  check('and one room can still be asked about on its own',
    connectedInRoom(breakout.key).join() === 'tx-bo');
  check('the main room on its own says only who is in it',
    connectedInRoom(CODE).join() === 'tx-ana');

  // The same person cannot be counted twice by being in two rooms at once —
  // they cannot be, but the union must not invent them either.
  breakout.addPeer(someone('tx-ana'));
  check('nobody is counted twice', connectedTexorIds(CODE).length === 2, JSON.stringify(connectedTexorIds(CODE)));
  breakout.removePeer('tx-ana');
}

console.log('\n── another meeting is another meeting ──');
{
  const elsewhere = await getOrCreateRoom(OTHER);
  elsewhere.addPeer(someone('tx-kim'));

  check("its rooms are not this meeting's", roomsOf(CODE).every((room) => room.meetingCode === CODE));
  check('and its people are not counted here', !connectedTexorIds(CODE).includes('tx-kim'));
  closeRoom(elsewhere.key);
}

console.log('\n── moving somebody ──');
{
  // The arrival used to sweep only the room being arrived at, which left a
  // ghost peer still producing audio in the room just left.
  const left = removePeerEverywhere(CODE, 'tx-bo');
  check('they are taken out of whichever room held them', left === breakout);
  check('and the room lets go of them properly', connectedInRoom(breakout.key).length === 0);
  check('so the meeting sees only the people still in it', connectedTexorIds(CODE).join() === 'tx-ana');
  check('taking out somebody who is not here is not an error', removePeerEverywhere(CODE, 'tx-nobody') === null);
}

console.log('\n── closing one room ──');
{
  closeRoom(breakout.key);
  check('leaves the other alone', roomsOf(CODE).length === 1 && roomsOf(CODE)[0] === main);
  check('and presence follows', connectedTexorIds(CODE).join() === 'tx-ana');

  closeRoom(CODE);
  check('closing the last one leaves the meeting with none', roomsOf(CODE).length === 0);
  check('and nobody present', connectedTexorIds(CODE).length === 0);
}

await closeWorkers();

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
