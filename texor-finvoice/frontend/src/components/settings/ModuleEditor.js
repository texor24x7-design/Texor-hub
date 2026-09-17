'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EyeOff, GripVertical, Lock, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { Alert, Badge, Button, Dialog, Field, Switch, useConfirm, useToast } from '@/components/ui';
import { invalidate } from '@/lib/data';
import { useWorkspace } from '@/lib/workspace';
import { IconPicker } from './ModulesSettings';
import { SettingsLayout } from './SettingsLayout';

const TYPES = [
  ['text', 'Short text'], ['longtext', 'Paragraph'], ['number', 'Number'], ['currency', 'Money'], ['percent', 'Percentage'],
  ['date', 'Date'], ['datetime', 'Date & time'], ['time', 'Time'], ['select', 'Dropdown'], ['multiselect', 'Tags'],
  ['checkbox', 'Yes / no'], ['email', 'Email'], ['phone', 'Phone'], ['url', 'Link'], ['image', 'Photo'], ['reference', 'Link to a record'], ['items', 'List of items'],
];
const TYPE_LABELS = Object.fromEntries(TYPES);
const PRINTABLE_MODULES = new Set(['invoices', 'quotations', 'lines', 'products']);

const slugKey = (label) => label.trim().replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[^a-zA-Z]+/, '').replace(/^./, (c) => c.toLowerCase()).slice(0, 40) || 'field';

function FieldRow({ field, onEdit, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: field.key });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`field-row${field.hidden ? ' hidden-field' : ''}`}>
      <span className="handle" {...attributes} {...listeners} aria-label="Drag to reorder"><GripVertical size={16} /></span>
      <div className="grow">
        <div className="row" style={{ gap: 6 }}>
          <span className="strong">{field.label}</span>
          {field.required ? <Badge tone="red" plain>Required</Badge> : null}
          {field.hidden ? <Badge tone="neutral" plain><EyeOff size={11} />Hidden</Badge> : null}
          {field.printable ? <Badge tone="blue" plain><Printer size={11} />Printed</Badge> : null}
          {field.locked ? <Lock size={12} color="var(--text-subtle)" aria-label="Built in" /> : null}
        </div>
        <div className="tiny subtle">{TYPE_LABELS[field.type] ?? field.type}{field.section ? ` · ${field.section}` : ''}{field.custom ? ' · your field' : ''}</div>
      </div>
      <Button variant="ghost" size="sm" icon={<Pencil />} onClick={onEdit}>Edit</Button>
      {field.custom ? <Button variant="ghost" size="sm" icon={<Trash2 />} aria-label="Delete field" onClick={onRemove} /> : <span style={{ width: 30 }} />}
    </div>
  );
}

