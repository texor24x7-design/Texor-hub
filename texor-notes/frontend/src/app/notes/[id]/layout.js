/**
 * What a shared note link looks like when it is pasted somewhere.
 *
 * Only `og:url`, and only here. The root layout deliberately claims no
 * canonical URL on behalf of every page — set there, every note would advertise
 * itself as the site root and scrapers would collapse them all onto one cached
 * preview. The title and description stay generic on purpose: a note's contents
 * are private, and the point of the card is to say where the link goes, not
 * what is inside.
 */
export async function generateMetadata({ params }) {
  const { id } = await params;

  return {
    title: 'A note',
    openGraph: {
      url: `/notes/${id}`,
      title: 'A note on Texor Notes',
      description: 'Sign in with your Texor Account to open it.',
    },
  };
}

export default function NoteLayout({ children }) {
  return children;
}
