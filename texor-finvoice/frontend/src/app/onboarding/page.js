'use client';

/**
 * Onboarding: industry → business → branding → design → team.
 *
 * The workspace is created after the second step, so everything from there on
 * is ordinary settings being saved — leaving halfway leaves a usable business,
 * not a half-made one.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, MailPlus, Sparkles, Trash2 } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { Alert, Button, Field, Loading, Logo, Switch, ToastProvider } from '@/components/ui';
import { GstinInput, ImageInput } from '@/components/fields/FieldInput';
import { DesignThumb, useDesignPreviewInputs } from '@/components/settings/DesignsSettings';
import { SignatureField } from '@/components/settings/SignatureUpload';
import { ACCOUNTS_ORIGIN, api, auth } from '@/lib/api';
import { STATES, stateFromGstin } from '@/lib/shared/india.mjs';
import { WorkspaceContext, useWorkspace, useWorkspaceValue } from '@/lib/workspace';

const STEPS = ['Your industry', 'Business details', 'Logo & signature', 'Invoice design', 'Your team'];

function Steps({ current }) {
  return (
    <div className="steps">
      {STEPS.map((label, i) => (
        <div key={label} className={`step${i === current ? ' current' : ''}${i < current ? ' done' : ''}`}>
          <span className="dot">{i < current ? <Check size={14} /> : i + 1}</span><span className="step-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

function IndustryStep({ value, onChange, onNext }) {
  const [industries, setIndustries] = useState(null);
  const footer = useRef(null);
  useEffect(() => { api('/api/industries').then((r) => setIndustries(r.industries)).catch(() => setIndustries([])); }, []);
  const chosen = industries?.find((i) => i.key === value);

  /**
   * The gallery is taller than the screen, so picking a template used to leave
   * Continue below the fold with nothing to suggest it was there.
   */
  useEffect(() => {
    if (!value) return;
    footer.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [value]);
  return (
    <div className="stack-lg">
      <div><h1>What kind of business is this?</h1><p className="muted" style={{ marginTop: 6 }}>Finvoice shapes itself around your trade — its modules, names, fields and invoice layout. You can change any of it later.</p></div>
      <div className="industry-grid">
        {(industries ?? []).map((ind) => (
          <button key={ind.key} type="button" className="industry" aria-pressed={value === ind.key} onClick={() => onChange(ind.key)}>
            <span className="industry-icon" style={{ background: ind.accent }}><Icon name={ind.icon} /></span>
            <strong>{ind.name}</strong>
            <span className="small muted">{ind.tagline}</span>
            <ul>{ind.highlights.map((h) => <li key={h}><Check />{h}</li>)}</ul>
          </button>
        ))}
      </div>
      {chosen ? (
        <div className="card card-pad grid-2" style={{ alignItems: 'center' }}>
          <div><div className="section-title">Your sidebar will look like this</div><p className="small muted" style={{ marginTop: 6 }}>Rename, reorder or switch off anything whenever you like.</p></div>
          <div className="mini-sidebar">{chosen.sidebar.slice(0, 11).map((m) => <div key={m.key}><Icon name={m.icon} />{m.label}</div>)}</div>
        </div>
      ) : null}
      <div className="onboard-actions" ref={footer}>
        <span className="muted small">{chosen ? `${chosen.name} selected — you can change any of it later.` : 'Choose the closest match.'}</span>
        <Button size="lg" onClick={onNext} disabled={!value}>Continue<ArrowRight /></Button>
      </div>
    </div>
  );
}

