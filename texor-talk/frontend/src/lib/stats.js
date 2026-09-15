/**
 * Reading what WebRTC is actually doing.
 *
 * Without this, "the video looks soft" is untestable folklore. A browser knows
 * precisely what resolution it is encoding, what it is receiving, and — through
 * `qualityLimitationReason` — *why* it is holding back. None of that was
 * surfaced anywhere in this product, so every quality question was answered by
 * guessing.
 *
 * Rates need two samples, so every function here takes the previous report as
 * well as the current one. An `RTCStatsReport` is a `Map`, which is all these
 * need it to be — so the suite passes plain Maps and no browser is involved.
 */

/** Bits per second between two samples of the same counter. */
function rate(nowBytes, thenBytes, nowTs, thenTs) {
  if (thenBytes == null || thenTs == null) return null;
  const seconds = (nowTs - thenTs) / 1000;
  if (!(seconds > 0)) return null;

  const bits = (nowBytes - thenBytes) * 8;
  return bits >= 0 ? Math.round(bits / seconds) : null;
}

const get = (report, id) => (report && typeof report.get === 'function' ? report.get(id) : undefined);

/**
 * What this browser is sending, one entry per simulcast layer.
 *
 * The layer list is the answer to most "why does it look bad" questions: three
 * entries with the top one at 1280x720 is a healthy sender; three entries where
 * the top one is 640x360 is a browser that has quietly given up on resolution.
 */
export function videoSenders(report, previous) {
  const out = [];
  if (!report?.forEach) return out;

  report.forEach((stat) => {
    if (stat.type !== 'outbound-rtp' || stat.kind !== 'video') return;

    const before = get(previous, stat.id);
    out.push({
      id: stat.id,
      // `rid` names the simulcast layer. Absent means a single-layer sender,
      // which is what a screen share is.
      rid: stat.rid ?? null,
      width: stat.frameWidth ?? null,
      height: stat.frameHeight ?? null,
      fps: stat.framesPerSecond ?? null,
      bitrate: rate(stat.bytesSent, before?.bytesSent, stat.timestamp, before?.timestamp),
      // 'none' | 'bandwidth' | 'cpu' | 'other' — the single most useful field
      // in the whole report, and the one nothing here was reading.
      limitedBy: stat.qualityLimitationReason ?? null,
      scaleDownBy: stat.scalabilityMode ? null : (stat.qualityLimitationResolutionChanges ?? null),
    });
  });

  // Biggest layer first: it is the one anybody is asking about.
  return out.sort((left, right) => (right.height ?? 0) - (left.height ?? 0));
}

/** What this browser is receiving, one entry per incoming stream. */
export function videoReceivers(report, previous) {
  const out = [];
  if (!report?.forEach) return out;

  report.forEach((stat) => {
    if (stat.type !== 'inbound-rtp' || stat.kind !== 'video') return;

    const before = get(previous, stat.id);
    out.push({
      id: stat.id,
      width: stat.frameWidth ?? null,
      height: stat.frameHeight ?? null,
      fps: stat.framesPerSecond ?? null,
      bitrate: rate(stat.bytesReceived, before?.bytesReceived, stat.timestamp, before?.timestamp),
      packetsLost: stat.packetsLost ?? 0,
      // Frozen video with healthy bitrate usually means decode trouble rather
      // than network trouble, and these separate the two.
      framesDropped: stat.framesDropped ?? 0,
    });
  });

  return out.sort((left, right) => (right.height ?? 0) - (left.height ?? 0));
}

/**
 * Which transport the media is actually taking.
 *
 * UDP or TCP, and round-trip time. This matters more than it looks: when UDP is
 * blocked — a firewall, or a cloud security group that never opened the RTC
 * port range — WebRTC silently falls back to TCP. Everything still works, and
 * everything is worse, because TCP's own retransmissions make the bandwidth
 * estimator cautious and every viewer ends up pinned to the smallest simulcast
 * layer. That is invisible unless something reports it.
 */
export function transportInfo(report) {
  if (!report?.forEach) return null;

  let pair = null;
  report.forEach((stat) => {
    if (stat.type !== 'candidate-pair') return;
    if (stat.state === 'succeeded' || stat.nominated) pair = stat;
  });
  if (!pair) return null;

  const local = get(report, pair.localCandidateId);

  return {
    protocol: local?.protocol ?? null,
    candidateType: local?.candidateType ?? null,
    rtt: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
    availableOutgoing: pair.availableOutgoingBitrate ?? null,
  };
}

/** Everything the connection panel shows, from one pair of reports. */
export function readConnection({ send, recv, previous = {} } = {}) {
  return {
    sending: videoSenders(send, previous.send),
    receiving: videoReceivers(recv, previous.recv),
    transport: transportInfo(send) ?? transportInfo(recv),
  };
}

/** Why the encoder is holding back, in words. */
export function describeLimit(reason) {
  return {
    none: null,
    bandwidth: 'Your connection cannot carry the full picture, so it is being sent smaller.',
    cpu: 'This device cannot encode the full picture fast enough, so it is being sent smaller.',
    other: 'Something is limiting the picture being sent.',
  }[reason] ?? null;
}

/** "1280×720" or nothing, because half a resolution is not worth showing. */
export const resolution = (entry) =>
  entry?.width && entry?.height ? `${entry.width}×${entry.height}` : null;

/** Bits per second as something a person reads. */
export function formatBitrate(bps) {
  if (bps == null) return null;
  if (bps < 1000) return `${bps} bps`;
  if (bps < 1_000_000) return `${Math.round(bps / 1000)} kbps`;
  return `${(bps / 1_000_000).toFixed(1)} Mbps`;
}

/**
 * A one-line verdict, so nobody has to read a table to know if it is healthy.
 *
 * The thresholds are about what a person would call the picture, not about
 * hitting a target: 720p and up is the full picture, 540 and up still looks
 * fine on a tile, and anything under 360 is the soft, upscaled look that
 * prompts somebody to ask why the video is bad.
 */
export function verdict({ sending, transport } = {}) {
  const top = sending?.[0];
  if (!top || !top.height) return { level: 'unknown', text: 'Not sending video.' };

  if (transport?.protocol === 'tcp') {
    return {
      level: 'bad',
      text: 'Media is going over TCP, which limits quality. UDP is being blocked somewhere on the network.',
    };
  }

  const limit = describeLimit(top.limitedBy);
  if (limit) return { level: top.height >= 540 ? 'ok' : 'bad', text: limit };

  if (top.height >= 700) return { level: 'good', text: 'Sending the full picture.' };
  if (top.height >= 480) return { level: 'ok', text: 'Sending a reduced picture.' };
  return { level: 'bad', text: 'Sending a much smaller picture than the camera can manage.' };
}

export default {
  videoSenders, videoReceivers, transportInfo, readConnection,
  describeLimit, resolution, formatBitrate, verdict,
};
