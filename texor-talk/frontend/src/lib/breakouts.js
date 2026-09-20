/**
 * Proposing a split, in the browser.
 *
 * This is here rather than on the server because a host has to *see* the
 * proposal and change it before the rooms open — putting the wrong two people
 * together is the kind of mistake that is obvious on screen and invisible in an
 * API. The server validates whatever finally arrives; this only suggests.
 */

/**
 * Deals people into `count` rooms, as evenly as they go.
 *
 * Round-robin rather than slicing into chunks. Nine people into four rooms is
 * 3/2/2/2 either way, but a chunked deal puts everyone who was listed first —
 * which is usually everyone who joined first — in the same room, and the point
 * of spreading a meeting is usually to break that grouping up.
 */
export function spread(texorIds, count) {
  const rooms = Array.from({ length: Math.max(1, Math.floor(count) || 1) }, () => []);

  texorIds.forEach((texorId, index) => {
    rooms[index % rooms.length].push(texorId);
  });

  return rooms;
}

/** "Room 3", and the names a host has not bothered to change. */
export const defaultRoomName = (index) => `Room ${index + 1}`;

export default { spread, defaultRoomName };
