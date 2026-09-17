'use client';

import { use } from 'react';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';

export default function WorkspaceLayout({ params, children }) {
  const { workspace } = use(params);
  return <WorkspaceShell slug={decodeURIComponent(workspace)}>{children}</WorkspaceShell>;
}
