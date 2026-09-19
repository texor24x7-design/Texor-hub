'use client';

import { NOTE_COLOURS } from '@/lib/colours';

/** Nine swatches, nine CSS variables. The palette is the highlighter's. */
export function ColourPicker({ value = 'default', onPick, label = 'Note colour' }) {
  return (
    <div className="swatches" role="group" aria-label={label}>
      {NOTE_COLOURS.map((colour) => (
        <button
          key={colour}
          type="button"
          className={`swatch ${value === colour ? 'swatch--on' : ''}`}
          style={{ background: `var(--note-${colour})` }}
          aria-label={colour === 'default' ? 'No colour' : colour}
          aria-pressed={value === colour}
          onClick={() => onPick(colour)}
        />
      ))}
    </div>
  );
}

export default ColourPicker;
