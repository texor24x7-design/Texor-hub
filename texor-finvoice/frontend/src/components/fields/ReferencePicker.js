'use client';

/**
 * Search-as-you-type picker for a linked record: a customer, a vehicle, a
 * staff member, a catalogue item.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useDebounced } from '@/lib/data';
import { money } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';

const CATALOGUE = new Set(['items', 'products', 'services']);

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
        .map((i) => ({ id: i._id, title: i.name, subtitle: [i.sku, i.variants?.length ? `${i.variants.length} variants` : ''].filter(Boolean).join(' · '), amount: i.priceMinor, raw: i })))
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [label, setLabel] = useState(title ?? '');
  const [box, setBox] = useState(null);
  const wrap = useRef(null);
  const list = useRef(null);
  const { results, loading } = useSearch(refModule, query, { enabled: open });

  useEffect(() => { setLabel(title ?? ''); }, [title]);

  /**
   * The list is rendered in a portal, fixed to the input's position.
   *
   * Inside a document's items table it would otherwise be trapped: that table
   * scrolls sideways, and a box with `overflow-x: auto` clips vertically too —
   * which turned the suggestions into a tiny scrollable sliver.
   */
  const place = useCallback(() => {
    const input = wrap.current?.querySelector('input');
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const height = Math.min(320, Math.max(below - 16, 160));
    setBox({
      left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 260) - 8),
      width: Math.max(rect.width, 260),
      top: below < 200 && rect.top > below ? undefined : rect.bottom + 4,
      bottom: below < 200 && rect.top > below ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: below < 200 && rect.top > below ? Math.min(320, rect.top - 16) : height,
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place, results.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target) && !list.current?.contains(e.target)) setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener('mousedown', onDown);
    // `true` so the ancestors that actually scroll (the items table, the page) are heard.
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

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
      {open && box ? createPortal((
        <div
          className="combo-list"
          role="listbox"
          ref={list}
          style={{ position: 'fixed', left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight, right: 'auto' }}
        >
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
        </div>
      ), document.body) : null}
    </div>
  );
}
