'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, Field, Switch, useToast } from '@/components/ui';
import { EVERY_UNITS } from '@/components/pages/Schedules';
import { invalidate } from '@/lib/data';
import { toDateInput } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';

/**
 * Turns an issued invoice into a repeating one. The lines are copied as they
 * stand, so what repeats is exactly what the customer already agreed to.
 */
export function RepeatDialog({ open, onClose, document: doc }) {
  const { api, slug, href, prefs, module } = useWorkspace();
  const toast = useToast();
  const schedules = module('schedules');
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next = new Date();
    next.setMonth(next.getMonth() + 1);
    setForm({
      title: `${doc.billTo?.name ?? 'Customer'} — repeating`,
      n: 1, unit: 'months',
      nextRunAt: toDateInput(next),
      endsOn: '',
      dueDays: prefs.dueDays ?? 15,
      autoSend: false,
      channel: 'smtp',
    });
    setErrors({});
  }, [open, doc, prefs.dueDays]);

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api.post('/schedules', {
        title: form.title,
        customer: doc.customer,
        lines: (doc.lines ?? []).map(({ item, description, variant, hsn, quantity, unit, priceMinor, discountPct, taxRate, cessRate, priceIncludesTax, custom }) => ({
          item: item ?? null, description, variant, hsn, quantity, unit, priceMinor, discountPct, taxRate, cessRate, priceIncludesTax, custom,
        })),
        notes: doc.notes ?? '',
        terms: doc.terms ?? '',
        custom: doc.custom ?? {},
        every: { n: Number(form.n) || 1, unit: form.unit },
        nextRunAt: form.nextRunAt,
        endsOn: form.endsOn || null,
        dueDays: Number(form.dueDays) || 0,
        autoSend: form.autoSend,
        channel: form.channel,
      });
      invalidate(`schedules:${slug}`);
      toast('It will raise itself from now on');
      onClose();
    } catch (error) {
      setErrors({ ...error.fieldErrors, _: error.message });
    } finally { setBusy(false); }
  }

  if (!form) return null;

  return (
    <Dialog open={open} onClose={onClose} title="Repeat this invoice"
      description={`The same lines will be raised and issued for ${doc.billTo?.name ?? 'this customer'} on the schedule you choose.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Set it up</Button></>}>
      <div className="stack">
        {errors._ ? <Alert kind="error">{errors._}</Alert> : null}
        {errors.lines ? <Alert kind="warning">{errors.lines}</Alert> : null}
        <Field label="Name" hint={`Shown in ${schedules?.label ?? 'the list'}.`}>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
        </Field>
        <div className="grid-2">
          <Field label="Repeat every">
            <div className="row">
              <input className="input" type="number" min="1" max="365" style={{ width: 90 }} value={form.n} onChange={(e) => setForm({ ...form, n: e.target.value })} aria-label="How often" />
              <select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} aria-label="Unit">
                {EVERY_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </Field>
          <Field label="First one on" error={errors.nextRunAt}>
            <input className="input" type="date" value={form.nextRunAt} onChange={(e) => setForm({ ...form, nextRunAt: e.target.value })} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Stop after" hint="Leave empty to keep going.">
            <input className="input" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
          </Field>
          <Field label="Payment due in" hint="Days after each invoice is raised.">
            <input className="input" type="number" min="0" max="365" value={form.dueDays} onChange={(e) => setForm({ ...form, dueDays: e.target.value })} />
          </Field>
        </div>
        <Switch checked={form.autoSend} onChange={(autoSend) => setForm({ ...form, autoSend })} label="Send each one to the customer automatically" />
        {form.autoSend ? (
          <>
            <Field label="Send over">
              <select className="input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                <option value="smtp">Email (SMTP)</option>
                <option value="whatsapp_cloud">WhatsApp Business</option>
              </select>
            </Field>
            <Alert kind="info">Needs that channel set up under Settings → Integrations. Without it the invoice is still raised, just not sent.</Alert>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
