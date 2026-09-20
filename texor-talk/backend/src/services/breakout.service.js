/**
 * Which room of a meeting somebody may open.
 *
 * Breakout rooms are separate media rooms keyed `code#b1`, so this decides one
 * thing: given a meeting, a person and what their client asked for, which room
 * key do they get. It is pure, and it is the only place that question is
 * answered — the panel hiding a button is a hint, this is the rule.
 *
 * Three properties are worth stating, because the rest of the feature leans on
 * them:
 *
 *   · **asking for nothing means "put me where I belong".** A client that sends
 *     no room at all is placed by their assignment, which is what makes a
 *     refresh — and a server restart, where every room in memory is gone —
 *     land everybody back where they were with no client state and no recovery
 *     code to write.
 *   · **the main room is always allowed.** Nobody is ever stuck in a breakout.
 *   · **the key is built here, never taken from the client.** The request
 *     supplies an id, the id is looked up in this meeting's own plan, and
 *     anything unrecognised is refused rather than concatenated — so no query
 *     string can address another meeting's room.
 */

export const MAIN_ROOM = '';

/** Refusal shapes, thrown as plain objects so the socket can answer in its own vocabulary. */
const deny = (code, message) => Object.assign(new Error(message), { code });

/** The breakout somebody has been assigned to, or the main room. */
export function assignedRoom(meeting, texorId) {
  const rooms = meeting?.breakouts?.rooms ?? [];
  return rooms.find((room) => room.members?.includes(texorId))?.key ?? MAIN_ROOM;
}

export function isBreakoutOpen(meeting) {
  return meeting?.breakouts?.status === 'open';
}

/**
 * @param requested  what the client asked for: `null`/`undefined` for "wherever
 *                   I belong", `''` for the main room, or a breakout's key.
 * @returns the room key to open, relative to the meeting (`''` is the main room)
 */
export function resolveRoom({ meeting, texorId, role, requested }) {
  if (!isBreakoutOpen(meeting)) return MAIN_ROOM;

  const rooms = meeting.breakouts.rooms ?? [];
  const assigned = assignedRoom(meeting, texorId);

  if (requested === null || requested === undefined) return assigned;
  if (requested === MAIN_ROOM) return MAIN_ROOM;

  if (!rooms.some((room) => room.key === requested)) {
    throw deny('not_found', 'That room is not open.');
  }

  if (requested === assigned) return requested;

  // A host walks into any room of their own meeting — that is what visiting is.
  if (role === 'host' || role === 'cohost') return requested;

  if (meeting.breakouts.selfSelect) return requested;

  throw deny('forbidden', 'You have not been put in that room.');
}

export default { resolveRoom, assignedRoom, isBreakoutOpen, MAIN_ROOM };
