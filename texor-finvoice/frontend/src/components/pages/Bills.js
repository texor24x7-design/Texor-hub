'use client';

/**
 * Purchase bills: what was bought, from whom, and what is still owed for it.
 *
 * A bill is recorded rather than composed — it already exists on paper, so this
 * screen is built for typing one in from a supplier's invoice quickly, not for
 * designing one. That is why it is a dialog on the list rather than a page of
 * its own, and why the supplier's own bill number is the first field.
 */
import { useEffect, useMemo, useState } from 'react';
import { Ban, Plus, Receipt, Search, Wallet } from 'lucide-react';
import { Alert, Badge, Button, Dialog, EmptyState, Field, PageHeader, Pagination, SkeletonRows, StatusBadge, Tabs, useConfirm, useToast, CardTable } from '@/components/ui';
import { MoneyInput } from '@/components/fields/MoneyInput';
import { ReferencePicker } from '@/components/fields/ReferencePicker';
import { SplitPayment, receivedOf } from '@/components/documents/SplitPayment';
import { invalidate, useDebounced, useResource } from '@/lib/data';
import { date, money, toDateInput } from '@/lib/format';
import { computeDocument } from '@/lib/shared/tax.mjs';
import { useWorkspace } from '@/lib/workspace';

const TABS = [
  { value: '', label: 'All' }, { value: 'unpaid', label: 'To pay' }, { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' }, { value: 'void', label: 'Void' },
];

const blankLine = () => ({ item: null, description: '', hsn: '', quantity: 1, unit: '', priceMinor: 0, taxRate: 18, priceIncludesTax: false });

/**
 * What the bill will come to. The same engine the server will run, with the
 * parties the way a purchase has them: the vendor sold, we are the destination.
 */
function useBillTotals(form, vendor, workspace) {
  return useMemo(() => computeDocument({
    lines: form.lines,
    sellerState: vendor?.stateCode || workspace.stateCode,
    placeOfSupply: workspace.stateCode,
    discount: null,
    roundOff: form.roundOff,
    taxMode: vendor?.gstin ? 'gst' : 'none',
    currency: workspace.currency ?? 'INR',
  }), [form.lines, form.roundOff, vendor, workspace]);
}

function RecordBill({ open, onClose, onSaved }) {
  const { api, slug, workspace, currency } = useWorkspace();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ vendor: null, vendorName: '', number: '', date: toDateInput(new Date()), dueDate: '', lines: [blankLine()], roundOff: false, reference: '', notes: '' });
    setVendor(null);
    setErrors({});
  }, [open]);

  const computed = useBillTotals(form ?? { lines: [], roundOff: false }, vendor, workspace);
  if (!form) return null;

  const setLine = (i, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const { bill } = await api.post('/bills', {
        vendor: form.vendor,
        number: form.number,
        date: form.date,
        dueDate: form.dueDate || null,
        roundOff: form.roundOff,
        reference: form.reference,
        notes: form.notes,
        lines: form.lines.filter((l) => l.description.trim() || l.item).map((l) => ({
          item: l.item, description: l.description, hsn: l.hsn, unit: l.unit,
          quantity: Number(l.quantity) || 0, priceMinor: Number(l.priceMinor) || 0,
          taxRate: Number(l.taxRate) || 0, priceIncludesTax: Boolean(l.priceIncludesTax),
        })),
      });
      toast(`Bill ${bill.number} recorded`);
      invalidate(`bills:${slug}`);
      onSaved();
      onClose();
    } catch (error) {
      setErrors({ ...error.fieldErrors, _: error.message });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} size="wide" title="Record a bill" description="Type it in from the supplier's invoice. Goods on it go onto the shelf."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Record {money(computed.totals.totalMinor, currency)}</Button></>}>
      <div className="stack">
        {errors._ ? <Alert kind="error" title={errors._}>{Object.entries(errors).filter(([k]) => k !== '_').map(([, v]) => v).join(' ')}</Alert> : null}

        <div className="grid-4">
          <Field label="Vendor" required error={errors.vendor} className="span-2">
            <ReferencePicker refModule="vendors" value={form.vendor} title={form.vendorName} placeholder="Search vendors…"
              onChange={(value, row) => { setForm({ ...form, vendor: value, vendorName: row?.title ?? '' }); setVendor(row?.raw ?? null); }} />
          </Field>
          <Field label="Their bill number" required error={errors.number}>
            <input className="input" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="As printed on it" />
          </Field>
          <Field label="Bill date" required error={errors.date}>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
        </div>

        {vendor && !vendor.gstin ? (
          <Alert kind="info">{vendor.name} has no GSTIN on file, so this bill carries no input tax to claim.</Alert>
        ) : null}

        <div className="table-wrap">
          <CardTable className="lines-table">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Item</th><th style={{ width: 90 }}>HSN</th>
                <th style={{ width: 80 }} className="num">Qty</th><th style={{ width: 140 }} className="num">Rate</th>
                <th style={{ width: 90 }} className="num">GST %</th><th style={{ width: 120 }} className="num">Amount</th><th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {form.lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <ReferencePicker refModule="items" value={l.item} title={l.description} placeholder="Search or type…"
                      onChange={(value, row) => (row
                        ? setLine(i, { item: value, description: row.title, hsn: row.raw?.hsn ?? '', unit: row.raw?.unit ?? '', priceMinor: row.raw?.costMinor ?? row.raw?.priceMinor ?? 0, taxRate: row.raw?.taxRate ?? 18 })
                        : setLine(i, { item: null }))}
                      onCreate={(text) => setLine(i, { item: null, description: text })} createLabel="Use as a one-off line" />
                  </td>
                  <td><input className="input input-sm" value={l.hsn} onChange={(e) => setLine(i, { hsn: e.target.value.replace(/\D/g, '').slice(0, 8) })} /></td>
                  <td><input className="input input-sm num" type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label="Quantity" /></td>
                  <td><MoneyInput size="sm" value={l.priceMinor} currency={currency} onChange={(v) => setLine(i, { priceMinor: v ?? 0 })} aria-label="Rate" /></td>
                  <td>
                    <select className="input input-sm" value={l.taxRate} onChange={(e) => setLine(i, { taxRate: Number(e.target.value) })} aria-label="GST rate">
                      {[...new Set([0, 0.25, 3, 5, 12, 18, 28, Number(l.taxRate)])].sort((a, b) => a - b).map((r) => <option key={r} value={r}>{r}%</option>)}
                    </select>
                  </td>
                  <td className="num strong">{money(computed.lines[i]?.totalMinor ?? 0, currency)}</td>
                  <td><Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, lines: f.lines.length === 1 ? [blankLine()] : f.lines.filter((_, j) => j !== i) }))} aria-label="Remove line">×</Button></td>
                </tr>
              ))}
            </tbody>
          </CardTable>
        </div>

        <div className="row row-between wrap" style={{ gap: '2rem', alignItems: 'flex-start' }}>
          <Button variant="secondary" size="sm" icon={<Plus />} onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>Add line</Button>
          <div className="totals-box" style={{ width: 'min(340px, 100%)' }}>
            <div className="row"><span className="muted">Taxable</span><span className="num">{money(computed.totals.taxableMinor, currency)}</span></div>
            {computed.interState
              ? <div className="row"><span className="muted">IGST</span><span className="num">{money(computed.totals.igstMinor, currency)}</span></div>
              : <><div className="row"><span className="muted">CGST</span><span className="num">{money(computed.totals.cgstMinor, currency)}</span></div><div className="row"><span className="muted">SGST</span><span className="num">{money(computed.totals.sgstMinor, currency)}</span></div></>}
            <div className="row grand"><span>Bill total</span><span className="num">{money(computed.totals.totalMinor, currency)}</span></div>
          </div>
        </div>

        <div className="grid-2">
          <Field label="Payment due" hint="When the supplier expects to be paid."><input type="date" className="input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          <Field label="Reference"><input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="PO number, transport docket…" /></Field>
        </div>
      </div>
    </Dialog>
  );
}

