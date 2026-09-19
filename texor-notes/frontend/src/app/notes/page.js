'use client';

import { Suspense, useEffect, useState } from 'react';
import { Board } from '@/components/Board';

/**
 * The board.
 *
 * `?q=` comes from the search box in the top bar, and `?new=1` from the button
 * beside it. Both are read from `location` in an effect rather than through
 * `useSearchParams`, which would need a Suspense boundary around the whole page
 * at build time to satisfy static rendering — a boundary that exists only to
 * placate the framework is a boundary nobody maintains.
 */
export default function NotesPage() {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get('q') ?? '');
  }, []);

  return (
    <Suspense>
      <Board
        scope="notes"
        title={query ? `Notes matching “${query}”` : 'Notes'}
        search={query}
        blurb="Write something down. It is saved as you type, and you can put it under a label, share it, or let another app write here too."
      />
    </Suspense>
  );
}
