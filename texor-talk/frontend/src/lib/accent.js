/**
 * A colour for a meeting.
 *
 * Calendars have done this for decades and for a good reason: a wall of cards
 * in one colour is a wall, and the eye has nothing to hold on to. A colour per
 * meeting turns the list into places rather than rows.
 *
 * It is derived from the code rather than stored or randomised, which matters
 * more than it sounds: the same meeting is the same colour on every device, on
 * every reload, for everyone — so somebody can say "the orange one" and be
 * understood.
 */

/**
 * Green is missing on purpose.
 *
 * Green means live in this interface. A scheduled meeting that happened to
 * hash green would be saying something it does not mean.
 */
export const ACCENTS = ['blue', 'violet', 'orange', 'yellow'];

/** Live outranks the hash — it is a fact about the meeting, not decoration. */
export function accentFor(seed, { live = false } = {}) {
  if (live) return 'live';

  const text = String(seed ?? '');
  if (!text) return ACCENTS[0];

  // A small, stable string hash. Nothing depends on it being a good one, only
  // on it being the same everywhere.
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100_000;
  }

  return ACCENTS[hash % ACCENTS.length];
}

export default { ACCENTS, accentFor };
