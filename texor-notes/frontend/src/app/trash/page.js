'use client';

import { Board } from '@/components/Board';

export default function TrashPage() {
  return (
    <Board
      scope="trash"
      title="Trash"
      blurb="Nothing has been deleted. A note stays here until you delete it for good."
    />
  );
}
