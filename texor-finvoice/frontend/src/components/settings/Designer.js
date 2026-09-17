'use client';

/**
 * The document designer.
 *
 * Left: page settings and the block tree (drag to reorder, including inside
 * columns). Centre: the real renderer on a sample or real document — click a
 * block to select it. Right: everything about the selected block.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowLeft, Columns2, Copy, FileText, GripVertical, Heading, Image as ImageIcon, Landmark, LayoutTemplate,
  ListOrdered, Minus, MoveVertical, NotebookPen, PenLine, Plus, Receipt, ScrollText, Sigma, Table, Trash2, Type, Users,
} from 'lucide-react';
import { Alert, Badge, Button, Field, Menu, MenuItem, Segmented, SkeletonRows, Switch, useToast } from '@/components/ui';
import { ImageInput } from '@/components/fields/FieldInput';
import { invalidate, useResource } from '@/lib/data';
import { BUILTIN_DESIGNS, CONDITIONS, FONTS, ITEM_COLUMNS, PAGE_SIZES, cloneDesign, newBlock } from '@/lib/shared/designs.mjs';
import { renderDocument } from '@/lib/shared/render.mjs';
import { useWorkspace } from '@/lib/workspace';
import { useDesignPreviewInputs } from './DesignsSettings';

const BLOCKS = {
  header: { label: 'Business header', icon: LayoutTemplate },
  title: { label: 'Title', icon: Heading },
  meta: { label: 'Document details', icon: ListOrdered },
  parties: { label: 'Bill to / ship to', icon: Users },
  items: { label: 'Items table', icon: Table },
  totals: { label: 'Totals', icon: Sigma },
  taxSummary: { label: 'GST summary', icon: Receipt },
  words: { label: 'Amount in words', icon: Type },
  bank: { label: 'Bank & UPI QR', icon: Landmark },
  notes: { label: 'Notes', icon: NotebookPen },
  terms: { label: 'Terms', icon: ScrollText },
  signature: { label: 'Signature', icon: PenLine },
  text: { label: 'Text', icon: FileText },
  image: { label: 'Image', icon: ImageIcon },
  divider: { label: 'Divider', icon: Minus },
  spacer: { label: 'Space', icon: MoveVertical },
  columns: { label: 'Columns', icon: Columns2 },
  footer: { label: 'Footer', icon: FileText },
};

const TAGS = ['customer.name', 'customer.gstin', 'customer.phone', 'document.number', 'document.date', 'document.dueDate', 'document.total', 'document.amountDue', 'business.name', 'business.phone', 'business.website'];

// ── tree helpers (blocks can sit at the top level or in a column) ─────────────

function findBlock(blocks, id) {
  for (const b of blocks) {
    if (b.id === id) return b;
    for (const column of b.children ?? []) {
      const found = findBlock(column, id);
      if (found) return found;
    }
  }
  return null;
}

function mapBlocks(blocks, fn) {
  return blocks.flatMap((b) => {
    const mapped = fn(b);
    if (mapped === null) return [];
    return [mapped.children ? { ...mapped, children: mapped.children.map((column) => mapBlocks(column, fn)) } : mapped];
  });
}

function reorder(blocks, container, activeId, overId) {
  if (container === 'root') {
    const from = blocks.findIndex((b) => b.id === activeId);
    const to = blocks.findIndex((b) => b.id === overId);
    return from < 0 || to < 0 ? blocks : arrayMove(blocks, from, to);
  }
  const [parentId, col] = container.split(':');
  return mapBlocks(blocks, (b) => {
    if (b.id !== parentId) return b;
    const children = b.children.map((column, i) => {
      if (i !== Number(col)) return column;
      const from = column.findIndex((x) => x.id === activeId);
      const to = column.findIndex((x) => x.id === overId);
      return from < 0 || to < 0 ? column : arrayMove(column, from, to);
    });
    return { ...b, children };
  });
}

// ── left pane ─────────────────────────────────────────────────────────────────

function BlockRow({ block, selected, onSelect, onRemove, onAddChild, container, onReorder }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: block.id, data: { container } });
  const meta = BLOCKS[block.type] ?? { label: block.type, icon: FileText };
  const Glyph = meta.icon;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <div className={`block-row${selected === block.id ? ' selected' : ''}`} onClick={() => onSelect(block.id)}>
        <span className="handle" {...attributes} {...listeners} aria-label="Drag to reorder" onClick={(e) => e.stopPropagation()}><GripVertical size={14} /></span>
        <Glyph />
        <span className="grow ellipsis">{meta.label}</span>
        {block.when ? <Badge tone="violet" plain title={CONDITIONS.find((c) => c.value === block.when)?.label}>if</Badge> : null}
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Remove ${meta.label}`} onClick={(e) => { e.stopPropagation(); onRemove(block.id); }}><Trash2 /></button>
      </div>
      {block.type === 'columns' ? (
        <div className="block-children">
          {(block.children ?? []).map((column, i) => (
            <div key={i} className="stack-sm" style={{ gap: 2 }}>
              <div className="row row-between tiny subtle" style={{ paddingLeft: 4 }}>
                Column {i + 1}
                <Menu align="right" trigger={({ toggle }) => <button type="button" className="btn btn-ghost btn-sm" style={{ height: 22 }} onClick={toggle}><Plus />Add</button>}>
                  {Object.entries(BLOCKS).filter(([t]) => t !== 'columns').map(([type, m]) => <MenuItem key={type} icon={<m.icon />} onClick={() => onAddChild(block.id, i, type)}>{m.label}</MenuItem>)}
                </Menu>
              </div>
              <SortableTree blocks={column} container={`${block.id}:${i}`} selected={selected} onSelect={onSelect} onRemove={onRemove} onAddChild={onAddChild} onReorder={onReorder} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SortableTree({ blocks, container, selected, onSelect, onRemove, onAddChild, onReorder }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (over && active.id !== over.id) onReorder(container, active.id, over.id); }}>
      <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div className="stack-sm" style={{ gap: 2 }}>
          {blocks.map((b) => <BlockRow key={b.id} block={b} container={container} selected={selected} onSelect={onSelect} onRemove={onRemove} onAddChild={onAddChild} onReorder={onReorder} />)}
          {!blocks.length ? <div className="tiny subtle" style={{ padding: '0.35rem 0.5rem' }}>Empty</div> : null}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// ── right pane ────────────────────────────────────────────────────────────────

function TagChips({ onInsert }) {
  return <div className="row wrap" style={{ gap: 4 }}>{TAGS.map((t) => <button key={t} type="button" className="tag" style={{ cursor: 'pointer' }} onClick={() => onInsert(`{{${t}}}`)}>{t}</button>)}</div>;
}

function Toggle({ props, name, label, set }) {
  return <Switch checked={props[name] !== false && Boolean(props[name] ?? true)} onChange={(v) => set({ [name]: v })} label={label} />;
}

function ColumnsEditor({ props, set, lineFields }) {
  const all = [...ITEM_COLUMNS.map((c) => c.key), ...lineFields.filter((f) => f.custom).map((f) => `custom.${f.key}`)];
  const current = props.columns?.length ? props.columns : ITEM_COLUMNS.map((c) => ({ key: c.key, show: true }));
  const columns = [...current, ...all.filter((k) => !current.some((c) => c.key === k)).map((key) => ({ key, show: false }))];
  const labelOf = (key) => ITEM_COLUMNS.find((c) => c.key === key)?.label ?? lineFields.find((f) => `custom.${f.key}` === key)?.label ?? key;
  const update = (index, patch) => set({ columns: columns.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  const move = (index, delta) => { const next = [...columns]; const to = index + delta; if (to < 0 || to >= next.length) return; [next[index], next[to]] = [next[to], next[index]]; set({ columns: next }); };
  return (
    <div className="stack-sm">
      {columns.map((c, i) => (
        <div key={c.key} className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={c.show !== false} onChange={(e) => update(i, { show: e.target.checked })} aria-label={`Show ${labelOf(c.key)}`} />
          <input className="input input-sm grow" value={c.label ?? ''} placeholder={labelOf(c.key)} onChange={(e) => update(i, { label: e.target.value })} aria-label="Column heading" />
          <input className="input input-sm num" style={{ width: 52 }} type="number" min="3" max="60" value={c.width ?? ''} placeholder={String(ITEM_COLUMNS.find((x) => x.key === c.key)?.width ?? 10)} onChange={(e) => update(i, { width: e.target.value ? Number(e.target.value) : undefined })} aria-label="Width" title="Relative width" />
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
        </div>
      ))}
      <span className="field-hint">Tick to show. Leave a heading empty to use the field's own name. Tax columns hide automatically when no GST is charged.</span>
    </div>
  );
}

function Properties({ block, update, lineFields }) {
  const { href } = useWorkspace();
  const props = block.props ?? {};
  const style = block.style ?? {};
  const set = (patch) => update({ ...block, props: { ...props, ...patch } });
  const setStyle = (patch) => update({ ...block, style: { ...style, ...patch } });
  const textRef = useRef(null);
  const insert = (key) => (tag) => {
    const el = textRef.current;
    const value = props[key] ?? '';
    const at = el?.selectionStart ?? value.length;
    set({ [key]: value.slice(0, at) + tag + value.slice(at) });
  };

  const specific = {
    header: (
      <>
        <Field label="Layout"><Segmented value={props.layout ?? 'split'} onChange={(layout) => set({ layout })} options={[{ value: 'split', label: 'Split' }, { value: 'band', label: 'Colour band' }, { value: 'inline', label: 'Inline' }, { value: 'centered', label: 'Centred' }]} /></Field>
        <Toggle props={props} name="showLogo" label="Logo" set={set} />
        <Toggle props={props} name="showAddress" label="Address" set={set} />
        <Toggle props={props} name="showContact" label="Phone, email & website" set={set} />
        <Toggle props={props} name="showGstin" label="GSTIN & state" set={set} />
        {['band', 'inline'].includes(props.layout) ? <><Switch checked={Boolean(props.showTitle)} onChange={(showTitle) => set({ showTitle })} label="Title inside the header" />{props.showTitle ? <Field label="Title"><input className="input" value={props.title ?? ''} placeholder="{{document.title}}" onChange={(e) => set({ title: e.target.value })} /></Field> : null}</> : null}
      </>
    ),
    title: (
      <>
        <Field label="Text" hint="{{document.title}} becomes “Tax Invoice” for GST invoices."><input className="input" value={props.text ?? ''} onChange={(e) => set({ text: e.target.value })} /></Field>
        <Field label="Subtitle"><input className="input" value={props.subtitle ?? ''} onChange={(e) => set({ subtitle: e.target.value })} placeholder="Original for recipient" /></Field>
      </>
    ),
    meta: (
      <>
        <Field label="Style"><Segmented value={props.style ?? 'table'} onChange={(v) => set({ style: v })} options={[{ value: 'table', label: 'Rows' }, { value: 'cards', label: 'Cards' }, { value: 'receipt', label: 'Receipt' }]} /></Field>
        <Switch checked={props.includePrintable !== false} onChange={(includePrintable) => set({ includePrintable })} label="Include your printed fields (e.g. vehicle no.)" />
      </>
    ),
    parties: (
      <>
        <Field label="Show"><Segmented value={props.show ?? 'billTo'} onChange={(show) => set({ show })} options={[{ value: 'billTo', label: 'Bill to' }, { value: 'both', label: 'Bill & ship to' }]} /></Field>
        <Field label="Bill-to heading"><input className="input" value={props.billToLabel ?? ''} onChange={(e) => set({ billToLabel: e.target.value })} placeholder="Bill to" /></Field>
        {props.show === 'both' ? <Field label="Ship-to heading"><input className="input" value={props.shipToLabel ?? ''} onChange={(e) => set({ shipToLabel: e.target.value })} placeholder="Ship to" /></Field> : null}
        <Switch checked={Boolean(props.compact)} onChange={(compact) => set({ compact })} label="Compact (name and GSTIN only)" />
      </>
    ),
    items: (
      <>
        <Field label="Layout"><Segmented value={props.layout ?? 'table'} onChange={(layout) => set({ layout })} options={[{ value: 'table', label: 'Table' }, { value: 'receipt', label: 'Receipt lines' }]} /></Field>
        {props.layout !== 'receipt' ? (
          <>
            <Switch checked={Boolean(props.striped)} onChange={(striped) => set({ striped })} label="Striped rows" />
            <Switch checked={Boolean(props.bordered)} onChange={(bordered) => set({ bordered })} label="Borders" />
            <Field label="Columns"><ColumnsEditor props={props} set={set} lineFields={lineFields} /></Field>
          </>
        ) : null}
        <Toggle props={props} name="showSerials" label="Serial numbers under items" set={set} />
        <Toggle props={props} name="showVariant" label="Variant names" set={set} />
      </>
    ),
    totals: (
      <>
        <Toggle props={props} name="showBalance" label="Paid & balance due" set={set} />
        <Switch checked={Boolean(props.highlight)} onChange={(highlight) => set({ highlight })} label="Total in accent colour" />
      </>
    ),
    taxSummary: <Switch checked={Boolean(props.compact)} onChange={(compact) => set({ compact })} label="Compact" />,
    bank: (
      <>
        <Toggle props={props} name="showBank" label="Bank account details" set={set} />
        <Toggle props={props} name="showQr" label="UPI scan-to-pay QR (when money is owed)" set={set} />
        <Switch checked={Boolean(props.compact)} onChange={(compact) => set({ compact })} label="Centred" />
      </>
    ),
    terms: <Field label="Heading"><input className="input" value={props.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="Terms & conditions" /></Field>,
    signature: (
      <>
        <Field label="Above the name"><input className="input" value={props.prefix ?? ''} onChange={(e) => set({ prefix: e.target.value })} placeholder="For" /></Field>
        <Field label="Below the line"><input className="input" value={props.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="Authorised signatory" /></Field>
        <span className="field-hint">The signature image comes from <Link href={href('/settings/branding')}>Logo & signature</Link>.</span>
      </>
    ),
    text: <><Field label="Text"><textarea ref={textRef} className="input" rows={4} value={props.text ?? ''} onChange={(e) => set({ text: e.target.value })} /></Field><TagChips onInsert={insert('text')} /></>,
    footer: <><Field label="Text"><textarea ref={textRef} className="input" rows={3} value={props.text ?? ''} onChange={(e) => set({ text: e.target.value })} /></Field><TagChips onInsert={insert('text')} /></>,
    image: <><ImageInput value={props.file} onChange={(file) => set({ file })} purpose="design" /><Field label={`Width: ${props.width ?? 30}%`}><input type="range" min="5" max="100" value={props.width ?? 30} onChange={(e) => set({ width: Number(e.target.value) })} /></Field></>,
    spacer: <Field label={`Height: ${props.height ?? 6} mm`}><input type="range" min="1" max="60" value={props.height ?? 6} onChange={(e) => set({ height: Number(e.target.value) })} /></Field>,
    columns: <Field label="Proportions"><select className="input" value={props.ratio ?? '1:1'} onChange={(e) => { const ratio = e.target.value; const n = ratio.split(':').length; update({ ...block, props: { ...props, ratio }, children: Array.from({ length: n }, (_, i) => block.children?.[i] ?? []) }); }}>{['1:1', '2:1', '1:2', '3:2', '2:3', '1:1:1'].map((r) => <option key={r}>{r}</option>)}</select></Field>,
  }[block.type];

  return (
    <div className="stack">
      <div className="row"><strong>{BLOCKS[block.type]?.label}</strong></div>
      {specific ? <div className="stack-sm">{specific}</div> : null}
      <div className="divider" />
      <Field label="Show this block"><select className="input input-sm" value={block.when ?? ''} onChange={(e) => update({ ...block, when: e.target.value })}>{CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
      <div className="section-title">Style</div>
      <Segmented value={style.align ?? ''} onChange={(align) => setStyle({ align: align || undefined })} options={[{ value: 'left', icon: <AlignLeft />, title: 'Left' }, { value: 'center', icon: <AlignCenter />, title: 'Centre' }, { value: 'right', icon: <AlignRight />, title: 'Right' }]} label="Alignment" />
      <div className="grid-2" style={{ gap: '0.5rem' }}>
        <Field label="Text size (pt)"><input className="input input-sm" type="number" min="5" max="40" step="0.5" value={style.fontSize ?? ''} placeholder="Auto" onChange={(e) => setStyle({ fontSize: e.target.value ? Number(e.target.value) : undefined })} /></Field>
        <Field label="Space above (mm)"><input className="input input-sm" type="number" min="0" max="60" value={style.marginTop ?? ''} placeholder="0" onChange={(e) => setStyle({ marginTop: e.target.value ? Number(e.target.value) : undefined })} /></Field>
        <Field label="Side padding (mm)"><input className="input input-sm" type="number" min="0" max="40" value={style.paddingX ?? ''} placeholder="0" onChange={(e) => setStyle({ paddingX: e.target.value ? Number(e.target.value) : undefined })} /></Field>
        <Field label="Vertical padding (mm)"><input className="input input-sm" type="number" min="0" max="40" value={style.paddingY ?? ''} placeholder="0" onChange={(e) => setStyle({ paddingY: e.target.value ? Number(e.target.value) : undefined })} /></Field>
        <Field label="Text colour"><input type="color" value={style.color ?? '#1f2328'} onChange={(e) => setStyle({ color: e.target.value })} style={{ width: '100%', height: 30 }} /></Field>
        <Field label="Background"><div className="row" style={{ gap: 4 }}><input type="color" value={style.background ?? '#ffffff'} onChange={(e) => setStyle({ background: e.target.value })} style={{ flex: 1, height: 30 }} />{style.background ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStyle({ background: undefined })}>None</button> : null}</div></Field>
      </div>
      <div className="row wrap">
        <Switch checked={Boolean(style.bold)} onChange={(bold) => setStyle({ bold })} label="Bold" />
        <Switch checked={Boolean(style.uppercase)} onChange={(uppercase) => setStyle({ uppercase })} label="Capitals" />
        <Switch checked={Boolean(style.borderTop)} onChange={(borderTop) => setStyle({ borderTop })} label="Line above" />
        <Switch checked={Boolean(style.borderBottom)} onChange={(borderBottom) => setStyle({ borderBottom })} label="Line below" />
      </div>
      {style.color ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStyle({ color: undefined })}>Reset text colour</button> : null}
    </div>
  );
}

// ── the screen ────────────────────────────────────────────────────────────────

export function Designer({ designKey }) {
  const { api, slug, href, module, apply } = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const { data } = useResource(`designs:${slug}`, () => api.get('/designs'));
  const inputs = useDesignPreviewInputs();
  const [design, setDesign] = useState(null);
  const [selected, setSelected] = useState(null);
  const [kind, setKind] = useState('invoices');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const frame = useRef(null);
  const canvas = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const lineFields = module('lines')?.fields ?? [];

  // The page is drawn at its real size in millimetres; zoom it down to fit the canvas.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setCanvasWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [design]);

  useEffect(() => {
    if (!data || design) return;
    const found = data.designs.find((d) => d.key === designKey);
    if (found) { const { builtin, edited, ...rest } = found; setDesign(cloneDesign(rest)); }
  }, [data, designKey, design]);

  useEffect(() => {
    const onLeave = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  const change = useCallback((next) => { setDesign(next); setDirty(true); }, []);

  const html = useMemo(() => {
    if (!design) return '';
    const quotations = module('quotations');
    const rendered = renderDocument({ ...inputs, design, kind, module: kind === 'invoices' ? inputs.module : { labelSingular: quotations?.labelSingular ?? 'Quotation', fields: quotations?.fields ?? [] } });
    const highlight = selected ? `<style>[data-block="${selected.replace(/[^\w-]/g, '')}"]{outline:2px solid #1fbf93;outline-offset:2px;border-radius:2px}</style>` : '';
    const pageMm = PAGE_SIZES.find((size) => size.value === design.page?.size)?.width ?? 210;
    const zoom = canvasWidth ? Math.min(1, (canvasWidth - 40) / (pageMm * 3.78)) : 1;
    return rendered.replace('</head>', `<style>html{zoom:${zoom.toFixed(3)}}[data-block]{cursor:pointer}[data-block]:hover{outline:1px dashed #78e2c2;outline-offset:2px}</style>${highlight}</head>`);
  }, [design, inputs, kind, selected, module, canvasWidth]);

  const wireFrame = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.addEventListener('click', (e) => {
      const el = e.target.closest('[data-block]');
      if (el) setSelected(el.getAttribute('data-block'));
    });
  };

  if (!data) return <div style={{ padding: '1.5rem' }}><SkeletonRows rows={10} /></div>;
  if (!design) return <div style={{ padding: '1.5rem' }}><Alert title="Design not found"><Link href={href('/settings/designs')}>Back to designs</Link></Alert></div>;

  const block = selected ? findBlock(design.blocks, selected) : null;
  const page = design.page;
  const setPage = (patch) => change({ ...design, page: { ...page, ...patch } });
  const updateBlock = (next) => change({ ...design, blocks: mapBlocks(design.blocks, (b) => (b.id === next.id ? next : b)) });
  const removeBlock = (id) => { change({ ...design, blocks: mapBlocks(design.blocks, (b) => (b.id === id ? null : b)) }); if (selected === id) setSelected(null); };
  const addBlock = (type) => { const b = newBlock(type); change({ ...design, blocks: [...design.blocks, b] }); setSelected(b.id); };
  const addChild = (parentId, col, type) => {
    const b = newBlock(type);
    change({ ...design, blocks: mapBlocks(design.blocks, (x) => (x.id === parentId ? { ...x, children: x.children.map((c, i) => (i === col ? [...c, b] : c)) } : x)) });
    setSelected(b.id);
  };

  async function save() {
    setBusy(true);
    try {
      const result = await api.put(`/designs/${designKey}`, design);
      apply(result);
      invalidate(`designs:${slug}`);
      invalidate(`document:${slug}`);
      setDirty(false);
      toast(`${design.name} saved — new and existing documents using it now look like this`);
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="toolbar" style={{ background: 'var(--surface)', position: 'sticky', top: 'var(--topbar-h)', zIndex: 20 }}>
        <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={() => (dirty && !window.confirm('Leave without saving your changes?') ? null : router.push(href('/settings/designs')))}>Designs</Button>
        <input className="input input-sm" style={{ width: 220, fontWeight: 600 }} value={design.name} onChange={(e) => change({ ...design, name: e.target.value })} aria-label="Design name" />
        {BUILTIN_DESIGNS[designKey] ? <Badge tone="neutral" plain>Based on {BUILTIN_DESIGNS[designKey].name}</Badge> : null}
        <div className="grow" />
        <Segmented label="Preview as" value={kind} onChange={setKind} options={[{ value: 'invoices', label: module('invoices')?.labelSingular ?? 'Invoice' }, { value: 'quotations', label: module('quotations')?.labelSingular ?? 'Quotation' }]} />
        {dirty ? <span className="tiny subtle">Unsaved changes</span> : null}
        <Button size="sm" onClick={save} loading={busy} disabled={!dirty}>Save design</Button>
      </div>

      <div className="designer">
        <aside className="designer-pane left">
          <div className="card-body stack">
            <div className="section-title">Page</div>
            <div className="grid-2" style={{ gap: '0.5rem' }}>
              <Field label="Size"><select className="input input-sm" value={page.size} onChange={(e) => setPage({ size: e.target.value })}>{PAGE_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
              <Field label="Margin (mm)"><input className="input input-sm" type="number" min="0" max="30" value={page.margin} onChange={(e) => setPage({ margin: Number(e.target.value) })} /></Field>
              <Field label="Font"><select className="input input-sm" value={page.font} onChange={(e) => setPage({ font: e.target.value })}>{FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></Field>
              <Field label="Text size (pt)"><input className="input input-sm" type="number" min="6" max="14" step="0.5" value={page.fontSize} onChange={(e) => setPage({ fontSize: Number(e.target.value) })} /></Field>
              <Field label="Accent">
                <div className="row" style={{ gap: 4 }}>
                  <input type="color" value={page.accent === 'brand' ? '#12a57f' : page.accent} onChange={(e) => setPage({ accent: e.target.value })} style={{ width: 40, height: 30 }} disabled={page.accent === 'brand'} />
                  <label className="check tiny"><input type="checkbox" checked={page.accent === 'brand'} onChange={(e) => setPage({ accent: e.target.checked ? 'brand' : '#12a57f' })} />Brand</label>
                </div>
              </Field>
              <Field label="Lines"><input type="color" value={page.border} onChange={(e) => setPage({ border: e.target.value })} style={{ width: '100%', height: 30 }} /></Field>
            </div>

            <div className="row row-between">
              <div className="section-title">Blocks</div>
              <Menu align="right" trigger={({ toggle }) => <Button size="sm" variant="secondary" icon={<Plus />} onClick={toggle}>Add block</Button>}>
                {Object.entries(BLOCKS).map(([type, m]) => <MenuItem key={type} icon={<m.icon />} onClick={() => addBlock(type)}>{m.label}</MenuItem>)}
              </Menu>
            </div>
            <SortableTree
              blocks={design.blocks}
              container="root"
              selected={selected}
              onSelect={setSelected}
              onRemove={removeBlock}
              onAddChild={addChild}
              onReorder={(container, activeId, overId) => change({ ...design, blocks: reorder(design.blocks, container, activeId, overId) })}
            />
          </div>
        </aside>

        <div className="designer-canvas" ref={canvas}>
          <iframe ref={frame} title="Design preview" srcDoc={html} sandbox="allow-same-origin" onLoad={wireFrame} />
        </div>

        <aside className="designer-pane right">
          <div className="card-body">
            {block ? (
              <>
                <Properties key={block.id} block={block} update={updateBlock} lineFields={lineFields} />
                <div className="row" style={{ marginTop: '1rem' }}>
                  <Button size="sm" variant="secondary" icon={<Copy />} onClick={() => { const copy = { ...structuredClone(block), id: `${block.type}-${Date.now().toString(36)}` }; change({ ...design, blocks: [...design.blocks, copy] }); setSelected(copy.id); }}>Duplicate</Button>
                  <Button size="sm" variant="danger-ghost" icon={<Trash2 />} onClick={() => removeBlock(block.id)}>Remove</Button>
                </div>
              </>
            ) : (
              <div className="empty" style={{ padding: '2rem 0.5rem' }}>
                <div className="empty-icon"><LayoutTemplate /></div>
                <h3>Select a block</h3>
                <p className="small">Click anything on the page, or a block in the list, to change its content, when it shows, and how it looks.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
