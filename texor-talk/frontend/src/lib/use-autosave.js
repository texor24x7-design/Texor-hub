'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createSaver, saveLabel } from '@/lib/autosave';

export { saveLabel };

/**
 * Autosave for a note.
 *
 * A thin wrapper over `createSaver`, which holds all the behaviour and is
 * tested without a browser. The only jobs here are to keep one saver for the
 * life of the component, mirror its state into React, and make sure the last
 * edit is not lost on the way out.
 */
export function useAutosave(save, { delay = 900 } = {}) {
  const [{ state, error }, setStatus] = useState({ state: 'idle', error: null });

  // Latest `save` without rebuilding the saver, which would drop a pending draft.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  const saver = useRef(null);
  if (!saver.current) {
    saver.current = createSaver({ save: (draft) => saveRef.current(draft), delay });
  }

  // Subscribing in the effect *body* is the whole point: StrictMode's second
  // mount re-attaches, where a boolean cleared in a cleanup would have stayed
  // cleared and frozen the indicator on "Unsaved changes".
  useEffect(() => saver.current.listen(setStatus), []);

  /**
   * Leaving must not cost a paragraph.
   *
   * Unmount flushes rather than cancels — a route change within the debounce
   * window used to discard whatever had just been typed. Flushing with nothing
   * pending is a no-op, so StrictMode's extra cleanup costs nothing.
   */
  useEffect(() => {
    const onHide = () => { saver.current.flushNow(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);

    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      saver.current.flushNow();
    };
  }, []);

  const queue = useCallback((draft) => saver.current.queue(draft), []);
  const flushNow = useCallback(() => saver.current.flushNow(), []);
  const hasPending = useCallback(() => saver.current.hasPending(), []);

  return { state, error, queue, flushNow, hasPending };
}

export default useAutosave;