function FieldDialog({ open, field, moduleKey, onClose, onSave, existingKeys }) {
  const { modules } = useWorkspace();
  const [draft, setDraft] = useState(null);
  const [optionText, setOptionText] = useState('');
  useEffect(() => {
    if (!open) return;
    setDraft(field ? structuredClone(field) : { key: '', label: '', type: 'text', required: false, hidden: false, custom: true, options: [], section: '', help: '', printable: false });
    setOptionText('');
  }, [open, field]);
  if (!draft) return null;

  const isNew = !field;
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const refTargets = modules.filter((m) => m.page !== false && !m.locked && !['dashboard', 'settings', 'team', 'payments', 'invoices', 'quotations'].includes(m.key));
  const key = isNew ? slugKey(draft.label) : draft.key;
  const clash = isNew && existingKeys.includes(key);

  return (
    <Dialog open={open} onClose={onClose} title={isNew ? 'Add a field' : `Edit “${field.label}”`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!draft.label.trim() || clash || (draft.type === 'reference' && !draft.refModule) || (['select', 'multiselect'].includes(draft.type) && draft.custom && !draft.options?.length && !draft.allowNew)} onClick={() => onSave({ ...draft, key })}>{isNew ? 'Add field' : 'Done'}</Button></>}>
      <div className="stack">
        {draft.locked ? <Alert kind="info">This field is built in, so its type cannot change and it cannot be deleted. You can rename it, add help text{draft.required ? '' : ', hide it'} or move it.</Alert> : null}
        <div className="grid-2">
          <Field label="Label" required error={clash ? 'Another field already uses this name.' : undefined}><input className="input" autoFocus value={draft.label} onChange={(e) => set({ label: e.target.value })} /></Field>
          <Field label="Type">
            <select className="input" value={draft.type} disabled={!draft.custom || !isNew} onChange={(e) => set({ type: e.target.value })}>
              {!draft.custom ? <option value={draft.type}>{TYPE_LABELS[draft.type] ?? draft.type}</option> : TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        </div>
        {draft.type === 'reference' && draft.custom ? (
          <Field label="Links to" required>
            <select className="input" value={draft.refModule ?? ''} onChange={(e) => set({ refModule: e.target.value })}>
              <option value="">Choose a module…</option>{refTargets.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </Field>
        ) : null}
        {draft.type === 'items' && draft.custom ? (
          <Field label="Items come from"><select className="input" value={draft.refModule ?? 'items'} onChange={(e) => set({ refModule: e.target.value })}><option value="items">Products & services</option><option value="products">Products</option><option value="services">Services</option></select></Field>
        ) : null}
        {['select', 'multiselect'].includes(draft.type) ? (
          <Field label="Options" hint={draft.custom ? 'Press Enter to add. Drag order is the order shown.' : undefined}>
            <div className="tags">
              {(draft.options ?? []).map((o) => <span className="tag" key={o.value}>{o.label}<button type="button" aria-label={`Remove ${o.label}`} onClick={() => set({ options: draft.options.filter((x) => x.value !== o.value) })}>×</button></span>)}
              <input value={optionText} placeholder="Add an option" onChange={(e) => setOptionText(e.target.value)} onKeyDown={(e) => {
                if (e.key !== 'Enter' || !optionText.trim()) return;
                e.preventDefault();
                const label = optionText.trim();
                const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `option_${Date.now()}`;
                if (!(draft.options ?? []).some((o) => o.value === value)) set({ options: [...(draft.options ?? []), { value, label }] });
                setOptionText('');
              }} />
            </div>
          </Field>
        ) : null}
        <div className="grid-2">
          <Field label="Section" hint="Fields with the same section are grouped on the form."><input className="input" value={draft.section ?? ''} onChange={(e) => set({ section: e.target.value })} placeholder="Details" /></Field>
          <Field label="Help text"><input className="input" value={draft.help ?? ''} onChange={(e) => set({ help: e.target.value })} /></Field>
        </div>
        <div className="stack-sm">
          {!draft.locked ? <Switch checked={draft.required} onChange={(required) => set({ required })} label="Required" /> : null}
          {!draft.locked ? <Switch checked={draft.hidden} onChange={(hidden) => set({ hidden })} label="Hidden from forms and lists" /> : null}
          {PRINTABLE_MODULES.has(moduleKey) && draft.custom ? <Switch checked={draft.printable} onChange={(printable) => set({ printable })} label="Print on quotations and invoices" /> : null}
          {draft.type === 'select' && draft.custom ? <Switch checked={draft.allowNew} onChange={(allowNew) => set({ allowNew })} label="Allow typing values that are not in the list" /> : null}
        </div>
      </div>
    </Dialog>
  );
}

export function ModuleEditor({ moduleKey }) {
  const { api, apply, href } = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [module, setModule] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    api.get('/settings/modules/all').then(({ modules }) => {
      const found = modules.find((m) => m.key === moduleKey);
      setModule(found);
      if (found) setDraft({ label: found.label, labelSingular: found.labelSingular, icon: found.icon, titleField: found.titleField, boardField: found.boardField ?? null, customerLink: found.customerLink, fields: found.fields.filter((f) => !(found.custom && f.key === 'customer' && !f.custom)) });
    });
  }, [api, moduleKey]);

  const selectFields = useMemo(() => (draft?.fields ?? []).filter((f) => f.type === 'select' && (f.options ?? []).length), [draft]);
  if (!module || !draft) return <SettingsLayout section="modules" title="Loading…" />;

  async function save() {
    setBusy(true);
    try {
      const body = { label: draft.label, labelSingular: draft.labelSingular, icon: draft.icon, fields: draft.fields.map(({ locked, readOnly, refModule, custom, ...f }) => ({ ...f, ...(custom ? { custom, refModule } : {}) })) };
      if (module.custom) Object.assign(body, { titleField: draft.titleField, boardField: draft.boardField || null, customerLink: draft.customerLink });
      apply(await api.put(`/settings/modules/${moduleKey}`, body));
      invalidate('');
      toast(`${draft.label} saved`);
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  }

  async function removeModule() {
    if (!(await confirm({ title: `Delete ${module.label}?`, message: 'The module disappears for everyone, along with its records.', confirmLabel: 'Delete module', danger: true }))) return;
    try { apply(await api.del(`/settings/modules/${moduleKey}`)); router.replace(href('/settings/modules')); } catch (error) { toast(error.message, 'error'); }
  }

  const upsertField = (field) => {
    setDraft((d) => {
      const index = d.fields.findIndex((f) => f.key === field.key);
      const fields = index >= 0 ? d.fields.map((f, i) => (i === index ? field : f)) : [...d.fields, field];
      return { ...d, fields };
    });
    setEditing(null);
  };

  return (
    <SettingsLayout section="modules" title={draft.label} description={module.custom ? 'A module you created.' : `Built-in module. Rename it to suit how your business talks.`}
      actions={<>{module.custom ? <Button variant="danger-ghost" icon={<Trash2 />} onClick={removeModule}>Delete module</Button> : null}<Button onClick={save} loading={busy}>Save changes</Button></>}>
      {module.page !== false ? (
        <section className="card">
          <div className="card-header"><h2>Name & icon</h2></div>
          <div className="card-body grid-2">
            <Field label="Name in the sidebar"><input className="input" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
            <Field label="One of them"><input className="input" value={draft.labelSingular} onChange={(e) => setDraft({ ...draft, labelSingular: e.target.value })} /></Field>
            <Field label="Icon" className="span-2"><div className="row"><span className="empty-icon" style={{ width: 40, height: 40 }}><Icon name={draft.icon} /></span><div className="grow"><IconPicker value={draft.icon} onChange={(icon) => setDraft({ ...draft, icon })} /></div></div></Field>
            {module.custom ? (
              <>
                <Field label="Record title" hint="What each record is called in lists and links.">
                  <select className="input" value={draft.titleField} onChange={(e) => setDraft({ ...draft, titleField: e.target.value })}>{draft.fields.filter((f) => ['text', 'reference', 'date', 'datetime', 'select', 'number'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
                </Field>
                <Field label="Board view" hint="Show records as cards in columns, grouped by a dropdown field.">
                  <select className="input" value={draft.boardField ?? ''} onChange={(e) => setDraft({ ...draft, boardField: e.target.value || null })}><option value="">No board</option>{selectFields.map((f) => <option key={f.key} value={f.key}>Group by {f.label}</option>)}</select>
                </Field>
                <Switch checked={draft.customerLink} onChange={(customerLink) => setDraft({ ...draft, customerLink })} label="Each record belongs to a customer" />
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card-header">
          <div><h2>Fields</h2><p className="small muted">Drag to set the order on forms. Built-in fields can be renamed and moved but not deleted.</p></div>
          <Button variant="secondary" icon={<Plus />} onClick={() => setEditing('new')}>Add field</Button>
        </div>
        <div className="card-body">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return;
            setDraft((d) => ({ ...d, fields: arrayMove(d.fields, d.fields.findIndex((f) => f.key === active.id), d.fields.findIndex((f) => f.key === over.id)) }));
          }}>
            <SortableContext items={draft.fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
              {draft.fields.map((f) => <FieldRow key={f.key} field={f} onEdit={() => setEditing(f)} onRemove={() => setDraft((d) => ({ ...d, fields: d.fields.filter((x) => x.key !== f.key) }))} />)}
            </SortableContext>
          </DndContext>
        </div>
      </section>

      <FieldDialog open={Boolean(editing)} field={editing === 'new' ? null : editing} moduleKey={moduleKey} existingKeys={draft.fields.map((f) => f.key)} onClose={() => setEditing(null)} onSave={upsertField} />
    </SettingsLayout>
  );
}
