'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Ban, CheckCircle2, Copy, CreditCard, Download, FileCheck2, FileMinus2, FilePlus2, MoreHorizontal, Pencil, Printer, Receipt, Repeat, Send, ShieldCheck, Trash2, Wallet, XCircle } from 'lucide-react';
import { Alert, Badge, Button, ButtonLink, Dialog, Field, Menu, MenuItem, PageHeader, SkeletonRows, StatusBadge, fitFrame, useConfirm, useToast } from '@/components/ui';
import { Activity } from '@/components/records/Activity';
import { invalidate, useResource } from '@/lib/data';
import { date, dateTime, money, toDateInput } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';
import { PaymentDialog, SendDialog } from './DocumentActions';
import { RepeatDialog } from './RepeatDialog';
import { ThermalPrint, rollWidthOf } from './ThermalPrint';

/** The server-rendered document in a sandboxed frame: no scripts, same markup as the PDF. */
function Preview({ kind, id, design, version }) {
  const { api } = useWorkspace();
  const [html, setHtml] = useState('');
  const [height, setHeight] = useState(1200);
  const frame = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.text(`/documents/${kind}/${id}/html${design ? `?design=${encodeURIComponent(design)}` : ''}`).then((text) => { if (!cancelled) setHtml(text); }).catch(() => {});
    return () => { cancelled = true; };
  }, [api, kind, id, design, version]);

  const fit = useCallback(() => {
    const next = fitFrame(frame.current);
    if (next) setHeight(next);
  }, []);
  useEffect(() => { window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit); }, [fit]);

  if (!html) return <div className="card"><SkeletonRows rows={14} /></div>;
  return <iframe ref={frame} title="Document preview" className="doc-frame" sandbox="allow-same-origin" srcDoc={html} style={{ height }} onLoad={() => { fit(); setTimeout(fit, 400); }} />;
}

