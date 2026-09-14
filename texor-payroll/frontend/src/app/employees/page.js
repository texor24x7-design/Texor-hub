'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Field, StatusPill, formatMoney } from '@/components/ui';
import { employees as employeeApi } from '@/lib/api';

export default function EmployeesPage() {
  return <AppShell>{(user) => <EmployeeRegister user={user} />}</AppShell>;
}

const blank = {
  firstName: '', lastName: '', email: '', jobTitle: '', department: '',
  annualSalary: '', taxRate: 20, pensionRate: 0, status: 'active',
};

function EmployeeRegister({ user }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);

  const currency = user.payCurrency ?? 'USD';

  const load = useCallback(async () => {
    try {
      const { employees } = await employeeApi.list();
      setRows(employees);
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(employee) {
    if (!window.confirm(`Remove ${employee.firstName} ${employee.lastName} from the register?`)) return;
    try {
      await employeeApi.remove(employee._id);
      await load();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  return (
    <>
      <div className="row row--between row--wrap" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1>Employees</h1>
          <p className="muted">Everyone on the payroll and what they are paid.</p>
        </div>
        <Button onClick={() => setEditing(editing ? null : { ...blank })}>
          {editing ? 'Cancel' : 'Add employee'}
        </Button>
      </div>

      <Alert kind="error">{error}</Alert>

      {editing ? (
        <EmployeeForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      ) : null}

      <section className="panel">
        {rows === null ? (
          <p className="muted">Loading register&hellip;</p>
        ) : rows.length === 0 ? (
          <div className="empty">
            <p>No employees yet.</p>
            <p style={{ marginTop: '0.75rem' }}>
              <Button onClick={() => setEditing({ ...blank })}>Add your first employee</Button>
            </p>
          </div>
        ) : (
          <div className="table__scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th><th>Role</th><th>Status</th>
                  <th className="num">Annual salary</th><th className="num">Tax</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((employee) => (
                  <tr key={employee._id}>
                    <td>
                      <strong>{employee.firstName} {employee.lastName}</strong>
                      {employee.email ? <div className="meta">{employee.email}</div> : null}
                    </td>
                    <td>
                      {employee.jobTitle || '—'}
                      {employee.department ? <div className="meta">{employee.department}</div> : null}
                    </td>
                    <td><StatusPill status={employee.status === 'on_leave' ? 'draft' : employee.status === 'terminated' ? 'void' : 'paid'} /></td>
                    <td className="num">{formatMoney(employee.annualSalary, currency)}</td>
                    <td className="num">{employee.taxRate}%</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: '0.35rem' }}>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(employee)}>Edit</Button>
                        <Button variant="danger" size="sm" onClick={() => remove(employee)}>Remove</Button>
                      </div>
                    </td>
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

function EmployeeForm({ initial, onCancel, onSaved }) {
  const [values, setValues] = useState({ ...blank, ...initial });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const payload = {
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      jobTitle: values.jobTitle,
      department: values.department,
      annualSalary: Number(values.annualSalary) || 0,
      taxRate: Number(values.taxRate) || 0,
      pensionRate: Number(values.pensionRate) || 0,
      status: values.status,
    };

    try {
      if (initial._id) await employeeApi.update(initial._id, payload);
      else await employeeApi.create(payload);
      await onSaved();
    } catch (submitError) {
      setError(submitError.message);
      setFieldErrors(submitError.fieldErrors ?? {});
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{initial._id ? 'Edit employee' : 'New employee'}</h2>
      </div>

      <form className="stack" onSubmit={submit}>
        <Alert kind="error">{error}</Alert>

        <div className="row row--wrap" style={{ gap: '0.75rem' }}>
          <div className="grow">
            <Field label="First name" htmlFor="firstName" error={fieldErrors.firstName}>
              <input id="firstName" className="input" required value={values.firstName} onChange={set('firstName')} />
            </Field>
          </div>
          <div className="grow">
            <Field label="Last name" htmlFor="lastName" error={fieldErrors.lastName}>
              <input id="lastName" className="input" required value={values.lastName} onChange={set('lastName')} />
            </Field>
          </div>
        </div>

        <div className="row row--wrap" style={{ gap: '0.75rem' }}>
          <div className="grow">
            <Field label="Email" htmlFor="email" error={fieldErrors.email}>
              <input id="email" className="input" type="email" value={values.email} onChange={set('email')} />
            </Field>
          </div>
          <div className="grow">
            <Field label="Job title" htmlFor="jobTitle">
              <input id="jobTitle" className="input" value={values.jobTitle} onChange={set('jobTitle')} />
            </Field>
          </div>
          <div className="grow">
            <Field label="Department" htmlFor="department">
              <input id="department" className="input" value={values.department} onChange={set('department')} />
            </Field>
          </div>
        </div>

        <div className="row row--wrap" style={{ gap: '0.75rem' }}>
          <div className="grow">
            <Field label="Annual salary" htmlFor="annualSalary" error={fieldErrors.annualSalary}>
              <input id="annualSalary" className="input" type="number" min="0" step="0.01" required
                value={values.annualSalary} onChange={set('annualSalary')} />
            </Field>
          </div>
          <div className="grow">
            <Field label="Tax rate %" htmlFor="taxRate">
              <input id="taxRate" className="input" type="number" min="0" max="100" step="any"
                value={values.taxRate} onChange={set('taxRate')} />
            </Field>
          </div>
          <div className="grow">
            <Field label="Pension %" htmlFor="pensionRate">
              <input id="pensionRate" className="input" type="number" min="0" max="100" step="any"
                value={values.pensionRate} onChange={set('pensionRate')} />
            </Field>
          </div>
          <div className="grow">
            <Field label="Status" htmlFor="status">
              <select id="status" className="input" value={values.status} onChange={set('status')}>
                <option value="active">Active</option>
                <option value="on_leave">On leave</option>
                <option value="terminated">Terminated</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="row" style={{ gap: '0.6rem' }}>
          <Button type="submit" loading={busy}>{busy ? 'Saving…' : 'Save employee'}</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </section>
  );
}
