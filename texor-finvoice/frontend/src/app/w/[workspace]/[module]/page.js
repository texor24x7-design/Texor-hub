'use client';

import { use } from 'react';
import { ModuleRoute } from '@/components/pages/ModuleRoute';

export default function ModulePage({ params }) {
  const { module } = use(params);
  return <ModuleRoute key={module} moduleKey={module} />;
}
