'use client';

import { AppShell } from '@/components/AppShell';
import { Soon } from '@/components/Soon';
import { RecordIcon } from '@/components/icons';

export default function RecordingsPage() {
  return (
    <AppShell>
      <Soon
        title="Recordings"
        icon={<RecordIcon />}
        blurb="Meetings recorded to your organisation's storage, with playback, sharing and retention rules."
        instead="Back to meetings"
        insteadHref="/meetings"
      />
    </AppShell>
  );
}
