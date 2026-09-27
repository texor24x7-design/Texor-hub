import { Plus_Jakarta_Sans } from 'next/font/google';

import '@/styles/globals.css';

/**
 * The Texor typeface, as in every other product. `next/font` downloads it at
 * build time and serves it from this deployment — no request to anybody else.
 */
const texorSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-texor',
  display: 'swap',
});

export const metadata = {
  title: 'Texor Payroll',
  description: 'Invoicing for the Texor ecosystem.',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={texorSans.variable}>
      <body>{children}</body>
    </html>
  );
}
