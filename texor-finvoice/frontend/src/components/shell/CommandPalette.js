'use client';

/**
 * ⌘K / Ctrl+K: jump to any module, create anything, or find a record.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Plus, Search } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { useDebounced } from '@/lib/data';
import { money } from '@/lib/format';
import { screenFor, useWorkspace } from '@/lib/workspace';

export function CommandPalette({ open, onClose }) {
  const { api, modules, href, can, currency, module } = useWorkspace();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const dialog = useRef(null);
  const debounced = useDebounced(q, 200);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) { el.showModal(); setQ(''); setActive(0); }
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    if (debounced.trim().length < 2) { setResults([]); return undefined; }
    api.get('/search', { q: debounced }).then((r) => { if (!cancelled) setResults(r.results); }).catch(() => {});
    return () => { cancelled = true; };
  }, [debounced, api]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (text) => !needle || text.toLowerCase().includes(needle);
    const nav = modules.filter((m) => m.page !== false && match(m.label)).map((m) => ({
      id: `go-${m.key}`, group: 'Go to', label: m.label, icon: m.icon, href: href(m.key === 'dashboard' ? '' : `/${m.key}`), hint: m.locked ? 'Pro' : '',
    }));
    const create = modules.filter((m) => !m.locked && ['records', 'documents'].includes(screenFor(m)) && can(m.key, 'create') && match(`new ${m.labelSingular}`)).map((m) => ({
      id: `new-${m.key}`, group: 'Create', label: `New ${m.labelSingular.toLowerCase()}`, icon: 'plus', href: href(`/${m.key}/new`),
    }));
    const found = results.map((r) => ({
      id: `r-${r.id}`, group: 'Records', label: r.title, sub: [module(r.module)?.labelSingular, r.subtitle].filter(Boolean).join(' · '), icon: module(r.module)?.icon ?? 'file', href: href(`/${r.module}/${r.id}`), hint: r.amountMinor != null ? money(r.amountMinor, currency) : '',
    }));
    return [...found, ...create.slice(0, needle ? 6 : 4), ...nav.slice(0, needle ? 12 : 8)];
  }, [q, modules, results, href, can, module, currency]);

  useEffect(() => setActive(0), [items.length]);

  const go = (item) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  let lastGroup = null;
  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === dialog.current) onClose(); }} style={{ marginTop: '12vh' }}>
      {open ? (
        <div>
          <div className="input-icon" style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)' }}>
            <Search style={{ left: '1.4rem' }} />
            <input
              autoFocus
              className="input"
              style={{ border: 0, boxShadow: 'none', height: 40, fontSize: '0.95rem' }}
              placeholder="Search customers, invoices, products… or jump to a module"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
              }}
              aria-label="Search"
            />
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto', padding: '0.4rem' }} role="listbox">
            {items.length === 0 ? <div className="combo-empty">Nothing matches “{q}”.</div> : null}
            {items.map((item, index) => {
              const header = item.group !== lastGroup ? <div className="menu-label" key={`g-${item.group}`}>{item.group}</div> : null;
              lastGroup = item.group;
              return [
                header,
                <div
                  key={item.id}
                  role="option"
                  aria-selected={index === active}
                  className="combo-option"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(item)}
                >
                  <span className="row grow">
                    {item.icon === 'plus' ? <Plus size={15} /> : <Icon name={item.icon} size={15} />}
                    <span className="grow"><span className="ellipsis" style={{ display: 'block' }}>{item.label}</span>{item.sub ? <span className="sub ellipsis" style={{ display: 'block' }}>{item.sub}</span> : null}</span>
                  </span>
                  <span className="row subtle tiny">{item.hint}{index === active ? <CornerDownLeft size={13} /> : null}</span>
                </div>,
              ];
            })}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
