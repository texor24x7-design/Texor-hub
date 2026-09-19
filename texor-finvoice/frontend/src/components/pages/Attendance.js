'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Download, Plus, Users } from 'lucide-react';
import { Avatar, Badge, Button, ButtonLink, EmptyState, Menu, MenuItem, SkeletonRows, StatusBadge, useConfirm, useToast, CardTable } from '@/components/ui';
import { fileUrl } from '@/lib/api';
import { invalidate, useResource } from '@/lib/data';
import { dateTime, money } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';

const STATUSES = [
  { value: 'present', label: 'Present', short: 'P' },
  { value: 'half_day', label: 'Half day', short: 'H' },
  { value: 'absent', label: 'Absent', short: 'A' },
  { value: 'leave', label: 'Leave', short: 'L' },
  { value: 'week_off', label: 'Week off', short: 'WO' },
  { value: 'holiday', label: 'Holiday', short: 'HO' },
];

const shift = (ymd, days) => {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function Attendance() {
  const { api, slug, can, href } = useWorkspace();
  const toast = useToast();
  const [day, setDay] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, loading, mutate, reload } = useResource(`attendance:${slug}:day:${day}`, () => api.get('/attendance/day', { date: day }));
  const canMark = can('staff', 'approve');

  async function mark(staffId, status) {
    try {
      const { entry } = await api.put(`/attendance/${staffId}/${data.date}`, { status });
      mutate((prev) => ({ ...prev, rows: prev.rows.map((r) => (r.staff._id === staffId ? { ...r, entry } : r)) }));
      invalidate(`dashboard:${slug}`);
      invalidate(`attendance:${slug}:register`);
    } catch (error) { toast(error.message, 'error'); }
  }

  /**
   * One request for the whole day, not one per person. On an ordinary day almost
   * everybody is present, so this is the tap that records the morning.
   */
  async function markAll(status, who = 'unmarked') {
    const rows = who === 'all' ? data.rows : data.rows.filter((r) => !r.entry);
    if (!rows.length) return;
    setBusy(true);
    try {
      await api.put('/attendance/day', { date: data.date, marks: rows.map((r) => ({ staff: r.staff._id, status })) });
      invalidate(`attendance:${slug}:day:${day}`);
      invalidate(`attendance:${slug}:register`);
      invalidate(`dashboard:${slug}`);
      reload();
      toast(`${rows.length} ${rows.length === 1 ? 'person' : 'people'} marked ${STATUSES.find((x) => x.value === status)?.label.toLowerCase()}`);
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  }

  if (loading && !data) return <SkeletonRows />;
  if (!data) return null;
  const isToday = data.date === data.today;

  return (
    <>
      <div className="toolbar">
        <Button variant="secondary" size="sm" icon={<ChevronLeft />} aria-label="Previous day" onClick={() => setDay(shift(data.date, -1))} />
        <input type="date" className="input input-sm" style={{ width: 160 }} value={data.date} max={data.today} onChange={(e) => setDay(e.target.value)} aria-label="Day" />
        <Button variant="secondary" size="sm" icon={<ChevronRight />} aria-label="Next day" disabled={isToday} onClick={() => setDay(shift(data.date, 1))} />
        {!isToday ? <Button variant="ghost" size="sm" onClick={() => setDay('')}>Today</Button> : null}
        <div className="grow" />
        <span className="small muted">{data.counts.present} present · {data.counts.absent} absent · {data.counts.leave} leave · {data.counts.unmarked} unmarked</span>
        {canMark && data.counts.unmarked ? (
          <Button size="sm" loading={busy} onClick={() => markAll('present')}>
            Mark {data.counts.unmarked === data.rows.length ? 'everyone' : `the other ${data.counts.unmarked}`} present
          </Button>
        ) : null}
        {canMark && data.rows.length ? (
          <Menu align="right" trigger={({ toggle }) => <Button size="sm" variant="secondary" onClick={toggle}>Mark all…</Button>}>
            <div className="menu-label">Everyone not yet marked</div>
            {STATUSES.map((s) => <MenuItem key={s.value} onClick={() => markAll(s.value)}>{s.label}</MenuItem>)}
            <div className="menu-sep" />
            <MenuItem onClick={() => markAll('present', 'all')}>Everyone present, overwriting</MenuItem>
          </Menu>
        ) : null}
      </div>
      {!data.rows.length ? <EmptyState icon={<Users />} title="Nobody here yet" action={<ButtonLink href={href('/staff/new')} icon={<Plus />}>Add a person</ButtonLink>}>Add the people who work here — they do not need a Texor account.</EmptyState> : (
        <div className="table-wrap">
          <CardTable>
            <thead><tr><th>Name</th><th>Shift</th><th>Check-in / out</th><th>Status</th>{canMark ? <th>Mark</th> : null}</tr></thead>
            <tbody>
              {data.rows.map(({ staff, entry }) => (
                <tr key={staff._id}>
                  <td><Link href={href(`/staff/${staff._id}`)} className="row" style={{ color: 'inherit' }}><Avatar name={staff.name} src={fileUrl(staff.photo)} /><span><span className="cell-title">{staff.name}</span><div className="cell-sub">{staff.designation}{staff.member ? ' · signs in' : ''}</div></span></Link></td>
                  <td className="muted nowrap">{staff.shiftStart ? `${staff.shiftStart}–${staff.shiftEnd || '…'}` : '—'}</td>
                  <td className="nowrap small">{entry?.checkIn ? dateTime(entry.checkIn) : '—'}{entry?.checkOut ? ` → ${dateTime(entry.checkOut)}` : ''}{entry?.late ? <> <Badge tone="amber" plain>Late</Badge></> : null}{entry?.source === 'self' ? <div className="tiny subtle">Self check-in</div> : null}</td>
                  <td>{entry ? <StatusBadge status={entry.status} /> : <span className="subtle">Not marked</span>}</td>
                  {canMark ? (
                    <td>
                      <div className="segmented" role="group" aria-label={`Mark ${staff.name}`}>
                        {STATUSES.slice(0, 4).map((s) => <button key={s.value} type="button" aria-pressed={entry?.status === s.value} title={s.label} onClick={() => mark(staff._id, s.value)}>{s.short}</button>)}
                        <Menu align="right" trigger={({ toggle }) => <button type="button" onClick={toggle} aria-label="More statuses">…</button>}>
                          {STATUSES.slice(4).map((s) => <MenuItem key={s.value} onClick={() => mark(staff._id, s.value)}>{s.label}</MenuItem>)}
                        </Menu>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </CardTable>
        </div>
      )}
    </>
  );
}

/** Why a figure is what it is, on hover — the divisor is the part people query. */
const payNote = (pay) => (pay.kind === 'daily'
  ? `${pay.payableDays} payable days`
  : `${pay.payableDays} payable · ${pay.lopDays} lost, at a day = pay ÷ ${pay.basis}`);

export function Register() {
  const { api, slug, can, currency, module: moduleOf } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const [month, setMonth] = useState('');
  const [billing, setBilling] = useState(false);
  const { data, loading, mutate } = useResource(`attendance:${slug}:register:${month}`, () => api.get('/attendance/register', { month }));
  const canMark = can('staff', 'approve');
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const paid = (data?.staff ?? []).some((s) => s.pay);
  const wagesMinor = (data?.staff ?? []).reduce((sum, s) => sum + (s.pay?.amountMinor ?? 0), 0);
  const expenses = moduleOf('expenses');

  /** Wages are money out; this is the one line that makes them show up as such. */
  async function recordWages() {
    const label = new Date(`${data.month}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    if (!(await confirm({
      title: `Record ${money(wagesMinor, currency)} as an expense?`,
      message: `One expense for wages in ${label}. It does not mark anyone as paid — Finvoice does not run payroll.`,
      confirmLabel: 'Record it',
    }))) return;
    setBilling(true);
    try {
      await api.post('/records/expenses', {
        description: `Wages — ${label}`, date: `${data.month}-01`, amountMinor: wagesMinor, category: 'Salaries & wages',
      });
      invalidate(`records:${slug}:expenses`);
      toast('Recorded in Expenses');
    } catch (error) { toast(error.message, 'error'); } finally { setBilling(false); }
  }

  const monthShift = (delta) => {
    const [y, m] = data.month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  async function cycle(staff, day) {
    const current = staff.marks[day]?.status;
    const order = ['present', 'absent', 'half_day', 'leave', 'week_off', 'holiday'];
    const next = order[(order.indexOf(current) + 1) % order.length];
    const ymd = `${data.month}-${String(day).padStart(2, '0')}`;
    try {
      await api.put(`/attendance/${staff._id}/${ymd}`, { status: next });
      mutate((prev) => ({ ...prev, staff: prev.staff.map((s) => (s._id === staff._id ? { ...s, marks: { ...s.marks, [day]: { ...(s.marks[day] ?? {}), status: next } } } : s)) }));
      invalidate(`attendance:${slug}:day`);
    } catch (error) { toast(error.message, 'error'); }
  }

  if (loading && !data) return <SkeletonRows />;
  if (!data) return null;
  const [y, m] = data.month.split('-').map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="toolbar">
        <Button variant="secondary" size="sm" icon={<ChevronLeft />} aria-label="Previous month" onClick={() => monthShift(-1)} />
        <strong style={{ minWidth: 130, textAlign: 'center' }}>{label}</strong>
        <Button variant="secondary" size="sm" icon={<ChevronRight />} aria-label="Next month" onClick={() => monthShift(1)} />
        <div className="grow" />
        <span className="tiny subtle">{canMark ? 'Click a day to change it. ' : ''}P present · A absent · H half day · L leave · WO week off · HO holiday</span>
        {can('staff', 'export') ? <a className="btn btn-secondary btn-sm" href={api.url(`/attendance/register/export?month=${data.month}`)}><Download />CSV</a> : null}
        {paid && expenses && can('expenses', 'create') && wagesMinor ? (
          <Button size="sm" variant="secondary" loading={billing} onClick={recordWages}>Record {money(wagesMinor, currency)} as an expense</Button>
        ) : null}
      </div>
      <div className="table-wrap" style={{ maxHeight: '70vh' }}>
        <table className="register">
          <thead>
            <tr>
              <th className="name">Staff</th>
              {Array.from({ length: data.days }, (_, i) => { const d = new Date(y, m - 1, i + 1); return <th key={i} className={[0, 6].includes(d.getDay()) ? 'weekend' : ''}>{i + 1}<div className="tiny subtle">{d.toLocaleDateString('en-IN', { weekday: 'narrow' })}</div></th>; })}
              <th style={{ padding: '0 0.5rem' }}>P</th><th style={{ padding: '0 0.5rem' }}>A</th><th style={{ padding: '0 0.5rem' }}>L</th><th style={{ padding: '0 0.5rem' }}>Payable</th>
              {paid ? <th style={{ padding: '0 0.5rem' }} className="num">Pay</th> : null}
            </tr>
          </thead>
          <tbody>
            {data.staff.map((s) => (
              <tr key={s._id}>
                <td className="name"><span className="strong">{s.name}</span> <span className="subtle tiny">{s.designation}</span></td>
                {Array.from({ length: data.days }, (_, i) => {
                  const day = i + 1;
                  const mark = s.marks[day];
                  const future = `${data.month}-${String(day).padStart(2, '0')}` > todayKey;
                  const short = STATUSES.find((x) => x.value === mark?.status)?.short;
                  return (
                    <td key={day}>
                      <button type="button" className={`mark${mark ? ` mark-${mark.status}` : ''}`} disabled={!canMark || future} onClick={() => cycle(s, day)} title={mark ? `${STATUSES.find((x) => x.value === mark.status)?.label}${mark.late ? ' (late)' : ''}` : 'Not marked'}>
                        {short ?? ''}{mark?.late ? '•' : ''}
                      </button>
                    </td>
                  );
                })}
                <td className="num strong">{s.totals.present}</td><td className="num">{s.totals.absent}</td><td className="num">{s.totals.leave}</td><td className="num strong">{s.totals.payable}</td>
                {paid ? (
                  <td className="num" title={s.pay ? payNote(s.pay) : undefined}>
                    {s.pay ? money(s.pay.amountMinor, currency) : <span className="subtle">—</span>}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

