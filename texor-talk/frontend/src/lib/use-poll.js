'use client';

import { useEffect } from 'react';

/**
 * Keep a list current without asking the reader to refresh it.
 *
 * Who is in a meeting changes while somebody is looking at the page listing it,
 * and the page had no way to find out — a room filled up, emptied, or ended and
 * the card carried on saying whatever it had said when it loaded. Reloading is
 * a thing people do when they already suspect the screen is wrong, which is too
 * late to be useful.
 *
 * Polling rather than a socket, deliberately. The only live connection in this
 * product belongs to a meeting, and opening one for a list would mean a second
 * kind of connection, a second thing to reconnect, and a server holding a
 * socket per person staring at their agenda. A request every few seconds costs
 * far less than that and cannot get stuck in a state nobody notices.
 *
 * Two rules keep the cost honest:
 *
 *   · A hidden tab does not poll. A laptop with nine tabs open should not be
 *     asking about meetings in all of them, and the answer would not be seen
 *     even if it arrived.
 *   · Coming back to the tab refreshes immediately rather than waiting out the
 *     interval, because returning to a page is exactly the moment somebody
 *     looks at it — and after a call, the moment it is most likely stale.
 *
 * @param {Function} fn  must be stable (`useCallback`), or this resubscribes
 *                       on every render.
 * @param {number} ms    0 turns polling off.
 */
export function usePoll(fn, ms = 10_000) {
  useEffect(() => {
    if (!ms || typeof document === 'undefined') return undefined;

    const visible = () => document.visibilityState !== 'hidden';
    const tick = () => { if (visible()) fn(); };

    const timer = setInterval(tick, ms);

    // Fires on the way out as well as the way in; the guard makes going away
    // a no-op and coming back a refresh.
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [fn, ms]);
}

export default { usePoll };
