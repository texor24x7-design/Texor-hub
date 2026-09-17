'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Wallet } from 'lucide-react';
import { Badge, EmptyState, PageHeader, Pagination, SkeletonRows } from '@/components/ui';
import { useDebounced, useResource } from '@/lib/data';
import { date, money } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';

export function Payments({ module }) {
  const { api, slug, href, currency, prefs } = useWorkspace();
  const [mode, setMode] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  useEffect(() => setPage(1), [mode, search, from, to]);
  const params = useMemo(() => ({ mode, q: search, from, to: to ? `${to}T23:59:59` : '', page }), [mode, search, from, to, page]);
  const { data, loading } = useResource(`payments:${slug}:${JSON.stringify(params)}`, () => api.get('/payments', params));
  const total = (data?.byMode ?? []).reduce((a, m) => a + m.amountMinor, 0);

  return (
    <>
      <PageHeader title={module.label} description="Money received against invoices. Record payments from an invoice." />
      {data?.byMode.length ? (
        <div className="grid-4" style={{ marginBottom: '1rem' }}>
          <div className="card stat"><div className="stat-label">Collected</div><div className="stat-value">{money(total, currency)}</div><div className="stat-foot">{data.total} payments</div></div>
          {data.byMode.slice(0, 3).map((m) => (
            <button key={m.mode} type="button" className="card stat" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => setMode(mode === m.mode ? '' : m.mode)}>
              <div className="stat-label">{m.mode}</div><div className="stat-value">{money(m.amountMinor, currency)}</div><div className="stat-foot">{Math.round((m.amountMinor / total) * 100)}% · {m.count} payments</div>
            </button>
          ))}
        </div>
      ) : null}
      <div className="card">
        <div className="toolbar">
          <div className="input-icon grow" style={{ maxWidth: 320 }}><Search aria-hidden="true" /><input className="input" placeholder="Search invoice, customer, UTR…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
          <select className="input" style={{ width: 'auto' }} value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode"><option value="">All modes</option>{(prefs.paymentModes ?? []).map((m) => <option key={m}>{m}</option>)}</select>
          <input type="date" className="input" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <span className="muted small">to</span>
          <input type="date" className="input" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </div>
        {loading && !data ? <SkeletonRows /> : null}
        {data && !data.payments.length ? <EmptyState icon={<Wallet />} title="No payments recorded">Open an issued invoice and choose “Record payment”.</EmptyState> : null}
        {data?.payments.length ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Customer</th><th>Invoice</th><th>Mode</th><th>Reference</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p._id}>
                      <td className="nowrap">{date(p.date)}</td>
                      <td><Link href={href(`/customers/${p.customer}`)}>{data.customers[p.customer] ?? '—'}</Link></td>
                      <td><Link className="mono" href={href(`/invoices/${p.invoice}`)}>{p.invoiceNumber}</Link></td>
                      <td><Badge tone="neutral" plain>{p.mode}</Badge></td>
                      <td className="muted">{p.reference || '—'}</td>
                      <td className="num strong">{money(p.amountMinor, currency)}</td>
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
