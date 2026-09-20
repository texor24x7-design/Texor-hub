'use client';

import { useEffect, useState } from 'react';
import { SOON_MS, URGENT_MS, formatRemaining } from '@/lib/duration';

/**
 * Which room you are in, and how long it has left.
 *
 * Its own component for the same reason as `MeetingTimer`: the second hand
 * should re-render a `<span>`, not the stage and every `<video>` on it.
 *
 * The countdown is drawn here from `closesAt` and nowhere else. The server does
 * not broadcast warnings — it only closes the rooms when the moment arrives —
 * so there is no "five minutes left" message to send twice, no flag recording
 * that it was sent, and nothing to put right after a restart.
 */
export function BreakoutChip({ room, name, closesAt, onReturn }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!closesAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [closesAt]);

  if (!room) return null;

  const left = closesAt ? new Date(closesAt).getTime() - now : null;
  const level = left === null ? null : left <= URGENT_MS ? 'urgent' : left <= SOON_MS ? 'soon' : null;

  return (
    <button
      type="button"
      className={`meet__room ${level ? `meet__room--${level}` : ''}`}
      onClick={onReturn}
      title="Back to the main room"
      aria-label={`You are in ${name || 'a breakout room'}. Return to the main room.`}
    >
      <span className="meet__room-name">{name || 'Breakout room'}</span>
      {left !== null ? (
        <span className="meet__room-left" role="status" aria-live="polite">{formatRemaining(left)}</span>
      ) : null}
    </button>
  );
}

export default BreakoutChip;