function DetailsStep({ industry, user, onBack, onCreated }) {
  const [form, setForm] = useState({ name: '', gstin: '', stateCode: '', city: '', phone: '', email: user?.email ?? '', sample: true });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function create() {
    setBusy(true);
    setErrors({});
    try {
      const { workspace } = await api('/api/workspaces', {
        method: 'POST',
        body: { name: form.name, industry, gstin: form.gstin || undefined, stateCode: form.stateCode || undefined, phone: form.phone, email: form.email, address: { city: form.city, stateCode: form.stateCode }, sample: form.sample },
      });
      onCreated(workspace.slug);
    } catch (error) {
      setErrors({ ...error.fieldErrors, _: error.message });
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 680 }}>
      <div><h1>Tell us about the business</h1><p className="muted" style={{ marginTop: 6 }}>These details print on your invoices. Only the name is required now.</p></div>
      {errors._ && Object.keys(errors).length === 1 ? <Alert>{errors._}</Alert> : null}
      <section className="card card-body grid-2">
        <Field label="Business name" required error={errors.name} className="span-2"><input className="input" autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Shine Car Spa" /></Field>
        <Field label="GSTIN" hint="Skip if you are not GST registered." error={errors.gstin}><GstinInput value={form.gstin} onChange={(gstin) => set({ gstin, stateCode: stateFromGstin(gstin) || form.stateCode })} /></Field>
        <Field label="State" error={errors.stateCode}><select className="input" value={form.stateCode} onChange={(e) => set({ stateCode: e.target.value })}><option value="">Choose…</option>{STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
        <Field label="City"><input className="input" value={form.city} onChange={(e) => set({ city: e.target.value })} /></Field>
        <Field label="Business phone" error={errors.phone}><input className="input" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label="Business email" error={errors.email} className="span-2"><input className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
      </section>
      <section className="card card-pad row">
        <Sparkles size={20} color="var(--brand-600)" />
        <div className="grow"><div className="strong">Start with a sample catalogue</div><div className="small muted">Typical items for your industry with realistic prices, so you can try an invoice straight away. Edit or delete them any time.</div></div>
        <Switch checked={form.sample} onChange={(sample) => set({ sample })} />
      </section>
      <div className="onboard-actions"><Button variant="ghost" icon={<ArrowLeft />} onClick={onBack}>Back</Button><div className="grow" /><Button size="lg" onClick={create} loading={busy} disabled={!form.name.trim()}>Create workspace<ArrowRight /></Button></div>
    </div>
  );
}

function BrandingStep({ onNext }) {
  const { api: wsApi, workspace, apply, user } = useWorkspace();
  const save = async (branding) => apply(await wsApi.patch('/settings/business', { branding }));
  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <div><h1>Make it look like yours</h1><p className="muted" style={{ marginTop: 6 }}>Your logo and signature appear on every quotation, invoice and warranty card.</p></div>
      <div className="grid-2">
        <Field label="Logo"><ImageInput value={workspace.branding?.logo} onChange={(logo) => save({ logo })} purpose="logo" label="Upload your logo" /></Field>
        <Field label="Business photo"><ImageInput value={workspace.branding?.photo} onChange={(photo) => save({ photo })} purpose="photo" label="Shopfront or team photo" /></Field>
      </div>
      <section className="card">
        <div className="card-header"><div><h2>Signature</h2><p className="small muted">Printed above “Authorised signatory”. Draw it here, or upload a photo of your signature on paper.</p></div></div>
        <div className="card-body">
          <SignatureField value={workspace.branding?.signature} onChange={(signature) => save({ signature })} />
        </div>
      </section>
      <div className="card card-pad row">
        <img src={user?.picture || '/brand/finvoice-icon.svg'} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
        <div className="grow"><div className="strong">Your profile photo</div><div className="small muted">Comes from your Texor Account and follows you across Finvoice, Talk and Payroll.</div></div>
        {ACCOUNTS_ORIGIN ? <a className="btn btn-secondary btn-sm" href={ACCOUNTS_ORIGIN} target="_blank" rel="noreferrer">Change photo</a> : null}
      </div>
      <div className="onboard-actions"><div className="grow" /><Button variant="ghost" onClick={onNext}>Skip for now</Button><Button size="lg" onClick={onNext}>Continue<ArrowRight /></Button></div>
    </div>
  );
}

function DesignStep({ onNext }) {
  const { api: wsApi, prefs, apply } = useWorkspace();
  const inputs = useDesignPreviewInputs();
  const [designs, setDesigns] = useState(null);
  useEffect(() => { wsApi.get('/designs').then((r) => setDesigns(r.designs)); }, [wsApi]);
  const choose = async (design) => apply(await wsApi.patch('/settings/preferences', { design }));
  return (
    <div className="stack-lg">
      <div><h1>Pick an invoice design</h1><p className="muted" style={{ marginTop: 6 }}>We picked one that suits your industry. Every block, label and colour can be customised later in the designer.</p></div>
      <div className="grid-4">
        {(designs ?? []).map((d) => (
          <button key={d.key} type="button" className="design-card" aria-pressed={(prefs.design ?? 'classic') === d.key} onClick={() => choose(d.key)}>
            <DesignThumb design={d} inputs={inputs} />
            <div className="card-body"><strong>{d.name}</strong><p className="tiny muted">{d.description}</p></div>
          </button>
        ))}
      </div>
      <div className="onboard-actions"><div className="grow" /><Button size="lg" onClick={onNext}>Continue<ArrowRight /></Button></div>
    </div>
  );
}

