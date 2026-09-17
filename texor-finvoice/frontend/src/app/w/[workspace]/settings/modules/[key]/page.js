'use client';

import { use } from 'react';
import { ModuleEditor } from '@/components/settings/ModuleEditor';

export default function ModuleEditorPage({ params }) {
  const { key } = use(params);
  return <ModuleEditor key={key} moduleKey={key} />;
}
