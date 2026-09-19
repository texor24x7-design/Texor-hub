'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Barcode, Plus, Send, Trash2 } from 'lucide-react';
import { Alert, Button, Dialog, Field, PageHeader, SkeletonRows, Switch, useToast } from '@/components/ui';
import { FieldInput, GstinInput, WIDE_TYPES } from '@/components/fields/FieldInput';
import { MoneyInput } from '@/components/fields/MoneyInput';
import { ReferencePicker } from '@/components/fields/ReferencePicker';
import { RecordForm } from '@/components/records/RecordForm';
import { invalidate, prefetch } from '@/lib/data';
import { money, toDateInput } from '@/lib/format';
import { STATES, stateFromGstin } from '@/lib/shared/india.mjs';
import { computeDocument } from '@/lib/shared/tax.mjs';
import { linesFromPackage } from '@/lib/shared/packages.mjs';
import { useWorkspace } from '@/lib/workspace';

const today = () => toDateInput(new Date());

/**
 * The lines a picked catalogue row becomes — several of them when it is a
 * package, which is billed by expanding into its parts rather than as itself.
 */
function linesFromPick(item, prefs, quantity = 1) {
  if (item.kind === 'package') {
    return linesFromPackage(item, { quantity, prefs }).map((line) => ({
      ...line,
      meta: { variants: [], trackSerials: false, trackStock: false, stock: null, kind: 'component', fromPackage: item.name },
    }));
  }
  return [{ ...lineFromItem(item, prefs), quantity }];
}

function lineFromItem(item, prefs) {
  const variant = item.variants?.[0];
  return {
    item: item._id,
    description: item.name,
    variant: variant?.name ?? '',
    hsn: item.hsn ?? '',
    quantity: 1,
    unit: item.unit ?? '',
    priceMinor: variant?.priceMinor ?? item.priceMinor ?? 0,
    discountPct: 0,
    taxRate: item.taxRate ?? prefs.taxRate ?? 0,
    cessRate: item.cessRate ?? 0,
    priceIncludesTax: item.priceIncludesTax ?? prefs.priceIncludesTax ?? false,
    serials: [],
    custom: {},
    meta: { variants: item.variants ?? [], trackSerials: item.trackSerials, trackStock: item.trackStock, stock: item.stock, kind: item.kind },
  };
}

const blankLine = (prefs) => ({ item: null, description: '', variant: '', hsn: '', quantity: 1, unit: '', priceMinor: 0, discountPct: 0, taxRate: prefs.taxRate ?? 0, cessRate: 0, priceIncludesTax: prefs.priceIncludesTax ?? false, serials: [], custom: {}, meta: {} });

function QuickCustomer({ open, initialName, onClose, onCreated }) {
  const { api, slug, module } = useWorkspace();
  const customers = module('customers');
  const [form, setForm] = useState({ name: '', phone: '', email: '', gstin: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setForm({ name: initialName ?? '', phone: '', email: '', gstin: '' }); }, [open, initialName]);

  async function save() {
    setBusy(true);
    try {
      const { record } = await api.post('/records/customers', { ...form, stateCode: stateFromGstin(form.gstin) || undefined });
      invalidate(`records:${slug}:customers`);
      onCreated(record);
    } catch (error) {
      setErrors({ ...error.fieldErrors, _: error.message });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`New ${customers?.labelSingular.toLowerCase() ?? 'customer'}`} description="Just the essentials — you can add the rest later."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Add</Button></>}>
      <div className="stack">
        {errors._ && !Object.keys(errors).some((k) => k !== '_') ? <Alert>{errors._}</Alert> : null}
        {Object.keys(errors).some((k) => k.startsWith('custom.')) ? <Alert kind="warning">This form has required fields. <Link href={`/w/${slug}/customers/new`}>Open the full form</Link>.</Alert> : null}
        <Field label="Name" required error={errors.name}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <div className="grid-2">
          <Field label="Phone" error={errors.phone}><input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Email" error={errors.email}><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        </div>
        <Field label="GSTIN" hint="For business customers — sets the place of supply." error={errors.gstin}><GstinInput value={form.gstin} onChange={(gstin) => setForm({ ...form, gstin })} /></Field>
      </div>
    </Dialog>
  );
}

