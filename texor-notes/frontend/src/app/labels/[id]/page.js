'use client';

import { use, useEffect, useState } from 'react';
import { Board } from '@/components/Board';
import { labels as labelApi } from '@/lib/api';

/** One label's notes — the board with a filter and its own address. */
export default function LabelPage({ params }) {
  const { id } = use(params);
  const [label, setLabel] = useState(null);

  useEffect(() => {
    let cancelled = false;
    labelApi.list()
      .then(({ labels }) => {
        if (!cancelled) setLabel(labels.find((row) => row.id === id) ?? null);
      })
      .catch(() => { if (!cancelled) setLabel(null); });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <Board
      scope="notes"
      labelId={id}
      title={label?.name ?? 'Label'}
      blurb="Nothing is filed here yet. A note written from this page starts with this label on it."
    />
  );
}
