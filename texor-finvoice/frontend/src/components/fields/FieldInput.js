'use client';

import { useRef, useState } from 'react';
import { Check, ChevronDown, Image as ImageIcon, Plus, Trash2, Upload, X } from 'lucide-react';
import { Button, Switch, useToast } from '@/components/ui';
import { fileUrl } from '@/lib/api';
import { toDateInput, toDateTimeInput } from '@/lib/format';
import { STATES, gstinError, normaliseGstin } from '@/lib/shared/india.mjs';
import { suggestionBucket, useWorkspace } from '@/lib/workspace';
import { ComboList, useCombo } from './combo';
import { MoneyInput } from './MoneyInput';
import { ReferencePicker } from './ReferencePicker';

/** Suggestions for free-entry selects come from the workspace's own lists. */

/**
 * A dropdown for a short list of words the workspace maintains itself:
 * categories, units, staff roles, payment modes.
 *
 * It was a bare `<input list=datalist>`, which looks like a text box, hides the
 * options behind a browser-specific affordance and cannot be styled. This shows
 * the list on focus and, when the field allows it, offers to create what was
 * typed instead of leaving people to guess that free text is allowed.
 */
function SelectInput({ id, field, value, onChange, options, allowNew, invalid, onCreate }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const matches = options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()));
  const typed = query.trim();
  const canCreate = allowNew && typed.length > 0 && !options.some((o) => o.toLowerCase() === typed.toLowerCase());
  const rows = canCreate ? matches.length + 1 : matches.length;
  const { open, setOpen, box, wrap, list } = useCombo(rows);

  const close = () => { setOpen(false); setQuery(''); };
  const pick = (index) => {
    if (canCreate && index === matches.length) { onChange(typed); onCreate?.(typed); close(); return; }
    if (matches[index] == null) return;
    onChange(matches[index]);
    close();
  };

  return (
    <div className="combo" ref={wrap}>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          className={`input${invalid ? ' invalid' : ''}`}
          style={{ paddingRight: '3.6rem' }}
          value={open ? query : (value ?? '')}
          placeholder={value ? value : (field.placeholder ?? (allowNew ? 'Choose or add…' : 'Choose…'))}
          onFocus={() => { setOpen(true); setQuery(''); setActive(0); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, rows - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && open) { e.preventDefault(); pick(active); }
            if (e.key === 'Escape') close();
          }}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <span className="row" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', gap: 2 }}>
          {value && !field.required ? (
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Clear" onClick={() => onChange('')}><X /></button>
          ) : null}
          <ChevronDown size={15} color="var(--text-subtle)" />
        </span>
      </div>
      {open ? (
        <ComboList box={box} listRef={list}>
          {!matches.length && !canCreate ? (
            <div className="combo-empty">{options.length ? `Nothing matches “${typed}”.` : 'Nothing here yet — type to add the first one.'}</div>
          ) : null}
          {matches.map((option, index) => (
            <div key={option} role="option" aria-selected={index === active}
              className={`combo-option${option === value ? ' is-current' : ''}`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(index)} onMouseEnter={() => setActive(index)}>
              <span className="grow ellipsis">{option}</span>
              {option === value ? <Check size={15} /> : null}
            </div>
          ))}
          {canCreate ? (
            <>
              {matches.length ? <div className="menu-sep" /> : null}
              <div role="option" aria-selected={active === matches.length}
                className="combo-option" onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(matches.length)} onMouseEnter={() => setActive(matches.length)}>
                <span className="row"><Plus size={15} />Add “{typed}”</span>
              </div>
            </>
          ) : null}
        </ComboList>
      ) : null}
    </div>
  );
}

function suggestionsFor(field, moduleKey, prefs) {
  const own = (field.options ?? []).map((o) => o.label ?? o.value);
  const bucket = suggestionBucket(field.key, moduleKey);
  const [key, sub] = bucket ?? [];
  const extra = (bucket ? (sub ? prefs[key]?.[sub] : prefs[key]) : null) ?? [];
  return [...new Set([...own, ...extra])];
}

export function TagsInput({ value = [], onChange, suggestions = [], id, placeholder = 'Type and press Enter' }) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const available = suggestions.filter((s) => !value.includes(s) && s.toLowerCase().includes(text.trim().toLowerCase()));
  const typed = text.trim();
  const canAdd = typed.length > 0 && !value.some((t) => t.toLowerCase() === typed.toLowerCase());
  const rows = canAdd ? available.length + 1 : available.length;
  const { open, setOpen, box, wrap, list } = useCombo(rows);

  const add = (raw) => {
    const tag = String(raw ?? '').trim();
    if (tag && !value.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...value, tag]);
    setText('');
    setActive(0);
  };
  const pick = (index) => {
    if (canAdd && index === available.length) return add(typed);
    if (available[index] != null) add(available[index]);
  };

  return (
    <div className="combo" ref={wrap}>
      <div className="tags" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
        {value.map((tag) => (
          <span className="tag" key={tag}>{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}><X /></button></span>
        ))}
        <input
          id={id}
          value={text}
          placeholder={value.length ? '' : placeholder}
          onFocus={() => { setOpen(true); setActive(0); }}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, rows - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (open && rows) pick(active); else add(text); }
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
      </div>
      {open && rows ? (
        <ComboList box={box} listRef={list}>
          {available.map((option, index) => (
            <div key={option} role="option" aria-selected={index === active} className="combo-option"
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(index)} onMouseEnter={() => setActive(index)}>
              <span className="grow ellipsis">{option}</span>
            </div>
          ))}
          {canAdd ? (
            <>
              {available.length ? <div className="menu-sep" /> : null}
              <div role="option" aria-selected={active === available.length} className="combo-option"
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(available.length)} onMouseEnter={() => setActive(available.length)}>
                <span className="row"><Plus size={15} />Add “{typed}”</span>
              </div>
            </>
          ) : null}
        </ComboList>
      ) : null}
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