const FULL_FORM_ID = 'quick-item-form';

/** Module defaults, with whatever was already typed in the quick form on top. */
function seedItem(module, form) {
  const record = { custom: {} };
  for (const field of module?.fields ?? []) {
    if (field.default === undefined) continue;
    if (field.custom) record.custom[field.key] = field.default;
    else record[field.key] = field.default;
  }
  return { ...record, name: form.name, priceMinor: form.priceMinor, taxRate: form.taxRate, hsn: form.hsn };
}

/**
 * Add to the catalogue without leaving the document. Starts on the four fields
 * a counter actually needs, and expands in place to the module's whole form —
 * navigating to that form instead would take the half-typed document with it.
 */
function QuickItem({ open, initialName, onClose, onCreated }) {
  const { api, slug, can, prefs, currency, module } = useWorkspace();
  const kinds = ['product', 'service'].filter((k) => can(`${k}s`, 'create'));
  const [form, setForm] = useState({ kind: 'product', name: '', priceMinor: 0, taxRate: 0, hsn: '' });
  const [full, setFull] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({ kind: kinds[0] ?? 'product', name: initialName ?? '', priceMinor: 0, taxRate: prefs.taxRate ?? 0, hsn: '' });
    setFull(false);
    setErrors({});
  }, [open, initialName]); // eslint-disable-line react-hooks/exhaustive-deps

  const itemModule = module(`${form.kind}s`);
  const noun = itemModule?.labelSingular.toLowerCase() ?? form.kind;

  // Throws on failure so RecordForm can show the field errors itself.
  async function create(body) {
    const { record } = await api.post(`/records/${form.kind}s`, body);
    invalidate(`records:${slug}:${form.kind}s`);
    onCreated({ ...record, kind: form.kind });
  }

  async function saveQuick() {
    setBusy(true);
    try {
      const { kind, ...rest } = form;
      await create({ ...rest, priceIncludesTax: prefs.priceIncludesTax ?? false });
    } catch (error) {
      setErrors({ ...error.fieldErrors, _: error.message });
    } finally { setBusy(false); }
  }

  // RecordForm shows the field errors; this only drives the footer's spinner.
  async function saveFull(values) {
    setBusy(true);
    try { await create(values); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} size={full ? 'wide' : undefined}
      title={`New ${noun}`}
      description={full ? `Everything this workspace keeps about a ${noun}.` : 'Just the essentials — you can add the rest later.'}
      footer={full ? (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FULL_FORM_ID} loading={busy}>Add {noun}</Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={() => setFull(true)}>Add full details</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={saveQuick} loading={busy}>Add</Button>
        </>
      )}>
      <div className="stack">
        {errors._ && !Object.keys(errors).some((k) => k !== '_') ? <Alert>{errors._}</Alert> : null}
        {Object.keys(errors).some((k) => k.startsWith('custom.')) ? (
          <Alert kind="warning">This {noun} has required details. <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFull(true)}>Fill them in</button></Alert>
        ) : null}
        {kinds.length > 1 ? (
          <Field label="Kind">
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {kinds.map((k) => <option key={k} value={k}>{module(`${k}s`)?.labelSingular ?? k}</option>)}
            </select>
          </Field>
        ) : null}
        {full ? (
          <RecordForm key={form.kind} formId={FULL_FORM_ID} module={itemModule}
            record={seedItem(itemModule, form)} onSubmit={saveFull} />
        ) : (
          <>
            <Field label="Name" required error={errors.name}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
            <div className="grid-2">
              <Field label="Price" error={errors.priceMinor}><MoneyInput value={form.priceMinor} currency={currency} onChange={(priceMinor) => setForm({ ...form, priceMinor: priceMinor ?? 0 })} /></Field>
              <Field label="Tax rate" hint="%" error={errors.taxRate}><input className="input" type="number" min="0" max="100" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) || 0 })} /></Field>
            </div>
            <Field label="HSN / SAC" error={errors.hsn}><input className="input" value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })} /></Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Create or edit a quotation or invoice. Totals are computed live with the same
 * tax engine the API uses, so what is shown here is what gets stored.
 */
