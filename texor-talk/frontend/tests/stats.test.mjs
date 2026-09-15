/**
 * Reading WebRTC stats.
 *
 * An `RTCStatsReport` is a `Map`, so these are plain Maps and no browser is
 * involved. The reports below are the shapes Chrome actually produces, trimmed
 * to the fields that get read.
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const {
  videoSenders, videoReceivers, transportInfo, readConnection,
  describeLimit, resolution, formatBitrate, verdict,
} = await import(`${FE}/src/lib/stats.js`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const report = (entries) => new Map(entries.map((e) => [e.id, e]));

/** Three simulcast layers, the shape a healthy camera sender produces. */
const healthy = (ts, bytes) => report([
  { id: 'o0', type: 'outbound-rtp', kind: 'video', rid: 'r0', frameWidth: 320, frameHeight: 180, framesPerSecond: 30, bytesSent: bytes * 0.1, timestamp: ts, qualityLimitationReason: 'none' },
  { id: 'o1', type: 'outbound-rtp', kind: 'video', rid: 'r1', frameWidth: 640, frameHeight: 360, framesPerSecond: 30, bytesSent: bytes * 0.3, timestamp: ts, qualityLimitationReason: 'none' },
  { id: 'o2', type: 'outbound-rtp', kind: 'video', rid: 'r2', frameWidth: 1280, frameHeight: 720, framesPerSecond: 30, bytesSent: bytes, timestamp: ts, qualityLimitationReason: 'none' },
  { id: 'cp', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'lc', currentRoundTripTime: 0.042, availableOutgoingBitrate: 3_000_000 },
  { id: 'lc', type: 'local-candidate', protocol: 'udp', candidateType: 'srflx' },
]);

console.log('\n── what is being sent ──');
{
  const senders = videoSenders(healthy(1000, 100_000));
  check('every simulcast layer is listed', senders.length === 3, String(senders.length));
  check('biggest first, because that is the one being asked about',
    senders[0].height === 720, String(senders[0].height));
  check('each layer keeps its rid', senders.map((s) => s.rid).join() === 'r2,r1,r0',
    senders.map((s) => s.rid).join());
  check('resolution comes through', resolution(senders[0]) === '1280×720', resolution(senders[0]));
  check('so does frame rate', senders[0].fps === 30);
  check('with no previous sample there is no rate to report', senders[0].bitrate === null);
}

console.log('\n── bitrate needs two samples ──');
{
  const before = healthy(1000, 100_000);
  const after = healthy(2000, 350_000);      // 250 kB in one second
  const senders = videoSenders(after, before);

  check('it is computed from the delta', senders[0].bitrate === 2_000_000,
    String(senders[0].bitrate));
  check('and formatted for a person', formatBitrate(senders[0].bitrate) === '2.0 Mbps',
    formatBitrate(senders[0].bitrate));

  // Counters reset when a track is replaced; a negative delta is not a
  // negative bitrate, it is no reading at all.
  const reset = videoSenders(healthy(3000, 10_000), after);
  check('a counter that went backwards reports nothing, not a negative',
    reset[0].bitrate === null, String(reset[0].bitrate));

  const sameInstant = videoSenders(healthy(2000, 400_000), after);
  check('two samples at the same instant report nothing', sameInstant[0].bitrate === null);
}

console.log('\n── why the encoder is holding back ──');
{
  // The field that answers the question this whole module exists for.
  const limited = report([
    { id: 'o2', type: 'outbound-rtp', kind: 'video', rid: 'r2', frameWidth: 640, frameHeight: 360, framesPerSecond: 30, bytesSent: 1, timestamp: 1, qualityLimitationReason: 'bandwidth' },
  ]);
  const senders = videoSenders(limited);
  check('the reason is carried through', senders[0].limitedBy === 'bandwidth');
  check('and explained in words', describeLimit('bandwidth').includes('connection'), describeLimit('bandwidth'));
  check('cpu is a different sentence', describeLimit('cpu').includes('device'), describeLimit('cpu'));
  check('"none" is not a problem to report', describeLimit('none') === null);
  check('nor is a reason nobody recognises', describeLimit('wat') === null);
}

