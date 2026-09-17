'use client';

/**
 * CSV import: the file is parsed in the browser, columns are matched to fields
 * by label, and rows go to the API as field-keyed objects. The API validates
 * every row exactly as the form would and reports the ones it could not take.
 */
import { useMemo, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Alert, Button, Dialog, useToast } from '@/components/ui';
import { invalidate } from '@/lib/data';
import { toMinor } from '@/lib/shared/money.mjs';
import { STATES } from '@/lib/shared/india.mjs';
import { useWorkspace } from '@/lib/workspace';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

const IMPORTABLE = new Set(['text', 'longtext', 'email', 'phone', 'url', 'number', 'currency', 'percent', 'date', 'select', 'checkbox', 'gstin', 'state', 'multiselect', 'time']);

function coerce(field, raw, currency) {
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
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const fields = useMemo(() => module.fields.filter((f) => !f.readOnly && IMPORTABLE.has(f.type)), [module]);

  function load(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result));
      setRows(parsed);
      setResult(null);
      const header = parsed[0] ?? [];
      setMapping(Object.fromEntries(header.map((h, i) => [i, fields.find((f) => f.label.toLowerCase() === h.trim().toLowerCase() || f.key.toLowerCase() === h.trim().toLowerCase())?.key ?? ''])));
    };
    reader.readAsText(file);
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
      const outcome = await api.post(`/records/${module.key}/import`, { rows: body });
      setResult(outcome);
      invalidate(`records:${slug}:${module.key}`);
      if (!outcome.errors.length) toast(`Imported ${outcome.created} ${module.label.toLowerCase()}`);
    } catch (error) {
      setResult({ created: 0, errors: [{ row: 0, message: error.message }] });
    } finally {
      setBusy(false);
    }
  }

  const close = () => { setRows(null); setResult(null); onClose(); };

  return (
    <Dialog open={open} onClose={close} size="wide" title={`Import ${module.label.toLowerCase()}`} description="Upload a CSV. Columns are matched to fields by name; check the matches before importing."
      footer={<><Button variant="secondary" onClick={close}>{result ? 'Done' : 'Cancel'}</Button>{rows && !result ? <Button onClick={run} loading={busy}>Import {rows.length - 1} rows</Button> : null}</>}>
      {!rows ? (
        <label className="upload-tile" style={{ minHeight: 180 }}>
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          <FileUp aria-hidden="true" />
          <span className="strong">Choose a CSV file</span>
          <span className="tiny subtle">Tip: export first to get a file with the right headings.</span>
        </label>
      ) : result ? (
        <div className="stack">
          <Alert kind={result.errors.length ? 'warning' : 'success'} title={`${result.created} imported${result.errors.length ? `, ${result.errors.length} skipped` : ''}`} />
          {result.errors.slice(0, 20).map((e) => (
            <div key={e.row} className="small"><span className="strong">Row {e.row}:</span> {e.details?.map((d) => d.message).join(' ') || e.message}</div>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Column in file</th><th>Example</th><th>Goes into</th></tr></thead>
            <tbody>
              {rows[0].map((header, index) => (
                <tr key={index}>
                  <td className="strong">{header}</td>
                  <td className="muted ellipsis" style={{ maxWidth: 220 }}>{rows[1]?.[index]}</td>
                  <td>
                    <select className="input input-sm" value={mapping[index] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [index]: e.target.value }))}>
                      <option value="">Skip this column</option>
                      {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
