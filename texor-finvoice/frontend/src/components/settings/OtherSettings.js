'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, ExternalLink, Mail, MessageCircle, Rocket, Send, Server, Trash2 } from 'lucide-react';
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
const MESSAGE_TAGS = ['customer.name', 'document.label', 'document.number', 'document.total', 'document.amountDue', 'document.dueDate', 'document.link', 'business.name', 'business.phone'];

export function MessagesSettings() {
  const { api, prefs, apply, can } = useWorkspace();
  const toast = useToast();
  const [messages, setMessages] = useState(() => ({ ...DEFAULTS, ...(prefs.messages ?? {}) }));
  const [focus, setFocus] = useState('whatsapp');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try { apply(await api.patch('/settings/preferences', { messages })); toast('Templates saved'); } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
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
