import '@/styles/globals.css';

import { resolveOrigin } from '@/lib/origin.mjs';

/**
 * Resolved rather than read straight from `NEXT_PUBLIC_TALK_ORIGIN`, because
 * that variable is inlined with a fallback at build time and so is never
 * absent — only, sometimes, wrong. A deployment that never set it advertised
 * its preview image at `http://localhost:3002`, which no crawler can fetch, so
 * a pasted meeting link showed words and no picture.
 *
 * This runs server-side, so it can still ask the platform at request time even
 * if the build was handed nothing useful.
 */
const ORIGIN = resolveOrigin();

const TITLE = 'Texor Talk';
const DESCRIPTION = 'Secure, high-quality video meetings for modern teams. Part of Texor.';

export const metadata = {
  /**
   * Without this, every image and link in the metadata below stays relative —
   * and a relative `og:image` is ignored by every chat client and social card
   * there is, which is why pasting a meeting link showed words and no picture.
   */
  metadataBase: new URL(ORIGIN),

  title: { default: TITLE, template: '%s · Texor Talk' },
  description: DESCRIPTION,
  applicationName: TITLE,

  openGraph: {
    type: 'website',
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    locale: 'en',

    /**
     * No `url` here on purpose.
     *
     * A value set at this level is inherited by every page, so each one
     * declared itself to be the site root. `og:url` is a canonical claim —
     * scrapers key their cached preview on it — so every meeting link
     * collapsed onto one entry rather than being fetched on its own merits.
     * Each page that is worth sharing states its own below.
     */
    // The image itself comes from `opengraph-image.js` beside this file; Next
    // adds it, with its dimensions, from the file convention.
  },

  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },

  /**
   * A meeting code is not a page anybody should find in a search result, and a
   * joining link pasted into a public channel should not become one either.
   */
  robots: { index: true, follow: true },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // The browser's own chrome takes the page's colour rather than sitting apart
  // from it — the one line that makes an installed app stop looking like a tab.
  themeColor: '#f6f7fa',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
