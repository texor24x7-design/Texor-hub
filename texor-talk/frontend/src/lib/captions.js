/**
 * The caption wire format, and the running list of lines on screen.
 *
 * Both halves are pure so both can be tested without a browser, a microphone or
 * a server. The encoder especially: it is the one place where the client and
 * the backend have to agree byte for byte, and a disagreement there would show
 * up as captions that silently never appear.
 */

/**
 * One utterance, ready to put on the socket.
 *
 *   ┌────────────┬──────────────────┬──────────────────────────────┐
 *   │ 4 bytes BE │ JSON header      │ Int16LE PCM, 16 kHz mono     │
 *   │ header len │ {utteranceId,…}  │                              │
 *   └────────────┴──────────────────┴──────────────────────────────┘
 *
 * ── Why binary, and why Int16 ──
 *
 * The obvious thing is to base64 the audio into the JSON messages the socket
 * already carries. That is a third more bytes for nothing, on the one message
 * type where the payload is large. Int16 rather than the Float32 the audio
 * graph produces halves it again, and costs nothing that matters: the model
 * converts back to float internally, and sixteen bits is more dynamic range
 * than a microphone in a room has to offer.
 *
 * ── What the header deliberately leaves out ──
 *
 * Who is speaking, and when. Both are things the server works out for itself —
 * the speaker is whoever authenticated this socket, the timing comes from the
 * sample count — so neither is something a client could get wrong or lie about.
 */
export function encodeAudioFrame(header, samples) {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const frame = new ArrayBuffer(4 + json.length + samples.length * 2);
  const view = new DataView(frame);

  view.setUint32(0, json.length, false);
  new Uint8Array(frame, 4, json.length).set(json);

  const audio = new DataView(frame, 4 + json.length);

  for (let index = 0; index < samples.length; index += 1) {
    /**
     * Clamped before it is scaled.
     *
     * Web Audio samples are nominally -1 to 1 but nothing enforces it, and a
     * loud moment or a gain node can push past. Left unclamped, the conversion
     * wraps around at the integer boundary and a shout arrives as a burst of
     * inverted noise — which the recogniser transcribes as nothing at all,
     * exactly when somebody was making their point.
     */
    const sample = Math.max(-1, Math.min(1, samples[index]));
    audio.setInt16(index * 2, Math.round(sample * 32_767), true);
  }

  return frame;
}

/** The most caption lines held for the panel. Older ones scroll out of reach
 * anyway, and the stored transcript is the thing that keeps everything. */
export const MAX_LINES = 300;

/**
 * The running conversation, as the client draws it.
 *
 * ── Why this is not just an array you push onto ──
 *
 * Captions arrive twice. An utterance still being spoken is re-transcribed
 * every couple of seconds and sent as an interim, and then once more as a final
 * when the speaker stops. Appending each one gives four copies of the same
 * sentence, each a few words longer than the last — which is what a naive
 * caption layer looks like, and it is unreadable.
 *
 * So a line is keyed by `utteranceId` and replaced in place. Interims update
 * the line they belong to; the final replaces it for good.
 */
export function applyCaption(lines, caption, { max = MAX_LINES } = {}) {
  const key = `${caption.texorId}:${caption.utteranceId}`;

  const existing = lines.findIndex((line) => line.key === key);

  const line = {
    key,
    texorId: caption.texorId,
    name: caption.name,
    text: caption.text,
    language: caption.language ?? '',
    confidence: caption.confidence ?? 0,
    final: Boolean(caption.final),
    at: caption.at ? new Date(caption.at) : new Date(),
  };

  if (existing !== -1) {
    /**
     * A final never loses to a late interim.
     *
     * The two are separate jobs in the recogniser's queue and can come back out
     * of order when it is busy. Without this, an interim landing after its own
     * final would replace a finished sentence with the half of it that had been
     * spoken two seconds earlier, and leave it that way.
     */
    if (lines[existing].final && !line.final) return lines;

    const next = lines.slice();
    next[existing] = line;
    return next;
  }

  const next = [...lines, line];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * The last few lines, for the overlay across the bottom of the stage.
 *
 * Interims are kept — watching the sentence assemble itself is the whole point
 * of a live caption — but a line nobody has added to for a while is dropped,
 * so the overlay does not sit on the last thing anybody said for the rest of a
 * silent meeting.
 */
export function visibleCaptions(lines, { count = 3, holdMs = 8_000, now = Date.now() } = {}) {
  return lines
    .filter((line) => now - new Date(line.at).getTime() < holdMs)
    .slice(-count);
}

/**
 * The same conversation the server stores, rendered for the panel.
 *
 * Consecutive lines from one person are joined, so a long answer reads as one
 * turn rather than as six lines with the same name down the side of them. This
 * mirrors `backend/src/utils/transcript.js`; the server's copy is the canonical
 * one and produces the downloaded file, this one draws what is on screen while
 * the meeting is still running and there is nothing stored yet.
 */
export function groupCaptions(lines, { gapMs = 4_000 } = {}) {
  const turns = [];

  for (const line of lines) {
    const previous = turns.at(-1);
    const at = new Date(line.at);

    if (previous && previous.texorId === line.texorId && at - previous.lastAt <= gapMs) {
      previous.text += ` ${line.text}`;
      previous.lastAt = at;
      previous.final = previous.final && line.final;
      continue;
    }

    turns.push({
      key: line.key,
      texorId: line.texorId,
      name: line.name,
      text: line.text,
      language: line.language,
      at,
      lastAt: at,
      final: line.final,
    });
  }

  return turns;
}

export default { encodeAudioFrame, applyCaption, visibleCaptions, groupCaptions, MAX_LINES };
