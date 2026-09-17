import { Stack_Sans_Headline } from 'next/font/google';

import '@/styles/globals.css';

/**
 * The Texor typeface, as in Accounts and Talk, so moving between products does
 * not feel like changing companies. `next/font` downloads it at build time and
 * serves it from this deployment — no request to anybody else at runtime.
 */
const texorSans = Stack_Sans_Headline({
  subsets: ['latin'],
  variable: '--font-texor',
  display: 'swap',
});

export const metadata = {
  title: { default: 'Finvoice', template: '%s · Finvoice' },
  description: 'Invoices, quotations, inventory, warranties and your team — shaped for the way your business works.',
  applicationName: 'Texor Finvoice',
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={texorSans.variable}>
      <body>{children}</body>
    </html>
  );
}