export const WARRANTY_SCOPES = [
  { value: 'parts_labour', label: 'Parts & labour' },
  { value: 'parts', label: 'Parts only' },
  { value: 'labour', label: 'Labour only' },
  { value: 'replacement', label: 'Replacement' },
  { value: 'service', label: 'Service / workmanship' },
];

/**
 * A short list of plain sentences — the "what is covered" and "what is not"
 * points that a warranty card is actually read for. Enter adds the next one,
 * so a whole policy can be typed without reaching for the mouse.
 */
function PointsInput({ value = [], onChange, placeholder, addLabel = 'Add point', id }) {
  const refs = useRef([]);
  const focus = (index) => requestAnimationFrame(() => refs.current[index]?.focus());

  const add = (at = value.length) => {
    const next = [...value];
    next.splice(at, 0, '');
    onChange(next);
    focus(at);
  };

  return (
    <div className="stack-sm">
      {value.map((point, index) => (
        <div className="row" key={index}>
          <span className="points-bullet" aria-hidden="true" />
          <input
            className="input"
            id={index === 0 ? id : undefined}
            ref={(el) => { refs.current[index] = el; }}
            value={point}
            placeholder={placeholder}
            onChange={(e) => onChange(value.map((p, i) => (i === index ? e.target.value : p)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); add(index + 1); }
              if (e.key === 'Backspace' && point === '' && value.length > 1) {
                e.preventDefault();
                onChange(value.filter((_, i) => i !== index));
                focus(Math.max(0, index - 1));
              }
            }}
          />
          <Button variant="ghost" size="sm" icon={<Trash2 />} aria-label="Remove point" onClick={() => onChange(value.filter((_, i) => i !== index))} />
        </div>
      ))}
      <div><Button variant="secondary" size="sm" icon={<Plus />} onClick={() => add()}>{addLabel}</Button></div>
    </div>
  );
}

const WARRANTY_DEFAULT = { duration: 12, unit: 'months', scope: 'parts_labour', includes: [], excludes: [], transferable: false, coverage: '' };

/**
 * The policy a product carries. Whatever is set here is copied onto every
 * warranty the invoice issues, so it is the certificate's wording, not a note.
 */
function WarrantyInput({ value, onChange, id }) {
  const on = Boolean(value);
  const w = { ...WARRANTY_DEFAULT, ...(value ?? {}) };
  const set = (patch) => onChange({ ...w, ...patch });

  return (
    <div className="stack-sm">
      <Switch id={id} checked={on} onChange={(checked) => onChange(checked ? { ...WARRANTY_DEFAULT } : null)} label="Comes with a warranty" />
      {on ? (
        <div className="warranty-terms stack">
          <div className="fields-grid">
            <div className="field">
              <span className="field-label">How long</span>
              <div className="row">
                <input className="input" type="number" min="1" style={{ width: 110 }} value={w.duration}
                  onChange={(e) => set({ duration: Number(e.target.value) || 1 })} aria-label="Warranty length" />
                <select className="input" style={{ width: 140 }} value={w.unit} onChange={(e) => set({ unit: e.target.value })} aria-label="Warranty unit">
                  <option value="days">days</option><option value="months">months</option><option value="years">years</option>
                </select>
              </div>
              <span className="field-hint">Counted from the invoice date.</span>
            </div>
            <div className="field">
              <span className="field-label">Cover</span>
              <select className="input" value={w.scope} onChange={(e) => set({ scope: e.target.value })} aria-label="What the warranty covers">
                {WARRANTY_SCOPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="field-hint">What the customer can claim for.</span>
            </div>
          </div>

          <div className="field">
            <span className="field-label">What is covered</span>
            <PointsInput value={w.includes} onChange={(includes) => set({ includes })}
              placeholder="e.g. Manufacturing defects in the panel" addLabel="Add covered point" />
          </div>

          <div className="field">
            <span className="field-label">What is not covered</span>
            <PointsInput value={w.excludes} onChange={(excludes) => set({ excludes })}
              placeholder="e.g. Physical damage or liquid ingress" addLabel="Add exclusion" />
          </div>

          <Switch checked={w.transferable} onChange={(transferable) => set({ transferable })} label="Transferable to a new owner" />

          <div className="field">
            <span className="field-label">Notes</span>
            <textarea className="input" rows={2} placeholder="Anything else that should appear on the card"
              value={w.coverage ?? ''} onChange={(e) => set({ coverage: e.target.value })} />
          </div>
        </div>
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
  const { prefs, currency, learn } = useWorkspace();
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
        return (
          <SelectInput
            id={id}
            field={field}
            value={value}
            onChange={onChange}
            invalid={invalid}
            allowNew={field.allowNew !== false}
            options={suggestionsFor(field, moduleKey, prefs)}
            onCreate={(added) => learn(field.key, moduleKey, added)}
          />
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
    case 'points':
      return <PointsInput id={id} value={value ?? []} onChange={onChange} placeholder={field.placeholder} />;
    case 'warranty':
      return <WarrantyInput id={id} value={value} onChange={onChange} />;
    default:
      return <input {...common} value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} readOnly={field.readOnly} />;
  }
}

/** Fields that need the whole row. */
export const WIDE_TYPES = new Set(['longtext', 'address', 'items', 'variants', 'warranty', 'points', 'image', 'file', 'multiselect']);
