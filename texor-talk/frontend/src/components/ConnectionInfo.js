'use client';

import { useEffect, useState } from 'react';
import { describeLimit, formatBitrate, resolution, verdict } from '@/lib/stats';

/**
 * What the connection is actually doing.
 *
 * This exists because "the video looks bad" was previously unanswerable — there
 * was no `getStats` call anywhere in the product, so every quality question
 * came down to guessing. The two things it makes visible are the two things
 * that are otherwise invisible:
 *
 *   · the **top simulcast layer's resolution**, which is the difference between
 *     a sender that gave up on picture and a network that cannot carry it
 *   · whether media is on **UDP or TCP**, because a blocked UDP port range
 *     silently degrades every call and says nothing about itself
 */
export function ConnectionInfo({ room }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const sample = async () => {
      try {
        const next = await room?.current?.connectionStats();
        if (!cancelled && next) setStats(next);
      } catch {
        // A transport closing mid-sample is not worth reporting; the next tick
        // either succeeds or the panel is gone with the call.
      }
    };

    sample();
    // Two seconds: rates need a gap to be measured over, and anything faster
    // is a number nobody can read changing under them.
    const timer = setInterval(sample, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [room]);

  if (!stats) {
    return <p className="meta">Measuring…</p>;
  }

  const top = stats.sending?.[0];
  const overall = verdict(stats);
  const limit = describeLimit(top?.limitedBy);

  return (
    <div className="conn">
      <p className={`conn__verdict conn__verdict--${overall.level}`}>{overall.text}</p>

      <div className="conn__group">
        <h4>Your camera</h4>
        {stats.sending.length === 0 ? (
          <p className="meta">Not sending video.</p>
        ) : (
          <>
            {/*
              * Every layer, not just the best one. Three rows where the top is
              * 1280×720 is a healthy sender; three rows where the top is
              * 640×360 is a browser that has quietly stopped sending the
              * picture it was asked for — and those look identical from the
              * outside.
              */}
            {stats.sending.map((layer) => (
              <div className="conn__row" key={layer.id}>
                <span className="conn__label">{layer.rid ? `Layer ${layer.rid}` : 'Single layer'}</span>
                <span className="conn__value">
                  {resolution(layer) ?? '—'}
                  {layer.fps != null ? ` · ${Math.round(layer.fps)} fps` : ''}
                  {layer.bitrate != null ? ` · ${formatBitrate(layer.bitrate)}` : ''}
                </span>
              </div>
            ))}
            {limit ? <p className="conn__note">{limit}</p> : null}
          </>
        )}
      </div>

      {stats.receiving.length > 0 ? (
        <div className="conn__group">
          <h4>Coming in</h4>
          {stats.receiving.map((stream) => (
            <div className="conn__row" key={stream.id}>
              <span className="conn__label">{resolution(stream) ?? 'Starting…'}</span>
              <span className="conn__value">
                {stream.fps != null ? `${Math.round(stream.fps)} fps` : ''}
                {stream.bitrate != null ? ` · ${formatBitrate(stream.bitrate)}` : ''}
                {stream.packetsLost > 0 ? ` · ${stream.packetsLost} lost` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {stats.transport ? (
        <div className="conn__group">
          <h4>Route</h4>
          <div className="conn__row">
            <span className="conn__label">Protocol</span>
            <span className={`conn__value ${stats.transport.protocol === 'tcp' ? 'conn__value--warn' : ''}`}>
              {(stats.transport.protocol ?? '—').toUpperCase()}
              {stats.transport.candidateType ? ` · ${stats.transport.candidateType}` : ''}
            </span>
          </div>
          {stats.transport.rtt != null ? (
            <div className="conn__row">
              <span className="conn__label">Round trip</span>
              <span className="conn__value">{stats.transport.rtt} ms</span>
            </div>
          ) : null}
          {stats.transport.availableOutgoing != null ? (
            <div className="conn__row">
              <span className="conn__label">Estimated up</span>
              <span className="conn__value">{formatBitrate(stats.transport.availableOutgoing)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ConnectionInfo;
