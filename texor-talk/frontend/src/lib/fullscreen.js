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
 * What a toggle should do, given what is fullscreen *now* and what was asked
 * for.
 *
 * Pulled out of the hook below and made pure, because the hook cannot be run
 * without a browser and this is where the bug was: the old code exited first
 * and then asked whether the thing it had just exited was the target. By then
 * nothing was fullscreen, the comparison was against `null`, and it fell
 * through and re-entered — so the button to leave fullscreen left and came
 * straight back, which is indistinguishable from it not working at all.
 *
 *   none  — nothing to act on
 *   exit  — the target is already fullscreen; this is the toggle off
 *   swap  — something else is fullscreen; leave it, then enter the target
 *   enter — nothing is fullscreen
 */
export function fullscreenAction(current, target) {
  if (!target) return 'none';
  if (current === target) return 'exit';
  return current ? 'swap' : 'enter';
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
    const target = elementRef.current;

    // Read once, before anything changes it. This is the whole of the fix.
    const action = fullscreenAction(fullscreenElement(), target);
    if (action === 'none') return;

    try {
      if (action === 'exit' || action === 'swap') await exitFullscreen();

      // Leaving one tile to enter another: exiting first is required, since a
      // second request while already fullscreen is rejected.
      if (action === 'exit') return;

      await enterFullscreen(target, videoRef?.current);
    } catch {
      // A rejected request is not worth an error message — the button simply
      // did not take, and the user can see that it did not.
    }
  }, [elementRef, videoRef]);

  return { active, toggle };
}

export default {
  useFullscreen, enterFullscreen, exitFullscreen, fullscreenSupported, fullscreenAction,
};
