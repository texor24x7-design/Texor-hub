'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/ui';
import { api, auth } from '@/lib/api';

/**
 * The way into the app.
 *
 * Sends people where they belong: sign-in, onboarding, the workspace they had
 * open, or the picker when they have several.
 */
export default function Start() {
  const router = useRouter();
  const [label, setLabel] = useState('Loading Finvoice');

  useEffect(() => {
    (async () => {
      try {
        const me = await auth.me();
        if (!me.user) { router.replace('/signin?returnTo=/start'); return; }
        const { workspaces, lastWorkspace } = await api('/api/workspaces');
        if (!workspaces.length) { router.replace('/onboarding'); return; }
        const last = workspaces.find((w) => w._id === lastWorkspace) ?? (workspaces.length === 1 ? workspaces[0] : null);
        router.replace(last ? `/w/${last.slug}` : '/workspaces');
      } catch {
        setLabel('Cannot reach Finvoice — retrying');
        setTimeout(() => window.location.reload(), 4000);
      }
    })();
  }, [router]);

  return <Loading label={label} />;
}
