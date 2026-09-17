'use client';

import { Suspense, use } from 'react';
import { ModuleRoute } from '@/components/pages/ModuleRoute';

export default function EditRecordPage({ params }) {
  const { module, id } = use(params);
  return <Suspense><ModuleRoute key={`${module}:${id}:edit`} moduleKey={module} mode="edit" id={id} /></Suspense>;
}
