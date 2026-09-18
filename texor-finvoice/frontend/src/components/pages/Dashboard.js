'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarCheck, FileClock, Hourglass, IndianRupee, LogIn, LogOut, Package, ShieldAlert, TrendingUp, Wallet } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { Badge, Button, ButtonLink, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { invalidate, useResource } from '@/lib/data';
import { date, dateTime, money, plural } from '@/lib/format';
import { screenFor, useWorkspace } from '@/lib/workspace';

function Delta({ now, before }) {
  if (!before) return null;
  const change = ((now - before) / before) * 100;
  const up = change >= 0;
  return <span className={up ? 'delta-up' : 'delta-down'}>{up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(change).toFixed(0)}%</span>;
}

function Sparkline({ days }) {
  const max = Math.max(...days.map((d) => d.totalMinor), 1);
  const points = days.map((d, i) => `${(i / (days.length - 1)) * 100},${40 - (d.totalMinor / max) * 36}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={`0,42 ${points} 100,42`} fill="rgb(31 191 147 / 12%)" stroke="none" />
      <polyline points={points} fill="none" stroke="var(--brand-500)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function MyAttendance() {
  const { api, slug } = useWorkspace();
  const toast = useToast();
  const { data, reload } = useResource(`attendance-me:${slug}`, () => api.get('/attendance/me'));
  if (!data?.staff) return null;
  const entry = data.entry;
  async function punch(direction) {
    const location = await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), () => resolve(null), { timeout: 4000 });
    });
    try {
      await api.post(`/attendance/me/check-${direction}`, { location });
      toast(direction === 'in' ? 'Checked in — have a good day' : 'Checked out');
      reload();
      invalidate(`dashboard:${slug}`);
    } catch (error) { toast(error.message, 'error'); }
  }
  return (
    <div className="card card-pad row row-between wrap">
      <div className="row"><CalendarCheck size={18} color="var(--brand-600)" /><div><div className="strong">Your attendance today</div><div className="small muted">{entry?.checkIn ? `In at ${dateTime(entry.checkIn)}${entry.checkOut ? ` · out at ${dateTime(entry.checkOut)}` : ''}${entry.late ? ' · late' : ''}` : 'Not checked in yet'}</div></div></div>
      {!entry?.checkIn ? <Button icon={<LogIn />} onClick={() => punch('in')}>Check in</Button> : !entry.checkOut ? <Button variant="secondary" icon={<LogOut />} onClick={() => punch('out')}>Check out</Button> : <Badge tone="green">Done for today</Badge>}
    </div>
  );
}

const WIDGETS = {
  sales_today: ({ data, currency }) => (
    <div className="card stat"><div className="stat-label"><IndianRupee />Today's sales</div><div className="stat-value">{money(data.totalMinor, currency)}</div><div className="stat-foot">{plural(data.count, 'bill')} <Delta now={data.totalMinor} before={data.previousMinor} /> vs yesterday</div></div>
  ),
  sales_month: ({ data, currency }) => (
    <div className="card stat"><div className="stat-label"><TrendingUp />Last 30 days</div><div className="stat-value">{money(data.totalMinor, currency)}</div><div className="stat-foot"><Delta now={data.totalMinor} before={data.previousMinor} /> vs previous 30 days</div><Sparkline days={data.days} /></div>
  ),
  receivables: ({ data, currency, href }) => (
    <Link href={href('/invoices?state=unpaid')} className="card stat" style={{ color: 'inherit', textDecoration: 'none' }}>
      <div className="stat-label"><Wallet />To collect</div><div className="stat-value">{money(data.dueMinor, currency)}</div>
      <div className="stat-foot">{plural(data.count, 'unpaid invoice')}{data.overdueCount ? <> · <span style={{ color: 'var(--danger)' }}>{money(data.overdueMinor, currency)} overdue</span></> : null}</div>
    </Link>
  ),
  quotes_open: ({ data, currency, module }) => (
    <div className="card stat"><div className="stat-label"><FileClock />Open {module('quotations')?.label.toLowerCase() ?? 'quotations'}</div><div className="stat-value">{money(data.totalMinor, currency)}</div><div className="stat-foot">{data.count} awaiting a decision{data.expiringThisWeek ? ` · ${data.expiringThisWeek} expire this week` : ''}</div></div>
  ),
  attendance_today: ({ data, href }) => (
    <Link href={href('/staff')} className="card stat" style={{ color: 'inherit', textDecoration: 'none' }}>
      <div className="stat-label"><CalendarCheck />Attendance today</div>
      <div className="stat-value">{data.present}<span className="muted" style={{ fontSize: '1rem' }}> / {data.total}</span></div>
      <div className="stat-foot">{data.absent} absent · {data.leave} on leave{data.unmarked ? ` · ${data.unmarked} not marked` : ''}{data.late ? ` · ${data.late} late` : ''}</div>
    </Link>
  ),
  receivables_aging: ({ data, currency, href }) => {
    const bars = [
      { key: 'current', label: 'Not due', minor: data.current, tone: 'var(--brand-400)' },
      { key: 'd30', label: '1–30 days', minor: data.d30, tone: '#e8b923' },
      { key: 'd60', label: '31–60', minor: data.d60, tone: '#e08b2f' },
      { key: 'd90', label: '61–90', minor: data.d90, tone: '#d9603c' },
      { key: 'older', label: '90+', minor: data.older, tone: 'var(--danger)' },
    ].filter((b) => b.minor > 0);
    return (
      <section className="card span-2">
        <div className="card-header">
          <h2 className="row"><Hourglass size={16} />How old the money is</h2>
          <span className="small muted">{money(data.totalMinor, currency)} outstanding</span>
        </div>
        <div className="card-body stack-sm">
          {bars.length ? (
            <>
              <div className="aging-bar" role="img" aria-label={bars.map((b) => `${b.label} ${money(b.minor, currency)}`).join(', ')}>
                {bars.map((b) => <span key={b.key} style={{ width: `${(b.minor / data.totalMinor) * 100}%`, background: b.tone }} />)}
              </div>
              <div className="aging-key">
                {bars.map((b) => (
                  <Link key={b.key} href={href(b.key === 'current' ? '/invoices?state=unpaid' : '/invoices?state=overdue')} className="aging-key-item">
                    <span className="aging-dot" style={{ background: b.tone }} />
                    <span className="grow">{b.label}</span>
                    <span className="num">{money(b.minor, currency)}</span>
                  </Link>
                ))}
              </div>
            </>
          ) : <p className="small muted">Nothing outstanding. Every invoice is settled.</p>}
        </div>
      </section>
    );
  },
  overdue: ({ data, currency, href }) => (
    <section className="card span-2">
      <div className="card-header"><h2 className="row"><AlertTriangle size={16} color="var(--danger)" />Overdue invoices</h2></div>
      {data.length ? data.map((row) => (
        <Link key={row._id} className="list-row" href={href(`/invoices/${row._id}`)}>
          <span className="grow"><span className="strong">{row.customer}</span> <span className="mono subtle">{row.number}</span></span>
          <Badge tone="red" plain>{row.days}d late</Badge><span className="num strong">{money(row.dueMinor, currency)}</span>
        </Link>
      )) : <div className="list-row muted">Nothing overdue. Nicely done.</div>}
    </section>
  ),
  low_stock: ({ data, href }) => (
    <section className="card">
      <div className="card-header"><h2 className="row"><Package size={16} />Low stock</h2><Link className="small" href={href('/products')}>All</Link></div>
      {data.length ? data.map((item) => (
        <Link key={item._id} className="list-row" href={href(`/products/${item._id}`)}><span className="grow ellipsis">{item.name}</span><span className="num strong" style={{ color: item.stock <= 0 ? 'var(--danger)' : 'var(--warning)' }}>{item.stock} {item.unit}</span></Link>
      )) : <div className="list-row muted">Everything is stocked.</div>}
    </section>
  ),
  warranties_expiring: ({ data, href, module }) => (
    <section className="card">
      <div className="card-header"><h2 className="row"><ShieldAlert size={16} />{module('warranties')?.label ?? 'Warranties'} ending soon</h2></div>
      {data.length ? data.map((w) => (
        <Link key={w._id} className="list-row" href={href(`/warranties/${w._id}`)}><span className="grow"><span className="ellipsis" style={{ display: 'block' }}>{w.itemName}</span><span className="tiny subtle">{w.customer?.name}{w.serial ? ` · ${w.serial}` : ''}</span></span><span className="tiny subtle nowrap">{date(w.endDate)}</span></Link>
      )) : <div className="list-row muted">None in the next 30 days.</div>}
    </section>
  ),
  top_items: ({ data, currency }) => {
    const max = Math.max(...data.map((d) => d.totalMinor), 1);
    return (
      <section className="card">
        <div className="card-header"><h2>Best sellers · 30 days</h2></div>
        {data.length ? data.map((row) => (
          <div key={String(row._id)} className="list-row" style={{ display: 'grid', gap: 4 }}>
            <div className="row row-between"><span className="ellipsis">{row.name}</span><span className="num small strong">{money(row.totalMinor, currency)}</span></div>
            <div className="bar"><span style={{ width: `${(row.totalMinor / max) * 100}%` }} /></div>
          </div>
        )) : <div className="list-row muted">No sales yet.</div>}
      </section>
    );
  },
  payment_modes_today: ({ data, currency }) => (
    <section className="card">
      <div className="card-header"><h2>Collected today by mode</h2></div>
      {data.length ? data.map((row) => <div key={row._id} className="list-row"><span className="grow">{row._id}</span><span className="subtle tiny">{plural(row.count, 'payment')}</span><span className="num strong">{money(row.amountMinor, currency)}</span></div>) : <div className="list-row muted">No payments yet today.</div>}
    </section>
  ),
  recent_invoices: ({ data, currency, href }) => (
    <section className="card">
      <div className="card-header"><h2>Recent invoices</h2></div>
      {data.map((d) => <Link key={d._id} className="list-row" href={href(`/invoices/${d._id}`)}><span className="grow">{d.billTo?.name}<div className="tiny mono subtle">{d.number ?? 'Draft'}</div></span><StatusBadge status={d.status} /><span className="num">{money(d.totals.totalMinor, currency)}</span></Link>)}
    </section>
  ),
};

function BoardWidget({ data, href, module }) {
  const m = module(data.module);
  return (
    <section className="card span-2">
      <div className="card-header"><h2 className="row"><Icon name={m?.icon} size={16} />{data.label}</h2><Link className="small" href={href(`/${data.module}`)}>Open board</Link></div>
      <div className="card-body board-mini">
        {data.columns.map((c) => <Link key={c.value} href={href(`/${data.module}`)} style={{ color: 'inherit', textDecoration: 'none' }}><div><strong>{c.count}</strong><span>{c.label}</span></div></Link>)}
      </div>
    </section>
  );
}

export function Dashboard() {
  const { api, slug, href, workspace, member, user, industry, currency, module, modules, can } = useWorkspace();
  const { data, loading } = useResource(`dashboard:${slug}`, () => api.get('/dashboard'));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const quick = modules.filter((m) => ['records', 'documents'].includes(screenFor(m)) && can(m.key, 'create')).slice(0, 4);
  const ctx = { currency, href, module };
  const stats = (data?.widgets ?? []).filter((w) => ['sales_today', 'sales_month', 'receivables', 'quotes_open', 'attendance_today'].includes(w.key));
  const panels = (data?.widgets ?? []).filter((w) => !stats.includes(w));

  return (
    <div className="stack-lg">
      <div className="hero">
        <div className="row row-between wrap" style={{ gap: '1rem' }}>
          <div>
            <div className="row" style={{ gap: 6, color: 'var(--brand-300)', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}><Icon name={industry?.icon} size={14} />{industry?.name}</div>
            <h1 style={{ marginTop: 6 }}>{greeting}, {(user?.displayName ?? member.name).split(' ')[0]}</h1>
            <p style={{ marginTop: 4 }}>Here is how {workspace.name} is doing.</p>
          </div>
          <div className="row wrap">
            {quick.map((m) => <ButtonLink key={m.key} href={href(`/${m.key}/new`)} variant="secondary" size="sm" icon={<Icon name={m.icon} />}>New {m.labelSingular.toLowerCase()}</ButtonLink>)}
          </div>
        </div>
      </div>

      <MyAttendance />

      {loading && !data ? <div className="card"><SkeletonRows rows={6} /></div> : null}

      {stats.length ? (
        <div className="grid-4">{stats.map((w) => <div key={w.key} style={{ display: 'contents' }}>{WIDGETS[w.key]({ data: w.data, ...ctx })}</div>)}</div>
      ) : null}

      {panels.length ? (
        <div className="grid-3">
          {panels.map((w) => (w.key.startsWith('board:')
            ? <BoardWidget key={w.key} data={w.data} {...ctx} />
            : <div key={w.key} style={{ display: 'contents' }}>{WIDGETS[w.key]?.({ data: w.data, ...ctx })}</div>))}
        </div>
      ) : null}
    </div>
  );
}
