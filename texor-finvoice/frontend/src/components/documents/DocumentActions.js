'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Mail, MessageCircle, Send } from 'lucide-react';
import { Alert, Button, Dialog, Field, Segmented, useToast } from '@/components/ui';
import { FieldInput } from '@/components/fields/FieldInput';
import { invalidate, useResource } from '@/lib/data';
import { money, toDateInput } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';
import { SplitPayment, receivedOf } from './SplitPayment';

export function PaymentDialog({ open, onClose, document, onRecorded }) {
  const { api, slug, prefs, currency, module } = useWorkspace();
  const toast = useToast();
  const payments = module('payments');
  const customFields = (payments?.fields ?? []).filter((f) => f.custom && !f.hidden);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const modes = prefs.paymentModes?.length ? prefs.paymentModes : ['Cash'];
  const rows = form.rows ?? [];
  const received = receivedOf(rows);

  useEffect(() => {
    if (open) {
      setForm({
        rows: [{ mode: modes[0], amountMinor: document.amountDueMinor }],
        date: toDateInput(new Date()), reference: '', note: '', custom: {},
      });
    }
    setErrors({});
  }, [open, document.amountDueMinor]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy(true);
    try {
      const { rows: tenders, date, ...rest } = form;
      // One request, one transaction: a split is never half-recorded.
      await api.post(`/documents/invoices/${document._id}/payments`, {
        payments: tenders.filter((row) => Number(row.amountMinor) > 0)
          .map((row) => ({ ...rest, mode: row.mode, amountMinor: row.amountMinor, date: new Date(`${date}T12:00:00`).toISOString() })),
      });
      invalidate(`documents:${slug}:invoices`);
      invalidate(`dashboard:${slug}`);
      invalidate(`payments:${slug}`);
      toast(`Payment of ${money(received, currency)} recorded`);
      onRecorded();
      onClose();
    } catch (error) {
      setErrors({ ...error.fieldErrors, _: error.message });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Record a payment" description={`${document.number} · ${money(document.amountDueMinor, currency)} still owed`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={received <= 0 || received > document.amountDueMinor}>Record payment</Button></>}>
      <div className="stack">
        {errors._ && !errors.amountMinor ? <Alert>{errors._}</Alert> : null}
        <Field label="Received" required error={errors.amountMinor ?? errors.mode} hint="Add a second mode if it came in more than one way.">
          <SplitPayment rows={rows} onChange={(next) => setForm({ ...form, rows: next })} modes={modes} currency={currency} dueMinor={document.amountDueMinor} />
        </Field>
        <Field label="Date" required><input type="date" className="input" value={form.date ?? ''} onChange={(e) => setForm({ ...form, date: e.target.value })} max={toDateInput(new Date())} /></Field>
        <Field label="Reference" hint="UTR, cheque number or card slip — whatever will help you match it later."><input className="input" value={form.reference ?? ''} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
        {customFields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required} error={errors[`custom.${f.key}`]}>
            <FieldInput field={f} moduleKey="payments" value={form.custom?.[f.key]} onChange={(value) => setForm({ ...form, custom: { ...form.custom, [f.key]: value } })} id={`pay-${f.key}`} />
          </Field>
        ))}
        <Field label="Note"><textarea className="input" rows={2} value={form.note ?? ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

/**
 * Sending, in the order a small business is most likely to use it: WhatsApp
 * straight from their phone, email, WhatsApp Business, or just the link.
 */
export function SendDialog({ open, onClose, kind, document, onSent }) {
  const { api, slug, href, boot, can } = useWorkspace();
  const toast = useToast();
  const { data: compose } = useResource(open ? `compose:${slug}:${kind}:${document._id}` : null, () => api.get(`/documents/${kind}/${document._id}/compose`));
  const { data: integrations } = useResource(open ? `integrations:${slug}` : null, () => api.get('/integrations'));
  const [channel, setChannel] = useState('whatsapp');
  const [form, setForm] = useState({ to: '', subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const gmail = integrations?.mine;
  const smtp = integrations?.integrations.find((i) => i.type === 'smtp');
  const cloud = integrations?.integrations.find((i) => i.type === 'whatsapp_cloud');
  const emailChannel = gmail ? 'gmail' : smtp ? 'smtp' : null;
  const link = document.publicToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/d/${document.publicToken}` : '';

  useEffect(() => {
    if (!compose) return;
    const isEmail = channel === 'email';
    setForm({ to: isEmail ? compose.email : compose.phone, subject: compose.subject, message: isEmail ? compose.body : compose.whatsapp });
    setError(null);
  }, [compose, channel]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const actual = channel === 'email' ? emailChannel : channel === 'business' ? 'whatsapp_cloud' : 'whatsapp_link';
      const result = await api.post(`/documents/${kind}/${document._id}/deliver`, { channel: actual, to: form.to, subject: form.subject, message: form.message });
      if (result.url) window.open(result.url, '_blank', 'noopener');
      invalidate(`documents:${slug}:${kind}`);
      toast(actual === 'whatsapp_link' ? 'Opening WhatsApp…' : 'Sent');
      onSent?.();
      onClose();
    } catch (sendError) {
      setError(sendError.message);
    } finally { setBusy(false); }
  }

  const settingsLink = can('settings', 'edit') ? <Link href={href('/settings/integrations')}>Settings → Integrations</Link> : 'an admin';

  return (
    <Dialog open={open} onClose={onClose} title={`Send ${document.number ?? ''}`} description={`To ${document.billTo?.name}`}
      footer={channel === 'link' ? <Button variant="secondary" onClick={onClose}>Close</Button> : (
        <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={<Send />} onClick={send} loading={busy} disabled={(channel === 'email' && !emailChannel) || (channel === 'business' && !cloud)}>{channel === 'whatsapp' ? 'Open WhatsApp' : 'Send'}</Button></>
      )}>
      <div className="stack">
        <Segmented label="Channel" value={channel} onChange={setChannel} options={[
          { value: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle /> },
          { value: 'email', label: 'Email', icon: <Mail /> },
          ...(cloud ? [{ value: 'business', label: 'WhatsApp Business', icon: <Send /> }] : []),
          { value: 'link', label: 'Link', icon: <Copy /> },
        ]} />
        {error ? <Alert>{error}</Alert> : null}

        {channel === 'link' ? (
          <Field label="Anyone with this link can view and download it">
            <div className="input-group">
              <input className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} />
              <Button variant="secondary" icon={<Copy />} onClick={() => { navigator.clipboard?.writeText(link); toast('Link copied'); }}>Copy</Button>
            </div>
          </Field>
        ) : null}

        {channel === 'email' && !emailChannel ? (
          <Alert kind="info" title="Email is not set up yet">
            {boot.features?.gmail ? 'Connect your Gmail, or add your mail server, in ' : 'Add your mail server in '}{settingsLink} to email documents with the PDF attached.
          </Alert>
        ) : null}

        {channel !== 'link' && (channel !== 'email' || emailChannel) ? (
          <>
            {channel === 'email' ? <div className="small muted">Sending from <strong>{gmail ? gmail.account : smtp.account}</strong> {gmail ? '(your Gmail)' : '(workspace mail server)'} with the PDF attached.</div> : null}
            {channel === 'business' ? <div className="small muted">From your WhatsApp Business number with the PDF attached, using the “{cloud.config.templateName}” template.</div> : null}
            <Field label={channel === 'email' ? 'To' : 'WhatsApp number'} hint={channel !== 'email' ? 'Ten-digit Indian numbers get +91 added.' : undefined}>
              <input className="input" type={channel === 'email' ? 'email' : 'tel'} value={form.to ?? ''} onChange={(e) => setForm({ ...form, to: e.target.value })} />
            </Field>
            {channel === 'email' ? <Field label="Subject"><input className="input" value={form.subject ?? ''} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field> : null}
            {channel !== 'business' ? <Field label="Message"><textarea className="input" rows={channel === 'email' ? 8 : 5} value={form.message ?? ''} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field> : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
