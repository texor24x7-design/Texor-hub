'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, StatusPill, formatDate, formatMoney } from '@/components/ui';
import { invoices as invoiceApi } from '@/lib/api';

const FILTERS = ['all', 'draft', 'sent', 'paid', 'overdue'];

export default function InvoicesPage() {
  return <AppShell>{(user) => <InvoiceList user={user} />}</AppShell>;
}

function InvoiceList({ user }) {
  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [listed, totals] = await Promise.all([
        invoiceApi.list({ status: filter === 'all' ? undefined : filter, search: search || undefined }),
        invoiceApi.summary(),
      ]);
      setRows(listed.invoices);
      setSummary(totals.summary);
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [filter, search]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const currency = user.defaultCurrency ?? 'USD';

  return (
    <>
      <div className="row row--between row--wrap" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1>Invoices</h1>
          <p className="muted">Everything you have billed, across all your clients.</p>
        </div>
        <a href="/invoices/new" className="btn btn--primary">New invoice</a>
      </div>

      {summary ? (
        <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
          <div className="stat">
            <div className="stat__label">Outstanding</div>
            <div className="stat__value">{formatMoney(summary.outstanding, currency)}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Paid</div>
            <div className="stat__value">{formatMoney(summary.paid, currency)}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Drafts</div>
            <div className="stat__value">{summary.draft}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Total invoices</div>
            <div className="stat__value">{summary.count}</div>
          </div>
        </div>
      ) : null}

      <section className="panel">
        <div className="row row--between row--wrap" style={{ marginBottom: '1.25rem', gap: '0.75rem' }}>
          <div className="row" style={{ gap: '0.25rem', flexWrap: 'wrap' }}>
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={`btn btn--sm ${filter === value ? 'btn--secondary' : 'btn--ghost'}`}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All' : value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>

          <input
            className="input"
            style={{ maxWidth: '16rem' }}
            placeholder="Search number or client…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search invoices"
          />
        </div>

        <Alert kind="error">{error}</Alert>

        {rows === null ? (
          <p className="muted">Loading invoices&hellip;</p>
        ) : rows.length === 0 ? (
          <div className="empty">
            <p>{search || filter !== 'all' ? 'No invoices match that.' : 'No invoices yet.'}</p>
            {!search && filter === 'all' ? (
              <p style={{ marginTop: '0.75rem' }}>
                <a href="/invoices/new" className="btn btn--primary">Create your first invoice</a>
              </p>
            ) : null}
          </div>
        ) : (
          <div className="table__scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Client</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => (
                  <tr key={invoice._id}>
                    <td><a href={`/invoices/${invoice._id}`}>{invoice.number}</a></td>
                    <td>
                      {invoice.client.name}
                      {invoice.client.email ? <div className="meta">{invoice.client.email}</div> : null}
                    </td>
                    <td>{formatDate(invoice.issueDate)}</td>
                    <td>{formatDate(invoice.dueDate)}</td>
                    <td><StatusPill status={invoice.status} /></td>
                    <td className="num">{formatMoney(invoice.total, invoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
