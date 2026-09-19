'use client';

import { Board } from '@/components/Board';

export default function ArchivePage() {
  return (
    <Board
      scope="archive"
      title="Archive"
      blurb="Notes you have finished with but do not want to throw away. They keep their labels and stay searchable."
    />
  );
}