console.log('\n── what is being received ──');
{
  const before = report([
    { id: 'i1', type: 'inbound-rtp', kind: 'video', frameWidth: 640, frameHeight: 360, framesPerSecond: 28, bytesReceived: 50_000, timestamp: 1000, packetsLost: 2 },
  ]);
  const after = report([
    { id: 'i1', type: 'inbound-rtp', kind: 'video', frameWidth: 640, frameHeight: 360, framesPerSecond: 28, bytesReceived: 175_000, timestamp: 2000, packetsLost: 5, framesDropped: 1 },
  ]);

  const receivers = videoReceivers(after, before);
  check('the incoming stream is listed', receivers.length === 1);
  check('at the resolution actually arriving', resolution(receivers[0]) === '640×360');
  check('with its bitrate', receivers[0].bitrate === 1_000_000, String(receivers[0].bitrate));
  check('and loss', receivers[0].packetsLost === 5);
  check('dropped frames are counted separately from lost packets',
    receivers[0].framesDropped === 1);
  check('audio is not counted as video', videoReceivers(report([
    { id: 'a', type: 'inbound-rtp', kind: 'audio', bytesReceived: 1, timestamp: 1 },
  ])).length === 0);
}

console.log('\n── which route the media took ──');
{
  const info = transportInfo(healthy(1000, 1));
  check('the protocol is reported', info.protocol === 'udp');
  check('round-trip time in milliseconds, not seconds', info.rtt === 42, String(info.rtt));
  check('and the estimate the browser is working to', info.availableOutgoing === 3_000_000);

  const tcp = report([
    { id: 'cp', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'lc', currentRoundTripTime: 0.1 },
    { id: 'lc', type: 'local-candidate', protocol: 'tcp', candidateType: 'host' },
  ]);
  check('a TCP fallback is visible', transportInfo(tcp).protocol === 'tcp');

  check('nothing connected yet reports nothing', transportInfo(report([])) === null);
  check('and a missing report does not throw', transportInfo(undefined) === null);
}

console.log('\n── the one-line verdict ──');
{
  const full = verdict({ sending: videoSenders(healthy(1, 1)), transport: { protocol: 'udp' } });
  check('a healthy sender says so', full.level === 'good', JSON.stringify(full));

  const soft = verdict({
    sending: [{ height: 360, limitedBy: 'bandwidth' }],
    transport: { protocol: 'udp' },
  });
  check('a bandwidth-limited small picture is called bad', soft.level === 'bad', JSON.stringify(soft));
  check('and says which of the two it is', soft.text.includes('connection'), soft.text);

  const cpu = verdict({ sending: [{ height: 720, limitedBy: 'cpu' }], transport: { protocol: 'udp' } });
  check('a limited but still-large picture is only "ok"', cpu.level === 'ok', JSON.stringify(cpu));

  /**
   * The production case worth naming.
   *
   * On a cloud host whose security group never opened the RTC port range for
   * UDP, media silently falls back to TCP. Everything works and everything is
   * worse, and nothing about the picture says why — so the verdict says it
   * outright, ahead of any other diagnosis.
   */
  const tcp = verdict({ sending: videoSenders(healthy(1, 1)), transport: { protocol: 'tcp' } });
  check('TCP is called out even when the picture looks fine', tcp.level === 'bad', JSON.stringify(tcp));
  check('and names UDP being blocked as the cause', tcp.text.includes('UDP'), tcp.text);

  const nothing = verdict({ sending: [] });
  check('sending nothing is not an error', nothing.level === 'unknown', JSON.stringify(nothing));
  check('nor is being handed nothing at all', verdict().level === 'unknown');
}

console.log('\n── put together ──');
{
  const connection = readConnection({ send: healthy(1000, 1), recv: report([]) });
  check('sending, receiving and transport in one object',
    connection.sending.length === 3 && Array.isArray(connection.receiving) && connection.transport,
    JSON.stringify(Object.keys(connection)));
  check('an empty call does not throw', readConnection({}).sending.length === 0);
  check('nor does no argument at all', readConnection().transport === null);
}

console.log('\n── formatting ──');
{
  check('bits', formatBitrate(800) === '800 bps');
  check('kilobits', formatBitrate(240_000) === '240 kbps');
  check('megabits keep one decimal', formatBitrate(1_850_000) === '1.9 Mbps', formatBitrate(1_850_000));
  check('nothing to format is nothing shown', formatBitrate(null) === null);
  check('half a resolution is not shown', resolution({ width: 640 }) === null);
  check('nor is none of one', resolution(null) === null);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
