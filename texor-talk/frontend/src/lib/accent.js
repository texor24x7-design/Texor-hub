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

/**
 * A small, stable string hash.
 *
 * Nothing depends on it being a good one, only on it being the same
 * everywhere — the same person has to come out the same colour in your browser
 * and in theirs, with nothing stored and nothing agreed.
 */
function hashOf(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100_000;
  }
  return hash;
}

/** Live outranks the hash — it is a fact about the meeting, not decoration. */
export function accentFor(seed, { live = false } = {}) {
  if (live) return 'live';

  const text = String(seed ?? '');
  if (!text) return ACCENTS[0];

  return ACCENTS[hashOf(text) % ACCENTS.length];
}

/**
 * Who said it, as a colour.
 *
 * A separate palette from `ACCENTS` because it is used on a different ground:
 * those four are chosen to sit on the app's white, and the call is nearly
 * black. These are picked for contrast against it, and there are eight rather
 * than four because a chat is the one place where two people coming out the
 * same colour is actually confusing — it is the thing the reader is using to
 * tell one block of text from the next.
 *
 * Deliberately not tied to a person's identity beyond their id: no attempt to
 * be "their" colour anywhere else in the product, only to be the same colour
 * for everybody in this call.
 */
export const CHAT_COLORS = [
  'sky', 'mint', 'amber', 'rose', 'violet', 'teal', 'coral', 'lime',
];

export function chatColorFor(seed) {
  const text = String(seed ?? '');
  if (!text) return CHAT_COLORS[0];

  return CHAT_COLORS[hashOf(text) % CHAT_COLORS.length];
}

export default { ACCENTS, accentFor, CHAT_COLORS, chatColorFor };
