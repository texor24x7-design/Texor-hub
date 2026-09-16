import { Caveat, Poppins } from 'next/font/google';
import '@/styles/landing.css';
import { Landing } from '@/components/Landing';

/**
 * Fonts are downloaded at build time and served from this deployment.
 *
 * `next/font` self-hosts rather than linking to Google's CDN, so the finished
 * page makes no request to anybody else — which is the same rule the rest of
 * this product follows about outside services.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--lp-sans',
  display: 'swap',
});

const caveat = Caveat({
  subsets: ['latin'],
  weight: ['600'],
  variable: '--lp-script',
  display: 'swap',
});

export const metadata = {
  title: 'Texor Talk — Meet. Collaborate. Move Forward.',
  description:
    'Secure, high-quality video meetings for modern teams. Built for productivity, designed for people.',

  // Resolved against `metadataBase`. Stated per page rather than once in the
  // layout, because `og:url` says "this is the canonical address of what you
  // just fetched" — and a page that names somebody else's address is telling a
  // scraper to cache it under theirs.
  openGraph: { url: '/' },
};

/**
 * `/` used to redirect straight to `/meetings`.
 *
 * It is the public address of the product, so it is now the public page. Every
 * way in from here lands on `/meetings`, which sends anybody who is not signed
 * in through Texor and straight back — so a signed-in person reaches the app in
 * one click and nobody meets a sign-in wall before knowing what this is.
 */
export default function HomePage() {
  return (
    <div className={`${poppins.variable} ${caveat.variable}`}>
      <Landing />
    </div>
  );
}
