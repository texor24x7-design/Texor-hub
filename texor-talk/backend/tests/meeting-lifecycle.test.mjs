/**
 * How long a meeting has run, and who is running it.
 *
 * ── Why ──
 *
 * A meeting used to be a thing that *finished*. It was "live" because a column
 * said so, it counted time from the moment it started whether or not anybody
 * was there, and when its host closed their laptop nobody was left who could
 * admit the person waiting in the lobby.
 *
 * All three are now answered from presence, and presence is reconciled from
 * four different places — a join, a leave, the five-second ticker, and a lazy
 * sweep on read. That is the risk these cover: the same transition seen twice
 * must not be counted twice, and a transition seen by nobody must not be lost.
 *
 * Pure functions only. The join and leave paths themselves are covered against
 * a real database by `meetings.test.mjs`.
 */
import {
  elapsedMsOf, syncActiveTime, reconcileHost, earliestJoined,
} from '../src/services/meeting.service.js';

let pass = 0, fail = 0;
const check = (l, ok, extra = '') => {
  ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${extra}`));
};

const MIN = 60_000;
const T0 = new Date('2026-01-01T10:00:00Z');
const at = (ms) => new Date(T0.getTime() + ms);

const room = () => ({ activeMs: 0, activeSince: null });

console.log('\n── the clock runs only while the room is occupied ──');
{
  const m = room();

  syncActiveTime(m, 2, T0);
  check('somebody arrives and it starts', m.activeSince?.getTime() === T0.getTime());
  check('nothing is banked yet', m.activeMs === 0);
  check('and the elapsed time counts up', elapsedMsOf(m, at(5 * MIN).getTime()) === 5 * MIN);

  syncActiveTime(m, 0, at(5 * MIN));
  check('everybody leaves and it stops', m.activeSince === null);
  check('banking what was spent', m.activeMs === 5 * MIN, String(m.activeMs));

  // An hour of an empty room must cost the meeting nothing.
  check('an empty room does not accrue', elapsedMsOf(m, at(9 * 60 * MIN).getTime()) === 5 * MIN);
}

console.log('\n── it is safe to see the same change twice ──');
{
  /**
   * The property that matters most. Presence is reconciled from four places,
   * two of which can easily observe the same departure — the socket closing and
   * the ticker noticing a moment later. Banking it twice would silently double
   * a meeting's length and could trip a duration limit that was never reached.
   */
  const m = room();
  syncActiveTime(m, 1, T0);
  syncActiveTime(m, 1, at(1 * MIN));
  check('a second "somebody is here" does not move the start',
    m.activeSince.getTime() === T0.getTime());

  syncActiveTime(m, 0, at(5 * MIN));
  syncActiveTime(m, 0, at(6 * MIN));
  syncActiveTime(m, 0, at(90 * MIN));
  check('and repeated "nobody is here" banks it once', m.activeMs === 5 * MIN, String(m.activeMs));
}

console.log('\n── two sittings ──');
{
  const m = room();
  syncActiveTime(m, 1, T0);
  syncActiveTime(m, 0, at(20 * MIN));
  // The room sits empty for an hour, then somebody opens the link again.
  syncActiveTime(m, 1, at(80 * MIN));

  check('reopening resumes rather than restarting',
    elapsedMsOf(m, at(90 * MIN).getTime()) === 30 * MIN,
    String(elapsedMsOf(m, at(90 * MIN).getTime())));

  syncActiveTime(m, 0, at(90 * MIN));
  check('and the total is the sum of the stretches', m.activeMs === 30 * MIN, String(m.activeMs));
}

console.log('\n── a clock that steps backwards ──');
{
  const m = { activeMs: 5 * MIN, activeSince: at(10 * MIN) };
  check('never subtracts from time already spent',
    elapsedMsOf(m, at(9 * MIN).getTime()) === 5 * MIN);

  const banked = { activeMs: 5 * MIN, activeSince: at(10 * MIN) };
  syncActiveTime(banked, 0, at(9 * MIN));
  check('and closing a stretch cannot bank a negative', banked.activeMs === 5 * MIN);
}

console.log('\n── nothing sensible to work with ──');
{
  check('a fresh meeting has run for no time', elapsedMsOf({ activeMs: 0, activeSince: null }) === 0);
  check('a missing total reads as zero', elapsedMsOf({}) === 0);
}

/* ── host custody ───────────────────────────────────────────────────────── */

const meeting = (over = {}) => ({
  hostTexorId: 'owner',
  cohostTexorIds: [],
  actingHostTexorId: null,
  // Everybody in the room was let into it; that is what a pass records.
  admittedTexorIds: ['owner', 'asha', 'bo', 'guest-1'],
  attendance: [
    { texorId: 'owner', role: 'host', firstJoinedAt: at(0) },
    { texorId: 'asha', role: 'participant', firstJoinedAt: at(1 * MIN) },
    { texorId: 'bo', role: 'participant', firstJoinedAt: at(2 * MIN) },
    { texorId: 'guest-1', role: 'guest', firstJoinedAt: at(-1 * MIN) },
  ],
  ...over,
});

console.log('\n── somebody in the room can always run it ──');
{
  const m = meeting();
  const changed = reconcileHost(m, ['asha', 'bo']);
  check('the owner being away hands it to whoever is there', m.actingHostTexorId === 'asha');
  check('and says that something changed', changed === true);

  const alone = meeting();
  reconcileHost(alone, ['bo']);
  check('the first person into an empty room gets it', alone.actingHostTexorId === 'bo');
}

console.log('\n── a guest hosts only a room of guests ──');
{
  /**
   * A guest arrived first, so "longest here" alone would hand a stranger the
   * ability to admit people and remove them. Members come first; the join order
   * decides between them.
   */
  const mixed = meeting();
  reconcileHost(mixed, ['guest-1', 'asha']);
  check('a member is preferred however long the guest has been there',
    mixed.actingHostTexorId === 'asha', mixed.actingHostTexorId);

  const guestsOnly = meeting();
  reconcileHost(guestsOnly, ['guest-1']);
  check('but a room of only guests still gets a host',
    guestsOnly.actingHostTexorId === 'guest-1');
}

console.log('\n── the owner takes it back ──');
{
  const m = meeting({ actingHostTexorId: 'asha' });
  reconcileHost(m, ['owner', 'asha']);

  check('walking back in reclaims it', m.actingHostTexorId === null);
  check('and the stand-in keeps the powers they were using',
    m.cohostTexorIds.includes('asha'), JSON.stringify(m.cohostTexorIds));

  // Twice must not list them twice.
  const again = meeting({ actingHostTexorId: 'asha', cohostTexorIds: ['asha'] });
  reconcileHost(again, ['owner', 'asha']);
  check('and is not added a second time',
    again.cohostTexorIds.filter((id) => id === 'asha').length === 1);
}

console.log('\n── nobody is appointed when nobody needs to be ──');
{
  const withCohost = meeting({ cohostTexorIds: ['bo'] });
  check('a co-host present is enough', reconcileHost(withCohost, ['bo', 'asha']) === false);
  check('so no stand-in is named', withCohost.actingHostTexorId === null);

  const owned = meeting();
  check('nor when the owner is here', reconcileHost(owned, ['owner', 'asha']) === false);

  const standing = meeting({ actingHostTexorId: 'asha' });
  check('nor when the stand-in is still here', reconcileHost(standing, ['asha', 'bo']) === false);
}

console.log('\n── an empty room ends the sitting ──');
{
  /**
   * Cleared, not kept. A stand-in kept across an empty room came back as the
   * host — walking past "everyone knocks" before anybody had let them in — and
   * the passes of everybody admitted outlived the sitting they were for.
   */
  const m = meeting({ actingHostTexorId: 'asha', admittedTexorIds: ['asha', 'bo'] });
  check('reports that something changed', reconcileHost(m, []) === true);
  check('the stand-in is no longer the host', m.actingHostTexorId === null);
  check("and this sitting's passes are gone", m.admittedTexorIds.length === 0);

  // The worry that kept the old behaviour: a write on every sweep of every
  // empty room. Only the first sweep has anything to clear.
  check('a second sweep of the same empty room writes nothing', reconcileHost(m, []) === false);
}

console.log('\n── a socket that has not closed yet is not a host ──');
{
  /**
   * A socket lingers for a moment after somebody hangs up, and the next read of
   * "who is here" still counts it. That ghost used to be handed the empty room,
   * and an acting host never knocks — so hanging up and coming straight back
   * was a way past the waiting room.
   */
  const m = meeting({ admittedTexorIds: [] });
  check('nobody takes custody on a pass that has ended', reconcileHost(m, ['asha']) === false);
  check('and the room has no stand-in', m.actingHostTexorId === null);
}

console.log('\n── the stand-in leaves too ──');
{
  const m = meeting({ actingHostTexorId: 'asha' });
  reconcileHost(m, ['bo']);
  check('it passes on again', m.actingHostTexorId === 'bo');
}

console.log('\n── picking who ──');
{
  const m = meeting();
  check('the longest-standing member', earliestJoined(m, ['bo', 'asha']) === 'asha');
  check('somebody who is not here is never chosen', earliestJoined(m, ['bo']) === 'bo');
  check('and an empty room yields nobody', earliestJoined(m, []) === null);
  check('as does a room of people with no attendance row',
    earliestJoined(m, ['stranger']) === null);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
