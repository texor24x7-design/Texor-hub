'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Field, formatMoney } from '@/components/ui';

const emptyLine = () => ({ description: '', quantity: 1, unitPrice: 0, taxRate: 0 });

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');

/**
 * Create/edit form for an invoice.
 *
 * Totals are previewed here for immediate feedback but recomputed on the server
 * before saving — the server's numbers are the ones that count, so the two use
 * the same rounding rule (round each line to cents, then sum).
 */
export function InvoiceForm({ initial, submitLabel = 'Save invoice', onSubmit, onDelete }) {
  const [values, setValues] = useState(() => ({
    number: initial?.number ?? '',
    client: {
      name: initial?.client?.name ?? '',
      email: initial?.client?.email ?? '',
      address: initial?.client?.address ?? '',
    },
    lineItems: initial?.lineItems?.length ? initial.lineItems.map((item) => ({ ...item })) : [emptyLine()],
    currency: initial?.currency ?? 'USD',
    notes: initial?.notes ?? '',
    issueDate: toDateInput(initial?.issueDate ?? new Date()),
    dueDate: toDateInput(initial?.dueDate),
    status: initial?.status ?? 'draft',
  }));

  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }));
  const setClient = (key) => (event) => setValues((prev) => ({
    ...prev, client: { ...prev.client, [key]: event.target.value },
  }));

  const setLine = (index, key) => (event) => {
    const raw = event.target.value;
    const value = key === 'description' ? raw : raw === '' ? '' : Number(raw);
    setValues((prev) => ({
      ...prev,
      lineItems: prev.lineItems.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    }));
  };

  const addLine = () => setValues((prev) => ({ ...prev, lineItems: [...prev.lineItems, emptyLine()] }));
  const removeLine = (index) => setValues((prev) => ({
    ...prev,
    lineItems: prev.lineItems.length === 1 ? prev.lineItems : prev.lineItems.filter((_, i) => i !== index),
  }));

  const totals = useMemo(() => {
    const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
    let subtotal = 0;
    let taxTotal = 0;

    for (const item of values.lineItems) {
      const lineTotal = money((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0));
      subtotal = money(subtotal + lineTotal);
      taxTotal = money(taxTotal + money(lineTotal * ((Number(item.taxRate) || 0) / 100)));
    }

    return { subtotal, taxTotal, total: money(subtotal + taxTotal) };
  }, [values.lineItems]);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);

    try {
      await onSubmit({
        ...values,
        dueDate: values.dueDate || null,
        lineItems: values.lineItems.map((item) => ({
          description: item.description,
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.unitPrice) || 0,
          taxRate: Number(item.taxRate) || 0,
        })),
      });
    } catch (submitError) {
      setError(submitError.message);
      setFieldErrors(submitError.fieldErrors ?? {});
      setBusy(false);
    }
  }

  return (
    <form className="stack stack--loose" onSubmit={submit}>
      <Alert kind="error">{error}</Alert>

      <section className="panel">
        <div className="panel__header"><h2>Details</h2></div>

        <div className="stack">
          <div className="row row--wrap" style={{ gap: '0.75rem' }}>
            <div className="grow">
              <Field label="Invoice number" htmlFor="number" error={fieldErrors.number}>
                <input id="number" className="input" required placeholder="INV-001"
                  value={values.number} onChange={set('number')} />
              </Field>
            </div>
            <div className="grow">
              <Field label="Currency" htmlFor="currency" error={fieldErrors.currency}>
                <input id="currency" className="input" maxLength={3} style={{ textTransform: 'uppercase' }}
                  value={values.currency} onChange={set('currency')} />
              </Field>
            </div>
            <div className="grow">
              <Field label="Status" htmlFor="status">
                <select id="status" className="input" value={values.status} onChange={set('status')}>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="void">Void</option>
                </select>
              </Field>
            </div>
          </div>

          <div className="row row--wrap" style={{ gap: '0.75rem' }}>
            <div className="grow">
              <Field label="Issue date" htmlFor="issueDate">
                <input id="issueDate" className="input" type="date" value={values.issueDate} onChange={set('issueDate')} />
              </Field>
            </div>
            <div className="grow">
              <Field label="Due date" htmlFor="dueDate">
                <input id="dueDate" className="input" type="date" value={values.dueDate} onChange={set('dueDate')} />
              </Field>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header"><h2>Bill to</h2></div>

        <div className="stack">
          <Field label="Client name" htmlFor="clientName" error={fieldErrors['client.name']}>
            <input id="clientName" className="input" required value={values.client.name} onChange={setClient('name')} />
          </Field>
          <Field label="Client email" htmlFor="clientEmail" error={fieldErrors['client.email']}>
            <input id="clientEmail" className="input" type="email" value={values.client.email} onChange={setClient('email')} />
          </Field>
          <Field label="Address" htmlFor="clientAddress">
            <textarea id="clientAddress" className="input" rows={3} value={values.client.address} onChange={setClient('address')} />
          </Field>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header row row--between row--wrap">
          <h2>Line items</h2>
          <Button type="button" variant="secondary" size="sm" onClick={addLine}>Add line</Button>
        </div>

        <Alert kind="error">{fieldErrors.lineItems}</Alert>

        <div className="line-items">
          <div className="line-item meta" style={{ fontWeight: 600 }}>
            <span>Description</span><span>Qty</span><span>Unit price</span><span>Tax %</span><span />
          </div>

          {values.lineItems.map((item, index) => (
            <div className="line-item" key={index}>
              <Field htmlFor={`desc-${index}`} error={fieldErrors[`lineItems.${index}.description`]}>
                <input id={`desc-${index}`} className="input" required placeholder="What are you billing for?"
                  value={item.description} onChange={setLine(index, 'description')} />
              </Field>
              <Field htmlFor={`qty-${index}`}>
                <input id={`qty-${index}`} className="input" type="number" min="0" step="any"
                  value={item.quantity} onChange={setLine(index, 'quantity')} />
              </Field>
              <Field htmlFor={`price-${index}`}>
                <input id={`price-${index}`} className="input" type="number" min="0" step="0.01"
                  value={item.unitPrice} onChange={setLine(index, 'unitPrice')} />
              </Field>
              <Field htmlFor={`tax-${index}`}>
                <input id={`tax-${index}`} className="input" type="number" min="0" max="100" step="any"
                  value={item.taxRate} onChange={setLine(index, 'taxRate')} />
              </Field>
              <Button type="button" variant="ghost" size="sm"
                onClick={() => removeLine(index)} disabled={values.lineItems.length === 1}
                aria-label={`Remove line ${index + 1}`}>
                Remove
              </Button>
            </div>
          ))}
        </div>

        <div className="stack stack--tight" style={{ marginTop: '1.5rem', marginLeft: 'auto', maxWidth: '16rem' }}>
          <div className="row row--between"><span className="muted">Subtotal</span><span className="num">{formatMoney(totals.subtotal, values.currency)}</span></div>
          <div className="row row--between"><span className="muted">Tax</span><span className="num">{formatMoney(totals.taxTotal, values.currency)}</span></div>
          <div className="row row--between" style={{ fontWeight: 650, fontSize: '1.05rem' }}>
            <span>Total</span><span className="num">{formatMoney(totals.total, values.currency)}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header"><h2>Notes</h2></div>
        <Field htmlFor="notes" hint="Payment terms, bank details, a thank you — anything the client should see.">
          <textarea id="notes" className="input" rows={4} value={values.notes} onChange={set('notes')} />
        </Field>
      </section>

      <div className="row row--between row--wrap">
        {onDelete ? (
          <Button type="button" variant="danger" onClick={onDelete}>Delete invoice</Button>
        ) : <span />}
        <Button type="submit" loading={busy}>{busy ? 'Saving…' : submitLabel}</Button>
      </div>
    </form>
  );
}

export default InvoiceForm;
