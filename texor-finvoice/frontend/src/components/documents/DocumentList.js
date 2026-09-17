'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { ButtonLink, EmptyState, PageHeader, Pagination, SkeletonRows, StatusBadge, Tabs } from '@/components/ui';
import { useDebounced, useResource } from '@/lib/data';
import { date, money } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';

const TABS = {
  invoices: [
    { value: '', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'unpaid', label: 'Unpaid' },
    { value: 'overdue', label: 'Overdue' }, { value: 'partial', label: 'Partly paid' }, { value: 'paid', label: 'Paid' }, { value: 'void', label: 'Void' },
  ],
  quotations: [
    { value: '', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'sent', label: 'Sent' }, { value: 'accepted', label: 'Accepted' },
    { value: 'expired', label: 'Expired' }, { value: 'declined', label: 'Declined' }, { value: 'converted', label: 'Converted' },
  ],
};

export function DocumentList({ module }) {
  const { api, slug, href, can, currency } = useWorkspace();
  const router = useRouter();
  const kind = module.key;
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  useEffect(() => setPage(1), [state, search, from, to]);

  const params = useMemo(() => ({ state, q: search, from, to: to ? `${to}T23:59:59` : '', page }), [state, search, from, to, page]);
  const { data, loading, error } = useResource(`documents:${slug}:${kind}:${JSON.stringify(params)}`, () => api.get(`/documents/${kind}`, params));
  const isInvoice = kind === 'invoices';
  const printable = module.fields.filter((f) => f.custom && f.printable && ['text', 'select'].includes(f.type)).slice(0, 1);

  return (
    <>
      <PageHeader
        title={module.label}
        actions={can(kind, 'create') ? <ButtonLink href={href(`/${kind}/new`)} icon={<Plus />}>New {module.labelSingular.toLowerCase()}</ButtonLink> : null}
      />

      {data ? (
        <div className="grid-3" style={{ marginBottom: '1rem' }}>
          <div className="card stat"><div className="stat-label">{state ? TABS[kind].find((t) => t.value === state)?.label : 'All'} · total</div><div className="stat-value">{money(data.sums.totalMinor, currency)}</div><div className="stat-foot">{data.total} {data.total === 1 ? module.labelSingular.toLowerCase() : module.label.toLowerCase()}</div></div>
          {isInvoice ? <div className="card stat"><div className="stat-label">Received</div><div className="stat-value">{money(data.sums.paidMinor, currency)}</div></div> : null}
          {isInvoice ? <div className="card stat"><div className="stat-label">Still owed</div><div className="stat-value">{money(data.sums.totalMinor - data.sums.paidMinor, currency)}</div></div> : null}
        </div>
      ) : null}

      <div className="card">
        <div style={{ padding: '0 0.9rem' }}><Tabs tabs={TABS[kind]} value={state} onChange={setState} /></div>
        <div className="toolbar">
          <div className="input-icon grow" style={{ maxWidth: 360 }}>
            <Search aria-hidden="true" />
            <input className="input" placeholder="Search number, customer or phone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          <input type="date" className="input" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <span className="muted small">to</span>
          <input type="date" className="input" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>

        {error ? <div className="card-body"><div className="alert alert-error">{error.message}</div></div> : null}
        {loading && !data ? <SkeletonRows /> : null}
        {data && !data.documents.length ? (
          <EmptyState icon={<Icon name={module.icon} />} title={state || q ? `No ${module.label.toLowerCase()} match` : `No ${module.label.toLowerCase()} yet`}
            action={!state && !q && can(kind, 'create') ? <ButtonLink href={href(`/${kind}/new`)} icon={<Plus />}>Create your first {module.labelSingular.toLowerCase()}</ButtonLink> : null} />
        ) : null}

        {data?.documents.length ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th><th>Customer</th>{printable.map((f) => <th key={f.key}>{f.label}</th>)}<th>Date</th><th>{isInvoice ? 'Due' : 'Valid until'}</th><th>Status</th>
                    <th className="num">Amount</th>{isInvoice ? <th className="num">Balance</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.documents.map((d) => (
                    <tr key={d._id} className="clickable" onClick={() => router.push(href(`/${kind}/${d._id}`))}>
                      <td><Link href={href(`/${kind}/${d._id}`)} className="cell-title mono" onClick={(e) => e.stopPropagation()}>{d.number ?? 'Draft'}</Link></td>
                      <td><div className="cell-title">{d.billTo?.name}</div>{d.billTo?.phone ? <div className="cell-sub">{d.billTo.phone}</div> : null}</td>
                      {printable.map((f) => <td key={f.key}>{f.options?.find((o) => o.value === d.custom?.[f.key])?.label ?? d.custom?.[f.key] ?? '—'}</td>)}
                      <td className="nowrap">{date(d.date)}</td>
                      <td className="nowrap">{date(isInvoice ? d.dueDate : d.validUntil)}</td>
                      <td><StatusBadge status={d.state} /></td>
                      <td className="num strong">{money(d.totals.totalMinor, currency)}</td>
                      {isInvoice ? <td className="num">{d.status === 'void' || d.status === 'draft' ? <span className="subtle">—</span> : money(d.amountDueMinor, currency)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        ) : null}
      </div>
    </>
  );
}
