'use client';

import { use } from 'react';
import { ModuleRoute } from '@/components/pages/ModuleRoute';

export default function RecordPage({ params }) {
  const { module, id } = use(params);
  return <ModuleRoute key={`${module}:${id}`} moduleKey={module} mode="view" id={id} />;
}
