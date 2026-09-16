'use client';

import { AppShell } from '@/components/AppShell';
import { Soon } from '@/components/Soon';
import { CalendarIcon } from '@/components/icons';

export default function CalendarPage() {
  return (
    <AppShell>
      <Soon
        title="Calendar"
        icon={<CalendarIcon />}
        blurb="Your meetings laid out by day and week, with the ones you host and the ones you were invited to side by side."
        instead="See your meetings"
        insteadHref="/meetings"
      />
    </AppShell>
  );
}
