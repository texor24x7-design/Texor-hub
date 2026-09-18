'use client';

/**
 * Search-as-you-type picker for a linked record: a customer, a vehicle, a
 * staff member, a catalogue item.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useDebounced } from '@/lib/data';
import { money } from '@/lib/format';
import { partsTotal } from '@/lib/shared/packages.mjs';
import { useWorkspace } from '@/lib/workspace';
import { ComboList, useCombo } from './combo';

const CATALOGUE = new Set(['items', 'products', 'services', 'packages']);

/** What a package will actually bill for, so the picker shows a real number. */
const packagePrice = (pkg) => (pkg.packagePricing === 'percent'
  ? Math.round(partsTotal(pkg) * (1 - (Number(pkg.packageDiscountPct) || 0) / 100))
  : pkg.priceMinor);

export function useSearch(refModule, query, { enabled = true } = {}) {
  const { api, module } = useWorkspace();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(query, 180);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setLoading(true);
    const request = CATALOGUE.has(refModule)
      ? api.get('/items', { q: debounced, limit: 25 }).then((r) => r.items
        .filter((i) => refModule === 'items' || `${i.kind}s` === refModule)
        .map((i) => ({
          id: i._id,
          title: i.name,
          subtitle: i.kind === 'package'
            ? [`${(i.components ?? []).length} items`, i.packagePricing === 'percent' ? `${i.packageDiscountPct}% off` : 'package price'].filter(Boolean).join(' · ')
            : [i.sku, i.variants?.length ? `${i.variants.length} variants` : ''].filter(Boolean).join(' · '),
          amount: i.kind === 'package' ? packagePrice(i) : i.priceMinor,
          raw: i,
        })))
      : module(refModule)
        ? api.get(`/records/${refModule}`, { q: debounced, limit: 25 }).then((r) => r.records.map((rec) => ({ id: rec._id, title: rec.title || rec.name || rec.itemName || 'Untitled', subtitle: rec.phone || rec.designation || rec.serial || '', raw: rec })))
        : Promise.resolve([]);
    request.then((rows) => { if (!cancelled) setResults(rows); }).catch(() => { if (!cancelled) setResults([]); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, module, refModule, debounced, enabled]);

  return { results, loading };
}

export function ReferencePicker({ refModule, value, title, onChange, placeholder, invalid, id, onCreate, createLabel, autoFocus }) {
  const { currency, module } = useWorkspace();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [label, setLabel] = useState(title ?? '');
  const { open, setOpen, box, wrap, list, place } = useCombo();
  const { results, loading } = useSearch(refModule, query, { enabled: open });

  useEffect(() => { setLabel(title ?? ''); }, [title]);
  // Results arrive after the list is already open, so re-pin it when they do.
  useLayoutEffect(() => { if (open) place(); }, [open, place, results.length]);

  const choose = (row) => {
    setLabel(row.title);
    setQuery('');
    setOpen(false);
    onChange(row.id, row);
  };

  const target = module(refModule);
  const noun = CATALOGUE.has(refModule) ? 'item' : (target?.labelSingular ?? 'record').toLowerCase();

  return (
    <div className="combo" ref={wrap}>
      <div className="input-icon" style={{ position: 'relative' }}>
        <input
          id={id}
          autoFocus={autoFocus}
          className={`input${invalid ? ' invalid' : ''}`}
          style={{ paddingLeft: '0.7rem', paddingRight: '3.8rem' }}
          value={open ? query : label}
          placeholder={value ? label : (placeholder ?? `Search ${noun}…`)}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); choose(results[active]); }
            if (e.key === 'Escape') setOpen(false);
          }}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <span className="row" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', gap: 2 }}>
          {value ? <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Clear" onClick={() => { setLabel(''); onChange(null, null); }}><X /></button> : null}
          <ChevronDown size={15} color="var(--text-subtle)" />
        </span>
      </div>
      {open ? (
        <ComboList box={box} listRef={list}>
          {loading && !results.length ? <div className="combo-empty">Searching…</div> : null}
          {!loading && !results.length ? <div className="combo-empty">{query ? `No ${noun} matches “${query}”.` : `No ${noun}s yet.`}</div> : null}
          {results.map((row, index) => (
            <div key={row.id} role="option" aria-selected={index === active} className="combo-option" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(row)} onMouseEnter={() => setActive(index)}>
              <span className="grow"><span className="ellipsis" style={{ display: 'block' }}>{row.title}</span>{row.subtitle ? <span className="sub ellipsis" style={{ display: 'block' }}>{row.subtitle}</span> : null}</span>
              {row.amount != null ? <span className="num sub">{money(row.amount, currency)}</span> : null}
            </div>
          ))}
          {onCreate ? (
            <>
              <div className="menu-sep" />
              <div className="combo-option" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); onCreate(query); }}>
                <span className="row"><Plus size={15} />{createLabel ?? `New ${noun}`}{query ? ` “${query}”` : ''}</span>
              </div>
            </>
          ) : null}
        </ComboList>
      ) : null}
    </div>
  );
}
