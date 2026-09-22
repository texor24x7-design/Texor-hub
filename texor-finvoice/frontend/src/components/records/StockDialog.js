'use client';

/**
 * Moving one product's stock: a delivery received, a customer return, or a
 * correction. Shared by the product page and the products list, because the
 * count someone wants to fix is usually the one they are looking at in the
 * table, and walking into the record to fix it is the reason nobody did.
 */
import { useState } from 'react';
import { Button, Dialog, Field, useToast } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';

const EMPTY = { quantity: '', reason: 'purchase', note: '' };

export function StockDialog({ item, open, onClose, onSaved }) {
  const { api } = useWorkspace();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.post(`/products/${item._id}/stock`, { quantity: Number(form.quantity), reason: form.reason, note: form.note });
      setForm(EMPTY);
      onClose();
      onSaved?.();
      toast('Stock updated');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Adjust stock — ${item.name}`} size="narrow"
      description={`${item.stock} ${item.unit || 'in hand'} right now.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="stack">
        <Field label="What happened">
          <select className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
            <option value="purchase">Received new stock</option>
            <option value="return">Customer returned</option>
            <option value="adjustment">Correction (use − to remove)</option>
          </select>
        </Field>
        <Field label="Quantity" hint="Negative numbers remove stock.">
          <input className="input" type="number" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} autoFocus />
        </Field>
        <Field label="Note">
          <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Supplier bill no., reason…" />
        </Field>
      </div>
    </Dialog>
  );
}
