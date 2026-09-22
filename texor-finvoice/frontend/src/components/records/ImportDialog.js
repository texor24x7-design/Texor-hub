'use client';

/**
 * Spreadsheet import: the file is read by the API — a `.xlsx` is a zip of XML
 * and the browser has no business unpacking one — columns are matched to fields
 * by their heading, and rows go back as field-keyed objects. The API validates
 * every row exactly as the form would and reports the ones it could not take.
 *
 * Nothing about the file is stored. Only the rows it produced are sent on.
 */
import { useMemo, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Alert, Button, Dialog, Field, Switch, useToast } from '@/components/ui';
import { invalidate } from '@/lib/data';
import { toMinor } from '@/lib/shared/money.mjs';
import { STATES } from '@/lib/shared/india.mjs';
import { useWorkspace } from '@/lib/workspace';

const IMPORTABLE = new Set(['text', 'longtext', 'email', 'phone', 'url', 'number', 'currency', 'percent', 'date', 'select', 'checkbox', 'gstin', 'state', 'multiselect', 'time']);

/**
 * Stock is read-only on the form — it is the sum of the ledger, not a number
 * anyone types — but a spreadsheet is exactly how a shop counts it. Both columns
 * become ledger rows on the way in: a count corrects the balance, a delivery
 * adds to it.
 */
const STOCK_COLUMNS = [
  { key: 'stock', label: 'In stock', type: 'number', help: 'Counted on the shelf' },
  { key: 'addStock', label: 'Stock received', type: 'number', help: 'Added to what is there' },
];

/** What other people's spreadsheets call our fields. Headings are compared with spaces and punctuation removed. */
const ALIASES = {
  item: 'name', itemname: 'name', productname: 'name', particulars: 'name',
  code: 'sku', itemcode: 'sku', productcode: 'sku', skucode: 'sku',
  qty: 'stock', quantity: 'stock', stockinhand: 'stock', currentstock: 'stock', closingstock: 'stock', openingstock: 'stock',
  received: 'addStock', inward: 'addStock', purchased: 'addStock',
  rate: 'priceMinor', price: 'priceMinor', mrp: 'priceMinor', sellingprice: 'priceMinor', salerate: 'priceMinor',
  cost: 'costMinor', costprice: 'costMinor', purchaserate: 'costMinor', buyingprice: 'costMinor',
  gst: 'taxRate', gstrate: 'taxRate', tax: 'taxRate', taxpercent: 'taxRate',
  hsncode: 'hsn', saccode: 'hsn', hsnsac: 'hsn',
  uom: 'unit', unitofmeasure: 'unit',
  mobile: 'phone', mobilenumber: 'phone', phonenumber: 'phone', contact: 'phone', contactnumber: 'phone', whatsapp: 'phone',
  emailid: 'email', gstnumber: 'gstin', gstno: 'gstin', lowstockalert: 'lowStock', reorderlevel: 'lowStock',
};

const squash = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The field a heading belongs to: its own label or key first, then what other apps call it. */
function matchField(heading, fields) {
  const wanted = squash(heading);
  if (!wanted) return '';
  const byName = fields.find((f) => squash(f.label) === wanted || squash(f.key) === wanted);
  if (byName) return byName.key;
  const alias = ALIASES[wanted];
  return fields.some((f) => f.key === alias) ? alias : '';
}

