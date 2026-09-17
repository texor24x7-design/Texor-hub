'use client';

import { useState } from 'react';
import { Alert, Button, Field, useToast } from '@/components/ui';
import { GstinInput } from '@/components/fields/FieldInput';
import { STATES, stateFromGstin } from '@/lib/shared/india.mjs';
import { useWorkspace } from '@/lib/workspace';
import { SettingsLayout } from './SettingsLayout';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function BusinessSettings() {
  const { api, workspace, apply, can } = useWorkspace();
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    name: workspace.name, legalName: workspace.legalName, gstin: workspace.gstin, stateCode: workspace.stateCode, pan: workspace.pan,
    address: { ...workspace.address }, phone: workspace.phone, email: workspace.email, website: workspace.website,
    currency: workspace.currency, fyStartMonth: workspace.fyStartMonth, bank: { ...workspace.bank },
  }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const readOnly = !can('settings', 'edit');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setAddress = (key) => (e) => set({ address: { ...form.address, [key]: e.target.value } });
  const setBank = (key) => (e) => set({ bank: { ...form.bank, [key]: e.target.value } });

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      apply(await api.patch('/settings/business', form));
      toast('Business profile saved');
    } catch (error) {
      setErrors({ ...error.fieldErrors, _: error.message });
    } finally { setBusy(false); }
  }

  return (
    <SettingsLayout section="business" title="Business profile" description="Printed on every quotation and invoice. Issued invoices keep the details they were issued with." actions={!readOnly ? <Button onClick={save} loading={busy}>Save changes</Button> : null}>
      {errors._ ? <Alert>{errors._}</Alert> : null}
      <section className="card">
        <div className="card-header"><h2>Identity</h2></div>
        <div className="card-body grid-2">
          <Field label="Business name" required error={errors.name}><input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} disabled={readOnly} /></Field>
          <Field label="Legal name" hint="As registered for GST, if different." error={errors.legalName}><input className="input" value={form.legalName} onChange={(e) => set({ legalName: e.target.value })} disabled={readOnly} /></Field>
          <Field label="GSTIN" hint="Leave empty if you are not GST registered — invoices will then carry no GST." error={errors.gstin}>
            <GstinInput value={form.gstin} onChange={(gstin) => set({ gstin, stateCode: stateFromGstin(gstin) || form.stateCode })} />
          </Field>
          <Field label="State" hint="Decides CGST + SGST versus IGST." error={errors.stateCode}>
            <select className="input" value={form.stateCode} onChange={(e) => set({ stateCode: e.target.value })} disabled={readOnly}>
              <option value="">Choose…</option>{STATES.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
            </select>
          </Field>
          <Field label="PAN" error={errors.pan}><input className="input mono" value={form.pan} maxLength={10} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} disabled={readOnly} /></Field>
          <Field label="Financial year starts in">
            <select className="input" value={form.fyStartMonth} onChange={(e) => set({ fyStartMonth: Number(e.target.value) })} disabled={readOnly}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-header"><h2>Address & contact</h2></div>
        <div className="card-body grid-2">
          <Field label="Address line 1" className="span-2"><input className="input" value={form.address.line1} onChange={setAddress('line1')} disabled={readOnly} /></Field>
          <Field label="Address line 2" className="span-2"><input className="input" value={form.address.line2} onChange={setAddress('line2')} disabled={readOnly} /></Field>
          <Field label="City"><input className="input" value={form.address.city} onChange={setAddress('city')} disabled={readOnly} /></Field>
          <Field label="PIN code"><input className="input" value={form.address.pincode} onChange={setAddress('pincode')} disabled={readOnly} /></Field>
          <Field label="Phone" error={errors.phone}><input className="input" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} disabled={readOnly} /></Field>
          <Field label="Email" error={errors.email}><input className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} disabled={readOnly} /></Field>
          <Field label="Website" error={errors.website}><input className="input" type="url" value={form.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" disabled={readOnly} /></Field>
          <Field label="Currency"><select className="input" value={form.currency} onChange={(e) => set({ currency: e.target.value })} disabled={readOnly}>{['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        </div>
      </section>

      <section className="card">
        <div className="card-header"><div><h2>Getting paid</h2><p className="small muted">A UPI ID puts a scan-to-pay QR code on unpaid invoices.</p></div></div>
        <div className="card-body grid-2">
          <Field label="UPI ID" error={errors['bank.upiId']}><input className="input" value={form.bank.upiId ?? ''} onChange={setBank('upiId')} placeholder="yourbusiness@okhdfcbank" disabled={readOnly} /></Field>
          <Field label="Account name"><input className="input" value={form.bank.accountName ?? ''} onChange={setBank('accountName')} disabled={readOnly} /></Field>
          <Field label="Account number"><input className="input mono" value={form.bank.accountNumber ?? ''} onChange={setBank('accountNumber')} disabled={readOnly} /></Field>
          <Field label="IFSC" error={errors['bank.ifsc']}><input className="input mono" value={form.bank.ifsc ?? ''} onChange={(e) => set({ bank: { ...form.bank, ifsc: e.target.value.toUpperCase() } })} maxLength={11} disabled={readOnly} /></Field>
          <Field label="Bank"><input className="input" value={form.bank.bankName ?? ''} onChange={setBank('bankName')} disabled={readOnly} /></Field>
          <Field label="Branch"><input className="input" value={form.bank.branch ?? ''} onChange={setBank('branch')} disabled={readOnly} /></Field>
        </div>
      </section>
    </SettingsLayout>
  );
}
