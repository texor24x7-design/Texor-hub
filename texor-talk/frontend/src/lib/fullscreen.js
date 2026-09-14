'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Fullscreen, across browsers that disagree about how to do it.
 *
 * Three spellings matter:
 *
 *   · the standard `requestFullscreen` / `exitFullscreen`
 *   · Safari's `webkitRequestFullscreen`, on desktop
 *   · iOS, which does not allow **any** element to go fullscreen — only a
 *     `<video>`, and only through `webkitEnterFullscreen`. That is why the
 *     video element is passed separately: on iPhone the tile's name overlay
 *     cannot come with it, and native video fullscreen is the whole of what is
 *     on offer.
 */

const fullscreenElement = () =>
  (typeof document === 'undefined'
    ? null
    : document.fullscreenElement ?? document.webkitFullscreenElement ?? null);

/** Whether this browser can fullscreen an arbitrary element, or a video at all. */
export function fullscreenSupported(element, video) {
  if (typeof document === 'undefined') return false;
  return Boolean(
    element?.requestFullscreen
    || element?.webkitRequestFullscreen
    || video?.webkitEnterFullscreen,
  );
}

export async function enterFullscreen(element, video) {
  if (element?.requestFullscreen) return element.requestFullscreen();
  if (element?.webkitRequestFullscreen) return element.webkitRequestFullscreen();
  // iPhone. Returns undefined rather than a promise, and takes the video only.
  if (video?.webkitEnterFullscreen) return video.webkitEnterFullscreen();
  throw new Error('Fullscreen is not available in this browser.');
}

export async function exitFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  return undefined;
}

/**
 * Tracks and toggles fullscreen for one element.
 *
 * `active` is derived from the browser's own `fullscreenchange` rather than
 * from whatever we last asked for — Escape, the system chrome and the browser's
 * own controls all exit without telling us, and state that only updates when we
 * click leaves a button claiming the opposite of what is on screen.
 */
export function useFullscreen(elementRef, videoRef) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setActive(fullscreenElement() === elementRef.current);

    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();

    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [elementRef]);

  const toggle = useCallback(async () => {
    try {
      if (fullscreenElement()) {
        await exitFullscreen();
        // Leaving one tile to enter another: exiting first is required, since
        // a second request while already fullscreen is rejected.
        if (fullscreenElement() === elementRef.current) return;
      }
      await enterFullscreen(elementRef.current, videoRef?.current);
    } catch {
      // A rejected request is not worth an error message — the button simply
      // did not take, and the user can see that it did not.
    }
  }, [elementRef, videoRef]);

  return { active, toggle };
}

export default { useFullscreen, enterFullscreen, exitFullscreen, fullscreenSupported };
