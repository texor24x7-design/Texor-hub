/**
 * Who is currently talking.
 *
 * Its own module, with no imports, so the rule can be tested without a
 * database, an identity provider or a running server — the logic is small but
 * it is exactly where the bug was, and a test that needs the whole application
 * booted is a test nobody runs while changing it.
 *
 * ── Why an audio level observer ──
 *
 * mediasoup offers two. `ActiveSpeakerObserver` runs a proper dominant-speaker
 * algorithm and emits `dominantspeaker`, and nothing else — it has **no silence
 * event**. So it can say who started talking but never that everybody stopped,
 * and a highlight driven by it is set once and then sits on whoever last spoke
 * for the remainder of the call. `AudioLevelObserver` reports `volumes` while
 * there is sound and `silence` when there is not, which is both halves.
 */

/**
 * Wires an observer to a broadcast function.
 *
 * `broadcast` is passed in rather than imported so this can be driven directly
 * in a test. Attaching twice is a no-op: the observer outlives the peers on it,
 * so re-attaching per connection would stack listeners and send every change
 * once per participant in the room.
 */
export function attachSpeakingDetection(room, broadcast) {
  if (room.speakingAttached) return false;
  room.speakingAttached = true;

  const announce = (texorId) => {
    // Deduped, because `volumes` fires every interval for as long as somebody
    // is talking — without this a five-minute anecdote is a thousand identical
    // messages to everyone in the meeting.
    if (room.activeSpeakerTexorId === texorId) return;

    room.activeSpeakerTexorId = texorId;
    broadcast(room, { type: 'activeSpeaker', data: { texorId } });
  };

  room.audioLevelObserver.on('volumes', (volumes) => {
    const loudest = volumes?.[0];
    if (!loudest) return;

    // The speaker can leave between the observer measuring and this firing.
    const owner = room.ownerOf(loudest.producer.id);
    if (owner) announce(owner.texorId);
  });

  room.audioLevelObserver.on('silence', () => announce(null));

  return true;
}

export default { attachSpeakingDetection };
