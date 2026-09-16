import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

/**
 * The square icon a chat app shows beside a shared link.
 *
 * Separate from the wide card in `opengraph-image.js`, because the two are
 * read by different things. A messaging app renders a compact row — a line of
 * text with a small tile beside it — and picks that layout when the image is
 * square. Hand it a 1200×630 banner and it either crops it to a sliver or
 * falls back to no picture at all, which is what a pasted meeting link was
 * doing.
 *
 * 512×512 is the size the same tile is published at across the products people
 * compare this one to, and comfortably above the 200×200 floor below which
 * scrapers discard an image.
 */
export const contentType = 'image/png';

const SIZE = 512;

/** The mark itself, at the size it is drawn, leaving a margin like an app tile. */
const MARK = 344;

export function GET() {
  const file = join(process.cwd(), 'public', 'brand', 'talk-icon.svg');
  const mark = `data:image/svg+xml;base64,${readFileSync(file).toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Opaque, not transparent: a chat app composites this onto its own
          // bubble, and a transparent mark disappears into a dark theme.
          background: '#ffffff',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mark} width={MARK} height={MARK} alt="" />
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}
