'use client';

/**
 * GSTR-1 for a month, read straight from the invoices and notes of that month.
 *
 * The sections are the return's own — B2B, B2CL, B2CS, CDNR, CDNUR, HSN, DOCS —
 * named exactly as a filing portal and an accountant name them, because this
 * screen is read side by side with one of those. Nothing here computes tax: the
 * figures are the ones each document was issued with.
 */
import { useMemo, useState } from 'react';
import { Download, Landmark } from 'lucide-react';
import { Alert, EmptyState, PageHeader, SkeletonRows as Skeleton, Tabs, CardTable } from '@/components/ui';
import { useResource } from '@/lib/data';
import { date, money } from '@/lib/format';
import { stateName } from '@/lib/shared/india.mjs';
import { useWorkspace } from '@/lib/workspace';

/** Returns are filed for the month just gone, so that is where the picker starts. */
function lastMonth() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const place = (code) => (code ? `${stateName(code) ?? code} (${code})` : '—');

/**
 * Each section's shape. `rows` flattens a document's per-rate breakdown into one
 * line per rate, which is how the return itself is laid out.
 */
const SECTIONS = (currency) => ({
  b2b: {
    label: 'B2B',
    hint: 'Sales to customers who gave a GSTIN. Listed invoice by invoice.',
    headings: ['GSTIN', 'Customer', 'Invoice', 'Date', 'Value', 'Place of supply', 'Rate', 'Taxable', 'IGST', 'CGST', 'SGST'],
    rows: (data) => data.b2b.flatMap((r) => r.rates.map((t) => [r.gstin, r.name, r.number, date(r.date), money(r.totalMinor, currency), place(r.placeOfSupply), `${t.rate}%`, money(t.taxableMinor, currency), money(t.igstMinor, currency), money(t.cgstMinor, currency), money(t.sgstMinor, currency)])),
  },
  b2cl: {
    label: 'B2CL',
    hint: 'Sales above ₹2.5 lakh to another state, where the customer is not registered.',
    headings: ['Invoice', 'Date', 'Value', 'Place of supply', 'Rate', 'Taxable', 'IGST'],
    rows: (data) => data.b2cl.flatMap((r) => r.rates.map((t) => [r.number, date(r.date), money(r.totalMinor, currency), place(r.placeOfSupply), `${t.rate}%`, money(t.taxableMinor, currency), money(t.igstMinor, currency)])),
  },
  b2cs: {
    label: 'B2CS',
    hint: 'Every other sale to an unregistered customer, totalled by state and rate rather than listed.',
    headings: ['Type', 'Place of supply', 'Rate', 'Taxable', 'IGST', 'CGST', 'SGST'],
    rows: (data) => data.b2cs.map((r) => [r.interState ? 'Inter-state' : 'Intra-state', place(r.placeOfSupply), `${r.rate}%`, money(r.taxableMinor, currency), money(r.igstMinor, currency), money(r.cgstMinor, currency), money(r.sgstMinor, currency)]),
  },
  cdnr: {
    label: 'CDNR',
    hint: 'Credit and debit notes against customers who gave a GSTIN.',
    headings: ['GSTIN', 'Customer', 'Note', 'Date', 'Type', 'Against', 'Value', 'Rate', 'Taxable'],
    rows: (data) => data.cdnr.flatMap((r) => r.rates.map((t) => [r.gstin, r.name, r.number, date(r.date), r.noteKind === 'credit' ? 'Credit' : 'Debit', r.against || '—', money(r.totalMinor, currency), `${t.rate}%`, money(t.taxableMinor, currency)])),
  },
  cdnur: {
    label: 'CDNUR',
    hint: 'Credit and debit notes against large unregistered sales.',
    headings: ['Note', 'Date', 'Type', 'Against', 'Value', 'Rate', 'Taxable'],
    rows: (data) => data.cdnur.flatMap((r) => r.rates.map((t) => [r.number, date(r.date), r.noteKind === 'credit' ? 'Credit' : 'Debit', r.against || '—', money(r.totalMinor, currency), `${t.rate}%`, money(t.taxableMinor, currency)])),
  },
  hsn: {
    label: 'HSN',
    hint: 'Everything supplied in the month, grouped by HSN or SAC code and rate.',
    headings: ['HSN / SAC', 'Description', 'UQC', 'Quantity', 'Rate', 'Taxable', 'IGST', 'CGST', 'SGST'],
    rows: (data) => data.hsn.map((r) => [r.hsn || '—', r.description, r.uqc, r.quantity, `${r.rate}%`, money(r.taxableMinor, currency), money(r.igstMinor, currency), money(r.cgstMinor, currency), money(r.sgstMinor, currency)]),
  },
  docs: {
    label: 'DOCS',
    hint: 'The invoice numbers this month covers, and any that were cancelled.',
    headings: ['Nature of document', 'From', 'To', 'Total', 'Cancelled'],
    rows: (data) => [['Invoices for outward supply', data.docs.from || '—', data.docs.to || '—', data.docs.issued + data.docs.cancelled, data.docs.cancelled]],
  },
});