export function DocumentEditor({ module, id }) {
  const { api, slug, href, can, workspace, prefs, currency, module: moduleOf, hidden } = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const kind = module.key;
  const isInvoice = kind === 'invoices';
  const isNote = kind === 'credit_notes' || kind === 'debit_notes';
  const lineModule = moduleOf('lines');
  const customLineFields = (lineModule?.fields ?? []).filter((f) => f.custom && !f.hidden);
  const headerFields = module.fields.filter((f) => f.custom && !f.hidden && !hidden(kind).includes(f.key));
  const label = (key, fallback) => lineModule?.fields.find((f) => f.key === key)?.label ?? fallback;

  const [loaded, setLoaded] = useState(!id);
  const [doc, setDoc] = useState(() => ({
    customer: null, customerTitle: '', customerState: '', date: today(), dueDate: '', validUntil: '', placeOfSupply: '', reference: '',
    notes: '', terms: (kind === 'invoices' ? prefs.terms : prefs.quotationTerms ?? prefs.terms) ?? '', custom: {}, lines: [blankLine(prefs)], discount: null, roundOff: prefs.roundOff ?? false,
  }));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [quick, setQuick] = useState(null);
  const [quickItem, setQuickItem] = useState(null);
  const [barcode, setBarcode] = useState('');
  const [status, setStatus] = useState('draft');
  const [refs, setRefs] = useState({});
  const scanRef = useRef(null);
  const restored = useRef(false);

  // Losing a half-filled document to a stray navigation is the worst thing this
  // editor can do, so an unsaved one is mirrored to localStorage as it is typed.
  const draftKey = `finvoice:draft:${slug}:${kind}`;

  useEffect(() => {
    if (id || restored.current) return;
    restored.current = true;
    if (params.get('customer')) return; // "bill this customer" beats an old draft
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      setDoc(JSON.parse(raw));
      toast('Restored your unsaved draft');
    } catch { /* private mode, or a draft from an older shape */ }
  }, [id, draftKey, params, toast]);

  useEffect(() => {
    if (id || !restored.current) return;
    const worth = doc.customer || doc.lines.some((l) => l.item || l.description.trim());
    try {
      if (worth) localStorage.setItem(draftKey, JSON.stringify(doc));
      else localStorage.removeItem(draftKey);
    } catch { /* ignore */ }
  }, [doc, id, draftKey]);

  useEffect(() => {
    if (!id) {
      const customer = params.get('customer');
      if (customer) {
        api.get(`/records/customers/${customer}`).then(({ record }) => setDoc((d) => ({ ...d, customer: record._id, customerTitle: record.name, customerState: record.stateCode }))).catch(() => {});
      }
      return;
    }
    api.get(`/documents/${kind}/${id}`).then(({ document: d }) => {
      setStatus(d.status);
      const itemIds = [...new Set(d.lines.filter((l) => l.item).map((l) => l.item))];
      setDoc({
        customer: d.customer, customerTitle: d.billTo?.name, customerState: d.billTo?.stateCode, date: toDateInput(d.date),
        dueDate: toDateInput(d.dueDate), validUntil: toDateInput(d.validUntil), placeOfSupply: d.placeOfSupply, reference: d.reference,
        notes: d.notes, terms: d.terms, custom: d.custom ?? {}, discount: d.discount?.value ? d.discount : null, roundOff: d.roundOff,
        lines: d.lines.map((l) => ({ ...l, meta: {} })),
      });
      setLoaded(true);
      // Fill in variants and serial flags for existing lines.
      if (itemIds.length) {
        api.get('/items', { limit: 100 }).then(({ items }) => {
          const byId = new Map(items.map((i) => [i._id, i]));
          setDoc((cur) => ({ ...cur, lines: cur.lines.map((l) => { const it = byId.get(l.item); return it ? { ...l, meta: { variants: it.variants ?? [], trackSerials: it.trackSerials, trackStock: it.trackStock, stock: it.stock, kind: it.kind } } : l; }) }));
        }).catch(() => {});
      }
    }).catch((loadError) => { setError(loadError.message); setLoaded(true); });
  }, [id, kind, api, params]);

  const taxMode = workspace.gstin ? 'gst' : 'none';
  const placeOfSupply = doc.placeOfSupply || doc.customerState || workspace.stateCode;
  const computed = useMemo(() => computeDocument({
    lines: doc.lines, sellerState: workspace.stateCode, placeOfSupply, discount: doc.discount, roundOff: doc.roundOff, taxMode, currency,
  }), [doc.lines, doc.discount, doc.roundOff, placeOfSupply, workspace.stateCode, taxMode, currency]);

  const set = (patch) => setDoc((d) => ({ ...d, ...patch }));
  const setLine = (index, patch) => setDoc((d) => ({ ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  const removeLine = (index) => setDoc((d) => ({ ...d, lines: d.lines.length === 1 ? [blankLine(prefs)] : d.lines.filter((_, i) => i !== index) }));
  const addItem = (item) => setDoc((d) => {
    // Scanning the same thing twice bumps the quantity — but a package expands,
    // so there is no single line of its to bump.
    const existing = item.kind === 'package'
      ? -1
      : d.lines.findIndex((l) => l.item === item._id && !item.trackSerials && !item.variants?.length);
    if (existing >= 0) return { ...d, lines: d.lines.map((l, i) => (i === existing ? { ...l, quantity: l.quantity + 1 } : l)) };
    const lines = d.lines.filter((l) => l.item || l.description);
    return { ...d, lines: [...lines, ...linesFromPick(item, prefs)] };
  });

  async function scan(e) {
    e.preventDefault();
    const code = barcode.trim();
    if (!code) return;
    try {
      const { items } = await api.get('/items', { q: code, limit: 5 });
      const match = items.find((i) => i.barcode === code) ?? (items.length === 1 ? items[0] : null);
      if (match) { addItem(match); setBarcode(''); } else toast(`Nothing in the catalogue matches “${code}”.`, 'error');
    } catch (scanError) { toast(scanError.message, 'error'); }
    scanRef.current?.focus();
  }

  function body() {
    return {
      customer: doc.customer,
      date: doc.date,
      ...(isInvoice ? { dueDate: doc.dueDate || null } : isNote ? {} : { validUntil: doc.validUntil || null }),
      placeOfSupply: doc.placeOfSupply || '',
      reference: doc.reference,
      notes: doc.notes,
      terms: doc.terms,
      custom: doc.custom,
      discount: doc.discount?.value ? { type: doc.discount.type, value: doc.discount.type === 'percent' ? Number(doc.discount.value) : doc.discount.value } : null,
      roundOff: doc.roundOff,
      lines: doc.lines.filter((l) => l.item || l.description.trim()).map(({ meta, _id, grossMinor, discountMinor, taxableMinor, cgstMinor, sgstMinor, igstMinor, cessMinor, totalMinor, kind: _k, ...l }) => ({
        ...l, quantity: Number(l.quantity) || 0, discountPct: Number(l.discountPct) || 0, taxRate: Number(l.taxRate) || 0, cessRate: Number(l.cessRate) || 0,
        discountAmountMinor: l.discountAmountMinor == null ? null : Math.round(Number(l.discountAmountMinor)) || 0,
        serials: (l.serials ?? []).map((s) => s.trim()).filter(Boolean),
      })),
    };
  }

  async function save(then) {
    setBusy(then);
    setError(null);
    setErrors({});
    try {
      const { document: saved } = id ? await api.patch(`/documents/${kind}/${id}`, body()) : await api.post(`/documents/${kind}`, body());
      // An invoice needs a number before it can go anywhere, so sending issues it too.
      if (then !== 'draft' && isInvoice) await api.post(`/documents/invoices/${saved._id}/issue`);
      if (then !== 'draft' && isNote) await api.post(`/documents/${kind}/${saved._id}/issue-note`);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      invalidate(`documents:${slug}:${kind}`);
      invalidate(`document:${slug}:${kind}:${saved._id}`);
      invalidate(`dashboard:${slug}`);
      // Start composing now so the send sheet is already filled in when it opens.
      if (then === 'send') prefetch(`compose:${slug}:${kind}:${saved._id}`, () => api.get(`/documents/${kind}/${saved._id}/compose`));
      if (then !== 'send') toast(then === 'issue' ? `${module.labelSingular} issued` : 'Saved');
      // The view decides whether that means a roll of paper or nothing at all.
      const after = [then === 'send' ? 'send=1' : '', then !== 'draft' ? 'printed=1' : ''].filter(Boolean).join('&');
      router.replace(href(`/${kind}/${saved._id}`) + (after ? `?${after}` : ''));
    } catch (saveError) {
      setError(saveError.message);
      setErrors(saveError.fieldErrors ?? {});
      setBusy(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  const canSendNow = (!isInvoice && !isNote) || can(kind, 'approve');

  // No dependency list: the handler has to see the current `save` and `busy` every render.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter' || busy) return;
      e.preventDefault();
      save(canSendNow ? 'send' : 'draft');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!loaded) return <SkeletonRows rows={10} />;
  if (id && (isInvoice || isNote) && status !== 'draft') {
    return <Alert kind="info" title="This invoice has been issued">Its figures are final. <Link href={href(`/${kind}/${id}`)}>Open it</Link> to record payments, send it, change the due date or void it.</Alert>;
  }

  // Only an approver can issue, and an invoice cannot be sent before it is issued.
  const canSend = (!isInvoice && !isNote) || can(kind, 'approve');
  const canAddItem = can('products', 'create') || can('services', 'create');
  const showSerialColumn = doc.lines.some((l) => l.meta?.trackSerials || l.serials?.length);
  const interState = computed.interState;
  const t = computed.totals;
  // Savings taken on the lines themselves — a package shares its discount out
  // this way — kept apart from the document discount so neither row shows the
  // other's money.
  const lineDiscountMinor = computed.lines.reduce((sum, l, i) => {
    const line = doc.lines[i];
    if (!line) return sum;
    const gross = Math.round((Number(line.quantity) || 0) * (Number(line.priceMinor) || 0));
    return sum + (line.discountAmountMinor == null
      ? Math.round((gross * Math.min(Math.max(Number(line.discountPct) || 0, 0), 100)) / 100)
      : Math.min(Math.max(Math.round(Number(line.discountAmountMinor)), 0), gross));
  }, 0);
  const docDiscountMinor = Math.max(t.discountMinor - lineDiscountMinor, 0);

  return (
    <>
      <PageHeader
        sticky
        title={id ? `Edit ${module.labelSingular.toLowerCase()}` : `New ${module.labelSingular.toLowerCase()}`}
        crumbs={[{ label: module.label, href: href(`/${kind}`) }, { label: id ? 'Edit' : 'New' }]}
        actions={(
          <>
            <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
            <Button variant={canSend ? 'secondary' : 'primary'} loading={busy === 'draft'} onClick={() => save('draft')}>{isInvoice || isNote ? 'Save draft' : 'Save'}</Button>
            {(isInvoice || isNote) && canSend ? <Button variant="secondary" loading={busy === 'issue'} onClick={() => save('issue')}>Save & issue</Button> : null}
            {canSend ? <Button icon={<Send />} loading={busy === 'send'} onClick={() => save('send')} title="Save and send (⌘↵ or Ctrl+↵)">Save & send</Button> : null}
          </>
        )}
      />

      <div className="stack">
        {error ? <Alert kind="error" title={error}>{Object.values(errors).filter(Boolean).slice(0, 4).join(' ')}</Alert> : null}
        {taxMode === 'none' ? <Alert kind="info">No GST is charged because this business has no GSTIN. <Link href={href('/settings/business')}>Add your GSTIN</Link> to issue tax invoices.</Alert> : null}

        <section className="card">
          <div className="card-body stack">
            <div className="grid-4">
              <Field label={moduleOf('customers')?.labelSingular ?? 'Customer'} required error={errors.customer} className="span-2">
                <ReferencePicker
                  refModule="customers"
                  value={doc.customer}
                  title={doc.customerTitle}
                  invalid={Boolean(errors.customer)}
                  onChange={(value, row) => set({ customer: value, customerTitle: row?.title ?? '', customerState: row?.raw?.stateCode ?? '', placeOfSupply: '' })}
                  onCreate={can('customers', 'create') ? (name) => setQuick(name) : undefined}
                />
              </Field>
              <Field label={module.fields.find((f) => f.key === 'date')?.label ?? 'Date'} required error={errors.date}>
                <input type="date" className="input" value={doc.date} onChange={(e) => set({ date: e.target.value })} />
              </Field>
              {isInvoice && module.fields.find((f) => f.key === 'dueDate')?.hidden ? null : isInvoice ? (
                <Field label={module.fields.find((f) => f.key === 'dueDate')?.label ?? 'Due date'} error={errors.dueDate}><input type="date" className="input" value={doc.dueDate} onChange={(e) => set({ dueDate: e.target.value })} placeholder={prefs.dueDays ? `${prefs.dueDays} days` : ''} /></Field>
              ) : isNote ? null : (
                <Field label={module.fields.find((f) => f.key === 'validUntil')?.label ?? 'Valid until'} error={errors.validUntil}><input type="date" className="input" value={doc.validUntil} onChange={(e) => set({ validUntil: e.target.value })} /></Field>
              )}
            </div>
            <div className="grid-4">
              <Field label="Place of supply" hint={taxMode === 'gst' ? (interState ? 'Other state — IGST applies' : 'Same state — CGST + SGST') : undefined}>
                <select className="input" value={doc.placeOfSupply || placeOfSupply || ''} onChange={(e) => set({ placeOfSupply: e.target.value })}>
                  <option value="">—</option>
                  {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              </Field>
              <Field label={module.fields.find((f) => f.key === 'reference')?.label ?? 'Reference'}><input className="input" value={doc.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
              {headerFields.map((f) => (
                <Field key={f.key} label={f.label} required={f.required} error={errors[`custom.${f.key}`]} className={WIDE_TYPES.has(f.type) ? 'span-2' : ''}>
                  <FieldInput field={f} moduleKey={kind} value={doc.custom[f.key]} onChange={(value) => set({ custom: { ...doc.custom, [f.key]: value } })} id={`h-${f.key}`} refs={refs} />
                </Field>
              ))}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Items</h2>
            <form className="row" onSubmit={scan}>
              <div className="input-icon" style={{ width: 240 }}>
                <Barcode aria-hidden="true" />
                <input ref={scanRef} className="input input-sm" style={{ height: 32 }} placeholder="Scan barcode or SKU" value={barcode} onChange={(e) => setBarcode(e.target.value)} aria-label="Barcode" />
              </div>
            </form>
          </div>
          <div className="table-wrap" style={{ padding: '0.25rem 0.75rem' }}>
            <table className="lines-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 260 }}>{label('description', 'Item')}</th>
                  {customLineFields.map((f) => <th key={f.key} style={{ minWidth: 150 }}>{f.label}</th>)}
                  <th style={{ width: 90 }}>{label('hsn', 'HSN/SAC')}</th>
                  <th style={{ width: 90 }} className="num">{label('quantity', 'Qty')}</th>
                  <th style={{ width: 150 }} className="num">{label('priceMinor', 'Rate')}</th>
                  <th style={{ width: 80 }} className="num">{label('discountPct', 'Disc %')}</th>
                  {taxMode === 'gst' ? <th style={{ width: 90 }} className="num">{label('taxRate', 'GST %')}</th> : null}
                  <th style={{ width: 130 }} className="num">Amount</th>
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((line, index) => {
                  const err = (k) => errors[`lines.${index}.${k}`];
                  return [
                    <tr key={`l-${index}`}>
                      <td>
                        <div className="stack-sm">
                          <ReferencePicker
                            refModule="items"
                            value={line.item}
                            title={line.description}
                            invalid={Boolean(err('description'))}
                            placeholder="Search products & services…"
                            onChange={(value, row) => (row
                              ? setDoc((d) => {
                                // A splice, not a map: a package replaces this one row with several.
                                const picked = linesFromPick(row.raw, prefs, d.lines[index]?.quantity || 1);
                                return { ...d, lines: [...d.lines.slice(0, index), ...picked, ...d.lines.slice(index + 1)] };
                              })
                              : setLine(index, { item: null }))}
                            onCreate={canAddItem ? (text) => setQuickItem({ index, name: text }) : (text) => setLine(index, { item: null, description: text, meta: {} })}
                            createLabel={canAddItem ? undefined : 'Use as a one-off line'}
                          />
                          {line.meta?.variants?.length ? (
                            <select className="input input-sm" value={line.variant} onChange={(e) => { const v = line.meta.variants.find((x) => x.name === e.target.value); setLine(index, { variant: e.target.value, priceMinor: v?.priceMinor ?? line.priceMinor }); }}>
                              {line.meta.variants.map((v) => <option key={v.name} value={v.name}>{v.name} — {money(v.priceMinor, currency)}</option>)}
                            </select>
                          ) : null}
                          {!line.item ? <input className="input input-sm" placeholder="Description" value={line.description} onChange={(e) => setLine(index, { description: e.target.value })} /> : null}
                          {line.meta?.trackStock && line.meta.stock != null && line.meta.stock < line.quantity ? <span className="field-error">Only {line.meta.stock} in stock</span> : null}
                          {err('description') ? <span className="field-error">{err('description')}</span> : null}
                        </div>
                      </td>
                      {customLineFields.map((f) => (
                        <td key={f.key}><FieldInput field={f} moduleKey="lines" value={line.custom?.[f.key]} onChange={(value) => setLine(index, { custom: { ...line.custom, [f.key]: value } })} id={`line-${index}-${f.key}`} refs={refs} /></td>
                      ))}
                      <td><input className="input input-sm" value={line.hsn} onChange={(e) => setLine(index, { hsn: e.target.value.replace(/\D/g, '').slice(0, 8) })} inputMode="numeric" /></td>
                      <td><input className="input input-sm num" type="number" min="0" step="any" value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} aria-label="Quantity" />{line.unit ? <div className="tiny subtle right">{line.unit}</div> : null}</td>
                      <td>
                        <MoneyInput size="sm" value={line.priceMinor} currency={currency} onChange={(priceMinor) => setLine(index, { priceMinor: priceMinor ?? 0 })} />
                        {taxMode === 'gst' ? <label className="check tiny subtle" style={{ marginTop: 4 }}><input type="checkbox" checked={line.priceIncludesTax} onChange={(e) => setLine(index, { priceIncludesTax: e.target.checked })} />incl. GST</label> : null}
                      </td>
                      <td>
                        {line.discountAmountMinor == null ? (
                          <input className="input input-sm num" type="number" min="0" max="100" step="any" value={line.discountPct || ''} placeholder="0" onChange={(e) => setLine(index, { discountPct: e.target.value })} aria-label="Discount percent" />
                        ) : (
                          // A package shares its saving out as exact amounts, so show the
                          // amount rather than a percentage that would not be the truth.
                          <MoneyInput size="sm" value={line.discountAmountMinor} currency={currency} onChange={(v) => setLine(index, { discountAmountMinor: v ?? 0 })} />
                        )}
                      </td>
                      {taxMode === 'gst' ? (
                        <td>
                          <select className="input input-sm" value={line.taxRate} onChange={(e) => setLine(index, { taxRate: Number(e.target.value) })} aria-label="GST rate">
                            {[...new Set([0, 0.25, 3, 5, 18, 40, Number(line.taxRate)])].sort((a, b) => a - b).map((r) => <option key={r} value={r}>{r}%</option>)}
                          </select>
                        </td>
                      ) : null}
                      <td className="num strong" style={{ paddingTop: '0.9rem' }}>{money(computed.lines[index]?.totalMinor ?? 0, currency)}</td>
                      <td><Button variant="ghost" size="sm" icon={<Trash2 />} aria-label="Remove line" onClick={() => removeLine(index)} /></td>
                    </tr>,
                    (line.meta?.trackSerials || line.serials?.length) ? (
                      <tr key={`s-${index}`}>
                        <td colSpan={8 + customLineFields.length}>
                          <Field label={`Serial numbers (${(line.serials ?? []).length} of ${line.quantity})`} error={err('serials')}>
                            <input className={`input input-sm mono${err('serials') ? ' invalid' : ''}`} placeholder="Scan or type serial numbers, separated by commas" value={(line.serials ?? []).join(', ')} onChange={(e) => setLine(index, { serials: e.target.value.split(/[,\n]/).map((s) => s.trimStart()) })} />
                          </Field>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
          <div className="card-body row row-between row-top wrap" style={{ gap: '2rem' }}>
            <Button variant="secondary" size="sm" icon={<Plus />} onClick={() => setDoc((d) => ({ ...d, lines: [...d.lines, blankLine(prefs)] }))}>Add line</Button>
            <div className="totals-box" style={{ width: 'min(380px, 100%)' }}>
              <div className="row"><span className="muted">Subtotal</span><span className="num">{money(t.grossMinor, currency)}</span></div>
              {lineDiscountMinor ? (
                <div className="row"><span className="muted">Savings on lines</span><span className="num">−{money(lineDiscountMinor, currency)}</span></div>
              ) : null}
              <div className="row">
                <span className="row muted" style={{ gap: 6 }}>
                  Discount
                  <select className="input input-sm" style={{ width: 70, height: 28 }} value={doc.discount?.type ?? 'percent'} onChange={(e) => set({ discount: { type: e.target.value, value: 0 } })} aria-label="Discount type"><option value="percent">%</option><option value="amount">₹</option></select>
                  {doc.discount?.type === 'amount'
                    ? <div style={{ width: 120 }}><MoneyInput size="sm" value={doc.discount?.value ?? 0} currency={currency} onChange={(value) => set({ discount: { type: 'amount', value: value ?? 0 } })} /></div>
                    : <input className="input input-sm num" style={{ width: 70, height: 28 }} type="number" min="0" max="100" value={doc.discount?.value || ''} placeholder="0" onChange={(e) => set({ discount: { type: 'percent', value: e.target.value } })} aria-label="Discount" />}
                </span>
                <span className="num">{docDiscountMinor ? `−${money(docDiscountMinor, currency)}` : '—'}</span>
              </div>
              {taxMode === 'gst' ? (
                <>
                  <div className="row"><span className="muted">Taxable amount</span><span className="num">{money(t.taxableMinor, currency)}</span></div>
                  {interState ? <div className="row"><span className="muted">IGST</span><span className="num">{money(t.igstMinor, currency)}</span></div> : (
                    <>
                      <div className="row"><span className="muted">CGST</span><span className="num">{money(t.cgstMinor, currency)}</span></div>
                      <div className="row"><span className="muted">SGST</span><span className="num">{money(t.sgstMinor, currency)}</span></div>
                    </>
                  )}
                  {t.cessMinor ? <div className="row"><span className="muted">Cess</span><span className="num">{money(t.cessMinor, currency)}</span></div> : null}
                </>
              ) : null}
              <div className="row"><Switch checked={doc.roundOff} onChange={(roundOff) => set({ roundOff })} label={<span className="muted">Round off</span>} /><span className="num">{t.roundOffMinor ? money(t.roundOffMinor, currency) : '—'}</span></div>
              <div className="row grand"><span>Total</span><span className="num">{money(t.totalMinor, currency)}</span></div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-body grid-2">
            <Field label={module.fields.find((f) => f.key === 'notes')?.label ?? 'Notes'} hint="Printed on the document."><textarea className="input" rows={3} value={doc.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
            <Field label={module.fields.find((f) => f.key === 'terms')?.label ?? 'Terms & conditions'} hint={!id ? 'Pre-filled from your settings.' : undefined}><textarea className="input" rows={3} value={doc.terms} onChange={(e) => set({ terms: e.target.value })} /></Field>
          </div>
        </section>
      </div>

      <QuickItem open={quickItem != null} initialName={quickItem?.name}
        onClose={() => setQuickItem(null)}
        onCreated={(item) => { setDoc((d) => ({ ...d, lines: d.lines.map((l, i) => (i === quickItem.index ? { ...lineFromItem(item, prefs), quantity: l.quantity || 1 } : l)) })); setQuickItem(null); }} />
      <QuickCustomer open={quick != null} initialName={quick} onClose={() => setQuick(null)} onCreated={(record) => { set({ customer: record._id, customerTitle: record.name, customerState: record.stateCode }); setRefs((r) => ({ ...r, [record._id]: { title: record.name } })); setQuick(null); }} />
    </>
  );
}
