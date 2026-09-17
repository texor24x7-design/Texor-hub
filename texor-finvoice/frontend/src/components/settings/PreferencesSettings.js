'use client';

import { useState } from 'react';
import { Button, Field, Switch, useToast } from '@/components/ui';
import { TagsInput } from '@/components/fields/FieldInput';
import { useResource } from '@/lib/data';
import { financialYear } from '@/lib/shared/india.mjs';
import { useWorkspace } from '@/lib/workspace';
import { SettingsLayout } from './SettingsLayout';

const WIDGET_LABELS = {
  sales_today: "Today's sales", sales_month: 'Sales, last 30 days', receivables: 'Money to collect', overdue: 'Overdue invoices', quotes_open: 'Open quotations',
  low_stock: 'Low stock', warranties_expiring: 'Warranties ending soon', attendance_today: 'Attendance today', top_items: 'Best sellers',
  payment_modes_today: 'Collected today by mode', recent_invoices: 'Recent invoices',
};

export function PreferencesSettings() {
  const { api, slug, prefs, apply, workspace, module, can } = useWorkspace();
  const toast = useToast();
  const { data: dash } = useResource(`dashboard:${slug}`, () => api.get('/dashboard'));
  const [form, setForm] = useState(() => ({
    taxRate: prefs.taxRate ?? 18, priceIncludesTax: prefs.priceIncludesTax ?? false, roundOff: prefs.roundOff ?? false,
    dueDays: prefs.dueDays ?? 15, validityDays: prefs.validityDays ?? 15,
    numbering: { invoices: prefs.numbering?.invoices ?? 'INV', quotations: prefs.numbering?.quotations ?? 'QT' },
    paymentModes: prefs.paymentModes ?? [], units: prefs.units ?? [], designations: prefs.designations ?? [],
    terms: prefs.terms ?? '', quotationTerms: prefs.quotationTerms ?? prefs.terms ?? '', dashboard: prefs.dashboard ?? [],
  }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const fy = financialYear(new Date(), workspace.fyStartMonth);
  const preview = (prefix) => [prefix, fy, '0001'].filter(Boolean).join('/');

  async function save() {
    setBusy(true);
    setErrors({});
    try { apply(await api.patch('/settings/preferences', { ...form, taxRate: Number(form.taxRate), dueDays: Number(form.dueDays), validityDays: Number(form.validityDays) })); toast('Preferences saved'); } catch (error) { setErrors(error.fieldErrors); toast(error.message, 'error'); } finally { setBusy(false); }
  }

  const invoices = module('invoices');
  const quotations = module('quotations');
  const boardLabel = (key) => module(key.slice(6))?.label;

  return (
    <SettingsLayout section="preferences" title="Invoicing & taxes" description="Defaults for new documents. Anything here can still be changed on a single invoice." actions={can('settings', 'edit') ? <Button onClick={save} loading={busy}>Save changes</Button> : null}>
      <section className="card">
        <div className="card-header"><h2>Numbering</h2></div>
        <div className="card-body grid-2">
          <Field label={`${invoices?.labelSingular ?? 'Invoice'} prefix`} hint={`Next number looks like ${preview(form.numbering.invoices)}. Numbers restart each financial year and never repeat.`} error={errors['numbering.invoices']}>
            <input className="input mono" maxLength={5} value={form.numbering.invoices} onChange={(e) => set({ numbering: { ...form.numbering, invoices: e.target.value.toUpperCase() } })} />
          </Field>
          <Field label={`${quotations?.labelSingular ?? 'Quotation'} prefix`} hint={`Looks like ${preview(form.numbering.quotations)}.`} error={errors['numbering.quotations']}>
            <input className="input mono" maxLength={5} value={form.numbering.quotations} onChange={(e) => set({ numbering: { ...form.numbering, quotations: e.target.value.toUpperCase() } })} />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-header"><h2>Tax & pricing</h2></div>
        <div className="card-body grid-2">
          <Field label="Default GST rate">
            <select className="input" value={form.taxRate} onChange={(e) => set({ taxRate: e.target.value })}>{[0, 0.25, 3, 5, 18, 40].map((r) => <option key={r} value={r}>{r}%</option>)}</select>
          </Field>
          <div className="stack-sm" style={{ paddingTop: '1.6rem' }}>
            <Switch checked={form.priceIncludesTax} onChange={(priceIncludesTax) => set({ priceIncludesTax })} label="Prices include GST by default" />
            <Switch checked={form.roundOff} onChange={(roundOff) => set({ roundOff })} label="Round totals to the nearest rupee" />
          </div>
          <Field label="Payment due after (days)" hint="0 means due on receipt."><input className="input" type="number" min="0" value={form.dueDays} onChange={(e) => set({ dueDays: e.target.value })} /></Field>
          <Field label="Quotations valid for (days)"><input className="input" type="number" min="0" value={form.validityDays} onChange={(e) => set({ validityDays: e.target.value })} /></Field>
        </div>
      </section>

      <section className="card">
        <div className="card-header"><h2>Lists</h2></div>
        <div className="card-body stack">
          <Field label="Payment modes" hint="Shown as buttons when recording a payment, and used for reports." error={errors.paymentModes}><TagsInput id="modes" value={form.paymentModes} onChange={(paymentModes) => set({ paymentModes })} /></Field>
          <Field label="Units"><TagsInput id="units" value={form.units} onChange={(units) => set({ units })} /></Field>
          <Field label="Staff roles"><TagsInput id="designations" value={form.designations} onChange={(designations) => set({ designations })} /></Field>
        </div>
      </section>

      <section className="card">
        <div className="card-header"><h2>Default terms</h2></div>
        <div className="card-body grid-2">
          <Field label={`On ${invoices?.label.toLowerCase() ?? 'invoices'}`}><textarea className="input" rows={5} value={form.terms} onChange={(e) => set({ terms: e.target.value })} /></Field>
          <Field label={`On ${quotations?.label.toLowerCase() ?? 'quotations'}`}><textarea className="input" rows={5} value={form.quotationTerms} onChange={(e) => set({ quotationTerms: e.target.value })} /></Field>
        </div>
      </section>

      {dash?.available ? (
        <section className="card">
          <div className="card-header"><div><h2>Dashboard</h2><p className="small muted">Choose what everyone sees first. Each person only sees what their role allows.</p></div></div>
          <div className="card-body grid-3">
            {dash.available.map((key) => (
              <label key={key} className="check">
                <input type="checkbox" checked={form.dashboard.includes(key)} onChange={(e) => set({ dashboard: e.target.checked ? [...form.dashboard, key] : form.dashboard.filter((k) => k !== key) })} />
                {WIDGET_LABELS[key] ?? `${boardLabel(key)} board`}
              </label>
            ))}
          </div>
        </section>
      ) : null}
    </SettingsLayout>
  );
}
