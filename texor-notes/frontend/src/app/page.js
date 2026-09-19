import '@/styles/landing.css';
import { Landing } from '@/components/Landing';

export const metadata = {
  title: 'Texor Notes — write it down, find it later',
  description:
    'Notes, lists and shared thinking for teams — with an API, so the software you already run can write them too. Part of Texor.',

  // Stated per page rather than once in the layout, because `og:url` says "this
  // is the canonical address of what you just fetched" — and a page that names
  // somebody else's address tells a scraper to cache it under theirs.
  openGraph: { url: '/' },
};

/**
 * The public address of the product, so it is the public page rather than a
 * redirect. Every way in from here lands on `/notes`, which sends anybody who
 * is not signed in through Texor and straight back — so a signed-in person
 * reaches their notes in one click, and nobody meets a sign-in wall before
 * knowing what this is.
 */
export default function LandingPage() {
  return <Landing />;
}
