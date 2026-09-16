'use client';

import { useEffect, useState } from 'react';
import { meetingTime } from '@/lib/duration';

/**
 * How long this call has been running.
 *
 * Its own component so the one-second tick re-renders a `<span>` rather than
 * the whole call. The stage, every tile and every `<video>` sit above this in
 * the tree, and re-rendering all of them once a second would be a real cost for
 * a clock nobody is staring at.
 *
 * A meeting with a duration limit also gets a warning as the end approaches.
 * Only then: the room ticker really will end the call, so saying nothing would
 * be worse — but a countdown running the whole meeting is a pressure device,
 * and most meetings here have no limit at all.
 */
export function MeetingTimer({ activeMs = 0, activeSince = null, maxDurationMinutes = 0 }) {
  const [now, setNow] = useState(() => Date.now());

  /**
   * The clock only ticks while somebody is in the room.
   *
   * `activeSince` is null exactly when it is empty, and an interval running
   * against a total that cannot change is a re-render a second for nothing.
   */
  useEffect(() => {
    if (!activeSince) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeSince]);

  const time = meetingTime({ activeMs, activeSince, maxDurationMinutes, now });

  // Hidden only before the meeting has run at all. An empty room that has
  // already run shows its total, held — going blank would read as the time
  // having been lost rather than paused.
  if (!time.elapsed) return null;

  return (
    <>
      {/*
        * The digits are hidden from screen readers: a timer announcing itself
        * every second would talk over the meeting. The same fact is carried
        * below in a form that is read on request rather than shouted.
        */}
      <span className="meet__elapsed" aria-hidden="true">{time.elapsed}</span>
      <span className="sr-only">{`In this meeting for ${time.elapsed}`}</span>

      {time.remaining ? (
        // Only the warning speaks, and its text changes once a minute rather
        // than once a second, so `polite` is not a firehose.
        <span className={`meet__left meet__left--${time.level}`} role="status" aria-live="polite">
          {time.remaining}
        </span>
      ) : null}
    </>
  );
}

export default MeetingTimer;
