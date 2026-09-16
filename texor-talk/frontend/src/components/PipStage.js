'use client';

import { useEffect, useRef } from 'react';
import { CameraIcon, CameraOffIcon, HangUpIcon, MicIcon, MicOffIcon } from '@/components/icons';

/**
 * What the floating window contains.
 *
 * Sized for something the width of a playing card sitting over somebody else's
 * work, which rules most things out. One feed, one name, and the three controls
 * that are worth reaching for without going back to the tab: mute, camera, and
 * leave. Anything more would be a menu nobody can hit.
 *
 * Rendered through a portal into the picture-in-picture document, so this is
 * the same React tree as the call — the mute button here and the mute button
 * in the tab are the same state, not two that have to be kept in step.
 */

function Feed({ track, name, muted }) {
  const video = useRef(null);

  /**
   * The stream is attached rather than the element moved.
   *
   * Moving the `<video>` out of the page and into the other document is the
   * other way to do this, and it leaves a hole in the call behind it — the tab
   * you come back to has lost the tile. A second element on the same track
   * costs a decode and keeps both intact.
   */
  useEffect(() => {
    const element = video.current;
    if (!element) return undefined;

    if (!track) {
      element.srcObject = null;
      return undefined;
    }

    element.srcObject = new MediaStream([track]);
    element.play?.().catch(() => {});

    return () => { element.srcObject = null; };
  }, [track]);

  return (
    <div className="pip__feed">
      {track ? (
        // Muted: the audio is already playing in the tab, and a second
        // element on the same track would double it.
        <video ref={video} autoPlay playsInline muted className="pip__video" />
      ) : (
        <div className="pip__blank">
          <span className="pip__initial">{(name ?? '?').trim().charAt(0).toUpperCase()}</span>
        </div>
      )}

      <div className="pip__label">
        {muted ? <span className="pip__muted" aria-hidden="true"><MicOffIcon /></span> : null}
        <span className="pip__name">{name}</span>
      </div>
    </div>
  );
}

export function PipStage({
  feed,
  micOn,
  cameraOn,
  onToggleMic,
  onToggleCamera,
  onLeave,
}) {
  return (
    <div className="pip__root">
      <Feed track={feed?.track} name={feed?.name} muted={feed?.muted} />

      <div className="pip__bar">
        <button
          type="button"
          className={`pip__btn ${micOn ? '' : 'pip__btn--off'}`}
          aria-pressed={!micOn}
          aria-label={micOn ? 'Mute' : 'Unmute'}
          onClick={onToggleMic}
        >
          {micOn ? <MicIcon /> : <MicOffIcon />}
        </button>

        <button
          type="button"
          className={`pip__btn ${cameraOn ? '' : 'pip__btn--off'}`}
          aria-pressed={!cameraOn}
          aria-label={cameraOn ? 'Turn the camera off' : 'Turn the camera on'}
          onClick={onToggleCamera}
        >
          {cameraOn ? <CameraIcon /> : <CameraOffIcon />}
        </button>

        <button
          type="button"
          className="pip__btn pip__btn--leave"
          aria-label="Leave the meeting"
          onClick={onLeave}
        >
          <HangUpIcon />
        </button>
      </div>
    </div>
  );
}

export default PipStage;
