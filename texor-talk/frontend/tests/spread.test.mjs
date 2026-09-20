/**
 * Proposing a split.
 *
 * `spread` only suggests — the host edits what it proposes and the server
 * validates what finally arrives — so what matters here is that it never loses
 * anybody and never puts the same person in two rooms.
 */
const { spread, defaultRoomName } = await import('../src/lib/breakouts.js');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const people = (n) => Array.from({ length: n }, (_, index) => `tx-${index}`);
const sizes = (rooms) => rooms.map((room) => room.length);
const everybody = (rooms) => rooms.flat();

console.log('\n── dealing people into rooms ──');
{
  const rooms = spread(people(8), 4);
  check('everybody is somewhere', everybody(rooms).length === 8, JSON.stringify(rooms));
  check('nobody is in two rooms at once', new Set(everybody(rooms)).size === 8);
  check('and the rooms are the same size', sizes(rooms).join(',') === '2,2,2,2', sizes(rooms).join(','));
}

{
  // The remainder lands on the first rooms, one each, rather than all together.
  const rooms = spread(people(9), 4);
  check('an uneven split is as even as it goes', sizes(rooms).join(',') === '3,2,2,2', sizes(rooms).join(','));
  check('and still loses nobody', everybody(rooms).length === 9);
}

{
  /**
   * Round-robin rather than chunking, which is the whole reason this is not a
   * two-line slice: people are listed in the order they joined, and chunking
   * would put everyone who arrived first in one room — exactly the grouping a
   * host splitting a meeting is usually trying to break up.
   */
  const rooms = spread(['a', 'b', 'c', 'd'], 2);
  check('consecutive people are dealt apart', rooms[0].join('') === 'ac' && rooms[1].join('') === 'bd',
    JSON.stringify(rooms));
}

console.log('\n── the edges a host will find ──');
check('one room holds everyone', spread(people(5), 1)[0].length === 5);
check('more rooms than people leaves empty ones', sizes(spread(people(2), 5)).join(',') === '1,1,0,0,0',
  sizes(spread(people(2), 5)).join(','));
check('nobody at all is not a crash', spread([], 3).length === 3);
check('and neither is a nonsense room count', spread(people(3), 0).length === 1);
check('rooms are named from one, not zero', defaultRoomName(0) === 'Room 1');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
