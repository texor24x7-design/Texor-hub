'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, Copy, CreditCard, ExternalLink, Mail, MessageCircle, Rocket, Send, Server, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Field, Switch, useConfirm, useToast } from '@/components/ui';
import { Activity } from '@/components/records/Activity';
import { useResource } from '@/lib/data';
import { useWorkspace } from '@/lib/workspace';
import { SettingsLayout } from './SettingsLayout';

const DEFAULTS = {
  'email.subject': '{{document.label}} {{document.number}} from {{business.name}}',
  'email.body': 'Hi {{customer.name}},\n\nPlease find {{document.label}} {{document.number}} for {{document.total}} attached.\n\nYou can also view it online: {{document.link}}\n\nThank you,\n{{business.name}}',
  whatsapp: 'Hi {{customer.name}}, here is your {{document.label}} {{document.number}} from {{business.name}} for {{document.total}}.\n\nView or download: {{document.link}}',
};
const REMINDER_DEFAULTS = {
  'reminder.email.subject': 'Reminder: {{document.label}} {{document.number}} is due',
  'reminder.email.body': 'Hi {{customer.name}},\n\nThis is a gentle reminder that {{document.label}} {{document.number}} for {{document.amountDue}} was due on {{document.dueDate}}.\n\nYou can view and pay it here: {{document.link}}\n\nIf you have already paid, please ignore this message.\n\nThank you,\n{{business.name}}',
  'reminder.whatsapp': 'Hi {{customer.name}}, a gentle reminder that {{document.label}} {{document.number}} for {{document.amountDue}} was due on {{document.dueDate}}.\n\nView or pay: {{document.link}}\n\nIf you have already paid, please ignore this.',
};
const MESSAGE_TAGS = ['customer.name', 'document.label', 'document.number', 'document.total', 'document.amountDue', 'document.dueDate', 'document.daysOverdue', 'document.validUntil', 'document.link', 'business.name', 'business.phone'];

const SWEEP_DEFAULTS = { enabled: false, channel: 'smtp', invoiceDays: [-3, 3, 10, 30], quoteDays: 3, warrantyDays: 30 };
const parseDays = (text) => [...new Set(String(text).split(',').map((d) => Number(d.trim())).filter((d) => Number.isFinite(d) && d >= -90 && d <= 365))].sort((a, b) => a - b).slice(0, 6);

export function MessagesSettings() {
  const { api, prefs, apply, can } = useWorkspace();
  const toast = useToast();
  const [messages, setMessages] = useState(() => ({ ...DEFAULTS, ...REMINDER_DEFAULTS, ...(prefs.messages ?? {}) }));
  const [reminders, setReminders] = useState(() => ({ ...SWEEP_DEFAULTS, ...(prefs.reminders ?? {}) }));
  const [daysText, setDaysText] = useState(() => (prefs.reminders?.invoiceDays ?? SWEEP_DEFAULTS.invoiceDays).join(', '));
  const setR = (patch) => setReminders((r) => ({ ...r, ...patch }));
  const [focus, setFocus] = useState('whatsapp');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try { apply(await api.patch('/settings/preferences', { messages, reminders: { ...reminders, invoiceDays: parseDays(daysText) } })); toast('Templates saved'); } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  }

  const field = (key, label, rows) => (
    <Field label={label}>
      {rows ? <textarea className="input" rows={rows} value={messages[key]} onFocus={() => setFocus(key)} onChange={(e) => setMessages({ ...messages, [key]: e.target.value })} /> : <input className="input" value={messages[key]} onFocus={() => setFocus(key)} onChange={(e) => setMessages({ ...messages, [key]: e.target.value })} />}
    </Field>
  );

  return (
    <SettingsLayout section="messages" title="Message templates" description="What customers receive when you send a quotation or invoice." actions={can('settings', 'edit') ? <Button onClick={save} loading={busy}>Save templates</Button> : null}>
      <section className="card">
        <div className="card-body stack">
          <div className="row wrap" style={{ gap: 4 }}>
            <span className="small muted">Insert into the field you are editing:</span>
            {MESSAGE_TAGS.map((t) => <button key={t} type="button" className="tag" style={{ cursor: 'pointer' }} onClick={() => setMessages((m) => ({ ...m, [focus]: `${m[focus]}{{${t}}}` }))}>{t}</button>)}
          </div>
          <div className="section-title">WhatsApp</div>
          {field('whatsapp', 'Message', 5)}
          <div className="section-title">Email</div>
          {field('email.subject', 'Subject')}
          {field('email.body', 'Body', 8)}
        </div>
      </section>

      <section className="card">
        <div className="card-header"><h2>Automatic reminders</h2></div>
        <div className="card-body stack">
          <Switch checked={reminders.enabled} onChange={(enabled) => setR({ enabled })}
            label="Chase overdue invoices and nudge before things expire" />
          {reminders.enabled ? (
            <>
              <Alert kind="info" title="These send without anyone clicking">
                So they need a channel that works unattended: SMTP or WhatsApp Business, set up under Integrations.
                The WhatsApp link channel cannot be automated — it opens a chat for a person to send.
              </Alert>
              <div className="grid-2">
                <Field label="Send over">
                  <select className="input" value={reminders.channel} onChange={(e) => setR({ channel: e.target.value })}>
                    <option value="smtp">Email (SMTP)</option>
                    <option value="whatsapp_cloud">WhatsApp Business</option>
                  </select>
                </Field>
                <Field label="Chase an overdue invoice on day" hint="Days from the due date. Negative is before it. One message per number, ever.">
                  <input className="input" value={daysText} onChange={(e) => setDaysText(e.target.value)} onBlur={() => setDaysText(parseDays(daysText).join(', '))} placeholder="-3, 3, 10, 30" />
                </Field>
              </div>
              <div className="grid-2">
                <Field label="Warn before a quotation expires" hint="Days. 0 turns it off.">
                  <input className="input" type="number" min="0" max="90" value={reminders.quoteDays} onChange={(e) => setR({ quoteDays: Number(e.target.value) || 0 })} />
                </Field>
                <Field label="Warn before a warranty ends" hint="Days. 0 turns it off. A good moment to offer a renewal or a service.">
                  <input className="input" type="number" min="0" max="365" value={reminders.warrantyDays} onChange={(e) => setR({ warrantyDays: Number(e.target.value) || 0 })} />
                </Field>
              </div>
              <div className="section-title">Reminder wording</div>
              {field('reminder.whatsapp', 'WhatsApp message', 5)}
              {field('reminder.email.subject', 'Email subject')}
              {field('reminder.email.body', 'Email body', 8)}
            </>
          ) : null}
        </div>
      </section>
    </SettingsLayout>
  );
}

