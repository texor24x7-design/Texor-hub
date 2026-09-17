'use client';

import { Suspense, use } from 'react';
import { ModuleRoute } from '@/components/pages/ModuleRoute';

export default function NewRecordPage({ params }) {
  const { module } = use(params);
  return <Suspense><ModuleRoute key={module} moduleKey={module} mode="new" /></Suspense>;
}
