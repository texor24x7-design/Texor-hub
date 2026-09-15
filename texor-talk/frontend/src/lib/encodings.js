/**
 * The RTP encodings we ask the browser to send.
 *
 * Its own module so the test suite imports the very same values the browser
 * uses. When these lived inline in `room.js` the tests produced with simpler
 * parameters, which is how a config the browser rejects outright still passed
 * every check.
 *
 * ── On `scalabilityMode` ──
 *
 * Do not add it here for VP8 or H264.
 *
 * An earlier version set `scalabilityMode: 'S1T3'` on every encoding, and
 * Chrome refused the whole transceiver:
 *
 *   Failed to execute 'addTransceiver' on 'RTCPeerConnection': Attempted to
 *   set RtpParameters scalabilityMode to an unsupported value for the current
 *   codecs.
 *
 * `S1T3` is not a real value. The WebRTC registry spells temporal-only
 * layering `L1T3`; the `S`-prefixed modes (`S2T3`, `S3T3`…) are VP9/AV1
 * spatial modes, and none of them is `S1T3`. Even the correct `L1T3` is only
 * accepted for codecs that implement it, and which codec gets negotiated is
 * not known when these are written.
 *
 * Simulcast does not need it. Three encodings at different resolutions is
 * exactly what the SFU selects between, and leaving the mode out lets the
 * browser apply whatever temporal layering the chosen codec supports. This is
 * what mediasoup's own demo does.
 */

/**
 * Camera: three resolutions of the same picture, sent at once.
 *
 * The SFU forwards whichever one each viewer's connection can carry, so one
 * person on bad wifi gets the small layer instead of dragging everybody down
 * to it. Smallest first, which is the order mediasoup expects.
 */
/**
 * Built from the ceiling the server granted, rather than fixed here.
 *
 * The three layers keep their proportions — a tenth, a third, and the whole of
 * whatever this meeting is allowed — so the shape of the ladder survives the
 * budget changing. The top layer is the grant; nothing exceeds it.
 */
export function cameraEncodings(maxBitrate = 1_500_000) {
  return [
    { scaleResolutionDownBy: 4, maxBitrate: Math.round(maxBitrate * 0.1) },
    { scaleResolutionDownBy: 2, maxBitrate: Math.round(maxBitrate * 0.33) },
    { scaleResolutionDownBy: 1, maxBitrate },
  ];
}

/** The default ladder, for anywhere a grant has not arrived yet. */
export const CAMERA_ENCODINGS = cameraEncodings();

/**
 * What the camera gets while a screen is being shared.
 *
 * Both senders share one transport and one bandwidth estimate, so a camera at
 * its full ceiling and a screen at its own are asking for the sum — and on a
 * real uplink there is rarely enough for both. The allocator then splits what
 * there is, and the screen share, which is the thing everybody is actually
 * looking at, gets starved along with the camera.
 *
 * So the camera yields. Nobody is studying a presenter's face at full
 * resolution while a screen is up, and the tile it is drawn in is small.
 */
export const PRESENTING_CAMERA_BITRATE = 300_000;

export function cameraBudget(ceiling = 1_500_000, { presenting = false } = {}) {
  // Never raise a budget: Data saver presenting must not end up above its tier.
  return presenting ? Math.min(ceiling, PRESENTING_CAMERA_BITRATE) : ceiling;
}

/**
 * Capture constraints for a screen share.
 *
 * `frameRate` alone was not enough. Without a size cap the browser hands back
 * the display's native resolution, and a 4K desktop encoded into a few Mbps is
 * the soft, blocky share this is fixing. Capped as `max` rather than `ideal` so
 * a small screen is never scaled *up* to meet it.
 */
export function screenConstraints({ frameRate = 30, maxHeight = 1080 } = {}) {
  return {
    frameRate: { ideal: frameRate, max: frameRate },
    // 16:9 at the given height, which is the shape of most displays. A taller
    // or wider screen is fitted inside it rather than stretched.
    width: { max: Math.round((maxHeight * 16) / 9) },
    height: { max: maxHeight },
  };
}

/**
 * Screen: one layer, at a much higher ceiling than a camera gets.
 *
 * No simulcast, deliberately — everybody watching a shared screen should see
 * exactly what the person sharing sees, and layers would mean some of them
 * quietly getting a worse one.
 *
 * The ceiling is high because screen content is expensive: a 1080p desktop at
 * 30fps with text, scrolling and a video playing in a corner will use all of
 * this. Set it too low and the encoder makes up the difference by dropping
 * frames, which is what "the quality is fine but it keeps sticking" looks like.
 */
export function screenEncodings(maxBitrate = 5_000_000) {
  return [{ maxBitrate }];
}

export const SCREEN_ENCODINGS = screenEncodings();

/**
 * How a screen share should behave when there is not enough bandwidth.
 *
 *   motion  keep the frame rate, let resolution drop — demos, video, scrolling
 *   detail  keep the resolution, let frames drop — code, spreadsheets, slides
 *
 * Something has to give, and which one is a judgement about the content rather
 * than a technical default. `motion` is the better default: a slightly softer
 * picture still reads, whereas a slideshow of stills is unusable for anything
 * you are actively doing.
 *
 * `contentHint` tells the encoder; `degradationPreference` tells the sender.
 * Both are needed — setting one and not the other leaves the browser free to
 * make the opposite choice with the half it was not told about.
 */
export const SCREEN_MODES = {
  motion: {
    contentHint: 'motion',
    degradationPreference: 'maintain-framerate',
    frameRate: { ideal: 30, max: 30 },
  },
  detail: {
    contentHint: 'detail',
    degradationPreference: 'maintain-resolution',
    frameRate: { ideal: 15, max: 30 },
  },
};

export default {
  CAMERA_ENCODINGS, SCREEN_ENCODINGS, SCREEN_MODES, cameraEncodings, screenEncodings,
};
