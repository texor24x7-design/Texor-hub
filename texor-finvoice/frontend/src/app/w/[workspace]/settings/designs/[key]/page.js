'use client';

import { use } from 'react';
import { Designer } from '@/components/settings/Designer';

export default function DesignerPage({ params }) {
  const { key } = use(params);
  return <Designer key={key} designKey={key} />;
}