export function Gst({ module }) {
  const { api, slug, currency, can, workspace } = useWorkspace();
  const [month, setMonth] = useState(lastMonth);
  const [section, setSection] = useState('b2b');

  const { data, loading, error } = useResource(`gstr1:${slug}:${month}`, () => api.get('/gst/gstr1', { month }));
  const sections = useMemo(() => SECTIONS(currency), [currency]);

  const counts = data ? {
    b2b: data.b2b.length, b2cl: data.b2cl.length, b2cs: data.b2cs.length,
    cdnr: data.cdnr.length, cdnur: data.cdnur.length, hsn: data.hsn.length, docs: 1,
  } : {};

  const current = sections[section];
  const rows = data ? current.rows(data) : [];

  return (
    <>
      <PageHeader
        title={module?.label ?? 'GST filing'}
        description={`GSTR-1 for ${workspace.gstin || 'this business'} — outward supplies, as the return groups them.`}
        actions={data && can('gst', 'export') ? (
          <a className="btn btn-secondary" href={api.url(`/gst/gstr1/export?month=${month}`)}><Download />Download workbook</a>
        ) : null}
      />

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="toolbar">
          <label className="row small" style={{ gap: '0.5rem' }}>
            <span className="muted">Month</span>
            <input type="month" className="input" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month to file for" />
          </label>
        </div>
      </div>

      {error ? <Alert kind="error" title="This return cannot be prepared">{error.message}</Alert> : null}
      {loading && !data ? <Skeleton rows={6} /> : null}

      {data ? (
        <>
          <div className="grid-4 stat-strip" style={{ marginBottom: '1rem' }}>
            <div className="card stat"><div className="stat-label">Taxable value</div><div className="stat-value">{money(data.totals.taxableMinor, currency)}</div><div className="stat-foot">{data.totals.invoices} invoices</div></div>
            <div className="card stat"><div className="stat-label">IGST</div><div className="stat-value">{money(data.totals.igstMinor, currency)}</div></div>
            <div className="card stat"><div className="stat-label">CGST + SGST</div><div className="stat-value">{money(data.totals.cgstMinor + data.totals.sgstMinor, currency)}</div></div>
            <div className="card stat"><div className="stat-label">Notes</div><div className="stat-value">{money(data.totals.creditedMinor, currency)}</div><div className="stat-foot">credited · {money(data.totals.debitedMinor, currency)} debited</div></div>
          </div>

          <div className="card">
            <div style={{ padding: '0 0.9rem' }}>
              <Tabs
                tabs={Object.entries(sections).map(([key, s]) => ({ value: key, label: s.label, count: counts[key] }))}
                value={section}
                onChange={setSection}
              />
            </div>
            <div className="card-body" style={{ paddingBottom: 0 }}><p className="small muted">{current.hint}</p></div>

            {rows.length ? (
              <div className="table-wrap">
                <CardTable>
                  <thead><tr>{current.headings.map((h) => <th key={h} className={['Taxable', 'IGST', 'CGST', 'SGST', 'Value', 'Quantity', 'Total', 'Cancelled'].includes(h) ? 'num' : ''}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cellValue, j) => <td key={j} className={['Taxable', 'IGST', 'CGST', 'SGST', 'Value', 'Quantity', 'Total', 'Cancelled'].includes(current.headings[j]) ? 'num' : ''}>{cellValue}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </CardTable>
              </div>
            ) : (
              <EmptyState icon={<Landmark />} title={`Nothing in ${current.label} this month`}>{current.hint}</EmptyState>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