function coerce(field, raw, currency) {
  if (raw instanceof Date) return field.type === 'date' ? raw.toISOString() : undefined;
  const value = String(raw ?? '').trim().replace(/^'(?=[=+\-@])/, '');
  if (!value) return undefined;
  switch (field.type) {
    case 'number': case 'percent': return Number(value.replace(/,/g, ''));
    case 'currency': return toMinor(value, currency) ?? undefined;
    case 'checkbox': return /^(yes|true|1|y)$/i.test(value);
    case 'date': { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toISOString(); }
    case 'multiselect': return value.split(/[;,]/).map((v) => v.trim()).filter(Boolean);
    case 'select': return field.options?.find((o) => o.label.toLowerCase() === value.toLowerCase() || o.value === value)?.value ?? value;
    case 'state': return STATES.find((s) => s.name.toLowerCase() === value.toLowerCase() || s.code === value.padStart(2, '0'))?.code ?? value;
    default: return value;
  }
}

export function ImportDialog({ open, onClose, module }) {
  const { api, slug, currency } = useWorkspace();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [mapping, setMapping] = useState({});
  const [updateExisting, setUpdateExisting] = useState(true);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fields = useMemo(() => [
    ...module.fields.filter((f) => !f.readOnly && IMPORTABLE.has(f.type)),
    ...(module.key === 'products' ? STOCK_COLUMNS : []),
  ], [module]);

  async function load(file) {
    setBusy(true);
    setError('');
    try {
      const { rows: parsed, truncated } = await api.sendFile(`/records/${module.key}/parse`, file);
      setRows(parsed);
      setResult(null);
      setMapping(Object.fromEntries((parsed[0] ?? []).map((heading, index) => [index, matchField(heading, fields)])));
      if (truncated) toast('That file is longer than 2000 rows — only the first 2000 will be imported.', 'error');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  /** A file with the right headings and nothing in it, for a catalogue that has nothing to export yet. */
  function template() {
    const url = URL.createObjectURL(new Blob([`﻿${fields.map((f) => f.label).join(',')}\r\n`], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: `${module.key}-template.csv` }).click();
    URL.revokeObjectURL(url);
  }

  async function run() {
    setBusy(true);
    const body = rows.slice(1).map((cells) => {
      const record = { custom: {} };
      cells.forEach((raw, index) => {
        const field = fields.find((f) => f.key === mapping[index]);
        if (!field) return;
        const value = coerce(field, raw, currency);
        if (value === undefined) return;
        if (field.custom) record.custom[field.key] = value; else record[field.key] = value;
      });
      return record;
    });
    try {
      const outcome = await api.post(`/records/${module.key}/import`, { rows: body, updateExisting });
      setResult(outcome);
      invalidate(`records:${slug}:${module.key}`);
      if (!outcome.errors.length) toast(`${outcome.created} added, ${outcome.updated} updated`);
    } catch (failure) {
      setResult({ created: 0, updated: 0, errors: [{ row: 0, message: failure.message }] });
    } finally {
      setBusy(false);
    }
  }

  const close = () => { setRows(null); setResult(null); setError(''); onClose(); };
  const summary = result ? [result.created && `${result.created} added`, result.updated && `${result.updated} updated`, result.errors.length && `${result.errors.length} skipped`].filter(Boolean).join(', ') : '';

  return (
    <Dialog open={open} onClose={close} size="wide" title={`Import ${module.label.toLowerCase()}`} description="Upload an Excel file or a CSV. Columns are matched to fields by their heading; check the matches before importing."
      footer={<><Button variant="secondary" onClick={close}>{result ? 'Done' : 'Cancel'}</Button>{rows && !result ? <Button onClick={run} loading={busy}>Import {rows.length - 1} rows</Button> : null}</>}>
      {!rows ? (
        <div className="stack">
          {error ? <Alert kind="error" title={error} /> : null}
          <label className="upload-tile" style={{ minHeight: 180 }}>
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
            <FileUp aria-hidden="true" />
            <span className="strong">{busy ? 'Reading the file…' : 'Choose an Excel or CSV file'}</span>
            <span className="tiny subtle">.xlsx or .csv — export first to get a file with the right headings{module.key === 'products' ? ', stock column included' : ''}.</span>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={template}>Download a blank template</button>
        </div>
      ) : result ? (
        <div className="stack">
          <Alert kind={result.errors.length ? 'warning' : 'success'} title={summary || 'Nothing to import'} />
          {result.errors.slice(0, 20).map((e) => (
            <div key={e.row} className="small"><span className="strong">Row {e.row}:</span> {e.details?.map((d) => d.message).join(' ') || e.message}</div>
          ))}
        </div>
      ) : (
        <div className="stack">
          <Field hint={`Rows that match an existing ${module.labelSingular.toLowerCase()} — same ${(module.key === 'customers' ? 'phone, email or name' : 'SKU, barcode or name')} — are updated instead of added again.`}>
            <Switch checked={updateExisting} onChange={setUpdateExisting} label="Update what is already here" />
          </Field>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Column in file</th><th>Example</th><th>Goes into</th></tr></thead>
              <tbody>
                {rows[0].map((heading, index) => (
                  <tr key={index}>
                    <td className="strong">{String(heading ?? '')}</td>
                    <td className="muted ellipsis" style={{ maxWidth: 220 }}>{String(rows[1]?.[index] ?? '')}</td>
                    <td>
                      <select className="input input-sm" value={mapping[index] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [index]: e.target.value }))}>
                        <option value="">Skip this column</option>
                        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.help ? ` — ${f.help}` : ''}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  );
}
