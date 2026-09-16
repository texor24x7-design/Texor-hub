import { Stack_Sans_Headline } from 'next/font/google';

import '@/styles/globals.css';

/**
 * The typeface for the whole product — the same one Texor Talk is set in, so
 * that signing in and landing in the app do not feel like two companies.
 *
 * Loaded here rather than per page so every route is set in it and so it is
 * downloaded once.
 *
 * Taken as the variable font: 200–700 in a single file, which is less to
 * download than the four static weights this interface uses, and lets a rule
 * ask for a weight in between where that reads better.
 *
 * `next/font` fetches it at build time and serves it from this deployment, so
 * the finished page still makes no request to anybody else — which matters
 * more here than anywhere: this is the page that handles passwords.
 */
const texorSans = Stack_Sans_Headline({
  subsets: ['latin'],
  variable: '--font-texor',
  display: 'swap',
});

export const metadata = {
  title: 'Texor Accounts',
  description: 'One account for every Texor product.',
  applicationName: 'Texor Accounts',

  /*
   * `icon.png` and `apple-icon.png` beside this file are picked up by Next's
   * file convention, so the tab and the home screen both get the supplied
   * mark rather than the framework's default.
   */
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,

  /*
   * One value, not a light/dark pair. The product is light on every machine
   * (see `color-scheme: light` in `globals.css`), so the browser's own chrome
   * should take the page's colour rather than the operating system's.
   */
  themeColor: '#f5f7fa',
  colorScheme: 'light',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={texorSans.variable}>
      <body>{children}</body>
    </html>
  );
}