function BillDetail({ id, onClose, onChanged }) {
  const { api, slug, currency, can, prefs } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useResource(id ? `bill:${slug}:${id}` : null, () => api.get(`/bills/${id}`));
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  const modes = prefs.paymentModes?.length ? prefs.paymentModes : ['Cash'];
  const bill = data?.bill;
  useEffect(() => { if (bill) setRows([{ mode: modes[0], amountMinor: bill.amountDueMinor }]); }, [bill?._id, bill?.amountDueMinor]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pay() {
    setBusy(true);
    try {
      await api.post(`/bills/${id}/payments`, { payments: rows.filter((r) => Number(r.amountMinor) > 0).map(({ mode, amountMinor }) => ({ mode, amountMinor })) });
      toast('Payment recorded');
      reload(); onChanged();
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  }

  async function voidIt() {
    if (!(await confirm({ title: `Void bill ${bill.number}?`, message: 'Its goods come back off the shelf and the vendor is no longer owed for it.', confirmLabel: 'Void bill', danger: true }))) return;
    try {
      await api.post(`/bills/${id}/void`);
      toast('Bill voided');
      reload(); onChanged();
    } catch (error) { toast(error.message, 'error'); }
  }

  return (
    <Dialog open={Boolean(id)} onClose={onClose} size="wide"
      title={bill ? `Bill ${bill.number}` : 'Bill'}
      description={bill ? `${bill.billFrom?.name} · ${date(bill.date)}` : ''}
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button>
        {bill && bill.status !== 'void' && bill.amountDueMinor === 0 ? null : null}
        {bill && bill.status !== 'void' && can('bills', 'approve') ? <Button variant="ghost" icon={<Ban />} onClick={voidIt}>Void</Button> : null}
        {bill && bill.amountDueMinor > 0 && can('bills', 'edit') ? <Button icon={<Wallet />} loading={busy} onClick={pay} disabled={receivedOf(rows) <= 0 || receivedOf(rows) > bill.amountDueMinor}>Pay {money(receivedOf(rows), currency)}</Button> : null}
      </>}>
      {!bill ? <SkeletonRows rows={6} /> : (
        <div className="stack">
          <div className="row wrap" style={{ gap: '1.5rem' }}>
            <div><div className="tiny subtle">Bill total</div><div className="strong num">{money(bill.totals.totalMinor, currency)}</div></div>
            <div><div className="tiny subtle">Input tax</div><div className="strong num">{money(bill.totals.taxMinor, currency)}</div></div>
            <div><div className="tiny subtle">Still to pay</div><div className="strong num">{money(bill.amountDueMinor, currency)}</div></div>
            <div><StatusBadge status={bill.state} /></div>
          </div>

          <div className="table-wrap">
            <CardTable>
              <thead><tr><th>Item</th><th>HSN</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">GST</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {bill.lines.map((l) => (
                  <tr key={l._id}>
                    <td>{l.description}</td><td>{l.hsn || '—'}</td><td className="num">{l.quantity} {l.unit}</td>
                    <td className="num">{money(l.priceMinor, currency)}</td><td className="num">{l.taxRate}%</td>
                    <td className="num strong">{money(l.totalMinor, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </CardTable>
          </div>

          {bill.amountDueMinor > 0 && bill.status !== 'void' && can('bills', 'edit') ? (
            <Field label="Pay this bill" hint="Add a second mode if it went out in more than one way.">
              <SplitPayment rows={rows} onChange={setRows} modes={modes} currency={currency} dueMinor={bill.amountDueMinor} />
            </Field>
          ) : null}

          {data.payments.length ? (
            <div>
              <h3 className="small strong">Paid so far</h3>
              {data.payments.map((p) => (
                <div className="list-row" key={p._id}>
                  <span className="grow">{p.mode}{p.reference ? <span className="subtle"> · {p.reference}</span> : null}<div className="tiny subtle">{date(p.date)}</div></span>
                  <span className="num strong">{money(p.amountMinor, currency)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

export function Bills({ module }) {
  const { api, slug, currency, can } = useWorkspace();
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [recording, setRecording] = useState(false);
  const [openId, setOpenId] = useState(null);
  const search = useDebounced(q);
  useEffect(() => setPage(1), [state, search]);

  const params = useMemo(() => ({ state, q: search, page }), [state, search, page]);
  const key = `bills:${slug}:${JSON.stringify(params)}`;
  const { data, loading, error, reload } = useResource(key, () => api.get('/bills', params));
  const refresh = () => { reload(); invalidate(`bills:${slug}`); };

  return (
    <>
      <PageHeader
        title={module?.label ?? 'Purchase bills'}
        description="What you have bought, and what you still owe for it."
        actions={can('bills', 'create') ? <Button icon={<Plus />} onClick={() => setRecording(true)}>Record a bill</Button> : null}
      />

      {data ? (
        <div className="grid-3 stat-strip" style={{ marginBottom: '1rem' }}>
          <div className="card stat"><div className="stat-label">Purchases</div><div className="stat-value">{money(data.sums.totalMinor, currency)}</div><div className="stat-foot">{data.total} bills</div></div>
          <div className="card stat"><div className="stat-label">Still to pay</div><div className="stat-value">{money(data.sums.totalMinor - data.sums.paidMinor, currency)}</div></div>
          <div className="card stat"><div className="stat-label">Input tax</div><div className="stat-value">{money(data.sums.inputTaxMinor, currency)}</div><div className="stat-foot">credit on these bills</div></div>
        </div>
      ) : null}

      <div className="card">
        <div style={{ padding: '0 0.9rem' }}><Tabs tabs={TABS} value={state} onChange={setState} /></div>
        <div className="toolbar">
          <div className="input-icon grow" style={{ maxWidth: 360 }}>
            <Search aria-hidden="true" />
            <input className="input" placeholder="Search bill number or vendor…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
        </div>

        {error ? <div className="card-body"><div className="alert alert-error">{error.message}</div></div> : null}
        {loading && !data ? <SkeletonRows /> : null}
        {data && !data.bills.length ? (
          <EmptyState icon={<Receipt />} title={state || q ? 'No bills match' : 'No bills yet'}
            action={can('bills', 'create') && !q && !state ? <Button icon={<Plus />} onClick={() => setRecording(true)}>Record your first bill</Button> : null}>
            Recording what you buy is what makes input tax and a profit figure possible.
          </EmptyState>
        ) : null}

        {data?.bills.length ? (
          <>
            <div className="table-wrap">
              <CardTable>
                <thead><tr><th>Bill</th><th>Vendor</th><th>Date</th><th>Due</th><th>Status</th><th className="num">Amount</th><th className="num">To pay</th></tr></thead>
                <tbody>
                  {data.bills.map((b) => (
                    <tr key={b._id} className="clickable" onClick={() => setOpenId(b._id)}>
                      <td><span className="cell-title mono">{b.number}</span></td>
                      <td>{data.vendors[b.vendor] ?? '—'}</td>
                      <td className="nowrap">{date(b.date)}</td>
                      <td className="nowrap">{b.dueDate ? date(b.dueDate) : <span className="subtle">—</span>}</td>
                      <td><StatusBadge status={b.state} />{b.totals.taxMinor ? <> <Badge tone="neutral" plain>ITC {money(b.totals.taxMinor, currency)}</Badge></> : null}</td>
                      <td className="num strong">{money(b.totals.totalMinor, currency)}</td>
                      <td className="num">{b.status === 'void' ? <span className="subtle">—</span> : money(b.amountDueMinor, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </CardTable>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        ) : null}
      </div>

      <RecordBill open={recording} onClose={() => setRecording(false)} onSaved={refresh} />
      <BillDetail id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />
    </>
  );
}
