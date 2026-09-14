'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Loading, StatusPill, formatDate, formatMoney } from '@/components/ui';
import { payRuns as payRunApi } from '@/lib/api';

export default function PayRunDetailPage({ params }) {
  const { id } = use(params);
  return <AppShell><PayRunDetail id={id} /></AppShell>;
}

function PayRunDetail({ id }) {
  const router = useRouter();
  const [payRun, setPayRun] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    payRunApi.get(id)
      .then((data) => setPayRun(data.payRun))
      .catch((loadError) => setError(loadError.message));
  }, [id]);

  async function act(kind, fn, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;

    setBusy(kind);
    setError(null);
    try {
      const result = await fn();
      if (result?.payRun) setPayRun(result.payRun);
      else router.push('/pay-runs');
    } catch (actError) {
      setError(actError.message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !payRun) {
    return (
      <>
        <a href="/pay-runs" className="meta">&larr; Back to pay runs</a>
        <div style={{ marginTop: '1rem' }}><Alert kind="error">{error}</Alert></div>
      </>
    );
  }

  if (!payRun) return <Loading label="Loading pay run" />;

  const isDraft = payRun.status === 'draft';

  return (
    <>
      <div style={{ marginBottom: '1.5rem' }}>
        <a href="/pay-runs" className="meta">&larr; Back to pay runs</a>
        <div className="row row--between row--wrap" style={{ marginTop: '0.5rem' }}>
          <div className="row">
            <h1>{payRun.label}</h1>
            <StatusPill status={payRun.status === 'approved' ? 'sent' : payRun.status} />
          </div>
          <div className="meta">
            {formatDate(payRun.periodStart)} – {formatDate(payRun.periodEnd)} · paid {formatDate(payRun.payDate)}
          </div>
        </div>
      </div>

      <Alert kind="error">{error}</Alert>

      <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat">
          <div className="stat__label">Gross</div>
          <div className="stat__value">{formatMoney(payRun.totalGross, payRun.currency)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Tax</div>
          <div className="stat__value">{formatMoney(payRun.totalTax, payRun.currency)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Pension</div>
          <div className="stat__value">{formatMoney(payRun.totalPension, payRun.currency)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Net pay</div>
          <div className="stat__value">{formatMoney(payRun.totalNet, payRun.currency)}</div>
        </div>
      </div>

      <section className="panel">
        <div className="panel__header row row--between row--wrap">
          <div>
            <h2>Payslips</h2>
            <p>{payRun.payslips.length} employee{payRun.payslips.length === 1 ? '' : 's'} in this run.</p>
          </div>

          <div className="row" style={{ gap: '0.5rem' }}>
            {isDraft ? (
              <>
                <Button variant="secondary" size="sm" loading={busy === 'recalc'}
                  onClick={() => act('recalc', () => payRunApi.recalculate(id))}>
                  Recalculate
                </Button>
                <Button size="sm" loading={busy === 'approve'}
                  onClick={() => act('approve', () => payRunApi.approve(id),
                    'Approve this pay run? The figures will be locked.')}>
                  Approve
                </Button>
              </>
            ) : payRun.status === 'approved' ? (
              <Button size="sm" loading={busy === 'paid'}
                onClick={() => act('paid', () => payRunApi.markPaid(id))}>
                Mark as paid
              </Button>
            ) : null}
          </div>
        </div>

        <div className="table__scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="num">Gross</th><th className="num">Tax</th>
                <th className="num">Pension</th><th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {payRun.payslips.map((slip) => (
                <tr key={slip.employee}>
                  <td>
                    <strong>{slip.employeeName}</strong>
                    {slip.jobTitle ? <div className="meta">{slip.jobTitle}</div> : null}
                  </td>
                  <td className="num">{formatMoney(slip.gross, payRun.currency)}</td>
                  <td className="num">{formatMoney(slip.tax, payRun.currency)}</td>
                  <td className="num">{formatMoney(slip.pension, payRun.currency)}</td>
                  <td className="num"><strong>{formatMoney(slip.net, payRun.currency)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isDraft ? (
          <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
            <Button variant="danger" size="sm" loading={busy === 'delete'}
              onClick={() => act('delete', () => payRunApi.remove(id), 'Delete this draft pay run?')}>
              Delete draft
            </Button>
          </div>
        ) : (
          <p className="meta" style={{ marginTop: '1.5rem' }}>
            This run was approved{payRun.approvedAt ? ` on ${formatDate(payRun.approvedAt)}` : ''} and is now a
            permanent record. Create a new run to make changes.
          </p>
        )}
      </section>
    </>
  );
}
