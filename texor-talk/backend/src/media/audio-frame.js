/**
 * The other half of `frontend/src/lib/captions.js`'s `encodeAudioFrame`.
 *
 *   ┌────────────┬──────────────────┬──────────────────────────────┐
 *   │ 4 bytes BE │ JSON header      │ Int16LE PCM, 16 kHz mono     │
 *   │ header len │ {utteranceId,…}  │                              │
 *   └────────────┴──────────────────┴──────────────────────────────┘
 *
 * Its own module, and pure, so the two ends of the wire can be tested against
 * each other — the suite encodes with the browser's function and decodes with
 * this one. A format agreed in two places and checked in neither is how a
 * feature ends up silently transcribing nothing.
 *
 * Every failure returns null rather than throwing. The input is bytes from the
 * network: malformed is a case to handle, not an exception to raise.
 */

/** Anything larger is not a header we wrote; checked before the slice. */
const MAX_HEADER_BYTES = 1024;

export function decodeAudioFrame(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < 4) return null;

  const headerLength = buffer.readUInt32BE(0);
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) return null;
  if (buffer.length < 4 + headerLength) return null;

  let header;
  try {
    header = JSON.parse(buffer.subarray(4, 4 + headerLength).toString('utf8'));
  } catch {
    return null;
  }

  if (!header || typeof header !== 'object') return null;

  const body = buffer.subarray(4 + headerLength);
  // Int16 samples, so an odd byte count is a truncated frame, not audio.
  if (body.length < 2 || body.length % 2 !== 0) return null;

  const samples = body.length / 2;
  const pcm = new Float32Array(samples);

  /**
   * Read sample by sample rather than through an `Int16Array` view.
   *
   * A `Buffer` is a slice of a shared pool, so its `byteOffset` is very often
   * odd — and a typed-array view onto a misaligned offset throws outright.
   * This costs about a millisecond for the longest utterance accepted, which is
   * nothing next to the recognition that follows it.
   */
  for (let index = 0; index < samples; index += 1) {
    pcm[index] = body.readInt16LE(index * 2) / 32_768;
  }

  return {
    header,
    pcm,
    samples,
    // Never taken from the header: a duration the client asserted would be a
    // duration the client could lie about, and it lands in a stored transcript.
    durationMs: Math.round((samples / 16_000) * 1000),
  };
}

export default { decodeAudioFrame };
