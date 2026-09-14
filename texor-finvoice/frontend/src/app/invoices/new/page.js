'use client';

import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { InvoiceForm } from '@/components/InvoiceForm';
import { invoices as invoiceApi } from '@/lib/api';

export default function NewInvoicePage() {
  return <AppShell>{(user) => <NewInvoice user={user} />}</AppShell>;
}

function NewInvoice({ user }) {
  const router = useRouter();

  return (
    <>
      <div style={{ marginBottom: '1.5rem' }}>
        <a href="/invoices" className="meta">&larr; Back to invoices</a>
        <h1 style={{ marginTop: '0.5rem' }}>New invoice</h1>
      </div>

      <InvoiceForm
        initial={{ currency: user.defaultCurrency }}
        submitLabel="Create invoice"
        onSubmit={async (values) => {
          const { invoice } = await invoiceApi.create(values);
          router.push(`/invoices/${invoice._id}`);
        }}
      />
    </>
  );
}