export function DocumentView({ module, id }) {
  const { api, slug, href, can, currency, member, module: moduleOf, prefs } = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const kind = module.key;
  const isInvoice = kind === 'invoices';
  const key = `document:${slug}:${kind}:${id}`;
  const { data, error, reload } = useResource(key, () => api.get(`/documents/${kind}/${id}`));
  const { data: designs } = useResource(`designs:${slug}`, () => api.get('/designs'));
  const { data: deliveries, reload: reloadDeliveries } = useResource(`deliveries:${slug}:${id}`, () => api.get(`/documents/${kind}/${id}/deliveries`));
  const [paying, setPaying] = useState(false);
  // Arriving from "Save & send" — open the send sheet straight away.
  const [sending, setSending] = useState(() => params.get('send') === '1');
  const [repeating, setRepeating] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(null);
  const [version, setVersion] = useState(0);

  // Which design this document prints on, and whether that design is a roll.
  // Both the document and the designs have to be in before this can be decided:
  // falling back to the workspace default early would print an A4 invoice on a
  // workspace whose default happens to be a roll.
  const rollMm = data && designs
    ? rollWidthOf(designs.designs?.find((d) => d.key === (data.document.design || prefs.design || 'classic')))
    : null;

  // Arriving straight from an issue, on a roll: run the printer once, then drop
  // the flag so a refresh does not print it again.
  useEffect(() => {
    if (!rollMm || params.get('printed') !== '1') return;
    setPrinting(true);
    router.replace(`${window.location.pathname}${params.get('send') === '1' ? '?send=1' : ''}`, { scroll: false });
  }, [rollMm, params, router]);

  if (error) return <Alert kind="error" title={`Could not open this ${module.labelSingular.toLowerCase()}`}>{error.message}</Alert>;
  if (!data) return <SkeletonRows rows={10} />;
  const { document: doc, related } = data;
  const refresh = () => { reload(); setVersion((v) => v + 1); invalidate(`documents:${slug}:${kind}`); invalidate(`dashboard:${slug}`); };

  async function act(name, run, success) {
    setBusy(name);
    try {
      const result = await run();
      toast(success);
      refresh();
      return result;
    } catch (actError) {
      toast(actError.message, 'error');
      return null;
    } finally { setBusy(null); }
  }

  const issue = () => act('issue', () => api.post(`/documents/invoices/${id}/issue`), `${module.labelSingular} issued`);
  const issueNote = () => act('issue', () => api.post(`/documents/${kind}/${id}/issue-note`), `${module.labelSingular} issued`);

  /** Raises a Razorpay link for what is still owed and copies it to the clipboard. */
  async function paymentLink() {
    const result = await act('link', () => api.post(`/documents/invoices/${id}/payment-link`), 'Payment link copied');
    if (result?.url) navigator.clipboard?.writeText(result.url);
  }

  /** Drafts a note that mirrors this invoice and opens it, so the lines can be trimmed. */
  async function raiseNote(noteKind) {
    const result = await act('note', () => api.post(`/documents/invoices/${id}/note/${noteKind}`), 'Draft note created');
    if (result?.document) router.push(href(`/${noteKind}/${result.document._id}/edit`));
  }
  const transition = (action, label) => act(action, () => api.post(`/documents/quotations/${id}/${action}`), label);
  async function convert() {
    const result = await act('convert', () => api.post(`/documents/quotations/${id}/convert`), 'Draft invoice created');
    // The invoice view, not the editor: the figures came from an accepted quotation,
    // so the common case is issuing it, not editing it again.
    if (result?.document) router.push(href(`/invoices/${result.document._id}`));
  }
  // A draft invoice has no number yet, so Send issues it first instead of disappearing.
  async function sendNow() {
    if (isInvoice && doc.status === 'draft') {
      if (!(await act('send', () => api.post(`/documents/invoices/${id}/issue`), `${module.labelSingular} issued`))) return;
      await reload();
    }
    setSending(true);
  }
  async function remove() {
    if (!(await confirm({ title: `Delete this ${module.labelSingular.toLowerCase()}?`, message: 'It will be removed permanently.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.del(`/documents/${kind}/${id}`);
      invalidate(`documents:${slug}:${kind}`);
      router.replace(href(`/${kind}`));
    } catch (deleteError) { toast(deleteError.message, 'error'); }
  }
  async function removePayment(payment) {
    if (!(await confirm({ title: 'Remove this payment?', message: `${money(payment.amountMinor, currency)} by ${payment.mode} on ${date(payment.date)} will be removed and the balance restored.`, confirmLabel: 'Remove payment', danger: true }))) return;
    act('payment', () => api.del(`/payments/${payment._id}`), 'Payment removed');
  }
  const setDesign = (design) => act('design', () => api.patch(`/documents/${kind}/${id}`, { design }), 'Design changed');
  const setDue = (dueDate) => act('due', () => api.patch(`/documents/${kind}/${id}`, { dueDate: dueDate || null }), 'Due date updated');

  // An issued invoice is final for everyone but the owner, who may correct a
  // wrong figure rather than leave the business with no way to fix it.
  const amendable = isInvoice && member?.role === 'owner' && ['issued', 'partial', 'paid'].includes(doc.status);
  const editable = amendable || (isInvoice ? doc.status === 'draft' : ['draft', 'sent'].includes(doc.status));
  const needsIssuer = isInvoice && doc.status === 'draft' && !can('invoices', 'approve');
  const pdfUrl = api.url(`/documents/${kind}/${id}/pdf?download=1`);
  const publicLink = doc.publicToken && !(isInvoice && doc.status === 'draft') ? `${window.location.origin}/d/${doc.publicToken}` : null;

  const invoices = moduleOf('invoices');
  const schedules = moduleOf('schedules');
  const isNote = kind === 'credit_notes' || kind === 'debit_notes';
  const creditNotes = moduleOf('credit_notes');
  const debitNotes = moduleOf('debit_notes');

  return (
    <>
      <PageHeader
        title={doc.number ?? `Draft ${module.labelSingular.toLowerCase()}`}
        badge={<StatusBadge status={doc.state} />}
        crumbs={[{ label: module.label, href: href(`/${kind}`) }, { label: doc.number ?? 'Draft' }]}
        description={<>For <Link href={href(`/customers/${doc.customer}`)}>{doc.billTo?.name}</Link> · {date(doc.date)}{doc.source?.title && doc.source.module !== 'quotations' ? <> · from <Link href={href(`/${doc.source.module}/${doc.source.record}`)}>{doc.source.title}</Link></> : null}</>}
        actions={(
          <>
            {editable && can(kind, 'edit') ? <ButtonLink variant="secondary" href={href(`/${kind}/${id}/edit`)} icon={<Pencil />}>Edit</ButtonLink> : null}
            {isInvoice && doc.status === 'draft' && can('invoices', 'approve') ? <Button icon={<FileCheck2 />} onClick={issue} loading={busy === 'issue'}>Issue invoice</Button> : null}
            {isNote && doc.status === 'draft' && can(kind, 'approve') ? <Button icon={<FileCheck2 />} onClick={issueNote} loading={busy === 'issue'}>Issue {module.labelSingular.toLowerCase()}</Button> : null}
            {isInvoice && ['issued', 'partial'].includes(doc.status) && can('payments', 'create') ? <Button icon={<Wallet />} onClick={() => setPaying(true)}>Record payment</Button> : null}
            {!isInvoice && ['draft', 'sent', 'accepted'].includes(doc.status) && invoices && can('invoices', 'create') ? <Button icon={<Receipt />} onClick={convert} loading={busy === 'convert'}>Convert to {invoices.labelSingular.toLowerCase()}</Button> : null}
            {doc.status !== 'void' ? <Button variant="secondary" icon={<Send />} onClick={sendNow} loading={busy === 'send'} disabled={needsIssuer} title={needsIssuer ? `A ${module.labelSingular.toLowerCase()} has to be issued before it can be sent, and you do not have permission to issue.` : undefined}>Send</Button> : null}
            <a className="btn btn-secondary" href={pdfUrl}><Download />PDF</a>
            <Menu align="right" trigger={({ toggle }) => <Button variant="secondary" icon={<MoreHorizontal />} aria-label="More actions" onClick={toggle} />}>
              {publicLink ? <MenuItem icon={<Copy />} onClick={() => { navigator.clipboard?.writeText(publicLink); toast('Link copied'); }}>Copy customer link</MenuItem> : null}
              {!isInvoice && ['draft', 'sent'].includes(doc.status) && can('quotations', 'approve') ? (
                <>
                  <MenuItem icon={<CheckCircle2 />} onClick={() => transition('accept', 'Marked accepted')}>Mark accepted</MenuItem>
                  <MenuItem icon={<XCircle />} onClick={() => transition('decline', 'Marked declined')}>Mark declined</MenuItem>
                </>
              ) : null}
              {!isInvoice && doc.status === 'draft' && can('quotations', 'approve') ? <MenuItem icon={<Send />} onClick={() => transition('send', 'Marked sent')}>Mark sent without sending</MenuItem> : null}
              {rollMm && doc.status !== 'draft' ? <MenuItem icon={<Printer />} onClick={() => setPrinting(true)}>Print the receipt</MenuItem> : null}
              {isInvoice && ['issued', 'partial'].includes(doc.status) && doc.amountDueMinor > 0 && can('payments', 'create') ? <MenuItem icon={<CreditCard />} onClick={paymentLink}>Copy a payment link</MenuItem> : null}
              {isInvoice && doc.status !== 'draft' && doc.status !== 'void' && schedules && can('schedules', 'create') ? <MenuItem icon={<Repeat />} onClick={() => setRepeating(true)}>Repeat this invoice…</MenuItem> : null}
              {isInvoice && doc.status !== 'draft' && doc.status !== 'void' && creditNotes && can('credit_notes', 'create') ? <MenuItem icon={<FileMinus2 />} onClick={() => raiseNote('credit_notes')}>Raise a credit note</MenuItem> : null}
              {isInvoice && doc.status !== 'draft' && doc.status !== 'void' && debitNotes && can('debit_notes', 'create') ? <MenuItem icon={<FilePlus2 />} onClick={() => raiseNote('debit_notes')}>Raise a debit note</MenuItem> : null}
              {isInvoice && ['issued', 'partial', 'paid'].includes(doc.status) && can('invoices', 'approve') ? <MenuItem icon={<Ban />} danger onClick={() => setVoiding(true)}>Void invoice</MenuItem> : null}
              {((isInvoice && doc.status === 'draft') || (!isInvoice && doc.status !== 'converted')) && can(kind, 'delete') ? <MenuItem icon={<Trash2 />} danger onClick={remove}>Delete</MenuItem> : null}
            </Menu>
          </>
        )}
      />

      <div className="doc-layout">
        <div className="stack">
          {doc.state === 'overdue' ? <Alert kind="warning" title="Overdue">{money(doc.amountDueMinor, currency)} was due on {date(doc.dueDate)}.</Alert> : null}
          {doc.state === 'expired' ? <Alert kind="warning" title="Expired">This {module.labelSingular.toLowerCase()} was valid until {date(doc.validUntil)}.</Alert> : null}
          {doc.status === 'void' ? <Alert kind="info" title="Void">{doc.voidReason || 'This invoice was voided.'} Stock and warranties were reversed.</Alert> : null}
          <Preview kind={kind} id={id} design={doc.design} version={version} />
        </div>

        <div className="doc-side">
          <section className="card card-pad stack-sm">
            <div className="stat-label">{isInvoice && ['issued', 'partial'].includes(doc.status) ? 'Balance due' : 'Total'}</div>
            <div className="amount-lg">{money(isInvoice && ['issued', 'partial'].includes(doc.status) ? doc.amountDueMinor : doc.totals.totalMinor, currency)}</div>
            {isInvoice && doc.amountPaidMinor > 0 ? <div className="bar"><span style={{ width: `${Math.min(100, (doc.amountPaidMinor / doc.totals.totalMinor) * 100)}%` }} /></div> : null}
            <dl className="kv" style={{ marginTop: '0.5rem' }}>
              <dt>Total</dt><dd>{money(doc.totals.totalMinor, currency)}</dd>
              {isInvoice ? <><dt>Received</dt><dd>{money(doc.amountPaidMinor, currency)}</dd></> : null}
              {isInvoice && doc.creditedMinor ? <><dt>{doc.creditedMinor > 0 ? 'Credited' : 'Debited'}</dt><dd>{money(Math.abs(doc.creditedMinor), currency)}</dd></> : null}
              {isNote && doc.reason ? <><dt>Reason</dt><dd>{doc.reason}</dd></> : null}
              {doc.totals.taxMinor ? <><dt>{doc.interState ? 'IGST' : 'GST'}</dt><dd>{money(doc.totals.taxMinor, currency)}</dd></> : null}
              {isInvoice ? (
                <>
                  <dt>Due date</dt>
                  <dd>{['issued', 'partial', 'draft'].includes(doc.status) && can(kind, 'edit')
                    ? <input type="date" className="input input-sm" style={{ width: 150, marginLeft: 'auto' }} defaultValue={toDateInput(doc.dueDate)} onBlur={(e) => e.target.value !== toDateInput(doc.dueDate) && setDue(e.target.value)} aria-label="Due date" />
                    : date(doc.dueDate)}</dd>
                </>
              ) : isNote ? null : <><dt>Valid until</dt><dd>{date(doc.validUntil)}</dd></>}
              {doc.sentAt ? <><dt>First sent</dt><dd>{dateTime(doc.sentAt)}</dd></> : null}
              {doc.viewedAt ? <><dt>First opened</dt><dd>{dateTime(doc.viewedAt)}</dd></> : null}
              {related.quotation ? <><dt>From</dt><dd><Link href={href(`/quotations/${doc.quotation}`)}>{related.quotation.number}</Link></dd></> : null}
              {related.invoice ? <><dt>Invoice</dt><dd><Link href={href(`/invoices/${doc.invoice}`)}>{related.invoice.number ?? 'Draft'}</Link></dd></> : null}
            </dl>
            {designs?.designs?.length ? (
              <Field label="Design">
                <select className="input input-sm" value={doc.design || prefs.design || 'classic'} onChange={(e) => setDesign(e.target.value)} disabled={!can(kind, 'edit')}>
                  {designs.designs.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
                </select>
              </Field>
            ) : null}
          </section>

          {isInvoice && related.payments?.length ? (
            <section className="card">
              <div className="card-header"><h2>Payments</h2></div>
              {related.payments.map((p) => (
                <div className="list-row" key={p._id}>
                  <span className="grow"><span className="strong num">{money(p.amountMinor, currency)}</span> <Badge tone="neutral" plain>{p.mode}</Badge><div className="tiny subtle">{date(p.date)}{p.reference ? ` · ${p.reference}` : ''}</div></span>
                  {can('payments', 'delete') ? <Button variant="ghost" size="sm" icon={<Trash2 />} aria-label="Remove payment" onClick={() => removePayment(p)} /> : null}
                </div>
              ))}
            </section>
          ) : null}

          {isInvoice && related.warranties?.length ? (
            <section className="card">
              <div className="card-header"><h2 className="row"><ShieldCheck size={16} />{moduleOf('warranties')?.label ?? 'Warranties'}</h2></div>
              {related.warranties.map((w) => (
                <Link className="list-row" key={w._id} href={href(`/warranties/${w._id}`)}>
                  <span className="grow"><span className="strong">{w.itemName}</span>{w.serial ? <div className="tiny mono subtle">{w.serial}</div> : null}</span>
                  <span className="tiny subtle">until {date(w.endDate)}</span>
                </Link>
              ))}
            </section>
          ) : null}

          {deliveries?.deliveries?.length ? (
            <section className="card">
              <div className="card-header"><h2>Sent</h2><Button size="sm" variant="ghost" onClick={reloadDeliveries}>Refresh</Button></div>
              {deliveries.deliveries.map((d) => (
                <div className="list-row" key={d._id}>
                  <span className="grow"><span>{{ gmail: 'Gmail', smtp: 'Email', whatsapp_link: 'WhatsApp', whatsapp_cloud: 'WhatsApp Business' }[d.channel]}</span>{d.to ? <span className="subtle"> · {d.to}</span> : null}<div className="tiny subtle">{d.sentByName} · {dateTime(d.createdAt)}</div></span>
                  <Badge tone={d.status === 'failed' ? 'red' : d.status === 'sent' ? 'green' : 'neutral'} plain title={d.error}>{d.status === 'prepared' ? 'opened' : d.status}</Badge>
                </div>
              ))}
            </section>
          ) : null}

          <section className="card">
            <div className="card-header"><h2>Activity</h2></div>
            <Activity module={kind} recordId={id} limit={10} />
          </section>
        </div>
      </div>

      {isInvoice ? <PaymentDialog open={paying} onClose={() => setPaying(false)} document={doc} onRecorded={refresh} /> : null}
      <ThermalPrint open={printing} onClose={() => setPrinting(false)} kind={kind} id={id} design={doc.design} widthMm={rollMm ?? 80} pdfUrl={pdfUrl} />
      <RepeatDialog open={repeating} onClose={() => setRepeating(false)} document={doc} />
      <SendDialog open={sending} onClose={() => { setSending(false); if (params.get('send')) router.replace(href(`/${kind}/${id}`)); }} kind={kind} document={doc} onSent={() => { refresh(); reloadDeliveries(); }} />
      <Dialog open={voiding} onClose={() => setVoiding(false)} size="narrow" title={`Void ${doc.number}?`} description="The number stays used, stock goes back and warranties from this invoice are voided. This cannot be undone."
        footer={<><Button variant="secondary" onClick={() => setVoiding(false)}>Cancel</Button><Button variant="danger" loading={busy === 'void'} onClick={async () => { await act('void', () => api.post(`/documents/invoices/${id}/void`, { reason: voidReason }), 'Invoice voided'); setVoiding(false); }}>Void invoice</Button></>}>
        <Field label="Reason" hint="Kept with the invoice for your records."><input className="input" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Wrong customer, duplicate…" autoFocus /></Field>
      </Dialog>
    </>
  );
}
