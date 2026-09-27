'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { Download, KanbanSquare, PackagePlus, Plus, Search, Settings2, Table2, Trash2, Upload } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { Badge, Button, ButtonLink, EmptyState, IconButton, Menu, PageHeader, Pagination, Segmented, SkeletonRows, SortTh, StatusBadge, Tabs, useConfirm, useToast, CardTable } from '@/components/ui';
import { FieldValue, readField } from '@/components/fields/FieldValue';
import { invalidate, useDebounced, useResource, useStored } from '@/lib/data';
import { money } from '@/lib/format';
import { recordTitle, useWorkspace } from '@/lib/workspace';
import { ImportDialog } from './ImportDialog';
import { StockDialog } from './StockDialog';

/** Mirrors the server's rule in `record.service.js`, so a header only offers what it can deliver. */
const SORTABLE_TYPES = new Set(['text', 'email', 'phone', 'url', 'gstin', 'state', 'select', 'number', 'currency', 'percent', 'date', 'datetime', 'checkbox', 'time']);

const LISTABLE = new Set(['text', 'email', 'phone', 'select', 'currency', 'number', 'date', 'datetime', 'reference', 'checkbox', 'gstin', 'state', 'percent', 'multiselect', 'image']);

/** Status tabs some modules get on top of their fields. */
const PRESET_TABS = {
  warranties: [{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'expiring', label: 'Expiring soon' }, { value: 'expired', label: 'Expired' }, { value: 'void', label: 'Void' }],
  products: [{ value: '', label: 'All' }, { value: 'lowStock', label: 'Low stock' }],
  customers: [{ value: '', label: 'All' }, { value: 'receivable', label: 'Owes money' }],
};

/**
 * The fields this table may give a column of their own, in the module's order.
 *
 * The title field is already the first column, and a module that links to a
 * customer gets a dedicated Customer column below — `effectiveModules` injects a
 * `customer` field for those, so including it here rendered Customer twice.
 */
const columnFields = (module, roleHidden) => module.fields.filter((f) => (
  !f.hidden && !roleHidden.includes(f.key) && LISTABLE.has(f.type)
  && f.key !== module.titleField && !(module.customerLink && f.key === 'customer')
));

function defaultColumns(module, roleHidden) {
  return columnFields(module, roleHidden).filter((f) => f.type !== 'image').slice(0, 5).map((f) => f.key);
}

function BoardCard({ record, module, refs, href }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: record._id, data: { record } });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10, position: 'relative' } : undefined;
  const fields = module.fields.filter((f) => !f.hidden && !['customer', module.boardField, module.titleField].includes(f.key) && ['reference', 'datetime', 'date', 'select', 'currency'].includes(f.type)).slice(0, 3);
  return (
    <div ref={setNodeRef} style={style} className={`board-card${isDragging ? ' dragging' : ''}`} {...listeners} {...attributes}>
      <Link href={href} className="title" onClick={(e) => isDragging && e.preventDefault()} style={{ color: 'var(--text)' }}>{recordTitle(module, record)}</Link>
      {record.customer && refs[record.customer] ? <div className="muted small">{refs[record.customer].title}</div> : null}
      {fields.map((f) => {
        const value = readField(f, record);
        return value ? <div className="row small" key={f.key}><span className="subtle">{f.label}</span><span className="grow ellipsis" style={{ textAlign: 'right' }}><FieldValue field={f} value={value} refs={refs} compact /></span></div> : null;
      })}
      {record.invoice ? <Badge tone="green" plain>Billed</Badge> : null}
    </div>
  );
}

function BoardColumn({ option, children, count }) {
  const { setNodeRef, isOver } = useDroppable({ id: option.value });
  return (
    <div ref={setNodeRef} className={`board-col${isOver ? ' over' : ''}`}>
      <div className="board-col-head"><span>{option.label}</span><span className="badge badge-neutral plain">{count}</span></div>
      {children}
    </div>
  );
}

