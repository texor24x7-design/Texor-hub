'use client';

import { AppShell } from '@/components/AppShell';
import { Soon } from '@/components/Soon';
import { GridIcon } from '@/components/icons';

export default function IntegrationsPage() {
  return (
    <AppShell>
      <Soon
        title="Integrations"
        icon={<GridIcon />}
        blurb="Connect Texor Talk to the calendars and tools your team already uses."
        instead="Back to meetings"
        insteadHref="/meetings"
      />
    </AppShell>
  );
}
