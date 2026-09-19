import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

/**
 * The picture that appears when somebody pastes a Texor Notes link.
 *
 * Drawn here rather than shipped as a file, so it cannot fall out of step with
 * the brand — the mark is read from the same `public/brand/notes-logo.svg` the
 * application uses, and the colours are the ones in it.
 *
 * 1200×630 because that is what every chat client and social card crops to. A
 * square icon on its own gets letterboxed or cropped to a sliver, which is why
 * a link to this product previously showed text and nothing else.
 */
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Texor Notes — notes for the Texor ecosystem';

/**
 * Satori draws no SVG elements of its own, so the logo goes in as an image.
 * Read at build time: a fetch here would make the card depend on the site
 * being up to describe itself.
 *
 * The full lockup, not the mark with the name set beside it in whatever the
 * card's font happens to be — the wordmark belongs to the artwork.
 */
function logoAsDataUri() {
  const file = join(process.cwd(), 'public', 'brand', 'notes-logo.svg');
  return `data:image/svg+xml;base64,${readFileSync(file).toString('base64')}`;
}

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 90px',
          background: '#f7f7f9',
          fontFamily: 'sans-serif',
        }}
      >
        {/* A band of the family's spectrum along the top. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 10,
            display: 'flex',
            background:
              'linear-gradient(90deg, #fb0102, #fa5908, #faa813, #a9ee25, #36e13b, #4addb1, #52d8d8, #6187ce, #6766cc)',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoAsDataUri()} width={372} height={110} alt="" />
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 46,
            fontWeight: 600,
            color: '#17181d',
            letterSpacing: -1.5,
            marginTop: 54,
          }}
        >
          Write it down. Find it later.
        </div>

        <div style={{ display: 'flex', fontSize: 30, color: '#61636e', marginTop: 18 }}>
          Notes, lists and shared thinking — with an API for your other software.
        </div>
      </div>
    ),
    size,
  );
}
