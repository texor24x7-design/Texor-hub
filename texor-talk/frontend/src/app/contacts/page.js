'use client';

import { AppShell } from '@/components/AppShell';
import { Soon } from '@/components/Soon';
import { PeopleIcon } from '@/components/icons';

export default function ContactsPage() {
  return (
    <AppShell>
      <Soon
        title="Contacts"
        icon={<PeopleIcon />}
        blurb="The people you meet with most, so starting a call with them does not begin with typing an address."
        instead="Back to meetings"
        insteadHref="/meetings"
      />
    </AppShell>
  );
}
