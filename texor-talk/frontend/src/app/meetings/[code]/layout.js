/**
 * Metadata for a meeting link, which is the one URL of this product that gets
 * pasted into other people's chats.
 *
 * It exists as a layout because the page itself is a client component and so
 * cannot export metadata of its own. It renders its children untouched.
 */

/**
 * A square tile and a `summary` card, which together produce the compact row a
 * messaging app shows: a line of text with a small icon beside it.
 *
 * The wide 1200×630 banner in `app/opengraph-image.js` stays on the landing
 * page, where a link is posted to a feed and the banner is the better object.
 * A chat is not a feed: handed a banner it crops to a sliver or shows nothing.
 *
 * It has to be named here at all because `openGraph` in a child segment
 * replaces the parent's rather than merging into it, which detaches the
 * `opengraph-image.js` file convention — so stating a URL and nothing else
 * silently strips the picture from exactly the link that gets shared.
 */
const TILE = {
  url: '/share-icon.png',
  width: 512,
  height: 512,
  alt: 'Texor Talk',
};

/**
 * The code is whatever was in the path, so it is not trusted to be a code.
 *
 * It goes into a canonical URL that scrapers cache things under, so anything
 * that is not plausibly one of our codes is dropped rather than reflected —
 * and a dropped `og:url` is harmless, because a crawler then falls back to the
 * address it actually fetched, which is the right answer anyway.
 */
const CODE = /^[a-z0-9]{2,12}(-[a-z0-9]{2,12}){0,3}$/;

export async function generateMetadata({ params }) {
  const { code } = await params;
  const clean = String(code ?? '').toLowerCase();

  /**
   * Per meeting, not per site. Set once in the root layout it was inherited by
   * every page, so each one claimed to be the site root.
   */
  const url = CODE.test(clean) ? `/meetings/${clean}` : undefined;

  return {
    // Absolute, so it is not suffixed by the root template into
    // "… · Texor Talk". The product's name is the heading a chat card wants;
    // what the link does belongs in the line under it.
    title: { absolute: 'Texor Talk' },
    description:
      'Join the meeting. Secure, high-quality video meetings for modern teams. Part of Texor.',

    openGraph: {
      url,
      title: 'Texor Talk',
      description:
        'Join the meeting. Secure, high-quality video meetings for modern teams. Part of Texor.',
      images: [TILE],
    },

    // `summary`, not `summary_large_image`: the compact row is the point.
    twitter: { card: 'summary', title: 'Texor Talk', images: [TILE] },
  };
}

export default function MeetingLayout({ children }) {
  return children;
}
