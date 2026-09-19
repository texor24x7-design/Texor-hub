'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Compass } from 'lucide-react';
import { ButtonLink, EmptyState } from '@/components/ui';
import { DocumentEditor } from '@/components/documents/DocumentEditor';
import { DocumentList } from '@/components/documents/DocumentList';
import { DocumentView } from '@/components/documents/DocumentView';
import { ModuleList } from '@/components/records/ModuleList';
import { RecordCreate, RecordDetail, RecordEdit } from '@/components/records/RecordPages';
import { screenFor, useWorkspace } from '@/lib/workspace';
import { Payments } from './Payments';
import { Schedules } from './Schedules';
import { ProTeaser } from './ProTeaser';
import { People } from './People';
import { Team } from './Team';

function Missing() {
  const { href } = useWorkspace();
  return <EmptyState icon={<Compass />} title="This page does not exist here" action={<ButtonLink href={href('')}>Back to dashboard</ButtonLink>}>The module may have been switched off or renamed, or your role may not include it.</EmptyState>;
}

function Redirect({ to }) {
  const router = useRouter();
  useEffect(() => { router.replace(to); }, [router, to]);
  return null;
}

/** `/w/:slug/:module[/new | /:id | /:id/edit]` → the right screen for that module. */
export function ModuleRoute({ moduleKey, mode = 'list', id }) {
  const { module, can, href } = useWorkspace();
  const m = module(moduleKey);
  const screen = screenFor(m);

  if (screen === 'missing' || (m && !can(m.key, 'view') && !m.locked)) return <Missing />;
  if (screen === 'pro') return <ProTeaser module={m} />;
  if (screen === 'dashboard') return <Redirect to={href('')} />;
  if (screen === 'settings') return <Redirect to={href('/settings/business')} />;
  if (screen === 'team') return <Team module={m} />;
  if (screen === 'payments') return <Payments module={m} />;
  if (screen === 'schedules') return <Schedules module={m} />;

  if (screen === 'documents') {
    if (mode === 'new') return can(m.key, 'create') ? <DocumentEditor module={m} /> : <Missing />;
    if (mode === 'edit') return can(m.key, 'edit') ? <DocumentEditor module={m} id={id} /> : <Missing />;
    if (mode === 'view') return <DocumentView module={m} id={id} />;
    return <DocumentList module={m} />;
  }

  if (mode === 'new') return can(m.key, 'create') ? <RecordCreate module={m} /> : <Missing />;
  if (mode === 'edit') return can(m.key, 'edit') ? <RecordEdit module={m} id={id} /> : <Missing />;
  if (mode === 'view') return <RecordDetail module={m} id={id} />;
  if (screen === 'staff') return <People module={m} />;
  return <ModuleList module={m} />;
}