function TeamStep({ onDone }) {
  const { api: wsApi, boot } = useWorkspace();
  const [rows, setRows] = useState([{ email: '', role: 'staff' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const roles = (boot.roles ?? [{ key: 'admin', name: 'Admin' }, { key: 'accountant', name: 'Accountant' }, { key: 'sales', name: 'Sales' }, { key: 'staff', name: 'Staff' }]).filter((r) => r.key !== 'owner');

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      for (const row of rows.filter((r) => r.email.trim())) await wsApi.post('/team/invites', row);
      await wsApi.patch('/settings/business', { onboarded: true });
      onDone();
    } catch (inviteError) { setError(inviteError.message); setBusy(false); }
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 680 }}>
      <div><h1>Bring your team</h1><p className="muted" style={{ marginTop: 6 }}>They sign in with their own Texor Account and get exactly what their role allows. Staff who never sign in can still be added for attendance later.</p></div>
      {error ? <Alert>{error}</Alert> : null}
      <section className="card card-body stack-sm">
        {rows.map((row, i) => (
          <div className="row" key={i}>
            <input className="input grow" type="email" placeholder="name@example.com" value={row.email} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))} aria-label="Email" />
            <select className="input" style={{ width: 160 }} value={row.role} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, role: e.target.value } : r)))} aria-label="Role">
              {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </select>
            <Button variant="ghost" icon={<Trash2 />} aria-label="Remove" onClick={() => setRows(rows.length === 1 ? [{ email: '', role: 'staff' }] : rows.filter((_, j) => j !== i))} />
          </div>
        ))}
        <div><Button variant="secondary" size="sm" icon={<MailPlus />} onClick={() => setRows([...rows, { email: '', role: 'staff' }])}>Add another</Button></div>
      </section>
      <div className="onboard-actions"><div className="grow" /><Button size="lg" onClick={finish} loading={busy}>{rows.some((r) => r.email.trim()) ? 'Invite and open Finvoice' : 'Open Finvoice'}<ArrowRight /></Button></div>
    </div>
  );
}

function WorkspaceSteps({ slug, user, step, setStep }) {
  const router = useRouter();
  const [boot, setBoot] = useState(null);
  useEffect(() => {
    Promise.all([api(`/api/w/${slug}`), api(`/api/w/${slug}/team`).catch(() => null)]).then(([b, team]) => setBoot({ ...b, roles: team?.roles }));
  }, [slug]);
  const value = useWorkspaceValue(slug, boot, (next) => setBoot((prev) => ({ ...next, roles: prev?.roles })), user);
  if (!boot) return <div className="muted">Setting up your workspace…</div>;
  return (
    <WorkspaceContext.Provider value={value}>
      {step === 2 ? <BrandingStep onNext={() => setStep(3)} /> : null}
      {step === 3 ? <DesignStep onNext={() => setStep(4)} /> : null}
      {step === 4 ? <TeamStep onDone={() => router.replace(`/w/${slug}`)} /> : null}
    </WorkspaceContext.Provider>
  );
}

export default function Onboarding() {
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [step, setStep] = useState(0);
  const [industry, setIndustry] = useState(null);
  const [slug, setSlug] = useState(null);

  useEffect(() => {
    auth.me().then((me) => {
      if (!me.user) router.replace('/signin?returnTo=/onboarding');
      else setUser(me.user);
    }).catch(() => router.replace('/signin?returnTo=/onboarding'));
  }, [router]);

  if (!user) return <Loading label="Loading" />;

  return (
    <ToastProvider>
      <div className="onboard">
        <aside className="onboard-aside">
          <Logo size="lg" dark />
          <div>
            <h2 style={{ color: '#fff', fontSize: '1.3rem' }}>Welcome, {user.displayName?.split(' ')[0]}</h2>
            <p style={{ marginTop: 6, fontSize: '0.875rem' }}>Five quick steps and your business is ready to bill.</p>
          </div>
          <Steps current={step} />
          <div className="grow" />
          <p className="hide-sm" style={{ fontSize: '0.75rem', color: '#6f857f' }}>Signed in with Texor as {user.email}</p>
        </aside>
        <main className="onboard-main">
          {step === 0 ? <IndustryStep value={industry} onChange={setIndustry} onNext={() => setStep(1)} /> : null}
          {step === 1 ? <DetailsStep industry={industry} user={user} onBack={() => setStep(0)} onCreated={(created) => { setSlug(created); setStep(2); }} /> : null}
          {step >= 2 && slug ? <WorkspaceSteps slug={slug} user={user} step={step} setStep={setStep} /> : null}
        </main>
      </div>
    </ToastProvider>
  );
}


