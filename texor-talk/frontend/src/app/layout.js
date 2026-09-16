import '@/styles/globals.css';

const ORIGIN = process.env.NEXT_PUBLIC_TALK_ORIGIN ?? 'http://localhost:3002';

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
    url: ORIGIN,
    locale: 'en',
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
