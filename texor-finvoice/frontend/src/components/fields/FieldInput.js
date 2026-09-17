'use client';

import { useRef, useState } from 'react';
import { Image as ImageIcon, Plus, Trash2, Upload, X } from 'lucide-react';
import { Button, Switch, useToast } from '@/components/ui';
import { fileUrl } from '@/lib/api';
import { toDateInput, toDateTimeInput } from '@/lib/format';
import { STATES, gstinError, normaliseGstin } from '@/lib/shared/india.mjs';
import { useWorkspace } from '@/lib/workspace';
import { MoneyInput } from './MoneyInput';
import { ReferencePicker } from './ReferencePicker';

/** Suggestions for free-entry selects come from the workspace's own lists. */
function suggestionsFor(field, moduleKey, prefs) {
  const own = (field.options ?? []).map((o) => o.label ?? o.value);
  const extra = {
    category: prefs.categories?.[moduleKey] ?? [],
    unit: prefs.units ?? [],
    designation: prefs.designations ?? [],
    mode: prefs.paymentModes ?? [],
  }[field.key] ?? [];
  return [...new Set([...own, ...extra])];
}

export function TagsInput({ value = [], onChange, suggestions = [], id, placeholder = 'Type and press Enter' }) {
  const [text, setText] = useState('');
  const add = (raw) => {
    const tag = raw.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText('');
  };
  const listId = `${id}-list`;
  return (
    <div className="tags" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
      {value.map((tag) => (
        <span className="tag" key={tag}>{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}><X /></button></span>
      ))}
      <input
        id={id}
        list={listId}
        value={text}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
      />
      <datalist id={listId}>{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

export function ImageInput({ value, onChange, purpose = 'image', label = 'Upload image', id }) {
  const { api } = useWorkspace();
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(file) {
    if (!file) return;
    setBusy(true);
    try {
      const { file: saved } = await api.upload(file, purpose);
      onChange(saved.key);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input ref={input} id={id} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {value ? (
        <div className="upload-tile" style={{ cursor: 'default' }}>
          <img src={fileUrl(value)} alt="" />
          <div className="row">
            <Button size="sm" variant="secondary" icon={<Upload />} onClick={() => input.current?.click()} loading={busy}>Replace</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => onChange(null)}>Remove</Button>
          </div>
        </div>
      ) : (
        <button type="button" className="upload-tile" onClick={() => input.current?.click()} disabled={busy} style={{ width: '100%' }}>
          {busy ? <span className="spinner" /> : <ImageIcon aria-hidden="true" />}
          <span>{busy ? 'Uploading…' : label}</span>
          <span className="tiny subtle">PNG, JPEG or WebP</span>
        </button>
      )}
    </div>
  );
}

function AddressInput({ value = {}, onChange, id }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="stack-sm">
      <input id={id} className="input" placeholder="Address line 1" value={value.line1 ?? ''} onChange={set('line1')} autoComplete="address-line1" />
      <input className="input" placeholder="Address line 2 (optional)" value={value.line2 ?? ''} onChange={set('line2')} autoComplete="address-line2" />
      <div className="grid-3" style={{ gap: '0.5rem' }}>
        <input className="input" placeholder="City" value={value.city ?? ''} onChange={set('city')} autoComplete="address-level2" />
        <select className="input" value={value.stateCode ?? ''} onChange={set('stateCode')} aria-label="State">
          <option value="">State</option>
          {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>
        <input className="input" placeholder="PIN code" inputMode="numeric" value={value.pincode ?? ''} onChange={set('pincode')} autoComplete="postal-code" />
      </div>
    </div>
  );
}

function VariantsInput({ value = [], onChange, currency }) {
  const update = (index, patch) => onChange(value.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  return (
    <div className="stack-sm">
      {value.map((variant, index) => (
        <div className="row" key={variant._id ?? index}>
          <input className="input grow" placeholder="e.g. SUV, Half, 256 GB" value={variant.name} onChange={(e) => update(index, { name: e.target.value })} aria-label="Variant name" />
          <div style={{ width: 170 }}><MoneyInput value={variant.priceMinor} currency={currency} onChange={(priceMinor) => update(index, { priceMinor: priceMinor ?? 0 })} /></div>
          <Button variant="ghost" size="sm" icon={<Trash2 />} aria-label="Remove variant" onClick={() => onChange(value.filter((_, i) => i !== index))} />
        </div>
      ))}
      <div><Button variant="secondary" size="sm" icon={<Plus />} onClick={() => onChange([...value, { name: '', priceMinor: 0, sku: '' }])}>Add variant</Button></div>
      {value.length ? <span className="field-hint">The first variant's price is used when none is chosen.</span> : null}
    </div>
  );
}

function WarrantyInput({ value, onChange }) {
  const on = Boolean(value);
  return (
    <div className="stack-sm">
      <Switch checked={on} onChange={(checked) => onChange(checked ? { duration: 12, unit: 'months', coverage: '' } : null)} label="Comes with a warranty" />
      {on ? (
        <>
          <div className="row">
            <input className="input" type="number" min="1" style={{ width: 110 }} value={value.duration} onChange={(e) => onChange({ ...value, duration: Number(e.target.value) || 1 })} aria-label="Warranty length" />
            <select className="input" style={{ width: 140 }} value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value })} aria-label="Warranty unit">
              <option value="days">days</option><option value="months">months</option><option value="years">years</option>
            </select>
          </div>
          <textarea className="input" rows={2} placeholder="What is covered, and what is not" value={value.coverage ?? ''} onChange={(e) => onChange({ ...value, coverage: e.target.value })} />
        </>
      ) : null}
    </div>
  );
}

function ItemsInput({ field, value = [], onChange, refs = {}, currency }) {
  const update = (index, patch) => onChange(value.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  return (
    <div className="stack-sm">
      {value.length ? (
        <table className="lines-table">
          <thead><tr><th>Item</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 150 }} className="num">Price</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {value.map((line, index) => (
              <tr key={index}>
                <td>
                  <ReferencePicker
                    refModule={field.refModule ?? 'items'}
                    value={line.item}
                    title={line.description || refs[line.item]?.title}
                    onChange={(id, row) => update(index, { item: id, description: row?.raw?.name ?? line.description, priceMinor: row?.raw?.priceMinor ?? line.priceMinor })}
                    placeholder="Search the catalogue…"
                  />
                </td>
                <td><input className="input input-sm num" type="number" min="0" step="any" value={line.quantity} onChange={(e) => update(index, { quantity: Number(e.target.value) })} aria-label="Quantity" /></td>
                <td><MoneyInput size="sm" value={line.priceMinor} currency={currency} onChange={(priceMinor) => update(index, { priceMinor: priceMinor ?? 0 })} /></td>
                <td><Button variant="ghost" size="sm" icon={<Trash2 />} aria-label="Remove" onClick={() => onChange(value.filter((_, i) => i !== index))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div><Button variant="secondary" size="sm" icon={<Plus />} onClick={() => onChange([...value, { item: null, description: '', quantity: 1, priceMinor: 0 }])}>Add item</Button></div>
    </div>
  );
}

export function GstinInput({ value, onChange, id, invalid }) {
  const message = value && value.length >= 15 ? gstinError(value) : null;
  return (
    <>
      <input
        id={id}
        className={`input mono${invalid || message ? ' invalid' : ''}`}
        value={value ?? ''}
        maxLength={15}
        placeholder="22AAAAA0000A1Z5"
        onChange={(e) => onChange(normaliseGstin(e.target.value))}
        style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
        spellCheck={false}
      />
      {message ? <span className="field-error">{message}</span> : null}
    </>
  );
}

/**
 * The input for any field type. `value` is the stored shape (paise, ISO dates,
 * file keys, ids) and `onChange` emits the same shape.
 */
export function FieldInput({ field, moduleKey, value, onChange, error, id, refs }) {
  const { prefs, currency } = useWorkspace();
  const invalid = Boolean(error);
  const common = { id, className: `input${invalid ? ' invalid' : ''}` };

  switch (field.type) {
    case 'longtext':
      return <textarea {...common} rows={3} value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input {...common} type="number" step="any" value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} readOnly={field.readOnly} />;
    case 'percent':
      return (
        <div className="input-group">
          <input {...common} type="number" min="0" max="100" step="any" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className={`${common.className} num`} />
          <span className="addon">%</span>
        </div>
      );
    case 'currency':
      return <MoneyInput id={id} value={value} currency={currency} invalid={invalid} onChange={onChange} />;
    case 'date':
      return <input {...common} type="date" value={toDateInput(value)} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return <input {...common} type="datetime-local" value={toDateTimeInput(value)} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />;
    case 'time':
      return <input {...common} type="time" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return <Switch id={id} checked={value} onChange={onChange} label={field.help ? undefined : field.label} />;
    case 'email':
      return <input {...common} type="email" value={value ?? ''} placeholder={field.placeholder ?? 'name@example.com'} onChange={(e) => onChange(e.target.value)} autoComplete="email" />;
    case 'phone':
      return <input {...common} type="tel" value={value ?? ''} placeholder={field.placeholder ?? '+91 98765 43210'} onChange={(e) => onChange(e.target.value)} autoComplete="tel" />;
    case 'url':
      return <input {...common} type="url" value={value ?? ''} placeholder="https://" onChange={(e) => onChange(e.target.value)} />;
    case 'select': {
      if (field.allowNew || !(field.options ?? []).length) {
        const listId = `${id}-options`;
        return (
          <>
            <input {...common} list={listId} value={value ?? ''} placeholder={field.placeholder ?? 'Choose or type'} onChange={(e) => onChange(e.target.value)} />
            <datalist id={listId}>{suggestionsFor(field, moduleKey, prefs).map((s) => <option key={s} value={s} />)}</datalist>
          </>
        );
      }
      return (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.required ? 'Choose…' : '—'}</option>
          {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    case 'multiselect':
      return <TagsInput id={id} value={value ?? []} onChange={onChange} suggestions={suggestionsFor(field, moduleKey, prefs)} />;
    case 'image':
    case 'file':
      return <ImageInput id={id} value={value} onChange={onChange} purpose={`${moduleKey}.${field.key}`} />;
    case 'reference':
      return <ReferencePicker id={id} refModule={field.refModule} value={value} title={refs?.[value]?.title} invalid={invalid} onChange={(next) => onChange(next)} />;
    case 'gstin':
      return <GstinInput id={id} value={value} onChange={onChange} invalid={invalid} />;
    case 'state':
      return (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {STATES.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
        </select>
      );
    case 'address':
      return <AddressInput id={id} value={value ?? {}} onChange={onChange} />;
    case 'items':
      return <ItemsInput field={field} value={value ?? []} onChange={onChange} refs={refs} currency={currency} />;
    case 'variants':
      return <VariantsInput value={value ?? []} onChange={onChange} currency={currency} />;
    case 'warranty':
      return <WarrantyInput value={value} onChange={onChange} />;
    default:
      return <input {...common} value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} readOnly={field.readOnly} />;
  }
}

/** Fields that need the whole row. */
export const WIDE_TYPES = new Set(['longtext', 'address', 'items', 'variants', 'warranty', 'image', 'file', 'multiselect']);
