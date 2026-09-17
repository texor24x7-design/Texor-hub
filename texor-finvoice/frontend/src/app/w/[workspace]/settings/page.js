'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SettingsIndex({ params }) {
  const { workspace } = use(params);
  const router = useRouter();
  useEffect(() => { router.replace(`/w/${workspace}/settings/business`); }, [router, workspace]);
  return null;
}