export function ModuleList({ module }) {
  const { api, slug, href, can, hidden, currency } = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const roleHidden = hidden(module.key);
  const boardField = module.fields.find((f) => f.key === module.boardField);
  const [view, setView] = useStored(`fv:${slug}:${module.key}:view`, boardField ? 'board' : 'table');
  const [columns, setColumns] = useStored(`fv:${slug}:${module.key}:columns`, null);
  const [importing, setImporting] = useState(false);
  const [adjusting, setAdjusting] = useState(null);

  /**
   * Search, tab, filters, sort and page live in the URL, the way the document
   * lists already do it: a filtered table can then be linked to a colleague or
   * bookmarked, and Back goes where it looks like it should.
   */
  const urlParams = useSearchParams();
  const tab = urlParams.get('tab') ?? '';
  const sort = urlParams.get('sort') ?? '';
  const page = Math.max(Number(urlParams.get('page')) || 1, 1);
  const [q, setQ] = useState(() => urlParams.get('q') ?? '');
  const search = useDebounced(q);
  const filters = useMemo(
    () => Object.fromEntries([...urlParams].filter(([k]) => k.startsWith('f.')).map(([k, v]) => [k.slice(2), v])),
    [urlParams],
  );

  const setParams = (patch) => {
    const next = new URLSearchParams(urlParams);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    // Narrowing the list starts again from the top; only paging keeps its place.
    if (!('page' in patch)) next.delete('page');
    router.replace(`?${next}`, { scroll: false });
  };
  // Keep typing snappy: the box is local, the URL catches up with the debounce.
  useEffect(() => { if (search !== (urlParams.get('q') ?? '')) setParams({ q: search }); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const isBoard = view === 'board' && boardField;

  const params = useMemo(() => {
    const p = { q: search, page: isBoard ? 1 : page, limit: isBoard ? 300 : 50, sort };
    if (tab === 'lowStock') p.lowStock = '1';
    else if (tab === 'receivable') p.receivable = '1';
    else if (tab) p.state = tab;
    for (const [key, value] of Object.entries(filters)) if (value) p[`f.${key}`] = value;
    return p;
  }, [search, page, tab, filters, sort, isBoard]);

  /**
   * Whatever the table is showing — search, tab and filters — is what gets
   * exported, or just the ticked rows when there are some.
   */
  const exportHref = (format, ids) => api.url(`/records/${module.key}/export?${new URLSearchParams([
    ...Object.entries(params).filter(([k, v]) => v && k !== 'page' && k !== 'limit'),
    ...(ids?.length ? [['ids', ids.join(',')]] : []),
    ['format', format],
  ])}`);

  const key = `records:${slug}:${module.key}:${JSON.stringify(params)}`;
  const { data, loading, error, mutate } = useResource(key, () => api.get(`/records/${module.key}`, params));

  // Ticks belong to the rows on screen, so a new query starts a new selection.
  const [selected, setSelected] = useState(() => new Set());
  useEffect(() => { setSelected(new Set()); }, [key]);

  /**
   * The stored preference says *which* columns are on; the order is always the
   * module's. Storing the order too meant that once anyone opened the Columns
   * menu, that browser froze the layout and later field reorders never showed up
   * in the table — while the menu, which reads the module directly, did reorder.
   */
  const enabled = new Set(columns ?? defaultColumns(module, roleHidden));
  const visibleColumns = columnFields(module, roleHidden).filter((f) => enabled.has(f.key));
  const titleField = module.fields.find((f) => f.key === module.titleField);
  const filterable = module.fields.filter((f) => !f.hidden && f.type === 'select' && (f.options ?? []).length && f.key !== module.boardField);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function moveCard(event) {
    const record = event.active?.data?.current?.record;
    const to = event.over?.id;
    if (!record || !to) return;
    const current = readField(boardField, record);
    if (current === to) return;
    const patch = boardField.custom ? { custom: { [boardField.key]: to } } : { [boardField.key]: to };
    mutate((prev) => ({ ...prev, records: prev.records.map((r) => (r._id === record._id ? (boardField.custom ? { ...r, custom: { ...r.custom, [boardField.key]: to } } : { ...r, [boardField.key]: to }) : r)) }));
    try {
      await api.patch(`/records/${module.key}/${record._id}`, patch);
      invalidate(`dashboard:${slug}`);
    } catch (moveError) {
      toast(moveError.message, 'error');
      invalidate(`records:${slug}:${module.key}`);
    }
  }

  const records = data?.records ?? [];
  const refs = data?.refs ?? {};

  // Ticking rows is only worth offering to someone who can then do something with them.
  const canTick = can(module.key, 'delete') || can(module.key, 'export');
  const allTicked = records.length > 0 && records.every((r) => selected.has(r._id));
  const toggleRow = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allTicked ? new Set() : new Set(records.map((r) => r._id)));

  async function deleteSelected() {
    const count = selected.size;
    const noun = (count === 1 ? module.labelSingular : module.label).toLowerCase();
    if (!(await confirm({
      title: `Delete ${count} ${noun}?`,
      message: `They will be removed from lists and search. Anything already billed keeps its own copy of them.`,
      confirmLabel: `Delete ${count}`,
      danger: true,
    }))) return;
    try {
      const { deleted } = await api.post(`/records/${module.key}/bulk-delete`, { ids: [...selected] });
      setSelected(new Set());
      invalidate(`records:${slug}:${module.key}`);
      invalidate(`dashboard:${slug}`);
      toast(`Deleted ${deleted} ${(deleted === 1 ? module.labelSingular : module.label).toLowerCase()}`);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  return (
    <>
      <PageHeader
        title={module.label}
        badge={data ? <Badge tone="neutral" plain>{data.total}</Badge> : null}
        actions={(
          <>
            {can(module.key, 'create') ? <Button variant="secondary" icon={<Upload />} onClick={() => setImporting(true)}>Import</Button> : null}
            {can(module.key, 'export') ? (
              <Menu align="right" trigger={({ toggle }) => <Button variant="secondary" icon={<Download />} onClick={toggle}>Export</Button>}>
                <a className="menu-item" role="menuitem" href={exportHref('xlsx')}>Excel (.xlsx)</a>
                <a className="menu-item" role="menuitem" href={exportHref('csv')}>CSV</a>
              </Menu>
            ) : null}
            {can(module.key, 'create') ? <ButtonLink href={href(`/${module.key}/new`)} icon={<Plus />}>New {module.labelSingular.toLowerCase()}</ButtonLink> : null}
          </>
        )}
      />

      <div className="card">
        {PRESET_TABS[module.key] ? <div style={{ padding: '0 0.9rem' }}><Tabs tabs={PRESET_TABS[module.key]} value={tab} onChange={(value) => setParams({ tab: value })} /></div> : null}
        <div className="toolbar">
          <div className="input-icon grow" style={{ maxWidth: 360 }}>
            <Search aria-hidden="true" />
            <input className="input" placeholder={`Search ${module.label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          {filterable.slice(0, 3).map((f) => (
            <select key={f.key} className="input" style={{ width: 'auto', minWidth: 140 }} value={filters[f.key] ?? ''} onChange={(e) => setParams({ [`f.${f.key}`]: e.target.value })} aria-label={f.label}>
              <option value="">{f.label}: all</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ))}
          <div className="grow" />
          {!isBoard ? (
            <Menu align="right" trigger={({ toggle }) => <Button variant="ghost" size="sm" icon={<Settings2 />} onClick={toggle}>Columns</Button>}>
              <div className="menu-label">Show columns</div>
              {columnFields(module, roleHidden).map((f) => {
                const current = columns ?? defaultColumns(module, roleHidden);
                const on = current.includes(f.key);
                return (
                  <label key={f.key} className="menu-item" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={on} onChange={() => setColumns(on ? current.filter((k) => k !== f.key) : [...current, f.key])} />
                    {f.label}
                  </label>
                );
              })}
            </Menu>
          ) : null}
          {boardField ? (
            <Segmented label="View" value={view} onChange={setView} options={[{ value: 'board', icon: <KanbanSquare />, label: 'Board' }, { value: 'table', icon: <Table2 />, label: 'Table' }]} />
          ) : null}
        </div>

        {selected.size && !isBoard ? (
          <div className="bulk-bar">
            <span className="strong">{selected.size} selected</span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <div className="grow" />
            {can(module.key, 'export') ? <a className="btn btn-secondary btn-sm" href={exportHref('xlsx', [...selected])}><Download />Export selected</a> : null}
            {can(module.key, 'delete') ? <Button variant="danger" size="sm" icon={<Trash2 />} onClick={deleteSelected}>Delete</Button> : null}
          </div>
        ) : null}

        {error ? <div className="card-body"><div className="alert alert-error">{error.message}</div></div> : null}
        {loading && !data ? <SkeletonRows /> : null}

        {data && !records.length ? (
          <EmptyState
            icon={<Icon name={module.icon} />}
            title={q || tab || Object.values(filters).some(Boolean) ? `No ${module.label.toLowerCase()} match` : `No ${module.label.toLowerCase()} yet`}
            action={can(module.key, 'create') && !q ? <ButtonLink href={href(`/${module.key}/new`)} icon={<Plus />}>Add your first {module.labelSingular.toLowerCase()}</ButtonLink> : null}
          >
            {!q ? `Everything you add shows up here${boardField ? `, grouped by ${boardField.label.toLowerCase()}` : ''}.` : null}
          </EmptyState>
        ) : null}

        {data && records.length && isBoard ? (
          <div style={{ padding: '0.9rem' }}>
            <DndContext sensors={sensors} onDragEnd={moveCard}>
              <div className="board">
                {boardField.options.map((option) => {
                  const inColumn = records.filter((r) => readField(boardField, r) === option.value);
                  return (
                    <BoardColumn key={option.value} option={option} count={inColumn.length}>
                      {inColumn.map((r) => <BoardCard key={r._id} record={r} module={module} refs={refs} href={href(`/${module.key}/${r._id}`)} />)}
                    </BoardColumn>
                  );
                })}
              </div>
            </DndContext>
          </div>
        ) : null}

        {data && records.length && !isBoard ? (
          <>
            <div className="table-wrap">
              <CardTable>
                <thead>
                  <tr>
                    {canTick ? (
                      <th className="tick-col">
                        <input type="checkbox" checked={allTicked} onChange={toggleAll}
                          aria-label={allTicked ? 'Clear selection' : `Select all ${records.length} on this page`} />
                      </th>
                    ) : null}
                    <SortTh field={titleField?.key ?? 'title'} label={titleField?.label ?? 'Name'} value={sort} onChange={(next) => setParams({ sort: next })} />
                    {module.customerLink ? <th>Customer</th> : null}
                    {module.key === 'warranties' ? <th>Status</th> : null}
                    {visibleColumns.map((f) => {
                      const numeric = ['currency', 'number', 'percent'].includes(f.type);
                      return SORTABLE_TYPES.has(f.type)
                        ? <SortTh key={f.key} field={f.key} label={f.label} value={sort} onChange={(next) => setParams({ sort: next })} desc={numeric || f.type === 'date' || f.type === 'datetime'} className={numeric ? 'num' : ''} />
                        : <th key={f.key} className={numeric ? 'num' : ''}>{f.label}</th>;
                    })}
                    {module.key === 'products' ? <SortTh field="stock" label="In stock" value={sort} onChange={(next) => setParams({ sort: next })} desc className="num" /> : null}
                    {module.key === 'customers' ? <SortTh field="receivableMinor" label="Owes" value={sort} onChange={(next) => setParams({ sort: next })} desc className="num" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r._id} className="clickable" onClick={() => router.push(href(`/${module.key}/${r._id}`))}>
                      {canTick ? (
                        <td className="tick-col" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(r._id)} onChange={() => toggleRow(r._id)} aria-label={`Select ${recordTitle(module, r)}`} />
                        </td>
                      ) : null}
                      <td>
                        <div className="row">
                          {r.image || r.photo ? <img src={`${process.env.NEXT_PUBLIC_API_ORIGIN}/api/files/${r.image || r.photo}`} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }} /> : null}
                          <div>
                            <Link href={href(`/${module.key}/${r._id}`)} className="cell-title" onClick={(e) => e.stopPropagation()}>{recordTitle(module, r)}</Link>
                            {r.variants?.length ? <div className="cell-sub">{r.variants.length} variants</div> : null}
                            {module.key === 'warranties' && r.serial ? <div className="cell-sub mono">{r.serial}</div> : null}
                          </div>
                        </div>
                      </td>
                      {module.customerLink ? <td>{refs[r.customer]?.title ?? <span className="subtle">—</span>}</td> : null}
                      {module.key === 'warranties' ? <td><StatusBadge status={r.state} />{r.openClaims ? <> <Badge tone="violet" plain>{r.openClaims} open claim{r.openClaims > 1 ? 's' : ''}</Badge></> : null}</td> : null}
                      {visibleColumns.map((f) => <td key={f.key} className={['currency', 'number', 'percent'].includes(f.type) ? 'num' : ''}><FieldValue field={f} value={readField(f, r)} refs={refs} compact /></td>)}
                      {module.key === 'products' ? (
                        <td className="num" onClick={(e) => e.stopPropagation()}>
                          {!r.trackStock ? <span className="subtle">—</span> : (
                            <span className="row" style={{ justifyContent: 'flex-end' }}>
                              <span className={r.lowStock != null && r.stock <= r.lowStock ? 'strong' : ''} style={{ color: r.lowStock != null && r.stock <= r.lowStock ? 'var(--danger)' : undefined }}>{r.stock} {r.unit}</span>
                              {can('products', 'edit') ? <IconButton size="sm" icon={<PackagePlus />} label={`Adjust stock of ${r.name}`} onClick={() => setAdjusting(r)} /> : null}
                            </span>
                          )}
                        </td>
                      ) : null}
                      {module.key === 'customers' ? <td className="num">{r.receivableMinor ? money(r.receivableMinor, currency) : <span className="subtle">—</span>}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </CardTable>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={(next) => setParams({ page: next > 1 ? String(next) : '' })} />
          </>
        ) : null}
      </div>

      <ImportDialog open={importing} onClose={() => setImporting(false)} module={module} />
      {adjusting ? <StockDialog item={adjusting} open onClose={() => setAdjusting(null)} onSaved={() => invalidate(`records:${slug}:${module.key}`)} /> : null}
    </>
  );
}


