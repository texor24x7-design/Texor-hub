import { Stack_Sans_Headline } from 'next/font/google';

import '@/styles/globals.css';

import { resolveOrigin } from '@/lib/origin.mjs';

/**
 * The typeface for the whole product.
 *
 * Loaded here rather than per page so every route is set in it — the board, a
 * note, the landing page — and so it is downloaded once.
 *
 * Taken as the variable font: 200–700 in a single file, which is less to
 * download than the four static weights this interface uses, and lets a rule
 * ask for a weight in between where that reads better.
 *
 * `next/font` fetches it at build time and serves it from this deployment, so
 * the finished page still makes no request to anybody else.
 */
const notesSans = Stack_Sans_Headline({
  subsets: ['latin'],
  variable: '--font-notes',
  display: 'swap',
});

/**
 * Resolved rather than read straight from `NEXT_PUBLIC_NOTES_ORIGIN`, because
 * that variable is inlined with a fallback at build time and so is never
 * absent — only, sometimes, wrong. Texor Talk learned this the hard way: a
 * deployment that never set it advertised its preview image at localhost,
 * which no crawler can fetch, so a pasted link showed words and no picture.
 *
 * This runs server-side, so it can still ask the platform at request time even
 * if the build was handed nothing useful.
 */
const ORIGIN = resolveOrigin();

const TITLE = 'Texor Notes';
const DESCRIPTION = 'Notes, lists and shared thinking — with an API, so your other software can write them too. Part of Texor.';

export const metadata = {
  /**
   * Without this, every image and link in the metadata below stays relative —
   * and a relative `og:image` is ignored by every chat client and social card
   * there is, which is why pasting a meeting link showed words and no picture.
   */
  metadataBase: new URL(ORIGIN),

  title: { default: TITLE, template: '%s · Texor Notes' },
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
     * scrapers key their cached preview on it — so every note link would
     * collapse onto one entry rather than being fetched on its own merits.
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
   * The landing page is worth finding. Nothing behind sign-in is reachable to a
   * crawler in the first place, since every one of those pages asks the API for
   * a session before it renders anything.
   */
  robots: { index: true, follow: true },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // The browser's own chrome takes the page's colour rather than sitting apart
  // from it — the one line that makes an installed app stop looking like a tab.
  themeColor: '#f7f7f9',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={notesSans.variable}>
      <body>{children}</body>
    </html>
  );
}
