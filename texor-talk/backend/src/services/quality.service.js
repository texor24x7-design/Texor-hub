/**
 * How much bandwidth a meeting is allowed to use.
 *
 * Two levels, and the separation is the point:
 *
 *   · the **organisation** sets a ceiling — this is the commercial lever, and
 *     the only place a limit can be raised
 *   · the **host** picks a tier at or below that ceiling, per meeting
 *
 * A host choosing quality is choosing how much the organisation spends: an SFU
 * forwards every stream to every participant, so cost grows with headcount
 * multiplied by bitrate. Letting a host raise it without a ceiling would put an
 * unbounded bill behind a button on a settings page.
 *
 * Tiers rather than raw numbers, because "1800000" is not a decision anybody
 * can make well, and named tiers survive the numbers behind them being tuned.
 */

/**
 * ── On `cameraDegradation` ──
 *
 * When there is not enough bandwidth, something has to give: resolution or
 * frame rate. Left unset, a browser decides for itself, and for a camera track
 * Chrome holds the frame rate and throws away resolution — which is why a call
 * can look smooth and soft at the same time. That was this product's behaviour
 * for every tier, because `degradationPreference` was only ever set on screen
 * shares.
 *
 * So each tier now says which one it is buying:
 *
 *   saver     keep it moving — on a weak link, a sharp slideshow is worse
 *   standard  let the browser balance the two
 *   high      hold the resolution; a tier called High that goes soft under load
 *             is not delivering the thing its name promises
 */
export const TIERS = {
  saver: {
    id: 'saver',
    name: 'Data saver',
    blurb: 'Lowest bandwidth. Best on mobile data or a weak connection.',
    cameraBitrate: 400_000,
    cameraDegradation: 'maintain-framerate',
    screenBitrate: 1_000_000,
    screenFrameRate: 15,
    screenMaxHeight: 720,
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    blurb: 'Clear video and a readable screen share. Good for most meetings.',
    cameraBitrate: 1_200_000,
    cameraDegradation: 'balanced',
    screenBitrate: 2_500_000,
    screenFrameRate: 30,
    screenMaxHeight: 1080,
  },
  high: {
    id: 'high',
    name: 'High',
    blurb: 'Sharpest picture and the smoothest screen sharing. Uses the most bandwidth.',
    // 720p30 needs more than the 1.5 Mbps this used to allow. At that ceiling
    // the top simulcast layer is starved and the encoder answers by sending a
    // smaller picture — the soft-but-smooth failure this tier exists to avoid.
    cameraBitrate: 2_500_000,
    cameraDegradation: 'maintain-resolution',
    screenBitrate: 5_000_000,
    screenFrameRate: 30,
    screenMaxHeight: 1080,
  },
};

/**
 * ── On `screenMaxHeight` ──
 *
 * Capture resolution has to be chosen together with bitrate, and this was the
 * one that was missing: `getDisplayMedia` was asked for a frame rate and
 * nothing else, so it handed back whatever the display happened to be. A 4K or
 * retina screen captured at native size and encoded at 5 Mbps is a fraction of
 * a bit per pixel, and the encoder answers the only way it can — by throwing
 * detail away until it fits. The share looks soft and blocky while the bitrate
 * graph looks healthy.
 *
 * On a developer's machine none of this shows, because a localhost transport
 * has no ceiling to press against.
 *
 * Downscaling at capture is strictly better than letting the encoder do it: the
 * scaler is doing a clean resize of a sharp source, where the encoder is
 * discarding high-frequency detail from a picture it cannot afford — which is
 * what turns text to mush.
 */

/** Cheapest first. Order is what makes "at or below the ceiling" meaningful. */
export const TIER_ORDER = ['saver', 'standard', 'high'];

export const isTier = (value) => TIER_ORDER.includes(value);

const rank = (tier) => {
  const index = TIER_ORDER.indexOf(tier);
  return index === -1 ? TIER_ORDER.length - 1 : index;
};

/**
 * The tier actually in force: the host's choice, clamped by the org ceiling.
 *
 * Clamped rather than rejected, so lowering the org plan does not break
 * meetings already scheduled at a tier that is no longer available — they
 * quietly run at the best tier the organisation now allows.
 */
export function effectiveTier(requested, ceiling) {
  const wanted = isTier(requested) ? requested : 'standard';
  const cap = isTier(ceiling) ? ceiling : 'high';
  return rank(wanted) <= rank(cap) ? wanted : cap;
}

/** The numbers a client needs, for a tier that has already been clamped. */
export function limitsFor(tier) {
  return TIERS[tier] ?? TIERS.standard;
}

/**
 * Which tiers a host may choose from, given the organisation's ceiling.
 *
 * Returned with the ceiling itself so an interface can say *why* the higher
 * ones are missing rather than silently offering fewer options.
 */
export function availableTiers(ceiling) {
  const cap = isTier(ceiling) ? ceiling : 'high';
  return TIER_ORDER.slice(0, rank(cap) + 1).map((id) => ({
    ...TIERS[id],
    // What this tier costs to carry, so the choice is not made blind.
    relativeCost: Math.round((TIERS[id].screenBitrate / TIERS.standard.screenBitrate) * 100) / 100,
  }));
}

/**
 * The total a single participant may send, used as the server-side cap.
 *
 * One transport carries a microphone, a camera and possibly a screen at once,
 * so the ceiling has to cover all three plus headroom — a cap that a legitimate
 * sender bumps into produces exactly the stuttering this is meant to prevent.
 */
export function maxSendBitrate(tier) {
  const limits = limitsFor(tier);
  const AUDIO_ALLOWANCE = 200_000;
  return limits.cameraBitrate + limits.screenBitrate + AUDIO_ALLOWANCE;
}

export default {
  TIERS,
  TIER_ORDER,
  isTier,
  effectiveTier,
  limitsFor,
  availableTiers,
  maxSendBitrate,
};
