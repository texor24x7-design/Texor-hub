'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Field, StatusPill, formatDate, formatMoney } from '@/components/ui';
import { payRuns as payRunApi, summary as summaryApi } from '@/lib/api';

export default function PayRunsPage() {
  return <AppShell>{(user) => <PayRunList user={user} />}</AppShell>;
}

/** Defaults the new-run form to the calendar month we are currently in. */
function currentPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (date) => date.toISOString().slice(0, 10);

  return {
    label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    periodStart: iso(start),
    periodEnd: iso(end),
    payDate: iso(end),
    frequency: 'monthly',
  };
}

function PayRunList({ user }) {
  const router = useRouter();
  const [rows, setRows] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const currency = user.payCurrency ?? 'USD';

  const load = useCallback(async () => {
    try {
      const [{ payRuns }, { summary }] = await Promise.all([payRunApi.list(), summaryApi()]);
      setRows(payRuns);
      setStats(summary);
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="row row--between row--wrap" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1>Pay runs</h1>
          <p className="muted">Each run is a frozen record of what was paid, and when.</p>
        </div>
        <Button onClick={() => setCreating((open) => !open)}>
          {creating ? 'Cancel' : 'New pay run'}
        </Button>
      </div>

      {stats ? (
        <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
          <div className="stat">
            <div className="stat__label">Active employees</div>
            <div className="stat__value">{stats.activeEmployees}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Annual payroll</div>
            <div className="stat__value">{formatMoney(stats.annualPayroll, currency)}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Last run</div>
            <div className="stat__value" style={{ fontSize: '1.05rem' }}>
              {stats.lastRun ? stats.lastRun.label : '—'}
            </div>
          </div>
        </div>
      ) : null}

      <Alert kind="error">{error}</Alert>

      {creating ? (
        <NewPayRun
          currency={currency}
          frequency={user.payFrequency}
          onCancel={() => setCreating(false)}
          onCreated={(payRun) => router.push(`/pay-runs/${payRun._id}`)}
        />
      ) : null}

      <section className="panel">
        {rows === null ? (
          <p className="muted">Loading pay runs&hellip;</p>
        ) : rows.length === 0 ? (
          <div className="empty">
            <p>No pay runs yet.</p>
            <p className="meta" style={{ marginTop: '0.5rem' }}>
              Add employees first, then create a run for the current period.
            </p>
          </div>
        ) : (
          <div className="table__scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Period</th><th>Pay date</th><th>Status</th>
                  <th className="num">Gross</th><th className="num">Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((run) => (
                  <tr key={run._id}>
                    <td>
                      <a href={`/pay-runs/${run._id}`}>{run.label}</a>
                      <div className="meta">{formatDate(run.periodStart)} – {formatDate(run.periodEnd)}</div>
                    </td>
                    <td>{formatDate(run.payDate)}</td>
                    <td><StatusPill status={run.status === 'approved' ? 'sent' : run.status} /></td>
                    <td className="num">{formatMoney(run.totalGross, run.currency)}</td>
                    <td className="num">{formatMoney(run.totalNet, run.currency)}</td>
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

function NewPayRun({ currency, frequency, onCancel, onCreated }) {
  const [values, setValues] = useState(() => ({ ...currentPeriod(), frequency: frequency ?? 'monthly', currency }));
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const { payRun } = await payRunApi.create(values);
      onCreated(payRun);
    } catch (createError) {
      setError(createError.message);
      setFieldErrors(createError.fieldErrors ?? {});
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>New pay run</h2>
        <p>Payslips are calculated from every active employee at the moment you create the run.</p>
      </div>

      <form className="stack" onSubmit={submit}>
        <Alert kind="error">{error}</Alert>

        <Field label="Label" htmlFor="label" error={fieldErrors.label}>
          <input id="label" className="input" required value={values.label} onChange={set('label')} />
        </Field>

        <div className="row row--wrap" style={{ gap: '0.75rem' }}>
          <div className="grow">
            <Field label="Period start" htmlFor="periodStart" error={fieldErrors.periodStart}>
              <input id="periodStart" className="input" type="date" required value={values.periodStart} onChange={set('periodStart')} />
            </Field>
          </div>
          <div className="grow">
            <Field label="Period end" htmlFor="periodEnd" error={fieldErrors.periodEnd}>
              <input id="periodEnd" className="input" type="date" required value={values.periodEnd} onChange={set('periodEnd')} />
            </Field>
          </div>
          <div className="grow">
            <Field label="Pay date" htmlFor="payDate" error={fieldErrors.payDate}>
              <input id="payDate" className="input" type="date" required value={values.payDate} onChange={set('payDate')} />
            </Field>
          </div>
          <div className="grow">
            <Field label="Frequency" htmlFor="frequency" hint="Sets how an annual salary is divided.">
              <select id="frequency" className="input" value={values.frequency} onChange={set('frequency')}>
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="monthly">Monthly</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="row" style={{ gap: '0.6rem' }}>
          <Button type="submit" loading={busy}>{busy ? 'Calculating…' : 'Create pay run'}</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </section>
  );
}
