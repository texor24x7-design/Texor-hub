'use client';

/**
 * Live captions, across the bottom of the stage.
 *
 * ── Why an overlay and not the panel ──
 *
 * The panel holds the whole conversation and is for reading back. This is for
 * following the sentence being spoken right now, which means it has to be where
 * the eyes already are — on the person talking — and has to hold no more than
 * can be read in the couple of seconds before it changes.
 *
 * Three lines, because two is not enough to keep the thread when people talk
 * over each other and four is a wall of text over somebody's face.
 */
import { useEffect, useState } from 'react';
import { visibleCaptions } from '@/lib/captions';

export function CaptionOverlay({ lines, self }) {
  /**
   * A caption that nobody has added to expires, so the overlay does not sit on
   * the last thing said for the rest of a quiet meeting. That needs a clock:
   * nothing arrives to trigger the re-render that makes an old line disappear.
   */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const shown = visibleCaptions(lines, { now });
  if (shown.length === 0) return null;

  return (
    <div className="meet__captions" aria-live="polite" aria-atomic="false">
      {shown.map((line) => (
        <p
          key={line.key}
          className={`meet__caption ${line.final ? '' : 'meet__caption--interim'}`}
        >
          <span className="meet__caption-who">
            {line.texorId === self ? 'You' : line.name}
          </span>
          <span className="meet__caption-text">{line.text}</span>
        </p>
      ))}
    </div>
  );
}

export default CaptionOverlay;
