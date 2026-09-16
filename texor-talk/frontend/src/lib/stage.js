/**
 * What the stage shows: a grid, one person large, or somebody's screen.
 *
 * Pulled out of the call view because it is a pure decision and the call view
 * is not testable — it needs a live room, a media grant and a socket. Twice now
 * a crash has reached the browser from that file with a clean build behind it,
 * and both times the broken thing was a decision, not a rendering.
 *
 * ── The invariant ──
 *
 * `mode: 'grid'` carries **no** `feature`; every other mode carries one. The
 * view reads `stage.feature.track` on the non-grid path, so a mode that is not
 * `grid` and has no feature is a `TypeError` in front of somebody who is trying
 * to join a meeting. `chooseStage` can never return that, and the suite says so
 * for every combination of inputs it can be given.
 */

/** A peer, or the local participant, in the shape the stage needs. */
const asFeature = (peer) => (peer ? { ...peer, track: peer.tracks?.camera ?? null } : null);

const meAsFeature = (me, localCamera) => ({
  texorId: me.texorId,
  name: me.displayName,
  picture: me.picture,
  isYou: true,
  track: localCamera ?? null,
});

export function chooseStage({
  pinned = null,
  presenting = null,
  layout = 'auto',
  speaking = null,
  peers = new Map(),
  me,
  localCamera = null,
} = {}) {
  const grid = { mode: 'grid' };
  if (!me?.texorId) return grid;

  /**
   * A pin outranks everything, including somebody presenting.
   *
   * It is the only explicit instruction on this list — everything else is the
   * room guessing — so it wins, and it keeps winning until it is taken off.
   */
  if (pinned) {
    const feature = pinned === me.texorId ? meAsFeature(me, localCamera) : asFeature(peers.get(pinned));
    // A pinned peer who has left leaves nothing to feature; fall through rather
    // than hold an empty stage on somebody who is gone.
    if (feature) return { mode: 'feature', feature, reason: 'pinned' };
  }

  if (presenting) return { mode: 'present', feature: presenting, reason: 'presenting' };

  if (layout === 'tiled') return grid;

  if (layout === 'spotlight' || layout === 'auto') {
    // In `auto`, two or three people already fit as a grid, and that is a
    // better view of everybody than promoting one of them.
    if (layout === 'auto' && peers.size < 3) return grid;

    const id = speaking ?? [...peers.keys()][0] ?? me.texorId;
    const feature = id === me.texorId ? meAsFeature(me, localCamera) : asFeature(peers.get(id));

    if (feature) return { mode: 'feature', feature, reason: 'speaking' };
  }

  return grid;
}

/**
 * Whether to offer the joining link.
 *
 * Separate from `chooseStage` because it is a different question: that one asks
 * *how* to arrange people, this one asks whether there is anybody to arrange.
 * Folding it into the mode was the bug — switching the grid off sent an empty
 * room down the spotlight path, which reads a feature that was never there.
 *
 * The camera used to be part of this: the link took over the whole stage, so it
 * had to stand down the moment there was a picture worth looking at. It is a
 * card over the stage now, and a card does not compete with the video behind
 * it — being alone is the whole of the question.
 */
export function promptToInvite({ peerCount = 0, status = 'connecting' } = {}) {
  return peerCount === 0 && status === 'live';
}

export default { chooseStage, promptToInvite };