export function IntegrationsSettings() {
  const { api, slug, boot, can, member } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const params = useSearchParams();
  const { data, reload } = useResource(`integrations:${slug}`, () => api.get('/integrations'));
  const smtp = data?.integrations.find((i) => i.type === 'smtp');
  const wa = data?.integrations.find((i) => i.type === 'whatsapp_cloud');
  const [smtpForm, setSmtpForm] = useState(null);
  const [waForm, setWaForm] = useState(null);
  const [rzpForm, setRzpForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const admin = can('settings', 'edit');

  async function remove(integration, label) {
    if (!(await confirm({ title: `Disconnect ${label}?`, message: 'You can connect it again at any time.', confirmLabel: 'Disconnect', danger: true }))) return;
    try { await api.del(`/integrations/${integration._id}`); reload(); toast(`${label} disconnected`); } catch (error) { toast(error.message, 'error'); }
  }

  async function saveSmtp() {
    setBusy('smtp');
    try { await api.put('/integrations/smtp', { ...smtpForm, port: Number(smtpForm.port) }); setSmtpForm(null); reload(); toast('Mail server connected'); } catch (error) { toast(error.message, 'error'); } finally { setBusy(null); }
  }
  async function saveWa() {
    setBusy('wa');
    try { await api.put('/integrations/whatsapp', waForm); setWaForm(null); reload(); toast('WhatsApp Business connected'); } catch (error) { toast(error.message, 'error'); } finally { setBusy(null); }
  }

  async function saveRzp() {
    setBusy('rzp');
    try { await api.put('/integrations/razorpay', rzpForm); setRzpForm(null); reload(); toast('Razorpay connected'); } catch (error) { toast(error.message, 'error'); } finally { setBusy(null); }
  }

  return (
    <SettingsLayout section="integrations" title="Integrations" description="Connect the accounts Finvoice sends from. Everything here is optional; WhatsApp links work with no setup at all.">
      {params.get('connected') === 'gmail' ? <Alert kind="success">Gmail connected. Invoices you send by email now go from your own mailbox.</Alert> : null}
      {params.get('error') ? <Alert>{params.get('error')}</Alert> : null}

      <section className="card card-pad row row-top">
        <span className="empty-icon" style={{ background: '#e8f8ee', color: '#128c3e' }}><MessageCircle /></span>
        <div className="grow"><div className="row"><strong>WhatsApp from your phone</strong><Badge tone="green">Always on</Badge></div><p className="small muted">“Send → WhatsApp” opens WhatsApp with the customer's number and a message linking to the invoice. Nothing to connect.</p></div>
      </section>

      <section className="card">
        <div className="card-header"><div className="row"><span className="empty-icon" style={{ width: 36, height: 36, background: '#fdecea', color: '#c5221f' }}><Mail size={18} /></span><div><h2>Gmail</h2><p className="small muted">Each person connects their own Gmail. Finvoice can only send — it cannot read your mail.</p></div></div>
          {data?.mine ? <Badge tone="green">{data.mine.account}</Badge> : null}
        </div>
        <div className="card-body">
          {!data?.gmailAvailable ? <Alert kind="info">Gmail sending has not been enabled on this Finvoice server. The administrator needs to add a Google OAuth client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).</Alert>
            : data.mine ? (
              <div className="row">{data.mine.status === 'error' ? <Alert kind="warning">{data.mine.lastError} — reconnect to keep sending.</Alert> : <span className="small muted row"><Check size={15} color="var(--success)" />Connected as {data.mine.account}</span>}<div className="grow" /><a className="btn btn-secondary btn-sm" href={api.url('/integrations/gmail/connect')}>Reconnect</a><Button size="sm" variant="danger-ghost" icon={<Trash2 />} onClick={() => remove(data.mine, 'Gmail')}>Disconnect</Button></div>
            ) : <a className="btn btn-primary" href={api.url('/integrations/gmail/connect')}><Mail />Connect Gmail</a>}
        </div>
      </section>

      <section className="card">
        <div className="card-header"><div className="row"><span className="empty-icon" style={{ width: 36, height: 36 }}><Server size={18} /></span><div><h2>Mail server (SMTP)</h2><p className="small muted">For Zoho Mail, Outlook, Google Workspace app passwords or your own domain. Used by everyone in the workspace.</p></div></div>{smtp ? <Badge tone="green">{smtp.account}</Badge> : null}</div>
        <div className="card-body">
          {smtpForm ? (
            <div className="stack">
              <div className="grid-3">
                <Field label="Server" className="span-2"><input className="input" value={smtpForm.host} onChange={(e) => setSmtpForm({ ...smtpForm, host: e.target.value })} placeholder="smtp.zoho.in" /></Field>
                <Field label="Port"><input className="input" type="number" value={smtpForm.port} onChange={(e) => setSmtpForm({ ...smtpForm, port: e.target.value, secure: Number(e.target.value) === 465 })} /></Field>
                <Field label="Username"><input className="input" value={smtpForm.user} onChange={(e) => setSmtpForm({ ...smtpForm, user: e.target.value })} autoComplete="off" /></Field>
                <Field label="Password" hint={smtp ? 'Leave empty to keep the saved one.' : undefined}><input className="input" type="password" value={smtpForm.password} onChange={(e) => setSmtpForm({ ...smtpForm, password: e.target.value })} autoComplete="new-password" /></Field>
                <div style={{ paddingTop: '1.6rem' }}><Switch checked={smtpForm.secure} onChange={(secure) => setSmtpForm({ ...smtpForm, secure })} label="SSL/TLS" /></div>
                <Field label="From name"><input className="input" value={smtpForm.fromName} onChange={(e) => setSmtpForm({ ...smtpForm, fromName: e.target.value })} /></Field>
                <Field label="From address" className="span-2"><input className="input" type="email" value={smtpForm.fromEmail} onChange={(e) => setSmtpForm({ ...smtpForm, fromEmail: e.target.value })} /></Field>
              </div>
              <div className="row row-end"><Button variant="secondary" onClick={() => setSmtpForm(null)}>Cancel</Button><Button onClick={saveSmtp} loading={busy === 'smtp'}>Test & save</Button></div>
            </div>
          ) : (
            <div className="row">{smtp ? <span className="small muted">{smtp.config.host}:{smtp.config.port} as {smtp.config.user}</span> : <span className="small muted">Not set up.</span>}<div className="grow" />
              {admin ? <Button size="sm" variant="secondary" onClick={() => setSmtpForm({ host: smtp?.config.host ?? '', port: smtp?.config.port ?? 465, secure: smtp?.config.secure ?? true, user: smtp?.config.user ?? '', password: '', fromName: smtp?.config.fromName ?? boot.workspace.name, fromEmail: smtp?.config.fromEmail ?? boot.workspace.email ?? '' })}>{smtp ? 'Edit' : 'Set up'}</Button> : null}
              {smtp && admin ? <Button size="sm" variant="danger-ghost" icon={<Trash2 />} onClick={() => remove(smtp, 'the mail server')} /> : null}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header"><div className="row"><span className="empty-icon" style={{ width: 36, height: 36, background: '#e8f8ee', color: '#128c3e' }}><Send size={18} /></span><div><h2>WhatsApp Business (Cloud API)</h2><p className="small muted">Send the PDF itself from your business number. Uses your own Meta account; Meta bills you per message.</p></div></div>{wa ? <Badge tone="green">{wa.account}</Badge> : null}</div>
        <div className="card-body">
          {waForm ? (
            <div className="stack">
              <Alert kind="info" title="Before you connect">
                In Meta Business Manager, create a <strong>utility</strong> message template with a <strong>document header</strong> and three body variables: customer name, document number, and total. Once Meta approves it, enter its name below.
                {' '}<a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer">Meta's guide <ExternalLink size={12} /></a>
              </Alert>
              <div className="grid-2">
                <Field label="Phone number ID"><input className="input mono" value={waForm.phoneNumberId} onChange={(e) => setWaForm({ ...waForm, phoneNumberId: e.target.value.trim() })} /></Field>
                <Field label="Permanent access token" hint={wa ? 'Leave empty to keep the saved one.' : undefined}><input className="input" type="password" value={waForm.accessToken} onChange={(e) => setWaForm({ ...waForm, accessToken: e.target.value.trim() })} autoComplete="off" /></Field>
                <Field label="Template name"><input className="input mono" value={waForm.templateName} onChange={(e) => setWaForm({ ...waForm, templateName: e.target.value.trim() })} placeholder="invoice_with_pdf" /></Field>
                <Field label="Template language"><input className="input mono" value={waForm.templateLanguage} onChange={(e) => setWaForm({ ...waForm, templateLanguage: e.target.value.trim() })} placeholder="en" /></Field>
              </div>
              <div className="row row-end"><Button variant="secondary" onClick={() => setWaForm(null)}>Cancel</Button><Button onClick={saveWa} loading={busy === 'wa'}>Verify & save</Button></div>
            </div>
          ) : (
            <div className="row">{wa ? <span className="small muted">Template “{wa.config.templateName}” ({wa.config.templateLanguage})</span> : <span className="small muted">Not connected.</span>}<div className="grow" />
              {admin ? <Button size="sm" variant="secondary" onClick={() => setWaForm({ phoneNumberId: wa?.config.phoneNumberId ?? '', accessToken: '', templateName: wa?.config.templateName ?? '', templateLanguage: wa?.config.templateLanguage ?? 'en' })}>{wa ? 'Edit' : 'Connect'}</Button> : null}
              {wa && admin ? <Button size="sm" variant="danger-ghost" icon={<Trash2 />} onClick={() => remove(wa, 'WhatsApp Business')} /> : null}
            </div>
          )}
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <div className="row">
            <span className="empty-icon" style={{ width: 36, height: 36 }}><CreditCard size={18} /></span>
            <div>
              <h2>Razorpay</h2>
              <p className="small muted">Lets customers pay an invoice by card, netbanking or UPI. Your own Razorpay account — the money goes straight to you and Finvoice never sees your keys.</p>
            </div>
          </div>
          {data?.razorpay?.connected ? <Badge tone="green">{data.razorpay.keyId}</Badge> : null}
        </div>
        <div className="card-body stack">
          {rzpForm ? (
            <div className="stack">
              <Alert kind="info" title="Where these come from">
                Razorpay Dashboard → Settings → API Keys for the key id and secret, and Settings → Webhooks for the webhook secret.
                {' '}<a href="https://razorpay.com/docs/webhooks/" target="_blank" rel="noreferrer">Razorpay's guide <ExternalLink size={12} /></a>
              </Alert>
              <div className="fields-grid">
                <Field label="Key id"><input className="input mono" value={rzpForm.keyId} onChange={(e) => setRzpForm({ ...rzpForm, keyId: e.target.value.trim() })} placeholder="rzp_live_XXXXXXXXXXXX" autoComplete="off" /></Field>
                <Field label="Key secret" hint={data?.razorpay?.connected ? 'Leave empty to keep the saved one.' : undefined}><input className="input" type="password" value={rzpForm.keySecret} onChange={(e) => setRzpForm({ ...rzpForm, keySecret: e.target.value })} autoComplete="new-password" /></Field>
                <Field label="Webhook secret" className="span-2" hint="Set the same value in Razorpay when you add the webhook below.">
                  <input className="input" type="password" value={rzpForm.webhookSecret} onChange={(e) => setRzpForm({ ...rzpForm, webhookSecret: e.target.value })} autoComplete="new-password" />
                </Field>
              </div>
              <Field label="Webhook URL to add in Razorpay" hint="Subscribe it to the payment_link.paid and payment.captured events.">
                <div className="row">
                  <input className="input mono" readOnly value={data?.razorpay?.webhookUrl ?? ''} onFocus={(e) => e.target.select()} />
                  <Button variant="secondary" icon={<Copy />} aria-label="Copy" onClick={() => { navigator.clipboard?.writeText(data?.razorpay?.webhookUrl ?? ''); toast('Copied'); }} />
                </div>
              </Field>
              <div className="row row-end"><Button variant="secondary" onClick={() => setRzpForm(null)}>Cancel</Button><Button onClick={saveRzp} loading={busy === 'rzp'}>Check & save</Button></div>
            </div>
          ) : (
            <div className="row">
              {data?.razorpay?.connected
                ? <span className="small muted">Connected{data.razorpay.hasWebhookSecret ? '' : ' — no webhook secret yet, so payments will not record themselves'}.</span>
                : <span className="small muted">Not connected.</span>}
              <div className="grow" />
              {admin ? <Button size="sm" variant="secondary" onClick={() => setRzpForm({ keyId: data?.razorpay?.keyId ?? '', keySecret: '', webhookSecret: '' })}>{data?.razorpay?.connected ? 'Edit' : 'Connect'}</Button> : null}
            </div>
          )}
        </div>
      </section>
      {member.role !== 'owner' && !admin ? <p className="small muted">Only people who manage settings can change the shared connections.</p> : null}
    </SettingsLayout>
  );
}

const LITE = ['Customers & CRM basics', 'Quotations & invoices with GST', 'Payments by mode', 'Products, stock & services', 'Warranties & claims', 'Staff attendance', 'Roles & permissions', 'Custom modules, fields & designs', 'Gmail, SMTP & WhatsApp sending'];

export function EditionSettings() {
  const { api, workspace, member, modules, apply } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const isPro = workspace.edition === 'pro';
  const pro = modules.filter((m) => m.edition === 'pro');

  async function switchTo(edition) {
    const ok = await confirm(edition === 'pro'
      ? { title: 'Switch to Finvoice Pro?', message: 'Pro modules unlock for this workspace straight away. Your data stays exactly as it is.', confirmLabel: 'Switch to Pro' }
      : { title: 'Go back to Lite?', message: 'Pro modules are hidden again. Nothing is deleted.', confirmLabel: 'Switch to Lite' });
    if (!ok) return;
    setBusy(true);
    try { apply(await api.put('/settings/edition', { edition })); toast(`Now on Finvoice ${edition === 'pro' ? 'Pro' : 'Lite'}`); } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <SettingsLayout section="edition" title="Lite & Pro" description="Both editions run on the same workspace, so moving between them never moves your data.">
      <div className="grid-2">
        <section className="card" style={!isPro ? { borderColor: 'var(--brand-400)' } : undefined}>
          <div className="card-header"><h2>Finvoice Lite</h2>{!isPro ? <Badge tone="brand">Current</Badge> : null}</div>
          <div className="card-body stack-sm">{LITE.map((f) => <div key={f} className="row small"><Check size={15} color="var(--success)" />{f}</div>)}</div>
          {isPro && member.role === 'owner' ? <div className="card-footer"><Button variant="secondary" onClick={() => switchTo('lite')} loading={busy}>Switch to Lite</Button></div> : null}
        </section>
        <section className="card" style={isPro ? { borderColor: 'var(--brand-400)' } : undefined}>
          <div className="card-header"><h2 className="row"><Rocket size={18} />Finvoice Pro</h2>{isPro ? <Badge tone="brand">Current</Badge> : null}</div>
          <div className="card-body stack-sm">
            <div className="small muted">Everything in Lite, plus:</div>
            {pro.map((m) => <div key={m.key} className="row row-top small"><Check size={15} color="var(--success)" style={{ marginTop: 3 }} /><span><strong>{m.label}</strong> — {m.teaser}</span></div>)}
          </div>
          {!isPro ? <div className="card-footer">{member.role === 'owner' ? <Button onClick={() => switchTo('pro')} loading={busy}>Switch to Pro</Button> : <span className="small muted">Only the owner can change the edition.</span>}</div> : null}
        </section>
      </div>
    </SettingsLayout>
  );
}

export function ActivitySettings() {
  return (
    <SettingsLayout section="activity" title="Activity log" description="Everything that changed in this workspace, and who did it.">
      <section className="card"><Activity limit={50} /></section>
    </SettingsLayout>
  );
}
