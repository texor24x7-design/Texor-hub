'use client';

import { Board } from '@/components/Board';

export default function SharedPage() {
  return (
    <Board
      scope="shared"
      title="Shared with me"
      blurb="Notes other people have shared with you appear here — one at a time, or everything under a label they shared."
    />
  );
}
