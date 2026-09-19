'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { Download, KanbanSquare, Plus, Search, Settings2, Table2, Upload } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { Badge, Button, ButtonLink, EmptyState, Menu, PageHeader, Pagination, Segmented, SkeletonRows, StatusBadge, Tabs, useToast, CardTable } from '@/components/ui';
import { FieldValue, readField } from '@/components/fields/FieldValue';
import { invalidate, useDebounced, useResource, useStored } from '@/lib/data';
import { money } from '@/lib/format';
import { recordTitle, useWorkspace } from '@/lib/workspace';
import { ImportDialog } from './ImportDialog';

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
  const roleHidden = hidden(module.key);
  const boardField = module.fields.find((f) => f.key === module.boardField);
  const [view, setView] = useStored(`fv:${slug}:${module.key}:view`, boardField ? 'board' : 'table');
  const [columns, setColumns] = useStored(`fv:${slug}:${module.key}:columns`, null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('');
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const search = useDebounced(q);
  const isBoard = view === 'board' && boardField;

  useEffect(() => setPage(1), [search, tab, filters]);

  const params = useMemo(() => {
    const p = { q: search, page: isBoard ? 1 : page, limit: isBoard ? 300 : 50 };
    if (tab === 'lowStock') p.lowStock = '1';
    else if (tab === 'receivable') p.receivable = '1';
    else if (tab) p.state = tab;
    for (const [key, value] of Object.entries(filters)) if (value) p[`f.${key}`] = value;
    return p;
  }, [search, page, tab, filters, isBoard]);

  const key = `records:${slug}:${module.key}:${JSON.stringify(params)}`;
  const { data, loading, error, mutate } = useResource(key, () => api.get(`/records/${module.key}`, params));

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

  return (
    <>
      <PageHeader
        title={module.label}
        badge={data ? <Badge tone="neutral" plain>{data.total}</Badge> : null}
        actions={(
          <>
            {can(module.key, 'create') ? <Button variant="secondary" icon={<Upload />} onClick={() => setImporting(true)}>Import</Button> : null}
            {can(module.key, 'export') ? <a className="btn btn-secondary" href={api.url(`/records/${module.key}/export?${new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== 'page' && k !== 'limit'))}`)}><Download />Export</a> : null}
            {can(module.key, 'create') ? <ButtonLink href={href(`/${module.key}/new`)} icon={<Plus />}>New {module.labelSingular.toLowerCase()}</ButtonLink> : null}
          </>
        )}
      />

      <div className="card">
        {PRESET_TABS[module.key] ? <div style={{ padding: '0 0.9rem' }}><Tabs tabs={PRESET_TABS[module.key]} value={tab} onChange={setTab} /></div> : null}
        <div className="toolbar">
          <div className="input-icon grow" style={{ maxWidth: 360 }}>
            <Search aria-hidden="true" />
            <input className="input" placeholder={`Search ${module.label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          {filterable.slice(0, 3).map((f) => (
            <select key={f.key} className="input" style={{ width: 'auto', minWidth: 140 }} value={filters[f.key] ?? ''} onChange={(e) => setFilters((prev) => ({ ...prev, [f.key]: e.target.value }))} aria-label={f.label}>
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
                    <th>{titleField?.label ?? 'Name'}</th>
                    {module.customerLink ? <th>Customer</th> : null}
                    {module.key === 'warranties' ? <th>Status</th> : null}
                    {visibleColumns.map((f) => <th key={f.key} className={['currency', 'number', 'percent'].includes(f.type) ? 'num' : ''}>{f.label}</th>)}
                    {module.key === 'products' ? <th className="num">In stock</th> : null}
                    {module.key === 'customers' ? <th className="num">Owes</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r._id} className="clickable" onClick={() => router.push(href(`/${module.key}/${r._id}`))}>
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
                      {module.key === 'products' ? <td className="num">{r.trackStock ? <span className={r.lowStock != null && r.stock <= r.lowStock ? 'strong' : ''} style={{ color: r.lowStock != null && r.stock <= r.lowStock ? 'var(--danger)' : undefined }}>{r.stock} {r.unit}</span> : <span className="subtle">—</span>}</td> : null}
                      {module.key === 'customers' ? <td className="num">{r.receivableMinor ? money(r.receivableMinor, currency) : <span className="subtle">—</span>}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </CardTable>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        ) : null}
      </div>

      <ImportDialog open={importing} onClose={() => setImporting(false)} module={module} />
    </>
  );
}


