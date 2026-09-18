'use client';

/**
 * A customer's statement of account: everything that moved their balance
 * between two dates, with a running total. Derived from the documents
 * themselves, so it can never disagree with them.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { SkeletonRows } from '@/components/ui';
import { useResource } from '@/lib/data';
import { date, money } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';

const iso = (d) => d.toISOString().slice(0, 10);
const HREF = { invoice: 'invoices', credit_note: 'credit_notes', debit_note: 'debit_notes' };

export function Statement({ customerId }) {
  const { api, slug, href, currency, can } = useWorkspace();
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 89 * 86400000)));
  const [to, setTo] = useState(() => iso(new Date()));
  const { data, loading } = useResource(
    `statement:${slug}:${customerId}:${from}:${to}`,
    () => api.get(`/customers/${customerId}/statement`, { from, to }),
  );

  const buckets = data?.aging
    ? [
      { label: 'Not due', minor: data.aging.current }, { label: '1–30', minor: data.aging.d30 },
      { label: '31–60', minor: data.aging.d60 }, { label: '61–90', minor: data.aging.d90 },
      { label: '90+', minor: data.aging.older },
    ].filter((b) => b.minor > 0)
    : [];

  return (
    <section className="card">
      <div className="card-header"><h2>Statement of account</h2></div>
      <div className="toolbar">
        <input type="date" className="input input-sm" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <span className="muted small">to</span>
        <input type="date" className="input input-sm" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <div className="grow" />
        {can('customers', 'export') ? (
          <a className="btn btn-secondary btn-sm" href={api.url(`/customers/${customerId}/statement/export?from=${from}&to=${to}`)}><Download />CSV</a>
        ) : null}
      </div>

      {loading && !data ? <SkeletonRows rows={6} /> : null}
      {data ? (
        <>
          {buckets.length ? (
            <div className="card-body" style={{ paddingBottom: 0 }}>
              <div className="row wrap" style={{ gap: '0.4rem' }}>
                <span className="small muted">Outstanding by age:</span>
                {buckets.map((b) => <span key={b.label} className="tag">{b.label} · {money(b.minor, currency)}</span>)}
              </div>
            </div>
          ) : null}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Document</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                <tr className="subtle"><td>{date(data.from)}</td><td>Opening balance</td><td /><td /><td className="num">{money(data.openingMinor, currency)}</td></tr>
                {data.rows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td className="nowrap">{date(row.date)}</td>
                    <td>
                      {HREF[row.kind] ? <Link href={href(`/${HREF[row.kind]}/${row.id}`)}>{row.ref || row.description}</Link> : row.description}
                      {HREF[row.kind] && row.ref ? <span className="sub"> · {row.description}</span> : null}
                    </td>
                    <td className="num">{row.debitMinor ? money(row.debitMinor, currency) : <span className="subtle">—</span>}</td>
                    <td className="num">{row.creditMinor ? money(row.creditMinor, currency) : <span className="subtle">—</span>}</td>
                    <td className="num">{money(row.balanceMinor, currency)}</td>
                  </tr>
                ))}
                {!data.rows.length ? <tr><td colSpan={5} className="muted" style={{ padding: '1rem' }}>Nothing moved between these dates.</td></tr> : null}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2}>Closing balance {date(data.to)}</th>
                  <th className="num">{money(data.totals.debitMinor, currency)}</th>
                  <th className="num">{money(data.totals.creditMinor, currency)}</th>
                  <th className="num">{money(data.closingMinor, currency)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
