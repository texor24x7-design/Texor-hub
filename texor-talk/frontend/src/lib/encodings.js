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
export const CAMERA_ENCODINGS = [
  { scaleResolutionDownBy: 4, maxBitrate: 150_000 },
  { scaleResolutionDownBy: 2, maxBitrate: 500_000 },
  { scaleResolutionDownBy: 1, maxBitrate: 1_500_000 },
];

/**
 * Screen: one layer, at a higher ceiling than a camera gets.
 *
 * No simulcast. Shrinking a shared screen to fit a slow connection makes the
 * text on it unreadable, which defeats the point of sharing it — better to
 * hold resolution and let the frame rate suffer.
 */
export const SCREEN_ENCODINGS = [{ maxBitrate: 2_500_000 }];

export default { CAMERA_ENCODINGS, SCREEN_ENCODINGS };
