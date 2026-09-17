'use client';

import { History } from 'lucide-react';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { useResource } from '@/lib/data';
import { dateTime, relative } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';

export function Activity({ module, recordId, limit }) {
  const { api, slug } = useWorkspace();
  const key = `activity:${slug}:${module ?? ''}:${recordId ?? ''}`;
  const { data, loading } = useResource(key, () => api.get('/activity', { module, recordId }));
  if (loading && !data) return <SkeletonRows rows={3} />;
  const events = (data?.events ?? []).slice(0, limit);
  if (!events.length) return <EmptyState icon={<History />} title="No activity yet" />;
  return (
    <div>
      {events.map((e) => (
        <div className="list-row" key={e._id} style={{ alignItems: 'flex-start' }}>
          <span className="avatar" style={{ width: 24, height: 24, fontSize: '0.62rem' }}>{(e.actorName || '?').slice(0, 1)}</span>
          <div className="grow">
            <div><span className="strong">{e.actorName || 'Someone'}</span> <span className="muted">{e.summary.charAt(0).toLowerCase() + e.summary.slice(1)}</span></div>
            <div className="tiny subtle" title={dateTime(e.at)}>{relative(e.at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
