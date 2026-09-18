'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pause, Play, Repeat, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, SkeletonRows, useConfirm, useToast } from '@/components/ui';
import { invalidate, useResource } from '@/lib/data';
import { date, money } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';

export const EVERY_UNITS = [
  { value: 'days', label: 'days' }, { value: 'weeks', label: 'weeks' },
  { value: 'months', label: 'months' }, { value: 'years', label: 'years' },
];

const cadence = (every) => (every.n === 1 ? `Every ${every.unit.replace(/s$/, '')}` : `Every ${every.n} ${every.unit}`);

export function Schedules({ module }) {
  const { api, slug, href, currency, can } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(null);
  const { data, loading, reload } = useResource(`schedules:${slug}`, () => api.get('/schedules'));
  const schedules = data?.schedules ?? [];

  async function act(id, patch, message) {
    setBusy(id);
    try {
      await api.patch(`/schedules/${id}`, patch);
      invalidate(`schedules:${slug}`);
      reload();
      toast(message);
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(null); }
  }

  async function remove(schedule) {
    if (!(await confirm({ title: 'Stop this repeating invoice?', body: `No more invoices will be raised for ${schedule.customerName}. Invoices already issued are not affected.`, confirmLabel: 'Stop it', danger: true }))) return;
    setBusy(schedule._id);
    try {
      await api.delete(`/schedules/${schedule._id}`);
      invalidate(`schedules:${slug}`);
      reload();
      toast('Stopped');
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(null); }
  }

  const total = (s) => (s.template?.lines ?? []).reduce((a, l) => a + Math.round((l.priceMinor ?? 0) * (l.quantity ?? 0)), 0);

  return (
    <>
      <PageHeader title={module.label} description="Invoices that raise themselves on a schedule — retainers, AMCs, rent. Start one from any issued invoice." />
      {loading && !data ? <SkeletonRows /> : null}
      {data && !schedules.length ? (
        <EmptyState icon={<Repeat />} title={`No ${module.label.toLowerCase()} yet`}>
          Open an issued invoice and choose <strong>Repeat this invoice</strong> to set one up.
        </EmptyState>
      ) : null}
      {schedules.length ? (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>What</th><th>Customer</th><th>Repeats</th><th>Next</th>
                  <th className="num">Each time</th><th>Raised</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s._id}>
                    <td>
                      {s.title}
                      {s.lastError ? <div className="field-error">Last run failed: {s.lastError}</div> : null}
                    </td>
                    <td>{s.customerName}</td>
                    <td>{cadence(s.every)}{s.endsOn ? <span className="sub"> · until {date(s.endsOn)}</span> : null}</td>
                    <td>{s.status === 'active' ? date(s.nextRunAt) : <span className="muted">—</span>}</td>
                    <td className="num">{money(total(s), currency)}</td>
                    <td>
                      {s.runCount}
                      {s.lastInvoice ? <> · <Link href={href(`/invoices/${s.lastInvoice}`)}>last</Link></> : null}
                    </td>
                    <td>
                      <Badge tone={s.status === 'active' ? 'green' : s.status === 'paused' ? 'amber' : 'neutral'}>
                        {s.status === 'active' ? (s.autoSend ? 'Active · sends' : 'Active') : s.status}
                      </Badge>
                    </td>
                    <td className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                      {can('schedules', 'edit') && s.status !== 'ended' ? (
                        <Button variant="ghost" size="sm" loading={busy === s._id}
                          icon={s.status === 'active' ? <Pause /> : <Play />}
                          aria-label={s.status === 'active' ? 'Pause' : 'Resume'}
                          onClick={() => act(s._id, { status: s.status === 'active' ? 'paused' : 'active' }, s.status === 'active' ? 'Paused' : 'Resumed')} />
                      ) : null}
                      {can('schedules', 'delete') ? (
                        <Button variant="ghost" size="sm" icon={<Trash2 />} aria-label="Stop" danger onClick={() => remove(s)} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}
