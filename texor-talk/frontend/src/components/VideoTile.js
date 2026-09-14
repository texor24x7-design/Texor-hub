'use client';

import { useEffect, useRef } from 'react';
import {
  FullscreenExitIcon, FullscreenIcon, HandIcon, MicOffIcon, PinIcon,
} from '@/components/icons';
import { useFullscreen } from '@/lib/fullscreen';

/**
 * One participant's tile.
 *
 * A `MediaStreamTrack` is not something React can render, so the track is
 * attached imperatively and only when it actually changes. Rebuilding
 * `srcObject` on every render would restart decoding and make the video flicker
 * whenever anything else on the page updated.
 */

/**
 * A stable colour per person.
 *
 * The avatar behind a switched-off camera is the only thing distinguishing two
 * tiles, so it has to be the same colour every time that person appears — a
 * random one per render would reshuffle the grid's identity on every update.
 * Hashing the name is enough, and needs nothing stored.
 */
const AVATAR_COLOURS = ['#5b8def', '#7b61c9', '#c9557f', '#c97f2e', '#2e9e83', '#4a7fb5'];

/**
 * Coerced, not defaulted.
 *
 * A display name arrives from an identity provider by way of the server, so it
 * is not ours to assume anything about. A default parameter only covers
 * `undefined` — a literal `null` sails straight past it and takes the whole
 * grid down on `.length`.
 */
const nameOf = (value) => (typeof value === 'string' ? value : '');

function colourFor(name) {
  const text = nameOf(name);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length];
}

const initialsOf = (name) =>
  nameOf(name)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?';

export function VideoTile({
  track, name, role, muted, speaking, handRaised, mirrored, isYou, label, compact,
  onPin, pinned, allowFullscreen = true,
}) {
  const video = useRef(null);
  const frame = useRef(null);
  const { active: isFullscreen, toggle: toggleFullscreen } = useFullscreen(frame, video);

  useEffect(() => {
    const element = video.current;
    if (!element) return undefined;

    if (!track) {
      element.srcObject = null;
      return undefined;
    }

    element.srcObject = new MediaStream([track]);

    // Autoplay is permitted because joining was a click, but a rejected play
    // promise is still possible and unhandled it is a console error beside a
    // blank tile with no explanation.
    element.play?.().catch(() => {});

    return () => { element.srcObject = null; };
  }, [track]);

  const classes = [
    'tile',
    speaking ? 'tile--speaking' : '',
    compact ? 'tile--compact' : '',
    label === 'screen' ? 'tile--screen' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={`${classes}${isFullscreen ? ' tile--fullscreen' : ''}`}
      ref={frame}
      // Double-click is the shortcut people already try on a video, and it
      // costs nothing to honour it alongside the button.
      onDoubleClick={allowFullscreen && track ? toggleFullscreen : undefined}
    >
      {track ? (
        <video
          ref={video}
          autoPlay
          playsInline
          // Our own preview is muted or we hear ourselves a round trip late.
          muted={isYou}
          className={[
            'tile__video',
            mirrored ? 'tile__video--mirrored' : '',
            // A shared screen is letterboxed rather than cropped: cover would
            // cut off the edges of whatever someone is trying to show.
            label === 'screen' ? 'tile__video--contain' : '',
          ].filter(Boolean).join(' ')}
        />
      ) : (
        <div className="tile__placeholder">
          <span className="tile__avatar" style={{ background: colourFor(name) }}>
            {initialsOf(name)}
          </span>
        </div>
      )}

      <div className="tile__badges">
        {handRaised ? (
          <span className="tile__badge tile__badge--hand" title={`${nameOf(name) || 'They'} raised a hand`}>
            <HandIcon />
          </span>
        ) : null}
        {muted ? (
          <span className="tile__badge" title={`${nameOf(name) || 'This participant'} is muted`}>
            <MicOffIcon />
          </span>
        ) : null}
      </div>

      {/* Grouped so they lay out beside each other rather than each needing
          to know what else happens to be rendered. */}
      <div className="tile__actions">
        {onPin ? (
          <button
            type="button"
            className={`tile__action ${pinned ? 'tile__action--on' : ''}`}
            onClick={onPin}
            aria-pressed={pinned}
            aria-label={pinned ? `Unpin ${nameOf(name)}` : `Pin ${nameOf(name)} to the stage`}
            title={pinned ? 'Unpin' : 'Pin to the stage'}
          >
            <PinIcon />
          </button>
        ) : null}

        {allowFullscreen && track ? (
          <button
            type="button"
            className="tile__action"
            onClick={toggleFullscreen}
            aria-label={
              isFullscreen
                ? 'Exit fullscreen'
                : `View ${label === 'screen' ? 'this shared screen' : nameOf(name) || 'this person'} fullscreen`
            }
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </button>
        ) : null}
      </div>

      <div className="tile__label">
        {role === 'host' || role === 'cohost' ? <span className="tile__pip" title={role} /> : null}
        <span className="tile__name">
          {isYou ? 'You' : nameOf(name) || 'Participant'}
          {label ? <span className="tile__sub"> · {label}</span> : null}
        </span>
      </div>
    </div>
  );
}

export default VideoTile;
