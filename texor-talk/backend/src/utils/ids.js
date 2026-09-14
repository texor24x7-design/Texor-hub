import { createHash, randomBytes, randomInt } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// No vowels and no look-alikes: a code read out over a bad phone line should not
// turn into a different code, and should not accidentally spell anything.
const CODE_ALPHABET = 'bcdfghjkmnpqrstvwxyz';

/**
 * A meeting code in the shape people already expect — `bcd-fghj-kmn`.
 *
 * Ten characters out of a twenty-letter alphabet is ~10^13 codes, so guessing
 * one at random is not a way in. It is still only a handle: what the holder of a
 * code is allowed to do is decided by the meeting document, never by the code.
 */
export function meetingCode() {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  const block = (length) => Array.from({ length }, pick).join('');
  return `${block(3)}-${block(4)}-${block(3)}`;
}
