'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { InvoiceForm } from '@/components/InvoiceForm';
import { Alert, Loading, StatusPill, formatMoney } from '@/components/ui';
import { invoices as invoiceApi } from '@/lib/api';

export default function InvoiceDetailPage({ params }) {
  const { id } = use(params);
  return <AppShell><InvoiceDetail id={id} /></AppShell>;
}

function InvoiceDetail({ id }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoiceApi.get(id)
      .then((data) => setInvoice(data.invoice))
      .catch((loadError) => setError(loadError.message));
  }, [id]);

  async function remove() {
    if (!window.confirm('Delete this invoice? This cannot be undone.')) return;
    try {
      await invoiceApi.remove(id);
      router.push('/invoices');
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  if (error && !invoice) {
    return (
      <>
        <a href="/invoices" className="meta">&larr; Back to invoices</a>
        <div style={{ marginTop: '1rem' }}><Alert kind="error">{error}</Alert></div>
      </>
    );
  }

  if (!invoice) return <Loading label="Loading invoice" />;

  return (
    <>
      <div style={{ marginBottom: '1.5rem' }}>
        <a href="/invoices" className="meta">&larr; Back to invoices</a>
        <div className="row row--between row--wrap" style={{ marginTop: '0.5rem' }}>
          <div className="row">
            <h1>{invoice.number}</h1>
            <StatusPill status={invoice.status} />
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 650 }}>
            {formatMoney(invoice.total, invoice.currency)}
          </div>
        </div>
      </div>

      {saved ? <div style={{ marginBottom: '1rem' }}><Alert kind="success">Invoice saved.</Alert></div> : null}
      <Alert kind="error">{error}</Alert>

      <InvoiceForm
        initial={invoice}
        submitLabel="Save changes"
        onDelete={remove}
        onSubmit={async (values) => {
          const { invoice: updated } = await invoiceApi.update(id, values);
          setInvoice(updated);
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        }}
      />
    </>
  );
}
